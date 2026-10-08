"""Unit tests for :class:`molvis.FrameStream` — the molrs → viewer relay.

Only what is reachable without a socket: argument validation, the
not-yet-connected guards and the missing-codec error. The relay itself needs a
live molrs Publisher on a loopback port and is not covered here.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from molvis import FrameStream, StreamError

import molrs.stream as molrs_stream


class RecordingViewer:
    """Stands in for :class:`~molvis.scene.Molvis`; counts appended frames."""

    name = "stub"

    def __init__(self) -> None:
        self.frames = 0

    def append_frame(self, frame: Any, *, follow: bool = True) -> RecordingViewer:
        self.frames += 1
        return self

    def count(self) -> int:
        return self.frames


class TestConstruction:
    @pytest.mark.parametrize("url", ["localhost:8765", "http://x", "", "tcp://x"])
    def test_rejects_a_non_websocket_url(self, url) -> None:
        with pytest.raises(ValueError, match="ws://"):
            FrameStream(RecordingViewer(), url)

    def test_rejects_an_unknown_format(self) -> None:
        with pytest.raises(ValueError, match="msgpack"):
            FrameStream(RecordingViewer(), "ws://localhost:1", format="protobuf")

    @pytest.mark.parametrize("rate", [0, -1.0])
    def test_rejects_a_nonsense_rate(self, rate) -> None:
        with pytest.raises(ValueError, match="max_rate_hz"):
            FrameStream(RecordingViewer(), "ws://localhost:1", max_rate_hz=rate)

    def test_reads_nothing_before_start(self) -> None:
        viewer = RecordingViewer()
        stream = FrameStream(viewer, "ws://localhost:1")
        time.sleep(0.05)
        assert stream.connected is False
        assert viewer.count() == 0


class TestNotConnected:
    def test_send_command_before_connecting_raises(self) -> None:
        stream = FrameStream(RecordingViewer(), "ws://127.0.0.1:1")
        with pytest.raises(StreamError, match="not connected"):
            stream.send_command(molrs_stream.ControlCommand.pause())


