"""Stage alias and name-keyed scene registry."""

from __future__ import annotations

import molvis as mv
from molvis import Stage
from molvis.events import EventBus
from molvis.transport import PageEndpoints


class FakeTransport:
    def __init__(self) -> None:
        self.event_bus: EventBus | None = None
        self.connected = False
        self.port = 0

    def attach_event_bus(self, bus: EventBus) -> None:
        self.event_bus = bus

    def start(self) -> int:
        return self.port

    def stop(self) -> None:
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
        return {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}

    def page_endpoints(self, *, session: str) -> PageEndpoints:
        base = "http://localhost:1234/"
        return PageEndpoints(
            base_url=base,
            ws_url="ws://localhost:1234/ws",
            session=session,
            token="t0k",
            scripts=(f"{base}js/index.abc.js",),
            css=(f"{base}css/index.abc.css",),
            standalone_url=f"{base}?ws_url=ws&token=t0k&session={session}",
        )


def setup_function() -> None:
    Stage.close_all()


def teardown_function() -> None:
    Stage.close_all()


def test_stage_is_molvis_alias() -> None:
    assert Stage is mv.Molvis
    assert mv.Stage is Stage


def test_named_stage_is_reused() -> None:
    a = Stage(name="a", transport=FakeTransport())  # type: ignore[arg-type]
    assert Stage(name="a") is a
    assert Stage.get_scene("a") is a


def test_scenes_are_independent_per_name() -> None:
    a = Stage(name="a", transport=FakeTransport())  # type: ignore[arg-type]
    b = Stage(name="b", transport=FakeTransport())  # type: ignore[arg-type]
    assert a is not b
    assert sorted(Stage.list_scenes()) == ["a", "b"]


def test_close_drops_the_scene_from_the_registry() -> None:
    a = Stage(name="a", transport=FakeTransport())  # type: ignore[arg-type]
    a.close()
    assert "a" not in Stage.list_scenes()


def test_no_module_level_command_shortcut() -> None:
    """`mv.draw(...)` is gone — commands live on a stage instance.

    Regression guard: the old module __getattr__ forwarded any unknown
    name to a global "current stage", which shadowed real AttributeErrors
    and broke `from molvis import <submodule>`.
    """
    Stage(name="a", transport=FakeTransport())  # type: ignore[arg-type]
    for name in ("draw", "camera", "snapshot", "clear"):
        assert not hasattr(mv, name), f"mv.{name} should not exist"
