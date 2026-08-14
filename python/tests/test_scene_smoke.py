"""Smoke tests for the Molvis scene handle: registry, send_cmd routing,
display bundle."""

from __future__ import annotations

import inspect

import pytest

from molvis import DisplaySurface, Molvis
from molvis.events import EventBus
from molvis.transport import PageEndpoints


class FakeTransport:
    def __init__(self, *, port: int = 0, connected: bool = False) -> None:
        self.event_bus: EventBus | None = None
        self.started = False
        self.stopped = False
        self.sent: list[tuple[str, dict, dict]] = []
        self.port = port
        self.connected = connected

    def attach_event_bus(self, bus: EventBus) -> None:
        self.event_bus = bus

    def start(self) -> int:
        self.started = True
        return self.port

    def stop(self) -> None:
        self.stopped = True
        self.connected = False

    def send_request(
        self,
        method: str,
        params: dict,
        *,
        buffers=None,
        wait_for_response: bool = False,
        timeout: float = 10.0,
    ):
        self.sent.append(
            (method, params, {"wait": wait_for_response, "timeout": timeout})
        )
        return {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}

    def page_endpoints(self, *, session: str) -> PageEndpoints:
        base = "http://localhost:1234/"
        return PageEndpoints(
            base_url=base,
            ws_url="ws://localhost:1234/ws",
            session=session,
            token="t0k",
            scripts=(f"{base}js/lib.abc.js", f"{base}js/index.abc.js"),
            css=(f"{base}css/index.abc.css",),
            standalone_url=f"{base}?ws_url=ws&token=t0k&session={session}",
        )


@pytest.fixture(autouse=True)
def _reset_registry() -> None:
    Molvis._scene_registry.clear()
    yield
    Molvis._scene_registry.clear()


def test_named_scene_registry_round_trip() -> None:
    scene = Molvis(name="registry-test", transport=FakeTransport())
    assert Molvis.get_scene("registry-test") is scene
    assert "registry-test" in Molvis.list_scenes()
    scene.close()
    assert "registry-test" not in Molvis.list_scenes()


def test_duplicate_name_returns_same_instance() -> None:
    transport = FakeTransport()
    first = Molvis(name="dup", transport=transport)
    # No-arg recall returns the cached scene unchanged.
    second = Molvis(name="dup")
    # Passing the same transport instance is also fine.
    third = Molvis(name="dup", transport=transport)
    assert first is second
    assert first is third


def test_param_mismatch_on_cached_name_raises() -> None:
    Molvis(name="default", transport=FakeTransport(), gui=True)
    with pytest.raises(ValueError, match="already exists with a different"):
        Molvis(name="default", gui=False)


def test_anonymous_call_then_conflicting_kwarg_raises() -> None:
    # Reproduces the user-reported bug: Molvis() then Molvis(gui=False)
    # both default to name="default" — the second call must NOT silently
    # alias to the first.
    Molvis(transport=FakeTransport())
    with pytest.raises(ValueError) as exc:
        Molvis(gui=False)
    msg = str(exc.value)
    assert "default" in msg
    assert "gui" in msg
    assert "Molvis.replace" in msg


def test_conflicting_size_also_raises() -> None:
    Molvis(name="ws", transport=FakeTransport(), width=1200)
    with pytest.raises(ValueError, match="width"):
        Molvis(name="ws", width=800)


def test_replace_closes_old_and_creates_new() -> None:
    old_transport = FakeTransport()
    old = Molvis(name="default", transport=old_transport, gui=True)
    new_transport = FakeTransport()
    new = Molvis.replace("default", transport=new_transport, gui=False)

    assert new is not old
    assert old_transport.stopped is True
    assert new.gui is False
    assert Molvis.get_scene("default") is new


def test_replace_without_existing_just_creates() -> None:
    new = Molvis.replace("fresh", transport=FakeTransport(), gui=False)
    assert Molvis.get_scene("fresh") is new
    assert new.gui is False


