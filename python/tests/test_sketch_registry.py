"""Sketch is its own registry. Document methods do not call the stage."""

from __future__ import annotations

import base64
import re
from pathlib import Path

import molpy as mp
import pytest
from molvis.errors import MolvisRPCError
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
    with pytest.raises(SketchUnavailable, match="build:sketch-page"):
        board.export_svg()
    assert Sketch.has("url")


class _RpcTransport(_Transport):
    """Answers every request with a canned ``result`` and records it."""

    def __init__(self, results: dict[str, object] | None = None) -> None:
        super().__init__()
        self.results = results or {}
        self.started = 0

    def start(self) -> None:
        self.started += 1

    def send_request(self, *args: object, **kwargs: object) -> object:
        method, params = args[0], args[1]
        self.requests.append((method, params, kwargs))
        if method in self.results and isinstance(self.results[method], Exception):
            raise self.results[method]  # type: ignore[misc]
        return {"jsonrpc": "2.0", "id": 1, "result": self.results.get(method)}


def test_document_methods_are_sketch_rpc_requests() -> None:
    transport = _RpcTransport({"sketch.draw_atom": 3, "sketch.draw_bond": 0})
    board = Sketch(name="doc", transport=transport)
    assert board.draw_atom("N", 1, 2, charge=1) == 3
    assert board.draw_bond(0, 1, order=2) == 0
    assert board.draw_ring(1.0, 1.0) is board
    assert board.draw_chain(0.0, 0.0, 3.0, 0.0, start=2) is board
    assert board.draw_fragment("phenyl", 0.0, 0.0) is board
    assert board.select_atom_by_id(0) is board
    assert board.clear() is board
    sent = [(method, params) for method, params, _ in transport.requests]
    assert sent == [
        ("sketch.draw_atom", {"element": "N", "x": 1.0, "y": 2.0, "charge": 1}),
        ("sketch.draw_bond", {"i": 0, "j": 1, "order": 2, "stereo": "none"}),
        ("sketch.draw_ring", {"x": 1.0, "y": 1.0, "size": 6, "kind": "benzene"}),
        ("sketch.draw_chain", {"x0": 0.0, "y0": 0.0, "x1": 3.0, "y1": 0.0, "start": 2}),
        ("sketch.draw_fragment", {"template_id": "phenyl", "x": 0.0, "y": 0.0}),
        ("sketch.select_atoms", {"atom_ids": [0]}),
        ("sketch.clear", {}),
    ]
    assert all(kwargs["wait_for_response"] is True for _, _, kwargs in transport.requests)
    assert transport.started == len(transport.requests)


def test_page_errors_raise_molvis_rpc_error() -> None:
    class _Refusing(_RpcTransport):
        def send_request(self, *args: object, **kwargs: object) -> object:
            return {"id": 4, "error": {"code": -32602, "message": "'x' must be a finite number"}}

    board = Sketch(name="err", transport=_Refusing())
    with pytest.raises(MolvisRPCError, match="finite number") as caught:
        board.draw_atom("C", 0, 0)
    assert caught.value.code == -32602
    assert caught.value.method == "sketch.draw_atom"


def test_export_svg_and_png_write_files(tmp_path: Path) -> None:
    png = b"\x89PNG\r\n"
    transport = _RpcTransport(
        {
            "sketch.export_svg": "<svg/>",
            "sketch.export_png": {"data": "data:image/png;base64," + base64.b64encode(png).decode()},
        }
    )
    board = Sketch(name="export", transport=transport)
    assert board.export_svg(tmp_path / "m.svg", width=640, height=480) == "<svg/>"
    assert (tmp_path / "m.svg").read_text() == "<svg/>"
    assert board.export_png(tmp_path / "m.png", pixel_ratio=1) == png
    assert (tmp_path / "m.png").read_bytes() == png
    assert transport.requests[0][1] == {"width": 640, "height": 480}
    assert transport.requests[1][1] == {"pixel_ratio": 1.0}


def test_export_png_without_data_is_an_error() -> None:
    board = Sketch(name="nopng", transport=_RpcTransport({"sketch.export_png": None}))
    with pytest.raises(SketchUnavailable, match="no PNG"):
        board.export_png()


