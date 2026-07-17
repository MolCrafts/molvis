from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image


def import_video_module():
    src_root = Path(__file__).resolve().parents[1] / "src"
    if str(src_root) not in sys.path:
        sys.path.insert(0, str(src_root))
    import importlib

    sys.modules.pop("molvis.video", None)
    return importlib.import_module("molvis.video")


def _solid_png(color: tuple[int, int, int]) -> bytes:
    """Return a 16x16 solid-color PNG using Pillow."""
    import io

    img = Image.new("RGB", (16, 16), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_write_video_produces_mp4(tmp_path: Path):
    video = import_video_module()
    frames = [
        _solid_png((255, 0, 0)),
        _solid_png((0, 255, 0)),
        _solid_png((0, 0, 255)),
    ]
    out = tmp_path / "test.mp4"
    result = video.write_video(frames, out, fps=10)

    assert result == out
    assert out.is_file()
    # mp4 file signature: bytes 4-8 are "ftyp"
    head = out.read_bytes()[:12]
    assert b"ftyp" in head, f"Expected mp4 signature, got: {head!r}"


def test_write_video_raises_when_ffmpeg_missing(monkeypatch, tmp_path: Path):
    video = import_video_module()
    monkeypatch.setattr(video, "_find_ffmpeg_executable", lambda: None)

    with pytest.raises(video.FfmpegNotFoundError, match="ffmpeg"):
        video.write_video([b"\x89PNG\r\n\x1a\n"], tmp_path / "out.mp4")


def test_write_video_propagates_ffmpeg_error(tmp_path: Path):
    video = import_video_module()

    # Send garbage that ffmpeg cannot decode as PNG.
    with pytest.raises(RuntimeError, match="ffmpeg"):
        video.write_video([b"NOT_A_PNG"] * 3, tmp_path / "bad.mp4", fps=10)
