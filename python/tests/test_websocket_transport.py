"""Unit tests for molvis.transport.WebSocketTransport.

Only the parts reachable without a socket: handshake parameters and the
wait-for-browser retry loop, driven by setting the connected event directly.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

import pytest
from molvis.transport import WebSocketTransport
from molvis.transport.websocket import (
    DEFAULT_HANDSHAKE_RETRIES,
    DEFAULT_HANDSHAKE_TIMEOUT_S,
)


def _transport_for_wait(
    *,
    timeout: float | None = 0.05,
    retries: int = 3,
) -> WebSocketTransport:
    t = WebSocketTransport(
        open_browser=False,
        handshake_timeout=timeout,
        handshake_retries=retries,
    )
    t._bound_port = 9  # type: ignore[attr-defined]
    t._bound_session = "s1"  # type: ignore[attr-defined]
    return t


def test_default_handshake_is_finite() -> None:
    t = WebSocketTransport(open_browser=False)
    assert t._handshake_timeout == DEFAULT_HANDSHAKE_TIMEOUT_S  # type: ignore[attr-defined]
    assert t._handshake_retries == DEFAULT_HANDSHAKE_RETRIES  # type: ignore[attr-defined]


def test_wait_raises_after_retries_when_no_browser() -> None:
    t = _transport_for_wait(timeout=0.02, retries=3)
    with pytest.raises(TimeoutError, match="3 attempt"):
        t._wait_until_browser_connected()  # type: ignore[attr-defined]


def test_wait_succeeds_when_browser_connects_mid_retry() -> None:
    t = _transport_for_wait(timeout=0.5, retries=5)

    def connect_soon() -> None:
        threading.Event().wait(0.05)
        t._connected_event.set()  # type: ignore[attr-defined]

    threading.Thread(target=connect_soon, daemon=True).start()
    t._wait_until_browser_connected()  # type: ignore[attr-defined]
    assert t.connected is True


def test_wait_is_noop_when_already_connected() -> None:
    t = _transport_for_wait(timeout=0.01, retries=1)
    t._connected_event.set()  # type: ignore[attr-defined]
    t._wait_until_browser_connected()  # type: ignore[attr-defined]


def test_send_request_fails_fast_without_browser() -> None:
    t = _transport_for_wait(timeout=0.02, retries=2)
    with pytest.raises(TimeoutError, match="browser"):
        t.send_request("scene.clear", {}, wait_for_response=True, timeout=1.0)


def test_handshake_timeout_none_waits_until_set() -> None:
    t = WebSocketTransport(
        open_browser=False,
        handshake_timeout=None,
        handshake_retries=1,
    )
    t._bound_port = 1  # type: ignore[attr-defined]
    done = threading.Event()

    def wait_then_flag() -> None:
        t._wait_until_browser_connected()  # type: ignore[attr-defined]
        done.set()

    threading.Thread(target=wait_then_flag, daemon=True).start()
    assert not done.wait(0.15)
    t._connected_event.set()  # type: ignore[attr-defined]
    assert done.wait(1.0)


def test_invalid_handshake_params() -> None:
    with pytest.raises(ValueError, match="handshake_timeout"):
        WebSocketTransport(open_browser=False, handshake_timeout=0)
    with pytest.raises(ValueError, match="handshake_retries"):
        WebSocketTransport(open_browser=False, handshake_retries=0)


class _FakeBrowser:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.closed = False
        self.console: list[str] = ["log: booting"]

    def check(self) -> None:
        if self.error is not None:
            raise self.error

    def close(self) -> None:
        self.closed = True


def test_headless_needs_a_page_to_serve() -> None:
    with pytest.raises(ValueError, match="serve_page"):
        WebSocketTransport(open_browser=False, serve_page=False, headless=True)
    with pytest.raises(ValueError, match="serve_page"):
        WebSocketTransport(open_browser=False, serve_page=False, headless=None)


def test_fallback_launches_a_headless_browser_instead_of_timing_out() -> None:
    t = WebSocketTransport(
        open_browser=False, handshake_timeout=0.01, handshake_retries=2, headless=None
    )
    t._bound_port = 9  # type: ignore[attr-defined]
    launched: list[bool] = []

    def launch() -> None:
        launched.append(True)
        t._browser = _FakeBrowser()  # type: ignore[attr-defined]
        t._connected_event.set()  # type: ignore[attr-defined]

    t._launch_headless_browser = launch  # type: ignore[method-assign]
    t._wait_until_browser_connected()  # type: ignore[attr-defined]
    assert launched == [True]


def test_without_fallback_no_browser_is_launched() -> None:
    t = _transport_for_wait(timeout=0.01, retries=1)
    t._launch_headless_browser = lambda: pytest.fail("launched")  # type: ignore[method-assign]
    with pytest.raises(TimeoutError):
        t._wait_until_browser_connected()  # type: ignore[attr-defined]


def test_a_dead_headless_browser_is_reported_not_timed_out() -> None:
    t = _transport_for_wait(timeout=0.01, retries=1)
    t._browser = _FakeBrowser(error=RuntimeError("page crashed"))  # type: ignore[attr-defined]
    with pytest.raises(RuntimeError, match="page crashed"):
        t._wait_until_browser_connected()  # type: ignore[attr-defined]


def test_headless_page_timeout_shows_the_console(monkeypatch: pytest.MonkeyPatch) -> None:
    from molvis.transport import websocket

    monkeypatch.setattr(websocket, "HEADLESS_CONNECT_TIMEOUT_S", 0.3)
    t = _transport_for_wait(timeout=0.01, retries=1)
    t._browser = _FakeBrowser()  # type: ignore[attr-defined]
    with pytest.raises(TimeoutError, match="log: booting"):
        t._wait_until_browser_connected()  # type: ignore[attr-defined]


def test_launch_opens_the_standalone_url_at_the_viewport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from molvis import headless

    opened: list[tuple[str, int, int]] = []

    class _Browser(_FakeBrowser):
        def __init__(self, *, width: int, height: int) -> None:
            super().__init__()
            self.size = (width, height)

        def open(self, url: str) -> None:
            opened.append((url, *self.size))

    monkeypatch.setattr(headless, "HeadlessBrowser", _Browser)
    t = WebSocketTransport(
        open_browser=False, headless=True, viewport=(640, 480), surface="canvas"
    )
    t._bound_port = 9  # type: ignore[attr-defined]
    t._launch_headless_browser()  # type: ignore[attr-defined]
    t._launch_headless_browser()  # type: ignore[attr-defined]  # once only
    assert len(opened) == 1
    url, width, height = opened[0]
    assert "surface=canvas" in url and "ws_url=" in url
    assert (width, height) == (640, 480)
    browser = t.headless_browser
    t.stop()
    assert isinstance(browser, _Browser) and browser.closed
    assert t.headless_browser is None


# ----------------------------------------------------------------------
# A real socket: a scripted frontend answers (or drops) the request
# ----------------------------------------------------------------------


def _serve_frontend(t: WebSocketTransport, answer: Any) -> threading.Thread:
    """Connect a scripted frontend: hello, then ``answer(ws, request)`` for
    the first request the transport sends."""
    from websockets.sync.client import connect

    def run() -> None:
        url = t.connection_url()
        with connect(url, max_size=None) as ws:
            ws.send(json.dumps({"type": "hello", "token": t.token, "session": "s"}))
            assert json.loads(ws.recv())["type"] == "ready"
            answer(ws, json.loads(ws.recv()))

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


def _started() -> WebSocketTransport:
    t = WebSocketTransport(open_browser=False, serve_page=False, handshake_retries=50)
    t.start()
    return t


def test_reply_larger_than_one_mebibyte_arrives() -> None:
    # A scale-2 snapshot of a dense periodic box is a >1 MiB PNG; the
    # websockets default max_size (1 MiB) used to drop the connection.
    t = _started()
    data = "A" * (3 * 2**20)

    def answer(ws: Any, request: dict[str, Any]) -> None:
        ws.send(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": {"data": data}}))
        ws.recv()  # hold the socket open until the transport closes it

    _serve_frontend(t, answer)
    try:
        reply = t.send_request("snapshot.take", {}, wait_for_response=True, timeout=10.0)
        assert reply is not None
        assert len(reply["result"]["data"]) == len(data)
    finally:
        t.stop()


def test_dropped_connection_fails_the_pending_request_at_once() -> None:
    t = _started()

    def answer(ws: Any, request: dict[str, Any]) -> None:
        ws.close(1011, "frontend crashed")

    _serve_frontend(t, answer)
    try:
        started = time.monotonic()
        with pytest.raises(ConnectionError, match="snapshot.take.*1011.*frontend crashed"):
            t.send_request("snapshot.take", {}, wait_for_response=True, timeout=30.0)
        assert time.monotonic() - started < 5.0
    finally:
        t.stop()