def test_close_all_empties_registry() -> None:
    Molvis(name="a", transport=FakeTransport())
    Molvis(name="b", transport=FakeTransport())
    Molvis(name="c", transport=FakeTransport())
    assert len(Molvis.list_scenes()) == 3
    Molvis.close_all()
    assert Molvis.list_scenes() == []


def test_has_scene() -> None:
    assert Molvis.has_scene("absent") is False
    Molvis(name="present", transport=FakeTransport())
    assert Molvis.has_scene("present") is True


def test_session_info_and_summary() -> None:
    transport = FakeTransport(port=4242, connected=True)
    scene = Molvis(name="probe", transport=transport, gui=False, width=900, height=600)
    info = scene.session_info
    assert info["name"] == "probe"
    assert info["gui"] is False
    assert info["width"] == 900
    assert info["height"] == 600
    assert info["connected"] is True
    assert info["port"] == 4242
    assert isinstance(info["created_at"], float)

    summary = Molvis.session_summary()
    assert any(entry["name"] == "probe" for entry in summary)


def test_repr_shows_status_and_gui() -> None:
    scene = Molvis(name="r", transport=FakeTransport(connected=True), gui=False)
    rendered = repr(scene)
    assert "name='r'" in rendered
    assert "gui=False" in rendered
    assert "connected" in rendered

    scene2 = Molvis(name="r2", transport=FakeTransport(), gui=True)
    assert "idle" in repr(scene2)


def test_send_cmd_routes_through_transport() -> None:
    fake = FakeTransport()
    scene = Molvis(name="route-test", transport=fake)

    result = scene.send_cmd("scene.clear", {}, wait_for_response=True, timeout=3.5)

    assert fake.started is True
    assert result == {"ok": True}
    method, params, meta = fake.sent[0]
    assert method == "scene.clear"
    assert params == {}
    assert meta["wait"] is True
    assert meta["timeout"] == 3.5


def test_fire_and_forget_returns_self_for_chaining() -> None:
    scene = Molvis(name="fnf", transport=FakeTransport())
    returned = scene.send_cmd("view.set_mode", {"mode": "view"})
    assert returned is scene


def test_visual_style_is_global_not_a_draw_argument() -> None:
    for method_name in ("draw_frame", "draw_atomistic", "draw_atoms"):
        parameters = inspect.signature(getattr(Molvis, method_name)).parameters
        for visual_parameter in (
            "style",
            "atom_radius",
            "bond_radius",
            "color_by",
        ):
            assert visual_parameter not in parameters
    style_parameters = inspect.signature(Molvis.set_style).parameters
    assert "style" in style_parameters
    assert "theme" not in style_parameters
    assert "atom_radius" in style_parameters
    assert "bond_radius" in style_parameters
    assert "outline" in style_parameters


def test_global_style_serializes_optional_outline() -> None:
    fake = FakeTransport()
    scene = Molvis(name="outlined", transport=fake)
    scene.set_style(style="graph", outline=False)

    method, params, _meta = fake.sent[0]
    assert method == "view.set_style"
    assert params["style"] == "graph"
    assert params["outline"] is False


def test_style_and_theme_catalogs_are_iterable() -> None:
    assert "ball-and-stick" in Molvis.STYLE
    assert "spacefill" in Molvis.STYLE
    assert "tab10" in Molvis.THEME
    assert "ovito" in Molvis.THEME
    assert "classic" not in Molvis.THEME
    # Instance inherits the same catalogs for stage.STYLE loops.
    scene = Molvis(name="catalogs", transport=FakeTransport())
    assert list(scene.STYLE) == list(Molvis.STYLE)
    assert list(scene.THEME) == list(Molvis.THEME)


def test_set_style_and_set_theme_are_separate_rpcs() -> None:
    fake = FakeTransport()
    scene = Molvis(name="style-theme", transport=fake)
    scene.set_style("spacefill")
    scene.set_theme("tab10")

    methods = [m for m, _p, _meta in fake.sent]
    assert methods == ["view.set_style", "view.set_theme"]
    assert fake.sent[0][1]["style"] == "spacefill"
    assert fake.sent[1][1]["theme"] == "tab10"


