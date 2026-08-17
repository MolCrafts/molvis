"""InProcessTransport: same JSON-RPC catalog, no WebSocket."""

from __future__ import annotations

import asyncio

import pytest

from molvis import DisplaySurface, InProcessTransport, Molvis, MolvisRPCError


class CatalogInvoker:
    """Sync invoker that mimics RPCRouter results (bare result values).

    The camera holds its pose. A stateless stub whose ``camera.get_pose``
    always answers the seed value cannot express "set it, then read it
    back" — the read is the only way the caller observes the write, so the
    assertion would contradict the stub rather than test the transport.
    """

    #: What a camera reports before anything has moved it.
    _SEED_POSE = {
        "alpha": 0.1,
        "beta": 1.0,
        "radius": 20.0,
        "target": [0.0, 0.0, 0.0],
        "position": [1.0, 0.0, 0.0],
        "up": [0.0, 0.0, 1.0],
    }

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.handlers: dict[str, object] = {}
        self._next_atom_id = 0
        self._pose = dict(self._SEED_POSE)

    def __call__(self, method: str, params: dict):
        self.calls.append((method, dict(params)))
        custom = self.handlers.get(method)
        if callable(custom):
            return custom(params)
        if method == "camera.get_pose":
            return dict(self._pose)
        if method == "camera.set_pose":
            self._pose = {
                **self._pose,
                "alpha": float(params.get("alpha", self._pose["alpha"])),
                "beta": float(params.get("beta", self._pose["beta"])),
                "radius": float(params.get("radius", self._pose["radius"])),
                "target": params.get("target", self._pose["target"]),
            }
            return {"pose": dict(self._pose)}
        if method == "camera.fit":
            self._pose = {
                **self._pose,
                "alpha": 0.5,
                "beta": 1.0,
                "radius": 15.0,
                "target": [0.0, 0.0, 0.0],
            }
            return {"pose": dict(self._pose)}
        if method == "scene.draw_frame":
            return {"success": True, "atomIds": []}
        if method == "scene.draw_atom":
            atom_id = self._next_atom_id
            self._next_atom_id += 1
            return {"success": True, "atomId": atom_id}
        if method == "scene.draw_bond":
            return {"success": True, "bondId": 0}
        if method == "scene.commit":
            return {"success": True}
        if method == "pipeline.list":
            return {"modifiers": []}
        if method == "boom":
            return {"error": {"code": -32603, "message": "kaboom"}}
        return {"ok": True}


def test_send_request_wraps_bare_result_as_envelope() -> None:
    inv = CatalogInvoker()
    t = InProcessTransport(inv)
    resp = t.send_request("camera.get_pose", {}, wait_for_response=True)
    assert resp is not None
    assert resp["result"]["alpha"] == pytest.approx(0.1)
    assert inv.calls == [("camera.get_pose", {})]


def test_send_request_propagates_error_envelope() -> None:
    inv = CatalogInvoker()
    t = InProcessTransport(inv)
    resp = t.send_request("boom", {}, wait_for_response=True)
    assert resp is not None
    assert "error" in resp
    assert resp["error"]["message"] == "kaboom"


def test_molvis_camera_uses_catalog_methods() -> None:
    inv = CatalogInvoker()
    scene = Molvis(
        name="inprocess-cam",
        transport=InProcessTransport(inv),
        serve_page=False,
        display_surface=DisplaySurface.HEADLESS,
        gui=False,
    )
    cam = scene.camera.set_pose(alpha=1.25, beta=0.9, radius=42.0)
    assert cam is scene.camera
    pose = cam.pose
    assert pose.alpha == pytest.approx(1.25)
    assert pose.radius == pytest.approx(42.0)
    methods = [m for m, _ in inv.calls]
    assert "camera.set_pose" in methods
    assert "camera.get_pose" in methods


def test_molvis_draw_frame_routes_scene_draw_frame() -> None:
    import numpy as np

    inv = CatalogInvoker()
    scene = Molvis(
        name="inprocess-draw",
        transport=InProcessTransport(inv),
        serve_page=False,
        display_surface=DisplaySurface.HEADLESS,
        gui=False,
    )

    class FakeFrame:
        def to_dict(self):
            return {
                "blocks": {
                    "atoms": {
                        "x": [0.0],
                        "y": [0.0],
                        "z": [0.0],
                        "element": ["C"],
                    }
                }
            }

    scene.draw_frame(FakeFrame())  # type: ignore[arg-type]
    methods = [m for m, _ in inv.calls]
    assert "scene.draw_frame" in methods
    draw_calls = [p for m, p in inv.calls if m == "scene.draw_frame"]
    assert "frame" in draw_calls[0]
    columns = draw_calls[0]["frame"]["blocks"]["atoms"]["columns"]
    # Wire contract: the column states its dtype, and the in-process transport
    # resolves the buffer inline so JS receives a Float64Array.
    assert columns["x"]["dtype"] == "f64"
    assert isinstance(columns["x"]["data"], np.ndarray)
    assert columns["x"]["data"].dtype == np.float64
    assert columns["x"]["data"].tolist() == [0.0]


