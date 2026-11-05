import tempfile
import unittest
from pathlib import Path

from worker.handler import (
    expand_scene_segments,
    media_blocks,
    make_srt,
    scene_duration,
    scene_prompt,
    generate_music,
    handler,
)


class AHMWorkerTests(unittest.TestCase):
    def test_long_scenes_are_split_into_supported_video_clips(self):
        scenes = [{"durationSec": 24, "action": "A camera flies through a tunnel."}]
        result = expand_scene_segments(scenes)
        self.assertEqual([item["durationSec"] for item in result], [10, 10, 4])
        self.assertIn("Continue the same action", result[1]["action"])

    def test_short_scene_duration_is_preserved_for_final_trim(self):
        self.assertEqual(scene_duration({"durationSec": 1}), 1)
        self.assertEqual(scene_duration({"durationSec": 40}), 10)

    def test_scene_prompt_keeps_style_and_continuity(self):
        story = {
            "title": "Speed of Light",
            "characters": [{"name": "Scientist", "description": "Blue coat, silver glasses"}],
            "environments": [{"name": "Lab", "description": "Dark blue physics laboratory"}],
            "props": [{"name": "Photon", "description": "Glowing golden particle"}],
        }
        scene = {"durationSec": 6, "action": "A photon races past the camera.", "visualPrompt": "Macro shot"}
        prompt = scene_prompt(story, scene, 0, 4)
        self.assertIn("vertical 9:16", prompt)
        self.assertIn("Blue coat, silver glasses", prompt)
        self.assertIn("Glowing golden particle", prompt)
        self.assertIn("Do not add", prompt)

    def test_media_blocks_only_reads_model_output(self):
        interaction = {
            "steps": [
                {"type": "user_input", "content": [{"type": "video", "data": "wrong"}]},
                {"type": "model_output", "content": [{"type": "video", "data": "right"}]},
            ]
        }
        self.assertEqual(media_blocks(interaction, "video"), [{"type": "video", "data": "right"}])

    def test_music_is_off_by_default_and_paid_generation_is_guarded(self):
        self.assertIsNone(generate_music({"productionSettings": {"musicEnabled": False}}, "/tmp/unused.mp3"))
        previous = __import__("os").environ.get("LYRIA_ENABLED")
        __import__("os").environ["LYRIA_ENABLED"] = "false"
        try:
            with self.assertRaisesRegex(RuntimeError, "Lyria is not enabled"):
                generate_music({"productionSettings": {"musicEnabled": True}}, "/tmp/unused.mp3")
        finally:
            if previous is None:
                __import__("os").environ.pop("LYRIA_ENABLED", None)
            else:
                __import__("os").environ["LYRIA_ENABLED"] = previous

    def test_worker_raises_failures_so_RunPod_marks_the_job_failed(self):
        import os
        previous = os.environ.pop("GEMINI_API_KEY", None)
        try:
            with self.assertRaisesRegex(RuntimeError, "GEMINI_API_KEY is missing"):
                handler({"input": {"story": {"scenes": [{"action": "A scene"}]}}})
        finally:
            if previous is not None:
                os.environ["GEMINI_API_KEY"] = previous

    def test_subtitles_use_scene_timing_and_preserve_phrases(self):
        story = {
            "scenes": [
                {
                    "start": 0,
                    "end": 6,
                    "narration": "Light moves fast. It crosses space.",
                    "subtitlePhrases": ["Light moves fast.", "It crosses space."],
                }
            ]
        }
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "captions.srt"
            make_srt(story, path)
            content = path.read_text(encoding="utf-8")
        self.assertIn("00:00:00,000 -->", content)
        self.assertIn("Light moves fast.", content)
        self.assertIn("It crosses space.", content)


if __name__ == "__main__":
    unittest.main()
