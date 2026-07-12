"""Unit tests for the ``pipeline.*`` command mixin.

These tests mock ``send_cmd`` and assert the mixin translates Python
arguments into the correct JSON-RPC payload and decodes responses into
the typed dataclasses. They don't boot a frontend — the router itself is
covered in the core test suite.

Every mutator (add/remove/reorder/set_enabled/set_selection_scope/clear) now also
triggers a follow-up ``pipeline.list`` call that refreshes the
Python-side mirror used for state sync on WS reconnect. The tests assert
both the mutation RPC **and** the mirror refresh.
"""

from __future__ import annotations

from typing import Any

import pytest

from molvis import Molvis
from molvis.commands import AvailableModifier, ModifierInfo


@pytest.fixture(autouse=True)
def _reset_registry() -> None:
    Molvis._scene_registry.clear()
    yield
    Molvis._scene_registry.clear()


def _wire_send_cmd(
    scene: Molvis,
    responses: dict[str, Any],
) -> list[dict[str, Any]]:
    """Replace ``scene.send_cmd`` with a stub driven by *responses*.

    Each inbound call looks up ``method`` in *responses*; missing keys
    return ``{}``. Returns a log list of every call (in order).
    """
    calls: list[dict[str, Any]] = []

    def stub(method, params, buffers=None, wait_for_response=False, timeout=10.0):
        calls.append(
            {
                "method": method,
                "params": params,
                "wait_for_response": wait_for_response,
            }
        )
        return responses.get(method, {})

    scene.send_cmd = stub  # type: ignore[method-assign]
    return calls


def _pipeline_list_response(modifiers: list[dict[str, Any]]) -> dict[str, Any]:
    return {"modifiers": modifiers}


def test_list_modifiers_decodes_response_and_updates_mirror() -> None:
    scene = Molvis(name="pipeline-list")
    modifiers_payload = [
        {
            "id": "data-source-1",
            "name": "Data Source",
            "category": "data",
            "enabled": True,
            "selection_scope_id": None,
            "source_owner_id": None,
        },
        {
            "id": "hide-h-1",
            "name": "Hide Hydrogens",
            "category": "Structure",
            "enabled": False,
            "selection_scope_id": None,
            "source_owner_id": None,
        },
    ]
    calls = _wire_send_cmd(
        scene,
        {"pipeline.list": _pipeline_list_response(modifiers_payload)},
    )

    result = scene.list_modifiers()

    assert calls[0]["method"] == "pipeline.list"
    assert calls[0]["wait_for_response"] is True
    assert len(result) == 2
    assert result[0] == ModifierInfo(
        id="data-source-1",
        name="Data Source",
        category="data",
        enabled=True,
        selection_scope_id=None,
        source_owner_id=None,
    )
    assert result[1].enabled is False
    # Mirror is populated and ready for state sync.
    assert len(scene._mirror_pipeline) == 2
    assert scene._mirror_pipeline[0].id == "data-source-1"


def test_available_modifiers_decodes_response() -> None:
    scene = Molvis(name="pipeline-available")
    _wire_send_cmd(
        scene,
        {
            "pipeline.available_modifiers": {
                "modifiers": [
                    {"name": "Slice", "category": "Geometry"},
                    {
                        "name": "Hide Hydrogens",
                        "category": "Structure",
                    },
                ],
            }
        },
    )

    result = scene.available_modifiers()

    assert result == [
        AvailableModifier(name="Slice", category="Geometry"),
        AvailableModifier(name="Hide Hydrogens", category="Structure"),
    ]


def test_add_modifier_sends_name_and_optional_scope() -> None:
    scene = Molvis(name="pipeline-add")
    added_info = {
        "id": "hide-sel-1",
        "name": "Hide Selection",
        "category": "Selection",
        "enabled": True,
        "selection_scope_id": "sel-1",
        "source_owner_id": None,
    }
    calls = _wire_send_cmd(
        scene,
        {
            "pipeline.add_modifier": {"id": "hide-sel-1", "modifier": added_info},
            "pipeline.list": _pipeline_list_response([added_info]),
        },
    )

    info = scene.add_modifier("Hide Selection", selection_scope_id="sel-1")

    # The mutation RPC is issued first, then the mirror refresh.
    assert [c["method"] for c in calls] == [
        "pipeline.add_modifier",
        "pipeline.list",
    ]
    assert calls[0]["params"] == {
        "name": "Hide Selection",
        "selection_scope_id": "sel-1",
    }
    assert info.id == "hide-sel-1"
    assert info.selection_scope_id == "sel-1"
    assert len(scene._mirror_pipeline) == 1


def test_add_modifier_omits_unset_params() -> None:
    scene = Molvis(name="pipeline-add-min")
    modifier = {
        "id": "slice-1",
        "name": "Slice",
        "category": "Geometry",
        "enabled": True,
        "selection_scope_id": None,
        "source_owner_id": None,
    }
    calls = _wire_send_cmd(
        scene,
        {
            "pipeline.add_modifier": {"modifier": modifier},
            "pipeline.list": _pipeline_list_response([modifier]),
        },
    )

    scene.add_modifier("Slice")

    assert calls[0]["params"] == {"name": "Slice"}


def test_remove_modifier_returns_cascade_ids() -> None:
    scene = Molvis(name="pipeline-remove")
    calls = _wire_send_cmd(
        scene,
        {
            "pipeline.remove_modifier": {"removed_ids": ["hide-1", "sel-1"]},
            "pipeline.list": _pipeline_list_response([]),
        },
    )

    result = scene.remove_modifier("sel-1")

    assert calls[0]["method"] == "pipeline.remove_modifier"
    assert calls[0]["params"] == {"id": "sel-1"}
    assert result == ["hide-1", "sel-1"]
    assert scene._mirror_pipeline == []


def test_reorder_modifier_sends_integer_index() -> None:
    scene = Molvis(name="pipeline-reorder")
    calls = _wire_send_cmd(
        scene,
        {
            "pipeline.reorder_modifier": {"success": True},
            "pipeline.list": _pipeline_list_response([]),
        },
    )

    scene.reorder_modifier("mod-1", 2)

    assert calls[0]["method"] == "pipeline.reorder_modifier"
    assert calls[0]["params"] == {"id": "mod-1", "new_index": 2}


def test_set_modifier_selection_scope_allows_null() -> None:
    scene = Molvis(name="pipeline-scope")
    calls = _wire_send_cmd(
        scene,
        {
            "pipeline.set_selection_scope": {"success": True},
            "pipeline.list": _pipeline_list_response([]),
        },
    )

    scene.set_modifier_selection_scope("mod-1", None)

    assert calls[0]["params"] == {"id": "mod-1", "selection_scope_id": None}


def test_clear_pipeline_has_no_params_and_wipes_mirror() -> None:
    scene = Molvis(name="pipeline-clear")
    scene._mirror_pipeline = [
        ModifierInfo(
            id="m1",
            name="Slice",
            category="Geometry",
            enabled=True,
            selection_scope_id=None,
            source_owner_id=None,
        )
    ]
    calls = _wire_send_cmd(scene, {"pipeline.clear": {"success": True}})

    scene.clear_pipeline()

    assert calls[0]["method"] == "pipeline.clear"
    assert calls[0]["params"] == {}
    assert scene._mirror_pipeline == []