def test_load_smiles_sends_a_laid_out_topology() -> None:
    transport = _RpcTransport()
    board = Sketch(name="smiles", transport=transport)
    assert board.load_smiles("[OH-]") is board
    method, params, _ = transport.requests[0]
    assert method == "sketch.load"
    # No 2D coordinates: the page lays the molecule out.
    assert params == {
        "data": {"atoms": [{"element": "O", "charge": -1, "hydrogens": 1}], "bonds": []}
    }


def test_load_molecule_takes_an_atomistic_and_a_frame() -> None:
    transport = _RpcTransport()
    board = Sketch(name="mol", transport=transport)
    mol = mp.io.smiles.read_smiles("CCO").to_atomistic()
    board.load_molecule(mol)
    board.load_molecule(mol.to_frame())
    first, second = (params["data"] for _, params, _ in transport.requests)
    assert first == second
    assert [a["element"] for a in first["atoms"]] == ["C", "C", "O"]
    assert first["atoms"][2]["hydrogens"] == 1


def test_load_rejects_a_non_document() -> None:
    board = Sketch(name="bad", transport=_RpcTransport())
    with pytest.raises(TypeError, match="atoms"):
        board.load({"atoms": []})


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
    assert seen[0]["viewport"] == (960, 720)


@pytest.mark.parametrize(
    ("headless_env", "requested", "expected"),
    [
        ("1", None, True),  # headless surface: render in headless Chromium
        ("", None, None),  # display present: fall back only if no page attaches
        ("", True, True),
        ("1", False, False),
    ],
)
def test_headless_policy_reaches_the_transport(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    headless_env: str,
    requested: bool | None,
    expected: bool | None,
) -> None:
    from molvis import runtime

    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "index.html").write_text("<html></html>")
    monkeypatch.setenv("MOLVIS_SKETCH_DIST", str(bundle))
    monkeypatch.setenv("MOLVIS_HEADLESS", headless_env)
    monkeypatch.setattr(runtime, "_lacks_display", lambda: False)
    runtime.display_surface.cache_clear()
    seen: list[dict[str, object]] = []

    class _Socket:
        def __init__(self, **kwargs: object) -> None:
            seen.append(kwargs)

        def start(self) -> None:
            pass

        def connection_url(self, *, session: str | None = None) -> str:
            return ""

    monkeypatch.setattr("molvis.transport.websocket.WebSocketTransport", _Socket)
    kwargs = {} if requested is None else {"headless": requested}
    try:
        _ = Sketch(name="headless", **kwargs).connection_url
    finally:
        runtime.display_surface.cache_clear()
    assert seen[0]["headless"] is expected


def test_headless_true_with_a_custom_transport_is_refused() -> None:
    with pytest.raises(ValueError, match="headless=True"):
        Sketch(name="custom", transport=_Transport(), headless=True)



def test_wait_for_page_waits_on_the_transport_without_a_deadline() -> None:
    class _Transport:
        def __init__(self) -> None:
            self.waited: list[float | None] = []

        def wait_for_connection(self, timeout: float | None = None) -> None:
            self.waited.append(timeout)

    transport = _Transport()
    board = Sketch(name="wait-for-page", transport=transport)
    try:
        assert board.wait_for_page() is board
        board.wait_for_page(timeout=3.0)
        assert transport.waited == [None, 3.0]
    finally:
        board.close()



def test_page_url_is_the_http_page_not_the_websocket() -> None:
    class _Endpoints:
        standalone_url = "http://127.0.0.1:9/?ws_url=ws%3A%2F%2F127.0.0.1%3A9%2Fws&session=s"

    class _Transport:
        def page_endpoints(self, *, session: str) -> _Endpoints:
            assert session == "page-url"
            return _Endpoints()

    board = Sketch(name="page-url", transport=_Transport())
    try:
        assert board.page_url.startswith("http://")
    finally:
        board.close()


def test_a_stage_also_has_a_page_url_and_waits_for_its_page() -> None:
    class _Endpoints:
        standalone_url = "http://127.0.0.1:9/?session=stage"

    class _Transport:
        def __init__(self) -> None:
            self.waited: list[float | None] = []

        def page_endpoints(self, *, session: str) -> _Endpoints:
            return _Endpoints()

        def wait_for_connection(self, timeout: float | None = None) -> None:
            self.waited.append(timeout)

    transport = _Transport()
    scene = Molvis(name="stage-page", transport=transport)
    try:
        assert scene.page_url == "http://127.0.0.1:9/?session=stage"
        assert scene.wait_for_page() is scene
        assert transport.waited == [None]
    finally:
        scene.close()
