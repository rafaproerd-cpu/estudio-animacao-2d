import base64
import unittest
from unittest.mock import patch

import main
from fastapi import BackgroundTasks, HTTPException


class RemoteImageQueueTests(unittest.TestCase):
    def setUp(self):
        self.original_token = main.API_TOKEN
        main.API_TOKEN = "remote-image-test-token"
        self.original_jobs = dict(main.generation_jobs)
        main.generation_jobs.clear()
        self.engine_status = {
            "available": True,
            "status": "configured_unverified",
            "provider": "Hugging Face Gradio Space",
        }

    def tearDown(self):
        main.API_TOKEN = self.original_token
        main.generation_jobs.clear()
        main.generation_jobs.update(self.original_jobs)

    def test_remote_space_can_accept_an_image_job(self):
        background = BackgroundTasks()
        payload = main.ImageGenerationRequest(
            prompt="cinematic anime scene",
            width=512,
            height=512,
        )
        with patch.object(main, "image_engine_status", return_value={"available": False}), patch.object(
            main, "huggingface_image_engine_status", return_value=self.engine_status
        ), patch.object(main, "prune_generation_state"), patch.object(main, "persist_generation_job"):
            result = main.request_image_generation(payload, background, "Bearer remote-image-test-token")

        self.assertEqual(result["status"], "queued")
        self.assertEqual(len(background.tasks), 1)
        self.assertIs(background.tasks[0].func, main.run_image_generation_job)

    def test_remote_space_rejects_reference_images_before_queueing(self):
        payload = main.ImageGenerationRequest(
            prompt="cinematic anime scene",
            width=512,
            height=512,
            referenceImageBase64=base64.b64encode(b"\x89PNG\r\n\x1a\nreference").decode("ascii"),
        )
        with patch.object(main, "image_engine_status", return_value={"available": False}), patch.object(
            main, "huggingface_image_engine_status", return_value=self.engine_status
        ), patch.object(main, "prune_generation_state"), patch.object(main, "persist_generation_job"):
            with self.assertRaises(HTTPException) as raised:
                main.request_image_generation(payload, BackgroundTasks(), "Bearer remote-image-test-token")

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("somente texto", raised.exception.detail)


    def test_worker_persists_completed_image_and_download_grant(self):
        job_id = "a" * 32
        output = main.IMAGE_OUTPUT_DIR / ("image-" + job_id + ".png")
        main.generation_jobs[job_id] = {
            "status": "queued",
            "progress": 0.0,
            "message": "Aguardando o motor de imagem.",
            "created_at": 1.0,
        }
        payload = main.ImageGenerationRequest(
            prompt="cinematic anime scene",
            width=512,
            height=512,
            seed=123,
        )
        with patch.object(main, "generate_image", return_value=output), patch.object(
            main, "persist_generation_job"
        ) as persist_job, patch.object(main, "persist_download_grant") as persist_grant:
            main.run_image_generation_job(job_id, payload)

        job = main.generation_jobs[job_id]
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["progress"], 1.0)
        self.assertIn("/v1/files/", job["output_url"])
        self.assertIn(output.name, main.generation_download_tokens)
        persist_grant.assert_called_once_with(output.name)
        self.assertEqual(persist_job.call_count, 2)

    def test_worker_records_generation_failure_for_resume_ui(self):
        job_id = "b" * 32
        main.generation_jobs[job_id] = {
            "status": "queued",
            "progress": 0.0,
            "message": "Aguardando o motor de imagem.",
            "created_at": 1.0,
        }
        payload = main.ImageGenerationRequest(
            prompt="cinematic anime scene",
            width=512,
            height=512,
        )
        with patch.object(main, "generate_image", side_effect=RuntimeError("Space is sleeping")), patch.object(
            main, "persist_generation_job"
        ) as persist_job:
            main.run_image_generation_job(job_id, payload)

        job = main.generation_jobs[job_id]
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["progress"], 0.0)
        self.assertIn("Space is sleeping", job["error"])
        persist_job.assert_called_once_with(job_id)


if __name__ == "__main__":
    unittest.main()
