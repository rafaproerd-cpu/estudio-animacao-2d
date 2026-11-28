import json
import unittest
from unittest.mock import patch

import story_engine


def valid_story(count=4):
    return {
        "title": "A ponte das estrelas",
        "premise": "Uma jovem encontra uma ponte luminosa.",
        "continuityRules": ["Manter o figurino e o rosto da protagonista."],
        "scenes": [
            {
                "title": f"Cena {index}",
                "purpose": "Revelar uma pista",
                "action": f"A protagonista encontra uma pista diferente {index}.",
                "dialogue": f"Isso muda tudo, etapa {index}.",
                "shot": "plano médio",
                "camera": "travelling lento",
                "lighting": "luz azul",
                "imagePrompt": f"Anime cinematográfico, cena {index}.",
                "videoPrompt": f"A protagonista caminha na cena {index}.",
            }
            for index in range(1, count + 1)
        ],
    }


class StoryEngineTests(unittest.TestCase):
    def test_openrouter_defaults_only_require_api_key(self):
        with patch.object(story_engine, "STORY_API_KEY", "secret"):
            status = story_engine.story_engine_status()
        self.assertTrue(status["available"])
        self.assertEqual(story_engine.STORY_API_URL, "https://openrouter.ai/api/v1/chat/completions")
        self.assertEqual(story_engine.STORY_MODEL, "openrouter/free")

    def test_status_requires_url_key_and_model(self):
        with patch.object(story_engine, "STORY_API_URL", ""), patch.object(
            story_engine, "STORY_API_KEY", "secret"
        ), patch.object(story_engine, "STORY_MODEL", "model"):
            status = story_engine.story_engine_status()
        self.assertFalse(status["available"])
        self.assertEqual(status["status"], "not_configured")

    def test_extracts_json_wrapped_in_markdown_fence(self):
        parsed = story_engine._extract_json(' ```json\n{"title":"Teste"}\n``` ')
        self.assertEqual(parsed["title"], "Teste")

    def test_rejects_invalid_scene_count(self):
        response = {"choices": [{"message": {"content": json.dumps(valid_story(3))}}]}
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps(response).encode()
        with patch.object(story_engine, "STORY_API_URL", "https://example.test/v1/chat/completions"), patch.object(
            story_engine, "STORY_API_KEY", "secret"
        ), patch.object(story_engine, "STORY_MODEL", "test-model"), patch.object(
            story_engine.urllib.request, "urlopen", return_value=FakeResponse()
        ):
            with self.assertRaisesRegex(ValueError, "entre 4 e 30"):
                story_engine.generate_story_plan("Uma ideia", "Aventura", "30 segundos", "Personagem")

    def test_normalizes_ai_story_to_app_contract(self):
        response = {"choices": [{"message": {"content": json.dumps(valid_story())}}]}
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps(response).encode()
        with patch.object(story_engine, "STORY_API_URL", "https://example.test/v1/chat/completions"), patch.object(
            story_engine, "STORY_API_KEY", "secret"
        ), patch.object(story_engine, "STORY_MODEL", "test-model"), patch.object(
            story_engine.urllib.request, "urlopen", return_value=FakeResponse()
        ):
            plan = story_engine.generate_story_plan("Uma ideia", "Aventura", "30 segundos", "Personagem")
        self.assertEqual(plan["generatedBy"], "ai-provider")
        self.assertEqual(len(plan["scenes"]), 4)
        self.assertEqual(plan["scenes"][0]["id"], "scene-1")
        self.assertEqual(plan["scenes"][0]["action"], "A protagonista encontra uma pista diferente 1.")
        self.assertEqual(plan["estimatedSeconds"], 30)


    def test_rejects_ai_duration_beyond_current_video_capacity(self):
        with patch.object(story_engine, "STORY_API_KEY", "secret"), patch.object(
            story_engine.urllib.request, "urlopen"
        ) as mocked_urlopen:
            with self.assertRaisesRegex(ValueError, "até 2 minutos e 30 segundos"):
                story_engine.generate_story_plan("Uma ideia", "Aventura", "3 minutos", "Personagem")
        mocked_urlopen.assert_not_called()

    def test_rejects_scene_without_narrator_text(self):
        broken = valid_story()
        broken["scenes"][0]["dialogue"] = ""
        response = {"choices": [{"message": {"content": json.dumps(broken)}}]}
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps(response).encode()
        with patch.object(story_engine, "STORY_API_URL", "https://example.test/v1/chat/completions"), patch.object(
            story_engine, "STORY_API_KEY", "secret"
        ), patch.object(story_engine, "STORY_MODEL", "test-model"), patch.object(
            story_engine.urllib.request, "urlopen", return_value=FakeResponse()
        ):
            with self.assertRaisesRegex(ValueError, "sem narração do narrador"):
                story_engine.generate_story_plan("Uma ideia", "Aventura", "30 segundos", "Personagem")

    def test_converts_supported_duration_labels_to_seconds(self):
        self.assertEqual(story_engine._duration_in_seconds("30 segundos"), 30)
        self.assertEqual(story_engine._duration_in_seconds("1 minuto"), 60)
        self.assertEqual(story_engine._duration_in_seconds("2 minutos"), 120)
        self.assertEqual(story_engine._duration_in_seconds("5 minutos"), 300)
        self.assertEqual(story_engine._duration_in_seconds("10 minutos"), 600)
        self.assertEqual(story_engine._duration_in_seconds("1 minuto e 30 segundos"), 90)
        self.assertEqual(story_engine._duration_in_seconds("2 min 15 seg"), 135)

    def test_rejects_incomplete_scene(self):
        broken = valid_story()
        broken["scenes"][0]["imagePrompt"] = ""
        response = {"choices": [{"message": {"content": json.dumps(broken)}}]}
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps(response).encode()
        with patch.object(story_engine, "STORY_API_URL", "https://example.test/v1/chat/completions"), patch.object(
            story_engine, "STORY_API_KEY", "secret"
        ), patch.object(story_engine, "STORY_MODEL", "test-model"), patch.object(
            story_engine.urllib.request, "urlopen", return_value=FakeResponse()
        ):
            with self.assertRaisesRegex(ValueError, "incompleta"):
                story_engine.generate_story_plan("Uma ideia", "Aventura", "30 segundos", "Personagem")


if __name__ == "__main__":
    unittest.main()
