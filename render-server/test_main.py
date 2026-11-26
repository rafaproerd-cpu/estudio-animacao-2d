import asyncio
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import BackgroundTasks, HTTPException
from fastapi import UploadFile

import main


class RenderServerTests(unittest.TestCase):
    def test_accepts_supported_video_extensions(self):
        for name in ("clip.mp4", "clip.MOV", "clip.mkv", "clip.webm"):
            with self.subTest(name=name):
                self.assertTrue(main.safe_extension(name))

    def test_accepts_supported_audio_extensions(self):
        for name in ("voice.mp3", "music.wav", "track.m4a", "voice.aac", "music.ogg", "track.flac"):
            with self.subTest(name=name):
                self.assertTrue(main.safe_audio_extension(name))

    def test_rejects_unsupported_audio_extension(self):
        with self.assertRaises(HTTPException) as raised:
            main.safe_audio_extension("voice.exe")
        self.assertEqual(raised.exception.status_code, 415)

    def test_rejects_unsupported_or_missing_extension(self):
        for name in ("clip.txt", "clip", "../clip.exe"):
            with self.subTest(name=name):
                with self.assertRaises(HTTPException) as raised:
                    main.safe_extension(name)
                self.assertEqual(raised.exception.status_code, 415)

    def test_requires_configured_bearer_token(self):
        original = main.API_TOKEN
        try:
            main.API_TOKEN = "test-token-for-unit-tests"
            main.require_token("Bearer test-token-for-unit-tests")
            with self.assertRaises(HTTPException) as raised:
                main.require_token("Bearer wrong-token")
            self.assertEqual(raised.exception.status_code, 401)
        finally:
            main.API_TOKEN = original


    def test_detects_nvidia_gpus_from_nvidia_smi(self):
        completed = type("Result", (), {"returncode": 0, "stdout": "NVIDIA RTX 4090, 24564, 22000, 550.54.14", "stderr": ""})()
        with patch.object(main.shutil, "which", return_value="/usr/bin/nvidia-smi"), patch.object(main.subprocess, "run", return_value=completed) as mocked:
            self.assertEqual(main.available_nvidia_gpus(), [{
                "name": "NVIDIA RTX 4090",
                "memory_total_mb": "24564",
                "memory_free_mb": "22000",
                "driver_version": "550.54.14",
            }])
            self.assertIn("memory.free", mocked.call_args.args[0][1])

    def test_gpu_detection_returns_empty_when_nvidia_smi_fails(self):
        completed = type("Result", (), {"returncode": 1, "stdout": "", "stderr": "driver unavailable"})()
        with patch.object(main.shutil, "which", return_value="/usr/bin/nvidia-smi"), patch.object(main.subprocess, "run", return_value=completed):
            self.assertEqual(main.available_nvidia_gpus(), [])

    def test_gpu_detection_is_optional_when_nvidia_smi_is_missing(self):
        with patch.object(main.shutil, "which", return_value=None):
            self.assertEqual(main.available_nvidia_gpus(), [])

    def test_lists_local_piper_voice_models(self):
        original = main.PIPER_VOICES_DIR
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                main.PIPER_VOICES_DIR = Path(temp_dir)
                (Path(temp_dir) / "pt_BR-faber-medium.onnx").write_bytes(b"model")
                (Path(temp_dir) / "not-a-model.txt").write_text("ignored")
                self.assertEqual(main.available_piper_voices(), ["pt_BR-faber-medium"])
        finally:
            main.PIPER_VOICES_DIR = original

    def test_tts_rejects_empty_text_and_invalid_voice(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "integration-test-token"
            with self.assertRaises(HTTPException) as empty:
                main.generate_tts(main.TTSRequest(text="  ", voice="voice"), "Bearer integration-test-token")
            self.assertEqual(empty.exception.status_code, 400)
            with self.assertRaises(HTTPException) as invalid:
                main.generate_tts(main.TTSRequest(text="Olá", voice="../voice"), "Bearer integration-test-token")
            self.assertEqual(invalid.exception.status_code, 400)
        finally:
            main.API_TOKEN = original_token

    def test_tts_rejects_missing_voice_model(self):
        original_token = main.API_TOKEN
        original_voices = main.PIPER_VOICES_DIR
        try:
            main.API_TOKEN = "integration-test-token"
            with tempfile.TemporaryDirectory() as temp_dir:
                main.PIPER_VOICES_DIR = Path(temp_dir)
                with self.assertRaises(HTTPException) as raised:
                    main.generate_tts(main.TTSRequest(text="Olá", voice="pt_BR-test"), "Bearer integration-test-token")
                self.assertEqual(raised.exception.status_code, 404)
        finally:
            main.API_TOKEN = original_token
            main.PIPER_VOICES_DIR = original_voices

    def test_tts_generates_wav_with_local_piper_model(self):
        original_token = main.API_TOKEN
        original_voices = main.PIPER_VOICES_DIR
        original_output = main.OUTPUT_DIR
        try:
            main.API_TOKEN = "integration-test-token"
            with tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                voices = root / "voices"
                voices.mkdir()
                (voices / "pt_BR-test.onnx").write_bytes(b"model")
                main.PIPER_VOICES_DIR = voices
                main.OUTPUT_DIR = root / "outputs"
                def fake_run(command, **kwargs):
                    Path(command[command.index("--output_file") + 1]).write_bytes(b"RIFFfake-wav")
                    class Result:
                        returncode = 0
                        stderr = ""
                    return Result()
                with patch.object(main.shutil, "which", return_value="/usr/bin/piper"), patch.object(main.subprocess, "run", side_effect=fake_run):
                    result = main.generate_tts(main.TTSRequest(text="Olá, mundo!", voice="pt_BR-test"), "Bearer integration-test-token")
                self.assertTrue(result.download_url.startswith("/tts/"))
                self.assertTrue((main.OUTPUT_DIR / ("tts-" + result.id + ".wav")).is_file())
        finally:
            main.API_TOKEN = original_token
            main.PIPER_VOICES_DIR = original_voices
            main.OUTPUT_DIR = original_output
    def test_tts_batch_generates_combined_audio_with_multiple_voices(self):
        original_token = main.API_TOKEN
        original_voices = main.PIPER_VOICES_DIR
        original_output = main.OUTPUT_DIR
        try:
            main.API_TOKEN = "integration-test-token"
            with tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                voices = root / "voices"
                voices.mkdir()
                (voices / "voice-a.onnx").write_bytes(b"model-a")
                (voices / "voice-b.onnx").write_bytes(b"model-b")
                main.PIPER_VOICES_DIR = voices
                main.OUTPUT_DIR = root / "outputs"
                def fake_piper(command, **kwargs):
                    Path(command[command.index("--output_file") + 1]).write_bytes(b"RIFFfake-wav")
                    class Result:
                        returncode = 0
                        stderr = ""
                    return Result()
                def fake_ffmpeg(arguments):
                    Path(arguments[-1]).write_bytes(b"RIFFcombined-wav")
                segments = [main.TTSRequest(text="Olá", voice="voice-a"), main.TTSRequest(text="", voice="voice-a"), main.TTSRequest(text="Tudo bem?", voice="voice-b")]
                with patch.object(main.shutil, "which", return_value="/usr/bin/piper"), patch.object(main.subprocess, "run", side_effect=fake_piper), patch.object(main, "run_ffmpeg", side_effect=fake_ffmpeg) as ffmpeg:
                    result = main.generate_tts_batch(main.TTSBatchRequest(segments=segments), "Bearer integration-test-token")
                self.assertEqual(result.voice, "multiple")
                self.assertEqual(ffmpeg.call_count, 4)
                self.assertTrue(any(any("anullsrc" in argument for argument in call.args[0]) for call in ffmpeg.call_args_list))
                self.assertTrue((main.OUTPUT_DIR / ("tts-" + result.id + ".wav")).is_file())
        finally:
            main.API_TOKEN = original_token
            main.PIPER_VOICES_DIR = original_voices
            main.OUTPUT_DIR = original_output
    def test_render_endpoint_normalizes_clips_and_returns_download_path(self):
        original_token = main.API_TOKEN
        original_output = main.OUTPUT_DIR
        try:
            main.API_TOKEN = "integration-test-token"
            with tempfile.TemporaryDirectory() as temp_dir:
                main.OUTPUT_DIR = Path(temp_dir)

                def fake_ffmpeg(arguments):
                    Path(arguments[-1]).write_bytes(b"fake-mp4")

                upload = UploadFile(filename="first-scene.mp4", file=BytesIO(b"fake-source-video"))
                with patch.object(main, "run_ffmpeg", side_effect=fake_ffmpeg) as mocked:
                    result = asyncio.run(main.render_video(
                        [upload],
                        None,
                        None,
                        "Minha história",
                        "Bearer integration-test-token",
                    ))

                self.assertTrue(result.download_url.startswith("/render/"))
                self.assertEqual(mocked.call_count, 2)
                rendered_file = main.OUTPUT_DIR / f"{result.id}.mp4"
                self.assertTrue(rendered_file.is_file())
                self.assertGreater(rendered_file.stat().st_size, 0)
        finally:
            main.API_TOKEN = original_token
            main.OUTPUT_DIR = original_output

    def test_capabilities_report_unconfigured_image_and_video_engines(self):
        original_token = main.API_TOKEN
        original_voices = main.PIPER_VOICES_DIR
        try:
            main.API_TOKEN = "capabilities-test-token"
            with tempfile.TemporaryDirectory() as temp_dir:
                main.PIPER_VOICES_DIR = Path(temp_dir)
                with patch.object(main.shutil, "which", side_effect=lambda command: "/usr/bin/ffmpeg" if command == "ffmpeg" else None):
                    result = main.generation_capabilities("Bearer capabilities-test-token")
            self.assertFalse(result["engines"]["image"]["available"])
            self.assertEqual(result["engines"]["image"]["status"], "not_configured")
            self.assertFalse(result["engines"]["video"]["available"])
            self.assertFalse(result["engines"]["audio"]["available"])
            self.assertTrue(result["engines"]["render"]["available"])
            self.assertEqual(result["hardware"]["gpu_detection"], "not_detected")
            self.assertEqual(result["hardware"]["nvidia_gpus"], [])
        finally:
            main.API_TOKEN = original_token
            main.PIPER_VOICES_DIR = original_voices

    def test_image_and_video_generation_fail_clearly_until_models_are_installed(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            with patch.object(main, "image_engine_status", return_value={"available": False, "message": "Modelo SDXL ausente"}):
                with self.assertRaises(HTTPException) as image_error:
                    main.request_image_generation(main.ImageGenerationRequest(prompt="anime cinematic scene"), BackgroundTasks(), "Bearer generation-test-token")
                self.assertEqual(image_error.exception.status_code, 503)
                self.assertIn("/v1/capabilities", image_error.exception.detail)
            with self.assertRaises(HTTPException) as video_error:
                main.request_video_generation("Bearer generation-test-token")
            self.assertEqual(video_error.exception.status_code, 503)
            self.assertIn("/v1/capabilities", video_error.exception.detail)
        finally:
            main.API_TOKEN = original_token

    def test_generation_endpoints_still_require_authentication(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            with self.assertRaises(HTTPException) as image_error:
                main.request_image_generation(main.ImageGenerationRequest(prompt="anime cinematic scene"), BackgroundTasks(), "Bearer wrong-token")
            self.assertEqual(image_error.exception.status_code, 401)
            with self.assertRaises(HTTPException) as video_error:
                main.request_video_generation("Bearer wrong-token")
            self.assertEqual(video_error.exception.status_code, 401)
        finally:
            main.API_TOKEN = original_token

    def test_rejects_requests_when_server_token_is_not_configured(self):
        original = main.API_TOKEN
        try:
            main.API_TOKEN = ""
            with self.assertRaises(HTTPException) as raised:
                main.require_token("Bearer anything")
            self.assertEqual(raised.exception.status_code, 503)
        finally:
            main.API_TOKEN = original

    def test_image_job_is_queued_only_when_engine_is_ready(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            payload = main.ImageGenerationRequest(prompt="cinematic 2D anime scene", negativePrompt="blurry", width=1024, height=576, seed=123)
            tasks = BackgroundTasks()
            with patch.object(main, "image_engine_status", return_value={"available": True, "message": "ready"}):
                result = main.request_image_generation(payload, tasks, "Bearer generation-test-token")
            self.assertEqual(result["status"], "queued")
            self.assertEqual(len(tasks.tasks), 1)
            job = main.get_generation_job(result["job_id"], "Bearer generation-test-token")
            self.assertEqual(job["status"], "queued")
        finally:
            main.API_TOKEN = original_token

    def test_image_generation_rejects_reference_images_until_img2img_is_supported(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            payload = main.ImageGenerationRequest(prompt="anime character", referenceImageUris=["file:///private/character.png"])
            with patch.object(main, "image_engine_status", return_value={"available": True, "message": "ready"}):
                with self.assertRaises(HTTPException) as raised:
                    main.request_image_generation(payload, BackgroundTasks(), "Bearer generation-test-token")
            self.assertEqual(raised.exception.status_code, 422)
            self.assertIn("image-to-image", raised.exception.detail)
        finally:
            main.API_TOKEN = original_token

    def test_image_job_requires_authentication_and_valid_identifier(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            with self.assertRaises(HTTPException) as unauthorized:
                main.get_generation_job("a" * 32, "Bearer wrong-token")
            self.assertEqual(unauthorized.exception.status_code, 401)
            with self.assertRaises(HTTPException) as invalid:
                main.get_generation_job("../job", "Bearer generation-test-token")
            self.assertEqual(invalid.exception.status_code, 404)
        finally:
            main.API_TOKEN = original_token

    def test_generated_image_download_uses_expiring_capability_token(self):
        original_output = main.IMAGE_OUTPUT_DIR
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                main.IMAGE_OUTPUT_DIR = Path(temp_dir)
                filename = "image-" + "a" * 32 + ".png"
                (Path(temp_dir) / filename).write_bytes(b"fake-png")
                token = "one-time-private-download-token"
                main.generation_download_tokens[filename] = (token, __import__("time").time() + 60)
                response = main.download_generated_image(filename, token, None)
                self.assertEqual(response.path, str(Path(temp_dir) / filename))
                with self.assertRaises(HTTPException) as invalid:
                    main.download_generated_image(filename, "wrong-token", None)
                self.assertEqual(invalid.exception.status_code, 401)
        finally:
            main.IMAGE_OUTPUT_DIR = original_output


if __name__ == "__main__":
    unittest.main()
