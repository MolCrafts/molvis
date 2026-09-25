"""Tests for molvis.mcp.workbench: named sessions, exec namespace, event journal.

No FastMCP and no browser: the scene is a fake, which is the whole point of
keeping the workbench free of protocol machinery.
"""

from __future__ import annotations

from typing import Any

import pytest

from molvis.mcp.workbench import JOURNAL_LIMIT, Workbench


class _Handle:
    """What :meth:`FakeScene.on` returns — an unsubscribe hook."""

    def __init__(self, remove: Any) -> None:
        self._remove = remove
        self.removed = False

    def remove(self) -> None:
        self.removed = True
        self._remove()


class FakeScene:
    """A scene double: registry-shaped, event-emitting, never opens a viewer."""

    def __init__(self, name: str, **config: Any) -> None:
        self.name = name
        self.config = config
        self.closed = False
        self.connected = True
        self.connection_url = f"http://127.0.0.1:9000/{name}"
        self._listeners: dict[str, list[Any]] = {}
        self.handles: list[_Handle] = []

    @property
    def session_info(self) -> dict[str, Any]:
        return {"name": self.name, "connected": self.connected}

    def on(self, event: str, callback: Any) -> _Handle:
        self._listeners.setdefault(event, []).append(callback)
        handle = _Handle(lambda: self._listeners[event].remove(callback))
        self.handles.append(handle)
        return handle

    def emit(self, event: str, payload: dict[str, Any]) -> None:
        for callback in list(self._listeners.get(event, ())):
            callback(payload)

    def draw(self, what: str) -> str:
        """Draw one thing."""
        return f"drew {what}"

    def close(self) -> None:
        self.closed = True


class BareScene:
    """A scene offering only ``close`` — the documented minimum."""

    def __init__(self, name: str, **config: Any) -> None:
        self.name = name
        self.closed = False

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def bench() -> Workbench:
    return Workbench(scene_factory=FakeScene)


def _scene(bench: Workbench, session: str) -> FakeScene:
    """The fake behind one session, reached the way the workbench stores it."""
    return bench._benches[session].scene


def test_open_mints_a_session_name_when_none_is_given(bench: Workbench) -> None:
    opened = bench.open()
    assert opened["session"].startswith("molvis-")
    assert opened["created"] is True
    assert opened["connection_url"].endswith(opened["session"])


def test_reopening_a_name_returns_the_same_session(bench: Workbench) -> None:
    first = bench.open("lab")
    scene = _scene(bench, "lab")

    again = bench.open("lab")

    assert again["created"] is False
    assert _scene(bench, "lab") is scene
    assert first["session"] == again["session"] == "lab"


def test_reopening_with_config_says_it_was_ignored(bench: Workbench) -> None:
    bench.open("lab", gui=False)

    again = bench.open("lab", gui=True)

    assert again["config_ignored"] is True
    assert _scene(bench, "lab").config == {"gui": False}


def test_the_namespace_survives_between_runs(bench: Workbench) -> None:
    bench.open("lab")

    bench.run("lab", "frame = 41")
    result = bench.run("lab", "frame + 1")

    assert result["ok"] is True
    assert result["result"] == "42"


def test_a_trailing_expression_comes_back_as_a_repr(bench: Workbench) -> None:
    bench.open("lab")

    assert bench.run("lab", "viewer.draw('water')")["result"] == "'drew water'"


def test_statements_alone_return_no_result(bench: Workbench) -> None:
    bench.open("lab")

    result = bench.run("lab", "x = 1\ny = 2")

    assert result["ok"] is True
    assert result["result"] is None


def test_stdout_is_captured(bench: Workbench) -> None:
    bench.open("lab")

    assert bench.run("lab", "print('hello')")["stdout"] == "hello\n"


def test_a_failure_is_a_traceback_not_an_exception(bench: Workbench) -> None:
    bench.open("lab")

    result = bench.run("lab", "1 / 0")

    assert result["ok"] is False
    assert "ZeroDivisionError" in result["error"]
    assert result["result"] is None