def test_set_style_theme_loop_matches_catalogs() -> None:
    fake = FakeTransport()
    scene = Molvis(name="style-theme-loop", transport=fake)
    for style in scene.STYLE:
        for theme in scene.THEME:
            scene.set_style(style)
            scene.set_theme(theme)
    theme_calls = [p for m, p, _ in fake.sent if m == "view.set_theme"]
    style_calls = [p for m, p, _ in fake.sent if m == "view.set_style"]
    assert len(theme_calls) == len(scene.STYLE) * len(scene.THEME)
    assert len(style_calls) == len(scene.STYLE) * len(scene.THEME)
    assert theme_calls[0]["theme"] == scene.THEME[0]
    assert style_calls[0]["style"] == scene.STYLE[0]


def test_set_theme_rejects_unknown() -> None:
    import pytest

    scene = Molvis(name="bad-theme", transport=FakeTransport())
    with pytest.raises(ValueError, match="unknown theme"):
        scene.set_theme("neon")


def test_set_style_rejects_unknown() -> None:
    import pytest

    scene = Molvis(name="bad-style", transport=FakeTransport())
    with pytest.raises(ValueError, match="unknown style"):
        scene.set_style("neon-tube")  # type: ignore[arg-type]


def test_interrupt_check_stops_send_cmd() -> None:
    import pytest

    from molvis import interrupt as mi

    mi.clear()
    mi.request()
    scene = Molvis(name="interrupted", transport=FakeTransport())
    with pytest.raises(mi.InterruptRequested):
        scene.set_style("spacefill")
    mi.clear()


def test_interrupt_host_latch_is_polled(monkeypatch: object) -> None:
    """Pyodide host raises a pure-JS latch; check() must see it without request()."""
    import pytest

    from molvis import interrupt as mi

    class _Host:
        def __init__(self) -> None:
            self.flag = False

        def is_interrupt_requested(self) -> bool:
            return self.flag

        def request_interrupt(self) -> None:
            self.flag = True

        def clear_interrupt(self) -> None:
            self.flag = False

    host = _Host()
    import sys

    sys.modules["molvis_kernel_ctl"] = host  # type: ignore[assignment]
    try:
        mi.clear()
        assert mi.requested() is False
        host.flag = True
        assert mi.requested() is True
        with pytest.raises(mi.InterruptRequested):
            mi.check()
    finally:
        mi.clear()
        sys.modules.pop("molvis_kernel_ctl", None)


def test_repr_mimebundle_emits_inline_mount() -> None:
    scene = Molvis(
        name="cell",
        transport=FakeTransport(),
        display_surface=DisplaySurface.INLINE,
    )
    bundle = scene._repr_mimebundle_()

    assert bundle["text/plain"].startswith("Molvis(name='cell',")

    html_body = bundle["text/html"]
    assert "<iframe" not in html_body
    assert 'class="molvis-cell"' in html_body
    assert "width:1200px" in html_body
    assert "height:800px" in html_body
    # Loader script ships the assets and the mount opts inline:
    assert "MolvisApp.mount" in html_body
    assert "useShadowDOM" in html_body
    assert "lib.abc.js" in html_body
    assert "index.abc.css" in html_body
    assert '"session": "cell"' in html_body
    assert '"wsUrl": "ws://localhost:1234/ws"' in html_body


def test_repr_mimebundle_respects_include_exclude() -> None:
    scene = Molvis(
        name="filtered",
        transport=FakeTransport(),
        display_surface=DisplaySurface.INLINE,
    )
    only_text = scene._repr_mimebundle_(include={"text/plain"})
    assert set(only_text.keys()) == {"text/plain"}

    drop_html = scene._repr_mimebundle_(exclude={"text/html"})
    assert "text/html" not in drop_html
    assert "text/plain" in drop_html


