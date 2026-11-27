from __future__ import annotations

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import image_engine


class HuggingFaceImageEngineTests(unittest.TestCase):
    def setUp(self):
        self._original_mode = image_engine.HF_SPACE_MODE
        image_engine.HF_SPACE_MODE = "legacy"

    def tearDown(self):
        image_engine.HF_SPACE_MODE = self._original_mode

    def test_remote_generation_normalizes_gradio_file_to_png(self):
        original_space = image_engine.HF_SPACE_ID
        original_mode = image_engine.HF_SPACE_MODE
        original_token = image_engine.HF_TOKEN
        original_output = image_engine.IMAGE_OUTPUT_DIR
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                source = root / "source.webp"
                Image.new("RGB", (32, 24), (20, 40, 60)).save(source, format="WEBP")
                image_engine.HF_SPACE_ID = "owner/test-space"
                image_engine.HF_SPACE_MODE = "legacy"
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
            image_engine.HF_SPACE_MODE = original_mode
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


    def test_remote_generation_cleans_reference_temp_file_when_gradio_fails(self):
        original_space = image_engine.HF_SPACE_ID
        original_token = image_engine.HF_TOKEN
        original_output = image_engine.IMAGE_OUTPUT_DIR
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                image_engine.HF_SPACE_ID = "owner/test-space"
                image_engine.HF_TOKEN = ""
                image_engine.IMAGE_OUTPUT_DIR = root / "outputs"

                class FakeClient:
                    reference_path = None

                    def __init__(self, space_id, **kwargs):
                        pass

                    def predict(self, prompt, seed, reference_image, api_name):
                        self.__class__.reference_path = Path(reference_image)
                        raise RuntimeError("simulated Gradio failure")

                fake_module = types.SimpleNamespace(Client=FakeClient)
                with patch.dict(sys.modules, {"gradio_client": fake_module}), patch.object(
                    image_engine, "huggingface_image_engine_status",
                    return_value={"available": True, "status": "configured_unverified"},
                ):
                    with self.assertRaisesRegex(RuntimeError, "simulated Gradio failure"):
                        image_engine.generate_huggingface_image(
                            prompt="cinematic anime scene", width=512, height=512,
                            seed=123, reference_image_bytes=b"reference-image",
                        )

                self.assertIsNotNone(FakeClient.reference_path)
                self.assertFalse(FakeClient.reference_path.exists())
        finally:
            image_engine.HF_SPACE_ID = original_space
            image_engine.HF_TOKEN = original_token
            image_engine.IMAGE_OUTPUT_DIR = original_output


class LocalReferenceImageTests(unittest.TestCase):
    def test_local_img2img_loads_reference_and_uses_configured_strength(self):
        original_values = {
            "IMAGE_MODEL_ID": image_engine.IMAGE_MODEL_ID,
            "IMAGE_DEVICE": image_engine.IMAGE_DEVICE,
            "IMAGE_STEPS": image_engine.IMAGE_STEPS,
            "IMAGE_OUTPUT_DIR": image_engine.IMAGE_OUTPUT_DIR,
            "_pipeline": image_engine._pipeline,
            "_pipeline_kind": image_engine._pipeline_kind,
        }
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                reference_path = root / "reference.png"
                Image.new("RGB", (20, 10), (30, 60, 90)).save(reference_path)
                image_engine.IMAGE_MODEL_ID = "test/sdxl"
                image_engine.IMAGE_DEVICE = "cpu"
                image_engine.IMAGE_STEPS = 12
                image_engine.IMAGE_OUTPUT_DIR = root / "outputs"
                image_engine._pipeline = None
                image_engine._pipeline_kind = None

                class FakeGenerator:
                    def manual_seed(self, seed):
                        self.seed = seed
                        return self

                fake_torch = types.SimpleNamespace(
                    float16="float16", float32="float32",
                    Generator=lambda device: FakeGenerator(),
                )

                class FakePipeline:
                    received = None
                    @classmethod
                    def from_pretrained(cls, model_id, **kwargs):
                        cls.model_id = model_id
                        cls.load_kwargs = kwargs
                        return cls()
                    def to(self, device):
                        self.device = device
                        return self
                    def __call__(self, **kwargs):
                        self.__class__.received = kwargs
                        return types.SimpleNamespace(images=[Image.new("RGB", (64, 36), (1, 2, 3))])

                fake_diffusers = types.SimpleNamespace(
                    StableDiffusionXLImg2ImgPipeline=FakePipeline,
                    StableDiffusionXLPipeline=type("UnusedTextPipeline", (), {}),
                )
                with patch.object(
                    image_engine, "image_engine_status",
                    return_value={"available": True, "status": "ready"},
                ), patch.dict(sys.modules, {
                    "torch": fake_torch,
                    "diffusers": fake_diffusers,
                }), patch.dict(os.environ, {"IMAGE_REFERENCE_STRENGTH": "0.42"}):
                    output = image_engine.generate_sdxl_image(
                        prompt="same anime character in another scene",
                        negative_prompt="blurry",
                        width=768,
                        height=432,
                        seed=321,
                        reference_image_bytes=reference_path.read_bytes(),
                    )

                self.assertTrue(output.is_file())
                self.assertEqual(image_engine._pipeline_kind, "img2img")
                self.assertEqual(FakePipeline.model_id, "test/sdxl")
                self.assertEqual(FakePipeline.received["strength"], 0.42)
                self.assertEqual(FakePipeline.received["num_inference_steps"], 12)
                self.assertEqual(FakePipeline.received["image"].size, (768, 432))
                self.assertEqual(FakePipeline.received["prompt"], "same anime character in another scene")
        finally:
            for key, value in original_values.items():
                setattr(image_engine, key, value)


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
