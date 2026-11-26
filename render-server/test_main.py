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
        completed = type("Result", (), {"returncode": 0, "stdout": "NVIDIA RTX 4090, 24564", "stderr": ""})()
        with patch.object(main.shutil, "which", return_value="/usr/bin/nvidia-smi"), patch.object(main.subprocess, "run", return_value=completed):
            self.assertEqual(main.available_nvidia_gpus(), [{"name": "NVIDIA RTX 4090", "memory_mb": "24564"}])

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
            for endpoint in (main.request_image_generation, main.request_video_generation):
                with self.subTest(endpoint=endpoint.__name__):
                    with self.assertRaises(HTTPException) as raised:
                        endpoint("Bearer generation-test-token")
                    self.assertEqual(raised.exception.status_code, 503)
                    self.assertIn("/v1/capabilities", raised.exception.detail)
        finally:
            main.API_TOKEN = original_token

    def test_generation_endpoints_still_require_authentication(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            for endpoint in (main.request_image_generation, main.request_video_generation):
                with self.subTest(endpoint=endpoint.__name__):
                    with self.assertRaises(HTTPException) as raised:
                        endpoint("Bearer wrong-token")
                    self.assertEqual(raised.exception.status_code, 401)
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


if __name__ == "__main__":
    unittest.main()
