from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import video_engine
from video_engine import validate_mp4_output


class ReferenceImageValidationTests(unittest.TestCase):
    def test_accepts_real_png_and_jpeg_images(self):
        import io
        from PIL import Image
        for image_format in ("PNG", "JPEG"):
            with self.subTest(image_format=image_format):
                buffer = io.BytesIO()
                Image.new("RGB", (32, 18), "white").save(buffer, format=image_format)
                video_engine.validate_reference_image(buffer.getvalue())

    def test_rejects_spoofed_png_header_and_corrupted_content(self):
        fake_png = b"\\x89PNG\\r\\n\\x1a\\n" + (b"not-an-image" * 20)
        with self.assertRaisesRegex(ValueError, "corrompida"):
            video_engine.validate_reference_image(fake_png)

    def test_rejects_empty_or_oversized_payload(self):
        with self.assertRaisesRegex(ValueError, "até 18 MB"):
            video_engine.validate_reference_image(b"")
        with self.assertRaisesRegex(ValueError, "até 18 MB"):
            video_engine.validate_reference_image(b"x" * (18 * 1024 * 1024 + 1))

    def test_rejects_image_formats_other_than_png_and_jpeg(self):
        import io
        from PIL import Image
        buffer = io.BytesIO()
        Image.new("RGB", (32, 18), "white").save(buffer, format="WEBP")
        with self.assertRaisesRegex(ValueError, "PNG ou JPEG"):
            video_engine.validate_reference_image(buffer.getvalue())


class WanFrameCountTests(unittest.TestCase):
    def test_frame_count_is_within_supported_bounds_and_matches_four_n_plus_one(self):
        for duration in (0, 0.2, 1, 3, 5, 10, 30, 300):
            with self.subTest(duration=duration):
                count = video_engine.wan_frame_count(duration)
                self.assertGreaterEqual(count, 5)
                self.assertLessEqual(count, 121)
                self.assertEqual((count - 1) % 4, 0)

    def test_frame_count_scales_with_requested_duration_until_cap(self):
        self.assertLess(video_engine.wan_frame_count(2), video_engine.wan_frame_count(5))
        self.assertEqual(video_engine.wan_frame_count(30), 121)
        self.assertEqual(video_engine.wan_frame_count(300), 121)

    def test_frame_count_rejects_non_finite_durations(self):
        for duration in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(duration=duration):
                with self.assertRaisesRegex(ValueError, "número finito"):
                    video_engine.wan_frame_count(duration)


class WanOutputValidationTests(unittest.TestCase):
    def test_accepts_iso_bmff_mp4_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip.mp4"
            path.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00")
            validate_mp4_output(path)

    def test_rejects_non_mp4_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip.mp4"
            path.write_bytes(b"not-a-video-file-content")
            with self.assertRaisesRegex(RuntimeError, "MP4 válido"):
                validate_mp4_output(path)

    def test_rejects_missing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.mp4"
            with self.assertRaisesRegex(RuntimeError, "arquivo de vídeo válido"):
                validate_mp4_output(path)

    def test_status_exposes_limited_ffmpeg_fallback_when_wan_is_missing(self):
        with patch.object(video_engine, "_wan_status", return_value={
            "available": False,
            "status": "wan_runtime_missing",
            "message": "Wan2.2 não configurado.",
        }), patch.object(video_engine, "_hf_video_status", return_value={
            "available": False,
            "status": "hf_video_space_missing",
            "message": "Space remoto indisponível.",
        }), patch.object(video_engine.shutil, "which", return_value="/usr/bin/ffmpeg"):
            status = video_engine.video_engine_status()

        self.assertTrue(status["available"])
        self.assertEqual(status["status"], "ready_motion_only")
        self.assertIn("Não é geração de movimento por IA", status["message"])

    def test_fallback_creates_and_validates_an_mp4_file(self):
        import io
        from PIL import Image

        image = io.BytesIO()
        Image.new("RGB", (32, 18), "white").save(image, format="PNG")
        with tempfile.TemporaryDirectory() as output_dir:
            def fake_run(command, **kwargs):
                target = Path(command[-1])
                target.write_bytes(b"0000ftypisom0000")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch.object(video_engine, "WAN_OUTPUT_DIR", Path(output_dir)), patch.object(
                video_engine.shutil, "which", return_value="/usr/bin/ffmpeg"
            ), patch.object(video_engine.subprocess, "run", side_effect=fake_run) as run:
                output = video_engine._generate_camera_motion_video(image.getvalue(), 3)

            self.assertTrue(output.is_file())
            self.assertTrue(output.name.endswith(".mp4"))
            command = run.call_args.args[0]
            self.assertIn("zoompan", command[command.index("-vf") + 1])
            self.assertIn("libx264", command)


    def test_fallback_normalizes_jpeg_input_to_png_for_ffmpeg(self):
        import io
        from PIL import Image

        with tempfile.TemporaryDirectory() as output_dir:
            jpeg = io.BytesIO()
            Image.new("RGB", (32, 18), "white").save(jpeg, format="JPEG")
            observed = {}

            def fake_run(command, **kwargs):
                input_path = Path(command[command.index("-i") + 1])
                observed["input_signature"] = input_path.read_bytes()[:8]
                target = Path(command[-1])
                target.write_bytes(b"0000ftypisom0000")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch.object(video_engine, "WAN_OUTPUT_DIR", Path(output_dir)), patch.object(
                video_engine.shutil, "which", return_value="/usr/bin/ffmpeg"
            ), patch.object(video_engine.subprocess, "run", side_effect=fake_run):
                video_engine._generate_camera_motion_video(jpeg.getvalue(), 3)

            self.assertEqual(observed["input_signature"], b"\x89PNG\r\n\x1a\n")