def test_repr_mimebundle_browser_surface_omits_html() -> None:
    """Script/terminal hosts have no notebook cell to render into —
    the mimebundle should carry only ``text/plain``."""
    scene = Molvis(
        name="tab",
        transport=FakeTransport(),
        display_surface=DisplaySurface.BROWSER,
    )
    bundle = scene._repr_mimebundle_()
    assert set(bundle.keys()) == {"text/plain"}


def test_repr_mimebundle_headless_omits_html() -> None:
    scene = Molvis(
        name="ci",
        transport=FakeTransport(),
        display_surface=DisplaySurface.HEADLESS,
    )
    bundle = scene._repr_mimebundle_()
    assert set(bundle.keys()) == {"text/plain"}


def test_inline_repr_mounts_once_then_renders_status() -> None:
    """Chained command calls in Jupyter should not clone the viewer.

    First ``_repr_mimebundle_`` call mounts the bundle; subsequent
    calls (e.g. ``scene.mark_atom(0)`` returning ``self`` in a later
    cell) emit a compact status span instead of a second mount, because
    the real update has already flowed over the WebSocket.
    """
    scene = Molvis(
        name="inline",
        transport=FakeTransport(),
        display_surface=DisplaySurface.INLINE,
    )
    first = scene._repr_mimebundle_()
    assert "MolvisApp.mount" in first["text/html"]

    second = scene._repr_mimebundle_()
    assert "MolvisApp.mount" not in second["text/html"]
    assert "molvis-status" in second["text/html"]
    assert "viewer mounted above" in second["text/html"]


def test_show_forces_a_fresh_mount() -> None:
    scene = Molvis(
        name="reshow",
        transport=FakeTransport(),
        display_surface=DisplaySurface.INLINE,
    )
    scene._repr_mimebundle_()  # first mount
    scene._repr_mimebundle_()  # status

    returned = scene.show()
    assert returned is scene
    third = scene._repr_mimebundle_()
    assert "MolvisApp.mount" in third["text/html"]


def test_show_is_noop_on_browser_surface() -> None:
    scene = Molvis(
        name="script-show",
        transport=FakeTransport(),
        display_surface=DisplaySurface.BROWSER,
    )
    assert scene.show() is scene
    bundle = scene._repr_mimebundle_()
    assert set(bundle.keys()) == {"text/plain"}


def test_runtime_properties_are_exposed() -> None:
    scene = Molvis(
        name="runtime",
        transport=FakeTransport(),
        display_surface=DisplaySurface.INLINE,
    )
    assert scene.display_surface is DisplaySurface.INLINE
    # runtime_env reflects the process, not the override — pytest runs
    # under a plain Python interpreter with no IPython attached.
    assert scene.runtime_env.value in {"script", "python_repl"}

    info = scene.session_info
    assert info["display_surface"] == "inline"
    assert info["runtime"] == scene.runtime_env.value


def test_display_surface_mismatch_on_cached_name_raises() -> None:
    Molvis(
        name="srf",
        transport=FakeTransport(),
        display_surface=DisplaySurface.INLINE,
    )
    with pytest.raises(ValueError, match="display_surface"):
        Molvis(name="srf", display_surface=DisplaySurface.BROWSER)


def test_close_stops_transport_and_drops_registry() -> None:
    fake = FakeTransport()
    scene = Molvis(name="close-test", transport=fake)
    scene.close()
    assert fake.stopped is True
    assert "close-test" not in Molvis.list_scenes()


def test_send_cmd_mounts_the_inline_viewer_before_the_first_rpc(monkeypatch):
    """A cell that drives a scene without displaying it must still mount.

    `stage = mv.Stage()` followed by `stage.draw_frame(...)` never displays
    the scene, so nothing calls `_repr_mimebundle_` — the RPC used to block on
    a handshake with a browser tab nothing had opened.
    """
    published: list[dict] = []
    monkeypatch.setattr(
        "IPython.display.publish_display_data",
        lambda data, *a, **k: published.append(data),
    )
    scene = Molvis(
        name="inline-mount",
        transport=FakeTransport(port=1234),
        display_surface=DisplaySurface.INLINE,
        serve_page=False,
    )

    scene.send_cmd("noop", {})

    assert len(published) == 1
    assert "text/html" in published[0]


