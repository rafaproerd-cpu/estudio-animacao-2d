from pathlib import Path
import tempfile
import unittest

from video_engine import validate_mp4_output


class WanOutputValidationTests(unittest.TestCase):
    def test_accepts_iso_bmff_mp4_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip.mp4"
            path.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00")
            validate_mp4_output(path)

    def test_rejects_non_mp4_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip.mp4"
            path.write_bytes(b"not-a-video-file-content")
            with self.assertRaisesRegex(RuntimeError, "MP4 válido"):
                validate_mp4_output(path)

    def test_rejects_missing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.mp4"
            with self.assertRaisesRegex(RuntimeError, "arquivo de vídeo válido"):
                validate_mp4_output(path)


if __name__ == "__main__":
    unittest.main()
