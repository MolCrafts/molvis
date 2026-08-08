"""Unit tests for :class:`molvis.FrameStream` — the molrs → viewer relay.

The end-to-end tests here run a real ``molrs.stream.FrameServer`` in-process and
read it over a real loopback socket. That is a unit test of the relay, not an
e2e lane: no browser, no page bundle, no rendering — the viewer is a stub that
records what it was handed.

`molrs.stream` is a hard dependency now (molpy >= 0.12.3), so nothing here is
skipped for a stale install. :class:`TestMissingCodec` still runs, because the
codec can also go missing on a *newer* molrs that moved it, and the error a user
sees for that is worth pinning either way.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import molpy as mp
import numpy as np
import pytest

from molvis import FrameStream, StreamError

import molrs.stream as molrs_stream

if not hasattr(molrs_stream, "FrameServer"):  # pragma: no cover - Pyodide
    pytest.skip("molrs.stream.FrameServer is native-only", allow_module_level=True)


class RecordingViewer:
    """Stands in for :class:`~molvis.scene.Molvis`.

    Copies out of each frame rather than retaining it, exactly as the real
    ``append_frame`` does. A streamed ``Frame`` belongs to the worker thread —
    keeping one alive past the call would abort the interpreter when the main
    thread eventually collects it. That constraint is molrs's, and a stub that
    ignored it would be testing something no consumer may do.
    """

    name = "stub"

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []
        self.follow_flags: list[bool] = []
        self._lock = threading.Lock()

    def append_frame(self, frame: Any, *, follow: bool = True) -> RecordingViewer:
        atoms = frame["atoms"]
        record = {
            "x": np.array(atoms["x"], copy=True),
            "element": list(atoms["element"]),
            "box": None if frame.box is None else np.array(frame.box.matrix, copy=True),
        }
        with self._lock:
            self.records.append(record)
            self.follow_flags.append(follow)
        return self

    def count(self) -> int:
        with self._lock:
            return len(self.records)


def _frame(offset: float = 0.0) -> mp.Frame:
    return mp.Frame(
        blocks={
            "atoms": {
                "x": np.array([0.0, 1.0, 2.0]) + offset,
                "y": np.zeros(3),
                "z": np.zeros(3),
                "element": ["C", "C", "O"],
            }
        }
    )


@pytest.fixture
def producer():
    """A live molrs FrameServer on an ephemeral loopback port."""
    server = molrs_stream.FrameServer("127.0.0.1:0")
    try:
        yield server
    finally:
        server.close()


def _url(server: Any) -> str:
    return f"ws://{server.address}"


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


class TestRelay:
    def test_forwards_frames_from_a_live_producer(self, producer) -> None:
        viewer = RecordingViewer()
        with FrameStream(viewer, _url(producer)) as stream:
            stream.wait_for_connection(timeout=5.0)
            # Wait for the server to register the client, else the first sends
            # broadcast into an empty fan-out.
            deadline = time.monotonic() + 5.0
            while producer.client_count == 0 and time.monotonic() < deadline:
                time.sleep(0.01)

            for i in range(3):
                producer.send(_frame(offset=float(i)))
            stream.wait_for_frames(3, timeout=10.0)

        assert viewer.count() >= 3

    def test_forwarded_frames_carry_the_producer_s_data(self, producer) -> None:
        viewer = RecordingViewer()
        with FrameStream(viewer, _url(producer)) as stream:
            stream.wait_for_connection(timeout=5.0)
            deadline = time.monotonic() + 5.0
            while producer.client_count == 0 and time.monotonic() < deadline:
                time.sleep(0.01)

            producer.send(_frame(offset=7.0))
            stream.wait_for_frames(1, timeout=10.0)

        received = viewer.records[0]
        np.testing.assert_allclose(received["x"], [7.0, 8.0, 9.0])
        assert received["element"] == ["C", "C", "O"]

    def test_forwards_the_box(self, producer) -> None:
        viewer = RecordingViewer()
        frame = _frame()
        frame.box = mp.Box(np.eye(3) * 12.0)

        with FrameStream(viewer, _url(producer)) as stream:
            stream.wait_for_connection(timeout=5.0)
            deadline = time.monotonic() + 5.0
            while producer.client_count == 0 and time.monotonic() < deadline:
                time.sleep(0.01)

            producer.send(frame)
            stream.wait_for_frames(1, timeout=10.0)

        assert viewer.records[0]["box"] is not None
        np.testing.assert_allclose(viewer.records[0]["box"], np.eye(3) * 12.0)

    def test_follow_flag_reaches_the_viewer(self, producer) -> None:
        viewer = RecordingViewer()
        with FrameStream(viewer, _url(producer), follow=False) as stream:
            stream.wait_for_connection(timeout=5.0)
            deadline = time.monotonic() + 5.0
            while producer.client_count == 0 and time.monotonic() < deadline:
                time.sleep(0.01)

            producer.send(_frame())
            stream.wait_for_frames(1, timeout=10.0)

        assert viewer.follow_flags[0] is False

    def test_counts_received_and_forwarded_separately(self, producer) -> None:
        viewer = RecordingViewer()
        with FrameStream(viewer, _url(producer)) as stream:
            stream.wait_for_connection(timeout=5.0)
            deadline = time.monotonic() + 5.0
            while producer.client_count == 0 and time.monotonic() < deadline:
                time.sleep(0.01)

            producer.send(_frame())
            stream.wait_for_frames(1, timeout=10.0)

            assert stream.frames_received >= 1
            assert stream.frames_forwarded >= 1
            assert stream.frames_dropped == 0

    def test_stop_detaches_and_is_idempotent(self, producer) -> None:
        stream = FrameStream(RecordingViewer(), _url(producer)).start()
        stream.wait_for_connection(timeout=5.0)

        stream.stop()
        stream.stop()

        assert stream.connected is False


class TestBackPressure:
    def test_rate_limit_drops_rather_than_queues(self, producer) -> None:
        # A producer that outruns the renderer must lose frames, not build an
        # RPC backlog that grows for the length of the run.
        viewer = RecordingViewer()
        with FrameStream(viewer, _url(producer), max_rate_hz=1.0) as stream:
            stream.wait_for_connection(timeout=5.0)
            deadline = time.monotonic() + 5.0
            while producer.client_count == 0 and time.monotonic() < deadline:
                time.sleep(0.01)

            for i in range(40):
                producer.send(_frame(offset=float(i)))
            stream.wait_for_frames(1, timeout=10.0)
            # Give the reader a moment to work through what the socket carried.
            time.sleep(0.3)

            assert stream.frames_dropped > 0
            assert stream.frames_forwarded < stream.frames_received


class TestFailureVisibility:
    def test_waiting_for_an_absent_producer_times_out(self) -> None:
        # Port 1 is privileged and never listening.
        with FrameStream(RecordingViewer(), "ws://127.0.0.1:1") as stream:
            with pytest.raises(TimeoutError, match="No producer"):
                stream.wait_for_connection(timeout=0.5)

    def test_a_reconnecting_stream_still_reports_why_it_is_empty(self) -> None:
        # Reconnect loops are how a dead endpoint stays silent forever.
        with FrameStream(RecordingViewer(), "ws://127.0.0.1:1") as stream:
            time.sleep(0.3)
            assert stream.last_error is not None

    def test_wait_for_frames_times_out_with_the_count_it_got(self) -> None:
        with FrameStream(RecordingViewer(), "ws://127.0.0.1:1") as stream:
            with pytest.raises(TimeoutError, match="Only 0 of 2"):
                stream.wait_for_frames(2, timeout=0.3)

    def test_send_command_before_connecting_raises(self) -> None:
        stream = FrameStream(RecordingViewer(), "ws://127.0.0.1:1")
        with pytest.raises(StreamError, match="not connected"):
            stream.send_command(molrs_stream.ControlCommand.pause())

    def test_send_command_rejects_a_non_command(self, producer) -> None:
        with FrameStream(RecordingViewer(), _url(producer)) as stream:
            stream.wait_for_connection(timeout=5.0)
            with pytest.raises(TypeError, match="ControlCommand"):
                stream.send_command({"type": "pause"})


class TestUpstreamControl:
    def test_a_command_reaches_the_producer(self, producer) -> None:
        with FrameStream(RecordingViewer(), _url(producer)) as stream:
            stream.wait_for_connection(timeout=5.0)
            deadline = time.monotonic() + 5.0
            while producer.client_count == 0 and time.monotonic() < deadline:
                time.sleep(0.01)

            stream.send_command(molrs_stream.ControlCommand.set_frame_rate(12.5))
            received = producer.recv_command(timeout=5.0)

        assert received is not None
        assert received.kind == "set_frame_rate"
        assert received.hz == pytest.approx(12.5)


    def test_a_json_stream_delivers_commands_too(self) -> None:
        # FrameServer picks its decoder from the WebSocket frame type: text is
        # JSON, binary is MessagePack. A JSON command sent as a binary frame is
        # dropped without a word, so the pairing is asserted for both formats.
        server = molrs_stream.FrameServer("127.0.0.1:0", format="json")
        try:
            with FrameStream(
                RecordingViewer(), _url(server), format="json"
            ) as stream:
                stream.wait_for_connection(timeout=5.0)
                deadline = time.monotonic() + 5.0
                while server.client_count == 0 and time.monotonic() < deadline:
                    time.sleep(0.01)

                stream.send_command(molrs_stream.ControlCommand.pause())
                received = server.recv_command(timeout=5.0)
        finally:
            server.close()

        assert received is not None
        assert received.kind == "pause"


class TestMissingCodec:
    """Runs on every molrs — pins what an out-of-date install actually sees."""

    def test_decode_names_the_stale_dependency(self, monkeypatch) -> None:
        import sys
        import types

        # A molrs whose `io` predates the stream codec: the module imports,
        # the name is absent. That is exactly what an out-of-date install
        # looks like, and it must surface as a named dependency problem
        # rather than an AttributeError on a background thread.
        monkeypatch.setitem(sys.modules, "molrs.io", types.ModuleType("molrs.io"))
        stream = FrameStream(RecordingViewer(), "ws://127.0.0.1:1")

        with pytest.raises(StreamError, match="molrs.stream"):
            stream._decode(b"")

