"""Sketch is its own registry. Document methods do not call the stage."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from molvis.scene import Molvis
from molvis.sketch import Sketch, SketchUnavailable


class _Transport:
    def __init__(self) -> None:
        self.stopped = False
        self.waited = False
        self.session = ""
        self.port = 0
        self.connected = False
        self.requests: list[object] = []

    def stop(self) -> None:
        self.stopped = True

    def set_session_name(self, session: str) -> None:
        self.session = session

    def wait_for_disconnection(self, timeout: float | None = None) -> None:
        self.waited = timeout is None or timeout >= 0

    def send_request(self, *args: object, **kwargs: object) -> object:
        self.requests.append((args, kwargs))
        raise AssertionError("send_request")


@pytest.fixture(autouse=True)
def _registries() -> object:
    Molvis._scene_registry.clear()
    Sketch._registry.clear()
    yield
    Molvis.close_all()
    Sketch.close_all()
    Molvis._scene_registry.clear()
    Sketch._registry.clear()


def test_same_name_reuses_the_board_without_a_bundle() -> None:
    board = Sketch(name="a")
    assert Sketch(name="a") is board
    assert Sketch.get("a") is board
    assert Sketch.list() == ["a"]
    assert Sketch.has("a")
    assert board.width == 960
    assert board.height == 720
    assert board.gui is True


def test_explicit_gui_mismatch_names_replace() -> None:
    Sketch(name="a")
    with pytest.raises(ValueError, match="Sketch.replace"):
        Sketch(name="a", gui=False)
    assert Sketch.get("a").gui is True


def test_explicit_width_match_reuses_and_mismatch_raises() -> None:
    board = Sketch(name="w", width=100)
    assert Sketch(name="w", width=100) is board
    with pytest.raises(ValueError, match="width"):
        Sketch(name="w", width=50)


def test_a_later_transport_is_a_conflict() -> None:
    Sketch(name="later")
    with pytest.raises(ValueError, match="Sketch.replace"):
        Sketch(name="later", transport=_Transport())


def test_same_name_on_stage_and_sketch_is_legal() -> None:
    stage = Molvis(name="default", transport=_Transport(), gui=True)
    board = Sketch(name="default", transport=_Transport())
    assert stage is Molvis.get_scene("default")
    assert board is Sketch.get("default")
    assert stage is not board


def test_get_lists_sketch_names_only() -> None:
    Molvis(name="stage-only", transport=_Transport(), gui=True)
    Sketch(name="only-sketch", transport=_Transport())
    with pytest.raises(KeyError) as caught:
        Sketch.get("missing")
    text = str(caught.value)
    assert "only-sketch" in text
    assert "stage-only" not in text


def test_sketch_has_board_verbs_and_not_stage_verbs() -> None:
    board = Sketch(name="verbs")
    for name in (
        "draw_atom",
        "draw_bond",
        "export_svg",
        "export_png",
        "select_atom_by_id",
        "fit",
        "get",
    ):
        assert hasattr(board, name)
    for name in (
        "draw_frame",
        "commit",
        "snapshot",
        "get_scene",
        "selection",
        "camera",
    ):
        assert not hasattr(Sketch, name)
        assert not hasattr(board, name)
    assert "document units" in (Sketch.draw_atom.__doc__ or "")
    assert "Not a camera" in (Sketch.fit.__doc__ or "")


def test_construct_does_not_detect_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> None:
        raise AssertionError("detect_runtime")

    monkeypatch.setattr("molvis.runtime.detect_runtime", boom)
    monkeypatch.setattr("molvis.scene.detect_runtime", boom)
    board = Sketch(name="plain")
    assert board.gui is True


def test_connection_url_names_the_missing_bundle(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    missing = tmp_path / "sketch_dist"
    monkeypatch.setenv("MOLVIS_SKETCH_DIST", str(missing))

    def boom() -> None:
        raise AssertionError("resolve_dist")

    monkeypatch.setattr("molvis.transport.websocket.resolve_dist", boom)
    board = Sketch(name="url")
    # A Windows path (C:\Users\...) is not a valid regex as it stands.
    pattern = re.escape(str(missing.resolve()))
    with pytest.raises(SketchUnavailable, match=pattern):
        _ = board.connection_url
    assert Sketch.has("url")
    with pytest.raises(SketchUnavailable, match="index.html"):
        board.wait(timeout=0)
    assert Sketch.has("url")


def test_document_methods_do_not_call_send_request() -> None:
    transport = _Transport()
    board = Sketch(name="doc", transport=transport)
    calls: list[tuple[str, tuple[object, ...]]] = [
        ("draw_atom", ("C", 0.0, 0.0)),
        ("draw_bond", (0, 1)),
        ("draw_fragment", ("phenyl", 0.0, 0.0)),
        ("draw_ring", (1.0, 1.0)),
        ("draw_chain", (0.0, 0.0, 3.0, 0.0)),
        ("clear", ()),
        ("undo", ()),
        ("redo", ()),
        ("select_atom_by_id", (0,)),
        ("select_atom_by_id", ([0, 1],)),
        ("selected_atoms", ()),
        ("delete_selection", ()),
        ("molecule", ()),
        ("load", ({"atoms": [], "bonds": []},)),
        ("fragment_templates", ()),
        ("export_svg", ()),
        ("export_png", ()),
        ("fit", ()),
        ("to_frame", ()),
        ("state", ()),
    ]
    for name, args in calls:
        with pytest.raises(SketchUnavailable, match="sketch board RPC is not connected"):
            getattr(board, name)(*args)
    assert transport.requests == []


def test_session_info_has_no_token_or_counts() -> None:
    board = Sketch(name="info", transport=_Transport())
    info = board.session_info
    assert set(info) == {
        "surface",
        "name",
        "gui",
        "width",
        "height",
        "connected",
        "port",
        "created_at",
    }
    assert info["surface"] == "sketch"
    assert info["name"] == "info"
    assert "token" not in info
    rows = Sketch.session_summary()
    assert rows == [info]
    assert Molvis.session_summary() == []


def test_replace_closes_and_recreates() -> None:
    first = Sketch(name="r", transport=_Transport())
    second = Sketch.replace("r", gui=False, transport=_Transport())
    assert second is not first
    assert second.gui is False
    assert Sketch.get("r") is second
    assert Sketch.list() == ["r"]


def test_close_drops_the_name_and_stops_the_transport() -> None:
    transport = _Transport()
    board = Sketch(name="gone", transport=transport)
    assert board.close() is board
    assert transport.stopped is True
    assert Sketch.has("gone") is False


def test_wait_on_an_injected_transport_closes() -> None:
    transport = _Transport()
    board = Sketch(name="wait", transport=transport)
    assert board.wait(timeout=0) is board
    assert transport.waited is True
    assert transport.stopped is True
    assert Sketch.has("wait") is False


def test_ensure_started_uses_the_sketch_bundle(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "index.html").write_text("<html></html>")
    monkeypatch.setenv("MOLVIS_SKETCH_DIST", str(bundle))
    seen: list[dict[str, object]] = []

    class _Socket:
        def __init__(self, **kwargs: object) -> None:
            seen.append(kwargs)

        def start(self) -> None:
            self.started = True

        def connection_url(self, *, session: str | None = None) -> str:
            return f"ws://sketch/{session}"

    def boom() -> None:
        raise AssertionError("resolve_dist")

    monkeypatch.setattr("molvis.transport.websocket.resolve_dist", boom)
    monkeypatch.setattr("molvis.transport.websocket.WebSocketTransport", _Socket)
    board = Sketch(name="page", gui=False)
    assert board.connection_url == "ws://sketch/page"
    assert seen[0]["dist"] == bundle.resolve()
    assert seen[0]["open_browser"] is False
    assert seen[0]["event_bus"] is None
    assert seen[0]["surface"] == "canvas"
    assert seen[0]["session"] == "page"
