from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import video_engine
from video_engine import validate_mp4_output


class WanOutputValidationTests(unittest.TestCase):
    def test_accepts_iso_bmff_mp4_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip.mp4"
            path.write_bytes(b"\\x00\\x00\\x00\\x18ftypisom\\x00\\x00\\x02\\x00")
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
        }), patch.object(video_engine.shutil, "which", return_value="/usr/bin/ffmpeg"):
            status = video_engine.video_engine_status()

        self.assertTrue(status["available"])
        self.assertEqual(status["status"], "ready_motion_only")
        self.assertIn("Não é geração de movimento por IA", status["message"])

    def test_fallback_creates_and_validates_an_mp4_file(self):
        with tempfile.TemporaryDirectory() as output_dir:
            def fake_run(command, **kwargs):
                target = Path(command[-1])
                target.write_bytes(b"0000ftypisom0000")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch.object(video_engine, "WAN_OUTPUT_DIR", Path(output_dir)), patch.object(
                video_engine.shutil, "which", return_value="/usr/bin/ffmpeg"
            ), patch.object(video_engine.subprocess, "run", side_effect=fake_run) as run:
                output = video_engine._generate_camera_motion_video(b"fake image bytes", 3)

            self.assertTrue(output.is_file())
            self.assertTrue(output.name.endswith(".mp4"))
            command = run.call_args.args[0]
            self.assertIn("zoompan", command[command.index("-vf") + 1])
            self.assertIn("libx264", command)


if __name__ == "__main__":
    unittest.main()