def test_send_cmd_mounts_at_most_once(monkeypatch):
    published: list[dict] = []
    monkeypatch.setattr(
        "IPython.display.publish_display_data",
        lambda data, *a, **k: published.append(data),
    )
    scene = Molvis(
        name="inline-mount-once",
        transport=FakeTransport(port=1234),
        display_surface=DisplaySurface.INLINE,
        serve_page=False,
    )

    scene.send_cmd("noop", {})
    scene.send_cmd("noop", {})
    scene.send_cmd("noop", {})

    assert len(published) == 1


def test_send_cmd_does_not_mount_outside_inline_hosts(monkeypatch):
    published: list[dict] = []
    monkeypatch.setattr(
        "IPython.display.publish_display_data",
        lambda data, *a, **k: published.append(data),
    )
    scene = Molvis(
        name="browser-no-mount",
        transport=FakeTransport(port=1234),
        display_surface=DisplaySurface.BROWSER,
        serve_page=False,
    )

    scene.send_cmd("noop", {})

    assert published == []


def test_gui_defaults_to_canvas_inline_and_page_in_a_browser_tab():
    """A notebook cell is a stage, not an application."""
    inline = Molvis(
        name="gui-inline",
        transport=FakeTransport(),
        display_surface=DisplaySurface.INLINE,
        serve_page=False,
    )
    tab = Molvis(
        name="gui-tab",
        transport=FakeTransport(),
        display_surface=DisplaySurface.BROWSER,
        serve_page=False,
    )

    assert inline.gui is False
    assert tab.gui is True


def test_explicit_gui_wins_over_the_surface_default():
    scene = Molvis(
        name="gui-explicit",
        transport=FakeTransport(),
        display_surface=DisplaySurface.INLINE,
        gui=True,
        serve_page=False,
    )

    assert scene.gui is True


def test_inline_mount_asks_for_the_canvas_surface(monkeypatch):
    published: list[dict] = []
    monkeypatch.setattr(
        "IPython.display.publish_display_data",
        lambda data, *a, **k: published.append(data),
    )
    scene = Molvis(
        name="gui-surface",
        transport=FakeTransport(port=1234),
        display_surface=DisplaySurface.INLINE,
        serve_page=False,
    )

    scene.send_cmd("noop", {})

    html = published[0]["text/html"]
    assert '"canvas"' in html
    assert '"full"' not in html


def test_inline_mount_carries_appearance_and_background(monkeypatch):
    published: list[dict] = []
    monkeypatch.setattr(
        "IPython.display.publish_display_data",
        lambda data, *a, **k: published.append(data),
    )
    scene = Molvis(
        name="opts-inline",
        transport=FakeTransport(port=1234),
        display_surface=DisplaySurface.INLINE,
        appearance="light",
        background="#ffffff",
        serve_page=False,
    )

    scene.send_cmd("noop", {})

    html = published[0]["text/html"]
    assert '"theme": "light"' in html or '"theme":"light"' in html
    assert "#FFFFFF" in html


def test_inline_mount_omits_appearance_when_unset(monkeypatch):
    """No flag means the host's stored light/dark preference wins."""
    published: list[dict] = []
    monkeypatch.setattr(
        "IPython.display.publish_display_data",
        lambda data, *a, **k: published.append(data),
    )
    scene = Molvis(
        name="opts-unset",
        transport=FakeTransport(port=1234),
        display_surface=DisplaySurface.INLINE,
        serve_page=False,
    )

    scene.send_cmd("noop", {})

    assert '"theme"' not in published[0]["text/html"]


def test_background_must_be_a_hex_color():
    with pytest.raises(ValueError, match="RRGGBB"):
        Molvis(
            name="bad-bg",
            transport=FakeTransport(),
            display_surface=DisplaySurface.BROWSER,
            background="rebeccapurple",
            serve_page=False,
        )
