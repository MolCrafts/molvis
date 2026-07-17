"""Integration tests for molvis.transport.WebSocketTransport.

These tests drive the real server using an in-process ``websockets``
client: they confirm the hello/ready handshake, token validation, and
notification → EventBus dispatch path.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import threading
import time
from typing import Any

import pytest

from molvis.events import EventBus
from molvis.transport import WebSocketTransport

websockets = pytest.importorskip("websockets")
import functools  # noqa: E402

from websockets.asyncio.client import connect as _ws_connect  # noqa: E402
from websockets.exceptions import ConnectionClosed  # noqa: E402

# websockets >= 14 auto-discovers proxies (including the macOS system-level
# SOCKS proxy) even for localhost; these tests talk to a local transport and
# must never leave the machine.
ws_connect = functools.partial(_ws_connect, proxy=None)


@contextlib.contextmanager
def running_transport(**kwargs: Any):
    bus = kwargs.pop("event_bus", None) or EventBus()
    tport = WebSocketTransport(
        token="test-token",
        open_browser=False,
        event_bus=bus,
        **kwargs,
    )
    tport.start()
    try:
        yield tport, bus
    finally:
        tport.stop()


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_start_returns_bound_port_and_token() -> None:
    with running_transport() as (tport, _bus):
        assert tport.port > 0
        assert tport.token == "test-token"


def test_page_endpoints_returns_resolved_urls() -> None:
    with running_transport() as (tport, _bus):
        endpoints = tport.page_endpoints(session="sess-42")
    assert endpoints.session == "sess-42"
    assert endpoints.token == "test-token"
    assert endpoints.ws_url.startswith("ws://localhost:")
    assert endpoints.ws_url.endswith("/ws")
    assert endpoints.base_url.startswith("http://localhost:")
    # Query string in standalone_url carries auth + session for the
    # page's URL-driven mount path.
    assert "ws_url=ws%3A%2F%2Flocalhost%3A" in endpoints.standalone_url
    assert "token=test-token" in endpoints.standalone_url
    assert "session=sess-42" in endpoints.standalone_url


def test_page_endpoints_uses_external_base_url_when_set() -> None:
    with running_transport(page_base_url="https://cdn.example/app") as (
        tport,
        _bus,
    ):
        endpoints = tport.page_endpoints(session="s1")
    assert endpoints.base_url == "https://cdn.example/app/"
    # WS still hits the local kernel-bound port:
    assert "ws://localhost:" in endpoints.ws_url
    # Standalone URL is base + query, NOT iframe.
    assert endpoints.standalone_url.startswith("https://cdn.example/app/?")


def test_handshake_with_good_token_succeeds() -> None:
    async def run(tport: WebSocketTransport) -> str:
        uri = f"ws://localhost:{tport.port}/ws"
        async with ws_connect(uri) as ws:
            await ws.send(
                json.dumps(
                    {"type": "hello", "token": "test-token", "session": "s"}
                )
            )
            msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        return msg

    with running_transport() as (tport, _bus):
        received = _run(run(tport))
    assert json.loads(received) == {"type": "ready"}


def test_handshake_with_bad_token_is_closed_with_1008() -> None:
    async def run(tport: WebSocketTransport) -> tuple[int, str]:
        uri = f"ws://localhost:{tport.port}/ws"
        async with ws_connect(uri) as ws:
            await ws.send(
                json.dumps(
                    {"type": "hello", "token": "wrong-token", "session": "s"}
                )
            )
            try:
                await asyncio.wait_for(ws.recv(), timeout=2.0)
            except ConnectionClosed as closed:
                rcvd = getattr(closed, "rcvd", None)
                code = rcvd.code if rcvd is not None else closed.code
                reason = rcvd.reason if rcvd is not None else closed.reason
                return code, reason
            return (0, "unexpected-open")

    with running_transport() as (tport, _bus):
        code, reason = _run(run(tport))
    assert code == 1008
    assert "auth" in reason


def test_non_hello_first_message_is_rejected() -> None:
    async def run(tport: WebSocketTransport) -> int:
        uri = f"ws://localhost:{tport.port}/ws"
        async with ws_connect(uri) as ws:
            await ws.send("not json")
            try:
                await asyncio.wait_for(ws.recv(), timeout=2.0)
            except ConnectionClosed as closed:
                rcvd = getattr(closed, "rcvd", None)
                return rcvd.code if rcvd is not None else closed.code
            return 0

    with running_transport() as (tport, _bus):
        code = _run(run(tport))
    assert code in (1003, 1008)


def test_notification_dispatches_to_event_bus() -> None:
    events: list[tuple[str, dict]] = []
    bus = EventBus()
    bus.on("selection_changed", lambda ev: events.append(("sel", ev)))

    async def run(tport: WebSocketTransport) -> None:
        uri = f"ws://localhost:{tport.port}/ws"
        async with ws_connect(uri) as ws:
            await ws.send(
                json.dumps(
                    {"type": "hello", "token": "test-token", "session": "s"}
                )
            )
            await asyncio.wait_for(ws.recv(), timeout=2.0)  # ready ack
            await ws.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "event.selection_changed",
                        "params": {"atom_ids": [1, 2], "bond_ids": []},
                    }
                )
            )
            await asyncio.sleep(0.1)  # let server thread dispatch

    with running_transport(event_bus=bus) as (tport, _b):
        _run(run(tport))

    assert len(events) == 1
    name, params = events[0]
    assert name == "sel"
    assert params["atom_ids"] == [1, 2]


def test_send_request_rpc_round_trip() -> None:
    async def run_client(tport: WebSocketTransport, done: threading.Event) -> dict:
        uri = f"ws://localhost:{tport.port}/ws"
        async with ws_connect(uri) as ws:
            await ws.send(
                json.dumps(
                    {"type": "hello", "token": "test-token", "session": "s"}
                )
            )
            await asyncio.wait_for(ws.recv(), timeout=2.0)

            # After handshake, expect server to send a request we respond to.
            raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            request = json.loads(raw)
            response = {
                "jsonrpc": "2.0",
                "id": request["id"],
                "result": {"echoed": request["params"]},
            }
            await ws.send(json.dumps(response))
            # Give the server a moment to deliver it to the waiter.
            await asyncio.sleep(0.05)
            done.set()
            return request

    def run_server_side(tport: WebSocketTransport, result_holder: dict) -> None:
        # Block until client has handshaken.
        tport.wait_for_connection(timeout=5)
        response = tport.send_request(
            "state.get",
            {"probe": 7},
            wait_for_response=True,
            timeout=5.0,
        )
        result_holder["response"] = response

    with running_transport() as (tport, _bus):
        result_holder: dict = {}
        done = threading.Event()
        server_thread = threading.Thread(
            target=run_server_side,
            args=(tport, result_holder),
            daemon=True,
        )
        server_thread.start()
        request = _run(run_client(tport, done))
        server_thread.join(timeout=5)

    assert request["method"] == "state.get"
    assert request["params"] == {"probe": 7}
    assert result_holder["response"]["result"] == {"echoed": {"probe": 7}}
