from __future__ import annotations

from pathlib import Path

import pytest

from molvis import video


def test_write_video_raises_when_ffmpeg_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(video, "_find_ffmpeg_executable", lambda: None)

    with pytest.raises(video.FfmpegNotFoundError, match="ffmpeg"):
        video.write_video([b"\x89PNG\r\n\x1a\n"], tmp_path / "out.mp4")
