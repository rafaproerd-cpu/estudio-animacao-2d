from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import image_engine


class HuggingFaceImageEngineTests(unittest.TestCase):
    def test_remote_generation_normalizes_gradio_file_to_png(self):
        original_space = image_engine.HF_SPACE_ID
        original_token = image_engine.HF_TOKEN
        original_output = image_engine.IMAGE_OUTPUT_DIR
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                source = root / "source.webp"
                Image.new("RGB", (32, 24), (20, 40, 60)).save(source, format="WEBP")
                image_engine.HF_SPACE_ID = "owner/test-space"
                image_engine.HF_TOKEN = "test-secret"
                image_engine.IMAGE_OUTPUT_DIR = root / "outputs"

                class FakeClient:
                    def __init__(self, space_id, **kwargs):
                        self.space_id = space_id
                        self.kwargs = kwargs

                    def predict(self, prompt, api_name):
                        self.prompt = prompt
                        self.api_name = api_name
                        return {"path": str(source)}

                fake_module = types.SimpleNamespace(Client=FakeClient)
                with patch.dict(sys.modules, {"gradio_client": fake_module}), patch.object(
                    image_engine,
                    "huggingface_image_engine_status",
                    return_value={"available": True, "status": "configured_unverified"},
                ):
                    output = image_engine.generate_huggingface_image(
                        prompt="cinematic anime scene",
                        width=512,
                        height=512,
                        seed=123,
                    )

                self.assertTrue(output.is_file())
                with Image.open(output) as generated:
                    self.assertEqual(generated.format, "PNG")
                    self.assertEqual(generated.size, (32, 24))
        finally:
            image_engine.HF_SPACE_ID = original_space
            image_engine.HF_TOKEN = original_token
            image_engine.IMAGE_OUTPUT_DIR = original_output

    def test_remote_generation_rejects_reference_image(self):
        with self.assertRaisesRegex(RuntimeError, "somente texto"):
            image_engine.generate_huggingface_image(
                prompt="scene",
                width=512,
                height=512,
                seed=None,
                reference_image_bytes=b"reference",
            )


if __name__ == "__main__":
    unittest.main()
