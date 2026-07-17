"""Pipe a stream of PNG frames into ffmpeg to produce a video file."""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Iterable
from pathlib import Path

__all__ = ["FfmpegNotFoundError", "write_video"]


class FfmpegNotFoundError(RuntimeError):
    """Raised when neither system nor bundled FFmpeg is available."""


def _find_ffmpeg_executable() -> str | None:
    """Resolve a system FFmpeg or the binary supplied by imageio-ffmpeg."""
    if executable := shutil.which("ffmpeg"):
        return executable

    try:
        from imageio_ffmpeg import get_ffmpeg_exe
    except ImportError:
        return None

    try:
        executable = get_ffmpeg_exe()
    except RuntimeError:
        return None
    return executable if Path(executable).is_file() else None


def write_video(
    frames: Iterable[bytes],
    path: str | Path,
    *,
    fps: int = 30,
    codec: str = "libx264",
    crf: int = 18,
    pix_fmt: str = "yuv420p",
    extra_args: list[str] | None = None,
) -> Path:
    """Encode ``frames`` (PNG bytes) into a video at ``path`` via ffmpeg.

    Defaults produce a browser-playable mp4 (``yuv420p`` + ``+faststart``).
    The function streams frames into ffmpeg's stdin, so memory usage stays
    bounded regardless of trajectory length.

    Args:
        frames: Iterable of PNG byte payloads (e.g. ``viewer.snapshot()``).
        path: Output file path; parent directory must exist.
        fps: Output frame rate.
        codec: ffmpeg ``-c:v`` codec name.
        crf: Constant Rate Factor (lower = higher quality, 18 is visually
            lossless for libx264).
        pix_fmt: Pixel format. ``yuv420p`` is required for QuickTime /
            browser playback.
        extra_args: Additional ffmpeg arguments inserted before the output
            path (e.g. ``["-vf", "scale=1920:1080"]``).

    Returns:
        Resolved absolute path of the written file.

    Raises:
        FfmpegNotFoundError: If ``ffmpeg`` is not available on PATH.
        RuntimeError: If ffmpeg exits with a non-zero status.
    """
    executable = _find_ffmpeg_executable()
    if executable is None:
        raise FfmpegNotFoundError(
            "ffmpeg is unavailable. Install the MolVis video extra "
            "(`pip install molcrafts-molvis[video]`) or install ffmpeg on "
            "PATH before calling write_video()."
        )
    out = Path(path).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        executable,
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-r",
        str(fps),
        "-i",
        "-",
        "-c:v",
        codec,
        "-crf",
        str(crf),
        "-pix_fmt",
        pix_fmt,
        "-movflags",
        "+faststart",
        *(extra_args or []),
        str(out),
    ]

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert proc.stdin is not None and proc.stderr is not None

    try:
        for png in frames:
            proc.stdin.write(png)
        proc.stdin.close()
        rc = proc.wait()
        if rc != 0:
            stderr = proc.stderr.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"ffmpeg exited with status {rc}\n{stderr.strip()}"
            )
    finally:
        if not proc.stdin.closed:
            proc.stdin.close()
        proc.stderr.close()

    return out
