"""Tests for molvis.mcp.server: the seven tools, over a fake scene.

FastMCP is an optional dependency, so the whole module skips without it. What
is asserted here is the wiring — that the tools exist under the names a host
will see, that they reach the workbench, and that an unknown session crosses
the seam as a message rather than as "error executing tool".
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

pytest.importorskip("fastmcp")

from fastmcp.exceptions import ToolError  # noqa: E402 - after the skip guard

from molvis.mcp.server import SERVER_NAME, build_server  # noqa: E402
from molvis.mcp.workbench import Workbench  # noqa: E402

EXPECTED_TOOLS = {
    "open",
    "close",
    "list_sessions",
    "exec",
    "capabilities",
    "refresh",
    "poll_events",
}


class FakeScene:
    """A scene double: no transport, no browser, one drawable method."""

    def __init__(self, name: str, **config: Any) -> None:
        self.name = name
        self.config = config
        self.closed = False
        self.connected = True
        self.connection_url = f"http://127.0.0.1:9000/{name}"

    @property
    def session_info(self) -> dict[str, Any]:
        return {"name": self.name, "connected": self.connected}

    def draw(self, what: str) -> str:
        """Draw one thing."""
        return f"drew {what}"

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def server() -> Any:
    return build_server(Workbench(scene_factory=FakeScene))


def _call(server: Any, tool: str, **arguments: Any) -> Any:
    """Invoke one tool the way a client would, and return its structured result."""

    async def _run() -> Any:
        handle = await server.get_tool(tool)
        result = await handle.run(arguments)
        return result.structured_content

    return asyncio.run(_run())


def test_the_server_is_named_for_the_package(server: Any) -> None:
    assert SERVER_NAME == "molvis"
    assert server.name == "molvis"


@pytest.mark.parametrize("tool", sorted(EXPECTED_TOOLS))
def test_every_tool_is_registered_under_the_name_a_host_sees(
    server: Any, tool: str
) -> None:
    assert asyncio.run(server.get_tool(tool)).name == tool


def test_no_tool_name_repeats_the_server_name(server: Any) -> None:
    """The client namespaces by server, so ``molvis_open`` would stutter."""
    assert not any(tool.startswith("molvis") for tool in EXPECTED_TOOLS)


def test_open_then_exec_shares_one_namespace(server: Any) -> None:
    opened = _call(server, "open", session="lab")
    assert opened["created"] is True

    _call(server, "exec", session="lab", code="frame = 41")
    result = _call(server, "exec", session="lab", code="frame + 1")

    assert result["result"] == "42"


def test_exec_reaches_the_live_scene(server: Any) -> None:
    _call(server, "open", session="lab")

    result = _call(server, "exec", session="lab", code="mv.draw('water')")

    assert result["result"] == "'drew water'"


def test_list_sessions_reports_what_open_created(server: Any) -> None:
    _call(server, "open", session="lab")

    listed = _call(server, "list_sessions", **{})

    assert [entry["session"] for entry in listed["result"]] == ["lab"]


def test_capabilities_reflects_the_scene(server: Any) -> None:
    _call(server, "open", session="lab")

    described = _call(server, "capabilities", session="lab")

    assert "draw" in {method["name"] for method in described["methods"]}


def test_poll_events_starts_empty(server: Any) -> None:
    _call(server, "open", session="lab")

    polled = _call(server, "poll_events", session="lab")

    assert polled["events"] == []
    assert polled["dropped"] is False


def test_close_reports_a_session_that_was_not_open(server: Any) -> None:
    assert _call(server, "close", session="ghost") == {
        "session": "ghost",
        "closed": False,
    }


def test_refresh_refuses_a_stdlib_package(server: Any) -> None:
    report = _call(server, "refresh", packages=["json"])

    assert report["refused"] == ["json"]


def test_an_unknown_session_arrives_as_a_message_naming_the_open_ones(
    server: Any,
) -> None:
    _call(server, "open", session="lab")

    with pytest.raises(ToolError) as excinfo:
        _call(server, "exec", session="ghost", code="1")

    message = str(excinfo.value)
    assert "ghost" in message
    assert "lab" in message