class HuggingFaceVideoSpaceTests(unittest.TestCase):
    def test_calls_the_actual_wan_22_video_endpoint_with_schema_order(self):
        import io
        import sys
        from PIL import Image

        image = io.BytesIO()
        Image.new("RGB", (32, 18), "white").save(image, format="PNG")
        observed = {}
        with tempfile.TemporaryDirectory() as directory:
            remote_video = Path(directory) / "remote.mp4"
            remote_video.write_bytes(b"0000ftypisom0000")

            class FakeClient:
                def __init__(self, space_id, token=None, verbose=False):
                    observed["space_id"] = space_id
                    observed["token"] = token

                def predict(self, *args, **kwargs):
                    observed["args"] = args
                    observed["kwargs"] = kwargs
                    return (str(remote_video), 42)

            fake_module = SimpleNamespace(
                Client=FakeClient,
                handle_file=lambda path: "uploaded:" + path,
            )
            with patch.dict(sys.modules, {"gradio_client": fake_module}), patch.object(
                video_engine, "WAN_OUTPUT_DIR", Path(directory) / "outputs"
            ):
                output = video_engine._generate_huggingface_video(
                    "A personagem caminha e pisca",
                    image.getvalue(),
                    3.5,
                    123,
                )

            self.assertTrue(output.is_file())
            self.assertEqual(observed["space_id"], "zerogpu-aoti/wan2-2-fp8da-aoti-faster")
            self.assertEqual(observed["args"][0], 3.5)
            self.assertEqual(observed["args"][1:3], (1.0, 1.0))
            self.assertTrue(str(observed["args"][3]).startswith("uploaded:"))
            self.assertEqual(observed["args"][5], "A personagem caminha e pisca")
            self.assertFalse(observed["args"][6])
            self.assertEqual(observed["args"][7:], (123, 6))
            self.assertEqual(observed["kwargs"]["api_name"], "/wan2_2_fp8da_aoti_faster_generate_video")


class VideoEngineDispatchTests(unittest.TestCase):
    def test_generate_video_uses_camera_fallback_when_wan_is_unavailable(self):
        expected = Path("/tmp/fallback-scene.mp4")
        with patch.object(video_engine, "video_engine_status", return_value={
            "available": True,
            "status": "ready_motion_only",
            "model": "FFmpeg Ken Burns",
        }), patch.object(
            video_engine, "_generate_camera_motion_video", return_value=expected
        ) as fallback, patch.object(
            video_engine.subprocess, "run"
        ) as wan_process:
            result = video_engine.generate_wan_video(
                prompt="Uma personagem caminhando",
                image_bytes=b"image-bytes",
                duration_seconds=3.0,
                seed=123,
            )

        self.assertEqual(result, expected)
        fallback.assert_called_once_with(b"image-bytes", 3.0)
        wan_process.assert_not_called()

    def test_generate_video_rejects_when_no_engine_is_available(self):
        with patch.object(video_engine, "video_engine_status", return_value={
            "available": False,
            "status": "gpu_unavailable",
            "message": "Wan2.2 precisa de uma GPU CUDA compatível.",
        }), patch.object(video_engine, "_generate_camera_motion_video") as fallback:
            with self.assertRaisesRegex(RuntimeError, "GPU CUDA compatível"):
                video_engine.generate_wan_video(
                    prompt="Uma personagem caminhando",
                    image_bytes=b"image-bytes",
                    duration_seconds=3.0,
                    seed=123,
                )

        fallback.assert_not_called()



if __name__ == "__main__":
    unittest.main()
