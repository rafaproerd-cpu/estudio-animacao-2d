import asyncio
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import base64
from fastapi import BackgroundTasks, HTTPException
from fastapi import UploadFile

import main


class RenderServerTests(unittest.TestCase):
    def test_public_healthz_does_not_expose_or_require_render_token(self):
        original = main.API_TOKEN
        try:
            main.API_TOKEN = ""
            self.assertEqual(main.public_health_check(), {"ok": True})
        finally:
            main.API_TOKEN = original

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


    def test_generated_media_download_is_not_cached(self):
        original_dir = main.IMAGE_OUTPUT_DIR
        filename = "image-" + "a" * 32 + ".png"
        token = "private-download-test-token"
        original_grant = main.generation_download_tokens.get(filename)
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                main.IMAGE_OUTPUT_DIR = Path(temp_dir)
                (Path(temp_dir) / filename).write_bytes(b"test-image")
                main.generation_download_tokens[filename] = (token, main.time.time() + 60)
                response = main.download_generated_media(filename, token=token)
                self.assertEqual(response.headers.get("cache-control"), "private, no-store")
        finally:
            main.IMAGE_OUTPUT_DIR = original_dir
            if original_grant is None:
                main.generation_download_tokens.pop(filename, None)
            else:
                main.generation_download_tokens[filename] = original_grant

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
                with patch.object(main.shutil, "which", side_effect=lambda command: "/usr/bin/ffmpeg" if command == "ffmpeg" else None), patch.object(main, "video_engine_status", return_value={"available": False, "status": "wan_runtime_missing", "message": "Wan runtime ausente"}):
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
                main.request_video_generation(main.VideoGenerationRequest(prompt="anime action", imageBase64="a" * 120), BackgroundTasks(), "Bearer generation-test-token")
            self.assertEqual(video_error.exception.status_code, 503)
            self.assertIn("/v1/capabilities", video_error.exception.detail)
        finally:
            main.API_TOKEN = original_token

    def test_story_generation_endpoint_requires_authentication(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "story-test-token"
            payload = main.StoryGenerationRequest(idea="Uma aventura", genre="Aventura", duration="1 minuto")
            with self.assertRaises(HTTPException) as raised:
                main.request_story_generation(payload, "Bearer wrong-token")
            self.assertEqual(raised.exception.status_code, 401)
        finally:
            main.API_TOKEN = original_token

    def test_story_generation_endpoint_reports_unconfigured_provider(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "story-test-token"
            payload = main.StoryGenerationRequest(idea="Uma aventura", genre="Aventura", duration="1 minuto")
            with patch.object(main, "story_engine_status", return_value={"available": False, "message": "Configure o provedor"}):
                with self.assertRaises(HTTPException) as raised:
                    main.request_story_generation(payload, "Bearer story-test-token")
            self.assertEqual(raised.exception.status_code, 503)
            self.assertIn("Configure", raised.exception.detail)
        finally:
            main.API_TOKEN = original_token

    def test_story_generation_endpoint_returns_validated_ai_plan(self):
        original_token = main.API_TOKEN
        expected = {
            "title": "A jornada",
            "premise": "Uma aventura original",
            "genre": "Aventura",
            "duration": "1 minuto",
            "estimatedSeconds": None,
            "visualStyle": "2D cinematográfico",
            "continuityRules": ["Manter personagem consistente"],
            "scenes": [{"id": "scene-1", "title": "A descoberta"}],
            "generatedBy": "ai-provider",
        }
        try:
            main.API_TOKEN = "story-test-token"
            payload = main.StoryGenerationRequest(idea="Uma aventura", genre="Aventura", duration="1 minuto", character="Herói de casaco azul")
            with patch.object(main, "story_engine_status", return_value={"available": True, "message": "ready"}), patch.object(
                main, "generate_story_plan", return_value=expected
            ) as generator:
                result = main.request_story_generation(payload, "Bearer story-test-token")
            self.assertEqual(result, expected)
            generator.assert_called_once_with("Uma aventura", "Aventura", "1 minuto", "Herói de casaco azul")
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
                main.request_video_generation(main.VideoGenerationRequest(prompt="anime action", imageBase64="a" * 120), BackgroundTasks(), "Bearer wrong-token")
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
        created_job_id = None
        try:
            main.API_TOKEN = "generation-test-token"
            payload = main.ImageGenerationRequest(prompt="cinematic 2D anime scene", negativePrompt="blurry", width=1024, height=576, seed=123)
            tasks = BackgroundTasks()
            with patch.object(main, "image_engine_status", return_value={"available": True, "message": "ready"}):
                result = main.request_image_generation(payload, tasks, "Bearer generation-test-token")
            self.assertEqual(result["status"], "queued")
            created_job_id = result["job_id"]
            self.assertEqual(len(tasks.tasks), 1)
            job = main.get_generation_job(result["job_id"], "Bearer generation-test-token")
            self.assertEqual(job["status"], "queued")
        finally:
            if created_job_id:
                main.generation_jobs.pop(created_job_id, None)
            main.API_TOKEN = original_token

    def test_image_generation_accepts_png_reference_for_character_consistency(self):
        original_token = main.API_TOKEN
        created_job_id = None
        try:
            main.API_TOKEN = "generation-test-token"
            reference_bytes = b"\x89PNG\r\n\x1a\n" + (b"reference-image" * 8)
            payload = main.ImageGenerationRequest(
                prompt="same anime character in a new scene",
                referenceImageBase64=base64.b64encode(reference_bytes).decode("ascii"),
            )
            tasks = BackgroundTasks()
            with patch.object(main, "image_engine_status", return_value={"available": True, "message": "ready"}):
                result = main.request_image_generation(payload, tasks, "Bearer generation-test-token")
            created_job_id = result["job_id"]
            self.assertEqual(result["status"], "queued")
            self.assertEqual(len(tasks.tasks), 1)
            self.assertEqual(tasks.tasks[0].args[2], reference_bytes)
        finally:
            if created_job_id:
                main.generation_jobs.pop(created_job_id, None)
            main.API_TOKEN = original_token

    def test_image_generation_rejects_invalid_reference_image_signature(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            reference_bytes = b"not-a-real-png" * 8
            payload = main.ImageGenerationRequest(
                prompt="anime character",
                referenceImageBase64=base64.b64encode(reference_bytes).decode("ascii"),
            )
            with patch.object(main, "image_engine_status", return_value={"available": True, "message": "ready"}):
                with self.assertRaises(HTTPException) as raised:
                    main.request_image_generation(payload, BackgroundTasks(), "Bearer generation-test-token")
            self.assertEqual(raised.exception.status_code, 415)
        finally:
            main.API_TOKEN = original_token

    def test_image_generation_rejects_local_reference_uri_instead_of_uploaded_bytes(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            payload = main.ImageGenerationRequest(prompt="anime character", referenceImageUris=["file:///private/character.png"])
            with patch.object(main, "image_engine_status", return_value={"available": True, "message": "ready"}):
                with self.assertRaises(HTTPException) as raised:
                    main.request_image_generation(payload, BackgroundTasks(), "Bearer generation-test-token")
            self.assertEqual(raised.exception.status_code, 422)
            self.assertIn("referenceImageBase64", raised.exception.detail)
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
                response = main.download_generated_media(filename, token, None)
                self.assertEqual(Path(response.path), Path(temp_dir) / filename)
                with self.assertRaises(HTTPException) as invalid:
                    main.download_generated_media(filename, "wrong-token", None)
                self.assertEqual(invalid.exception.status_code, 401)
        finally:
            main.IMAGE_OUTPUT_DIR = original_output

    def test_image_queue_rejects_when_gpu_worker_is_busy(self):
        original_token = main.API_TOKEN
        original_limit = main.MAX_ACTIVE_IMAGE_JOBS
        job_id = "b" * 32
        try:
            main.API_TOKEN = "generation-test-token"
            main.MAX_ACTIVE_IMAGE_JOBS = 1
            main.generation_jobs[job_id] = {"status": "running", "created_at": __import__("time").time()}
            payload = main.ImageGenerationRequest(prompt="anime scene")
            with patch.object(main, "image_engine_status", return_value={"available": True, "message": "ready"}):
                with self.assertRaises(HTTPException) as raised:
                    main.request_image_generation(payload, BackgroundTasks(), "Bearer generation-test-token")
            self.assertEqual(raised.exception.status_code, 429)
        finally:
            main.generation_jobs.pop(job_id, None)
            main.API_TOKEN = original_token
            main.MAX_ACTIVE_IMAGE_JOBS = original_limit

    def test_image_job_worker_publishes_completed_result_with_private_link(self):
        original_output = main.IMAGE_OUTPUT_DIR
        job_id = "c" * 32
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                main.IMAGE_OUTPUT_DIR = Path(temp_dir)
                output = Path(temp_dir) / ("image-" + "d" * 32 + ".png")
                output.write_bytes(b"fake-png")
                main.generation_jobs[job_id] = {"status": "queued", "created_at": __import__("time").time()}
                with patch.object(main, "generate_image", return_value=output):
                    main.run_image_generation_job(job_id, main.ImageGenerationRequest(prompt="anime scene"))
                job = main.generation_jobs[job_id]
                self.assertEqual(job["status"], "completed")
                self.assertIn("/v1/files/" + output.name + "?token=", job["output_url"])
                self.assertIn(output.name, main.generation_download_tokens)
        finally:
            main.generation_jobs.pop(job_id, None)
            main.generation_download_tokens.pop(output.name, None)
            main.IMAGE_OUTPUT_DIR = original_output

    def test_video_job_is_queued_when_wan_runtime_is_ready(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            image_bytes = b"\x89PNG\r\n\x1a\n" + (b"placeholder-image-data" * 5)
            payload = main.VideoGenerationRequest(
                prompt="cinematic anime character moves gently",
                imageBase64=base64.b64encode(image_bytes).decode("ascii"),
                durationSeconds=4,
                seed=42,
            )
            tasks = BackgroundTasks()
            with patch.object(main, "video_engine_status", return_value={"available": True, "message": "ready"}):
                result = main.request_video_generation(payload, tasks, "Bearer generation-test-token")
            self.assertEqual(result["status"], "queued")
            self.assertEqual(len(tasks.tasks), 1)
            job = main.get_generation_job(result["job_id"], "Bearer generation-test-token")
            self.assertEqual(job["status"], "queued")
        finally:
            main.API_TOKEN = original_token

    def test_video_generation_rejects_non_image_base64(self):
        original_token = main.API_TOKEN
        try:
            main.API_TOKEN = "generation-test-token"
            payload = main.VideoGenerationRequest(prompt="anime", imageBase64=base64.b64encode(b"not-an-image").decode("ascii").ljust(100, "A"))
            with patch.object(main, "video_engine_status", return_value={"available": True, "message": "ready"}):
                with self.assertRaises(HTTPException) as raised:
                    main.request_video_generation(payload, BackgroundTasks(), "Bearer generation-test-token")
            self.assertEqual(raised.exception.status_code, 415)
        finally:
            main.API_TOKEN = original_token

    def test_video_job_worker_publishes_completed_result(self):
        original_output = main.WAN_OUTPUT_DIR
        job_id = "e" * 32
        output = None
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                main.WAN_OUTPUT_DIR = Path(temp_dir)
                output = Path(temp_dir) / ("video-" + "f" * 32 + ".mp4")
                output.write_bytes(b"fake-mp4")
                main.generation_jobs[job_id] = {"status": "queued", "created_at": __import__("time").time()}
                with patch.object(main, "generate_wan_video", return_value=output):
                    main.run_video_generation_job(job_id, main.VideoGenerationRequest(prompt="anime", imageBase64="a" * 120), b"image")
                job = main.generation_jobs[job_id]
                self.assertEqual(job["status"], "completed")
                self.assertIn("/v1/files/" + output.name + "?token=", job["output_url"])
        finally:
            main.generation_jobs.pop(job_id, None)
            if output is not None:
                main.generation_download_tokens.pop(output.name, None)
            main.WAN_OUTPUT_DIR = original_output


    def test_generation_jobs_and_download_tokens_survive_server_restart(self):
        original_db = main.GENERATION_STATE_DB
        original_jobs = dict(main.generation_jobs)
        original_tokens = dict(main.generation_download_tokens)
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                main.GENERATION_STATE_DB = Path(temp_dir) / "generation-state.sqlite3"
                main.generation_jobs.clear()
                main.generation_download_tokens.clear()
                main.initialize_generation_state()
                completed_id = "e" * 32
                interrupted_id = "f" * 32
                expired_id = "d" * 32
                filename = "image-" + "a" * 32 + ".png"
                main.generation_jobs[completed_id] = {
                    "status": "completed",
                    "progress": 1.0,
                    "message": "Imagem gerada.",
                    "output_url": "/v1/files/" + filename + "?token=private-token",
                    "created_at": main.time.time(),
                }
                main.generation_jobs[interrupted_id] = {
                    "status": "running",
                    "progress": 0.5,
                    "message": "Gerando imagem.",
                    "created_at": main.time.time(),
                }
                main.generation_jobs[expired_id] = {
                    "status": "completed",
                    "progress": 1.0,
                    "created_at": main.time.time() - main.JOB_RETENTION_SECONDS - 10,
                }
                main.generation_download_tokens[filename] = ("private-token", main.time.time() + 300)
                main.persist_generation_job(completed_id)
                main.persist_generation_job(interrupted_id)
                main.persist_generation_job(expired_id)
                main.persist_download_grant(filename)

                main.generation_jobs.clear()
                main.generation_download_tokens.clear()
                main.initialize_generation_state()

                self.assertEqual(main.generation_jobs[completed_id]["status"], "completed")
                self.assertEqual(main.generation_jobs[interrupted_id]["status"], "failed")
                self.assertNotIn(expired_id, main.generation_jobs)
                with main._state_connection() as connection:
                    self.assertIsNone(connection.execute(
                        "SELECT job_id FROM generation_jobs WHERE job_id=?", (expired_id,)
                    ).fetchone())
                self.assertIn("reiniciou", str(main.generation_jobs[interrupted_id]["message"]))
                self.assertEqual(main.generation_download_tokens[filename][0], "private-token")
        finally:
            main.GENERATION_STATE_DB = original_db
            main.generation_jobs.clear()
            main.generation_jobs.update(original_jobs)
            main.generation_download_tokens.clear()
            main.generation_download_tokens.update(original_tokens)

if __name__ == "__main__":
    unittest.main()
