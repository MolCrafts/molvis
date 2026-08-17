"""Unit tests for finite browser-handshake wait (no network)."""

from __future__ import annotations

import threading

import pytest

from molvis.transport.websocket import (
    DEFAULT_HANDSHAKE_RETRIES,
    DEFAULT_HANDSHAKE_TIMEOUT_S,
    WebSocketTransport,
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
    # Avoid real start(): pretend we already bound a port for error hints.
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
    """Explicit infinite wait: only for interactive opt-in."""
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