def test_draw_atom_uses_edit_command_rpc() -> None:
    """draw_atom goes through scene.draw_atom (Edit DrawAtomCommand), not frame merge."""
    inv = CatalogInvoker()
    scene = Molvis(
        name="inprocess-draw-atom",
        transport=InProcessTransport(inv),
        serve_page=False,
        display_surface=DisplaySurface.HEADLESS,
        gui=False,
    )
    scene.draw_atom(x=0, y=0, z=0, element="O")
    draw_calls = [p for m, p in inv.calls if m == "scene.draw_atom"]
    assert draw_calls, "draw_atom must issue scene.draw_atom (edit working tree)"
    params = draw_calls[0]
    # Integer origin coords are sent as floats for the command path.
    assert params["x"] == 0.0 and params["y"] == 0.0 and params["z"] == 0.0
    assert params["element"] == "O"
    assert scene._atom_ids == [0]
    # HEAD is not written until commit (Ctrl+S).
    assert not any(m == "scene.commit" for m, _ in inv.calls)
    scene.commit()
    assert any(m == "scene.commit" for m, _ in inv.calls)


def test_draw_atom_accepts_mapping_row() -> None:
    """Plugin demos pass atoms[i] (a field→value mapping) positionally."""
    inv = CatalogInvoker()
    scene = Molvis(
        name="inprocess-draw-atom-row",
        transport=InProcessTransport(inv),
        serve_page=False,
        display_surface=DisplaySurface.HEADLESS,
        gui=False,
    )
    scene.draw_atom({"x": 1.0, "y": 2.0, "z": 3.0, "element": "C"})
    params = [p for m, p in inv.calls if m == "scene.draw_atom"][0]
    assert params["x"] == 1.0 and params["y"] == 2.0 and params["z"] == 3.0
    assert params["element"] == "C"
    assert scene._atom_ids == [0]


def test_molvis_rpc_error_from_inprocess() -> None:
    inv = CatalogInvoker()
    scene = Molvis(
        name="inprocess-err",
        transport=InProcessTransport(inv),
        serve_page=False,
        display_surface=DisplaySurface.HEADLESS,
        gui=False,
    )
    with pytest.raises(MolvisRPCError, match="kaboom"):
        scene.send_cmd("boom", {}, wait_for_response=True)


def test_resolve_async_invoker_inside_running_loop() -> None:
    """Must not deadlock when an invoker returns an awaitable inside a loop.

    Reproduces the Pyodide async in-process RPC path: send_request(wait=True) while
    asyncio is already running. Sync CatalogInvoker is fine; async one must
    still resolve (via side-thread on CPython).

    Driven with ``asyncio.run`` rather than ``@pytest.mark.asyncio``: the
    project has no pytest-asyncio dependency, so that marker was inert and
    the test reported as a failure instead of running.
    """
    calls: list[str] = []

    async def async_invoker(method: str, params: dict):
        calls.append(method)
        await asyncio.sleep(0)
        return {"success": True}

    async def inside_running_loop() -> None:
        t = InProcessTransport(async_invoker)
        resp = t.send_request(
            "scene.draw_frame",
            {"frame": {"blocks": {}}},
            wait_for_response=True,
            timeout=2.0,
        )
        assert resp is not None
        assert resp["result"]["success"] is True
        assert calls == ["scene.draw_frame"]

    asyncio.run(inside_running_loop())


def test_fire_and_forget_returns_none() -> None:
    inv = CatalogInvoker()
    t = InProcessTransport(inv)
    assert t.send_request("camera.fit", {}, wait_for_response=False) is None


def test_js_proxy_result_converted_to_python_mapping() -> None:
    """Pyodide returns JsProxy from JS; camera.fit needs result['pose']."""

    class FakeJsProxy:
        def __init__(self, data: dict) -> None:
            self._data = data

        def to_py(self):
            return self._data

    pose = {
        "alpha": 0.4,
        "beta": 1.05,
        "radius": 12.0,
        "target": [0.0, 0.0, 0.0],
        "position": [1.0, 0.0, 0.0],
        "up": [0.0, 0.0, 1.0],
    }

    def invoker(method: str, params: dict):
        # Mimic bare JS result object (not a Python dict).
        return FakeJsProxy({"pose": pose})

    t = InProcessTransport(invoker)
    resp = t.send_request("camera.fit", {}, wait_for_response=True)
    assert resp is not None
    assert isinstance(resp["result"], dict)
    assert resp["result"]["pose"]["alpha"] == pytest.approx(0.4)
    # Subscriptable the way control.Camera.fit expects.
    assert resp["result"]["pose"]["beta"] == pytest.approx(1.05)


def test_pyodide_to_py_helper() -> None:
    from molvis.transport.inprocess import _pyodide_to_py

    class FakeJsProxy:
        def to_py(self):
            return {"pose": {"alpha": 1.0}}

    out = _pyodide_to_py(FakeJsProxy())
    assert out == {"pose": {"alpha": 1.0}}
    assert _pyodide_to_py(None) is None
    assert _pyodide_to_py({"a": 1}) == {"a": 1}