def test_partial_output_survives_a_failure(bench: Workbench) -> None:
    bench.open("lab")

    result = bench.run("lab", "print('before')\nraise ValueError('stop')")

    assert result["stdout"] == "before\n"
    assert "ValueError: stop" in result["error"]


def test_a_syntax_error_is_reported_without_running_anything(bench: Workbench) -> None:
    bench.open("lab")

    result = bench.run("lab", "def (")

    assert result["ok"] is False
    assert result["error"].startswith("SyntaxError")


def test_an_unknown_session_names_the_open_ones(bench: Workbench) -> None:
    bench.open("lab")

    with pytest.raises(KeyError) as excinfo:
        bench.run("ghost", "1")

    message = str(excinfo.value)
    assert "ghost" in message
    assert "lab" in message


def test_close_stops_the_scene_and_unsubscribes(bench: Workbench) -> None:
    bench.open("lab")
    scene = _scene(bench, "lab")

    assert bench.close("lab") == {"session": "lab", "closed": True}

    assert scene.closed is True
    assert all(handle.removed for handle in scene.handles)
    assert bench.list() == []


def test_closing_an_unknown_session_is_reported_not_raised(bench: Workbench) -> None:
    assert bench.close("ghost") == {"session": "ghost", "closed": False}


def test_list_sessions_shows_bindings_and_hides_the_scene(bench: Workbench) -> None:
    bench.open("lab")
    bench.run("lab", "frame = 1")

    listed = bench.list()

    assert [entry["session"] for entry in listed] == ["lab"]
    assert listed[0]["names"] == ["frame", "session"]
    assert listed[0]["connected"] is True


def test_sessions_are_listed_oldest_first(bench: Workbench) -> None:
    bench.open("first")
    bench.open("second")

    assert [entry["session"] for entry in bench.list()] == ["first", "second"]


def test_poll_returns_events_after_the_cursor(bench: Workbench) -> None:
    bench.open("lab")
    scene = _scene(bench, "lab")
    scene.emit("selection_changed", {"atom_ids": [1]})
    scene.emit("frame_changed", {"index": 2})

    first = bench.poll("lab")

    assert [event["event"] for event in first["events"]] == [
        "selection_changed",
        "frame_changed",
    ]
    assert first["events"][0]["payload"] == {"atom_ids": [1]}

    scene.emit("mode_changed", {"mode": "edit"})
    second = bench.poll("lab", cursor=first["cursor"])

    assert [event["event"] for event in second["events"]] == ["mode_changed"]
    assert second["pending"] == 0


def test_poll_on_a_quiet_session_is_empty_and_keeps_the_cursor(
    bench: Workbench,
) -> None:
    bench.open("lab")

    polled = bench.poll("lab")

    assert polled["events"] == []
    assert polled["pending"] == 0
    assert polled["dropped"] is False


def test_poll_reports_what_the_limit_left_behind(bench: Workbench) -> None:
    bench.open("lab")
    scene = _scene(bench, "lab")
    for index in range(5):
        scene.emit("frame_changed", {"index": index})

    polled = bench.poll("lab", limit=2)

    assert len(polled["events"]) == 2
    assert polled["pending"] == 3


def test_a_trimmed_journal_reports_a_gap_rather_than_quiet(bench: Workbench) -> None:
    bench.open("lab")
    scene = _scene(bench, "lab")
    for index in range(JOURNAL_LIMIT + 5):
        scene.emit("frame_changed", {"index": index})

    polled = bench.poll("lab", cursor=0, limit=1)

    assert polled["dropped"] is True
    assert polled["events"][0]["payload"]["index"] == 5


def test_describe_reflects_the_live_surface(bench: Workbench) -> None:
    bench.open("lab")

    described = bench.describe("lab")

    names = {method["name"]: method for method in described["methods"]}
    assert names["draw"]["signature"] == "(what: str) -> str"
    assert names["draw"]["summary"] == "Draw one thing."
    assert described["info"]["name"] == "lab"


def test_a_scene_without_events_still_opens(bench: Workbench) -> None:
    bare = Workbench(scene_factory=BareScene)

    opened = bare.open("lab")

    assert opened["created"] is True
    assert opened["connected"] is False
    assert opened["connection_url"] == ""
    assert bare.poll("lab")["events"] == []
