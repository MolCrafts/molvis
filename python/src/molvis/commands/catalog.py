from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

__all__ = [
    "FrontendCommand",
    "FrontendCommandGroup",
    "FrontendCommands",
    "RPC_PROTOCOL_VERSION",
    "rpc_method_names",
]

# Keep in lockstep with core `RPC_PROTOCOL_VERSION` / `rpc.list_methods`.
RPC_PROTOCOL_VERSION = "1.5.0"


class FrontendCommandGroup(str, Enum):
    SCENE = "scene"
    VIEW = "view"
    SELECTION = "selection"
    SNAPSHOT = "snapshot"
    OVERLAY = "overlay"
    PIPELINE = "pipeline"
    CAMERA = "camera"
    RPC = "rpc"


@dataclass(frozen=True)
class FrontendCommand:
    group: FrontendCommandGroup
    action: str

    @property
    def method(self) -> str:
        return f"{self.group.value}.{self.action}"


class FrontendCommands:
    NEW_FRAME = FrontendCommand(FrontendCommandGroup.SCENE, "new_frame")
    DRAW_FRAME = FrontendCommand(FrontendCommandGroup.SCENE, "draw_frame")
    DRAW_ATOM = FrontendCommand(FrontendCommandGroup.SCENE, "draw_atom")
    DRAW_BOND = FrontendCommand(FrontendCommandGroup.SCENE, "draw_bond")
    DRAW_BOX = FrontendCommand(FrontendCommandGroup.SCENE, "draw_box")
    COMMIT = FrontendCommand(FrontendCommandGroup.SCENE, "commit")
    CLEAR = FrontendCommand(FrontendCommandGroup.SCENE, "clear")
    EXPORT_FRAME = FrontendCommand(FrontendCommandGroup.SCENE, "export_frame")
    SET_TRAJECTORY = FrontendCommand(FrontendCommandGroup.SCENE, "set_trajectory")
    APPEND_FRAME = FrontendCommand(FrontendCommandGroup.SCENE, "append_frame")
    SET_FRAME_LABELS = FrontendCommand(FrontendCommandGroup.SCENE, "set_frame_labels")
    SEEK_FRAME = FrontendCommand(FrontendCommandGroup.SCENE, "seek_frame")
    GET_SELECTED = FrontendCommand(FrontendCommandGroup.SELECTION, "get")
    SELECT_ATOMS = FrontendCommand(FrontendCommandGroup.SELECTION, "select_atoms")
    SNAPSHOT = FrontendCommand(FrontendCommandGroup.SNAPSHOT, "take")
    SET_STYLE = FrontendCommand(FrontendCommandGroup.VIEW, "set_style")
    SET_THEME = FrontendCommand(FrontendCommandGroup.VIEW, "set_theme")
    SET_VIEW_MODE = FrontendCommand(FrontendCommandGroup.VIEW, "set_mode")
    CAMERA_TRACK = FrontendCommand(FrontendCommandGroup.CAMERA, "track")
    CAMERA_STOP_TRACK = FrontendCommand(FrontendCommandGroup.CAMERA, "stop_track")
    MARK_ATOM = FrontendCommand(FrontendCommandGroup.OVERLAY, "mark_atom")
    UNMARK_ATOM = FrontendCommand(FrontendCommandGroup.OVERLAY, "unmark_atom")
    PIPELINE_LIST = FrontendCommand(FrontendCommandGroup.PIPELINE, "list")
    PIPELINE_AVAILABLE_MODIFIERS = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "available_modifiers"
    )
    PIPELINE_ADD_MODIFIER = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "add_modifier"
    )
    PIPELINE_REMOVE_MODIFIER = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "remove_modifier"
    )
    PIPELINE_REORDER_MODIFIER = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "reorder_modifier"
    )
    PIPELINE_SET_ENABLED = FrontendCommand(FrontendCommandGroup.PIPELINE, "set_enabled")
    PIPELINE_SET_SELECTION_SCOPE = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "set_selection_scope"
    )
    PIPELINE_SET_SOURCE_OWNER = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "set_source_owner"
    )
    PIPELINE_CLEAR = FrontendCommand(FrontendCommandGroup.PIPELINE, "clear")
    # Scene multi-source + state (core router)
    APPLY_STATE = FrontendCommand(FrontendCommandGroup.SCENE, "apply_state")
    ADD_DATA_SOURCE = FrontendCommand(FrontendCommandGroup.SCENE, "add_data_source")
    REMOVE_DATA_SOURCE = FrontendCommand(
        FrontendCommandGroup.SCENE, "remove_data_source"
    )
    LIST_DATA_SOURCES = FrontendCommand(FrontendCommandGroup.SCENE, "list_data_sources")
    CLEAR_SELECTION = FrontendCommand(FrontendCommandGroup.SELECTION, "clear")
    SELECT_BY_EXPRESSION = FrontendCommand(
        FrontendCommandGroup.SELECTION, "select_by_expression"
    )
    # Introspection — single-source version discovery
    LIST_METHODS = FrontendCommand(FrontendCommandGroup.RPC, "list_methods")


def rpc_method_names() -> list[str]:
    """All FrontendCommand method strings (including non-router session cmds)."""
    names: list[str] = []
    for value in FrontendCommands.__dict__.values():
        if isinstance(value, FrontendCommand):
            names.append(value.method)
    return sorted(set(names))
