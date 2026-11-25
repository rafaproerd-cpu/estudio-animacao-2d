import asyncio
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi import UploadFile

import main


class RenderServerTests(unittest.TestCase):
    def test_accepts_supported_video_extensions(self):
        for name in ("clip.mp4", "clip.MOV", "clip.mkv", "clip.webm"):
            with self.subTest(name=name):
                self.assertTrue(main.safe_extension(name))

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

    def test_rejects_requests_when_server_token_is_not_configured(self):
        original = main.API_TOKEN
        try:
            main.API_TOKEN = ""
            with self.assertRaises(HTTPException) as raised:
                main.require_token("Bearer anything")
            self.assertEqual(raised.exception.status_code, 503)
        finally:
            main.API_TOKEN = original


if __name__ == "__main__":
    unittest.main()
