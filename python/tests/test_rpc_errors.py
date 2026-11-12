"""Frontend-reported errors are translated into MolvisRPCError."""

from __future__ import annotations

import pytest
from molvis import Molvis, MolvisRPCError
from molvis.events import EventBus


class _ErrorTransport:
    def __init__(self, error: dict) -> None:
        self.event_bus: EventBus | None = None
        self._error = error

    def attach_event_bus(self, bus: EventBus) -> None:
        self.event_bus = bus

    def start(self) -> int:
        return 0

    def stop(self) -> None:
        return None

    def send_request(self, method, params, **kwargs):
        return {
            "jsonrpc": "2.0",
            "id": 3,
            "error": self._error,
        }


@pytest.fixture(autouse=True)
def _reset_registry() -> None:
    Molvis._scene_registry.clear()
    yield
    Molvis._scene_registry.clear()


def test_send_cmd_raises_on_frontend_error() -> None:
    scene = Molvis(
        name="error-test",
        transport=_ErrorTransport(
            {
                "code": -32603,
                "message": "frontend exploded",
                "data": {"detail": "bad state"},
            }
        ),
    )

    with pytest.raises(MolvisRPCError) as excinfo:
        scene.send_cmd("scene.draw_frame", {}, wait_for_response=True)

    err = excinfo.value
    assert err.method == "scene.draw_frame"
    assert err.code == -32603
    assert err.data == {"detail": "bad state"}
