from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

__all__ = ["FrontendCommand", "FrontendCommandGroup", "FrontendCommands"]


class FrontendCommandGroup(str, Enum):
    SCENE = "scene"
    VIEW = "view"
    SELECTION = "selection"
    SNAPSHOT = "snapshot"
    SESSION = "session"
    OVERLAY = "overlay"
    PIPELINE = "pipeline"


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
    DRAW_BOX = FrontendCommand(FrontendCommandGroup.SCENE, "draw_box")
    CLEAR = FrontendCommand(FrontendCommandGroup.SCENE, "clear")
    EXPORT_FRAME = FrontendCommand(FrontendCommandGroup.SCENE, "export_frame")
    SET_TRAJECTORY = FrontendCommand(FrontendCommandGroup.SCENE, "set_trajectory")
    SET_FRAME_LABELS = FrontendCommand(
        FrontendCommandGroup.SCENE, "set_frame_labels"
    )
    GET_SELECTED = FrontendCommand(FrontendCommandGroup.SELECTION, "get")
    SELECT_ATOMS = FrontendCommand(FrontendCommandGroup.SELECTION, "select_atoms")
    SNAPSHOT = FrontendCommand(FrontendCommandGroup.SNAPSHOT, "take")
    SET_STYLE = FrontendCommand(FrontendCommandGroup.VIEW, "set_style")
    SET_THEME = FrontendCommand(FrontendCommandGroup.VIEW, "set_theme")
    SET_VIEW_MODE = FrontendCommand(FrontendCommandGroup.VIEW, "set_mode")
    SET_BACKGROUND = FrontendCommand(FrontendCommandGroup.VIEW, "set_background")
    COLOR_BY = FrontendCommand(FrontendCommandGroup.VIEW, "color_by")
    SESSION_COUNT = FrontendCommand(
        FrontendCommandGroup.SESSION, "get_session_count"
    )
    LIST_SESSIONS = FrontendCommand(FrontendCommandGroup.SESSION, "list_sessions")
    CLEAR_ALL_SESSIONS = FrontendCommand(
        FrontendCommandGroup.SESSION, "clear_all_sessions"
    )
    CLEAR_ALL_CONTENT = FrontendCommand(
        FrontendCommandGroup.SESSION, "clear_all_content"
    )
    ADD_OVERLAY = FrontendCommand(FrontendCommandGroup.OVERLAY, "add")
    REMOVE_OVERLAY = FrontendCommand(FrontendCommandGroup.OVERLAY, "remove")
    UPDATE_OVERLAY = FrontendCommand(FrontendCommandGroup.OVERLAY, "update")
    CLEAR_OVERLAYS = FrontendCommand(FrontendCommandGroup.OVERLAY, "clear")
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
    PIPELINE_SET_ENABLED = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "set_enabled"
    )
    PIPELINE_SET_SELECTION_SCOPE = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "set_selection_scope"
    )
    PIPELINE_SET_SOURCE_OWNER = FrontendCommand(
        FrontendCommandGroup.PIPELINE, "set_source_owner"
    )
    PIPELINE_CLEAR = FrontendCommand(FrontendCommandGroup.PIPELINE, "clear")
