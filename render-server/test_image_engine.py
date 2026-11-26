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
                    last_seed = None
                    last_reference = None
                    reference_was_available = False

                    def __init__(self, space_id, **kwargs):
                        self.space_id = space_id
                        self.kwargs = kwargs

                    def predict(self, prompt, seed, reference_image, api_name):
                        self.prompt = prompt
                        self.seed = seed
                        FakeClient.last_seed = seed
                        FakeClient.last_reference = reference_image
                        FakeClient.reference_was_available = bool(reference_image and Path(reference_image).is_file())
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

                self.assertEqual(FakeClient.last_seed, 123)
                self.assertTrue(output.is_file())
                with Image.open(output) as generated:
                    self.assertEqual(generated.format, "PNG")
                    self.assertEqual(generated.size, (32, 24))
        finally:
            image_engine.HF_SPACE_ID = original_space
            image_engine.HF_TOKEN = original_token
            image_engine.IMAGE_OUTPUT_DIR = original_output

    def test_remote_generation_passes_reference_image_to_gradio_and_cleans_temp_file(self):
        original_space = image_engine.HF_SPACE_ID
        original_token = image_engine.HF_TOKEN
        original_output = image_engine.IMAGE_OUTPUT_DIR
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                source = root / "source.png"
                Image.new("RGB", (32, 24), (20, 40, 60)).save(source, format="PNG")
                image_engine.HF_SPACE_ID = "owner/test-space"
                image_engine.HF_TOKEN = ""
                image_engine.IMAGE_OUTPUT_DIR = root / "outputs"

                class FakeClient:
                    reference_path = None
                    reference_was_available = False
                    def __init__(self, space_id, **kwargs):
                        pass
                    def predict(self, prompt, seed, reference_image, api_name):
                        self.__class__.reference_path = reference_image
                        self.__class__.reference_was_available = Path(reference_image).is_file()
                        return {"path": str(source)}

                fake_module = types.SimpleNamespace(Client=FakeClient)
                with patch.dict(sys.modules, {"gradio_client": fake_module}), patch.object(
                    image_engine, "huggingface_image_engine_status",
                    return_value={"available": True, "status": "configured_unverified"},
                ):
                    image_engine.generate_huggingface_image(
                        prompt="cinematic anime scene", width=512, height=512,
                        seed=123, reference_image_bytes=b"\x89PNG\r\n\x1a\nreference",
                    )
                self.assertTrue(FakeClient.reference_was_available)
                self.assertFalse(Path(FakeClient.reference_path).exists())
        finally:
            image_engine.HF_SPACE_ID = original_space
            image_engine.HF_TOKEN = original_token
            image_engine.IMAGE_OUTPUT_DIR = original_output


class ImageEngineDispatchTests(unittest.TestCase):
    def test_generate_image_prefers_local_engine_when_available(self):
        expected = Path("/tmp/local-image.png")
        with patch.object(image_engine, "image_engine_status", return_value={
            "available": True, "status": "ready", "model": "local-sdxl",
        }), patch.object(
            image_engine, "generate_sdxl_image", return_value=expected
        ) as local, patch.object(
            image_engine, "generate_huggingface_image"
        ) as remote:
            result = image_engine.generate_image(
                prompt="cinematic anime scene",
                negative_prompt=None,
                width=1024,
                height=576,
                seed=77,
                reference_image_bytes=b"reference",
            )

        self.assertEqual(result, expected)
        local.assert_called_once_with(
            prompt="cinematic anime scene",
            negative_prompt=None,
            width=1024,
            height=576,
            seed=77,
            reference_image_bytes=b"reference",
        )
        remote.assert_not_called()

    def test_generate_image_uses_huggingface_when_local_engine_is_unavailable(self):
        expected = Path("/tmp/remote-image.png")
        with patch.object(image_engine, "image_engine_status", return_value={
            "available": False, "status": "gpu_unavailable",
        }), patch.object(
            image_engine, "generate_sdxl_image"
        ) as local, patch.object(
            image_engine, "generate_huggingface_image", return_value=expected
        ) as remote:
            result = image_engine.generate_image(
                prompt="cinematic anime scene",
                negative_prompt="blur",
                width=1024,
                height=576,
                seed=88,
                reference_image_bytes=None,
            )

        self.assertEqual(result, expected)
        local.assert_not_called()
        remote.assert_called_once_with(
            prompt="cinematic anime scene",
            width=1024,
            height=576,
            seed=88,
            reference_image_bytes=None,
        )


if __name__ == "__main__":
    unittest.main()
