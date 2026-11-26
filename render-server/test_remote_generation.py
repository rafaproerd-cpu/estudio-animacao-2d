import base64
import unittest
from unittest.mock import patch

import main
from fastapi import BackgroundTasks, HTTPException


class RemoteImageQueueTests(unittest.TestCase):
    def setUp(self):
        self.original_token = main.API_TOKEN
        main.API_TOKEN = "remote-image-test-token"
        self.engine_status = {
            "available": True,
            "status": "configured_unverified",
            "provider": "Hugging Face Gradio Space",
        }

    def tearDown(self):
        main.API_TOKEN = self.original_token

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


if __name__ == "__main__":
    unittest.main()
