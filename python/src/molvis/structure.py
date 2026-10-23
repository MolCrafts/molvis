"""Structure coercion for the frame / molgraph API surface.

Convention
----------
Commands that take molecular data put the structure as the **first** argument
after ``self``::

    stage.draw_frame(frame)        # Frame | Atomistic | molgraph
    stage.commit()                 # edit pool → pipeline HEAD
    stage.set_trajectory(frames, …)

:func:`frame_arg` and :func:`frames_arg` coerce that argument to a real
:class:`molpy.Frame`. Serialization is molrs's own: the command writes the Frame
with ``molrs.io.write_msgpack_frame_bytes`` and the browser reads it back with
molrs-wasm ``readFrameBytes`` — there is no molvis-side encoding.
"""

from __future__ import annotations

import functools
import inspect
import logging
from collections.abc import Callable
from typing import Any, TypeVar

import molpy as mp

logger = logging.getLogger("molvis")

__all__ = [
    "coerce_to_frame",
    "frame_arg",
    "frames_arg",
]

R = TypeVar("R")


def coerce_to_frame(obj: Any) -> mp.Frame:
    """Normalize Frame | Atomistic | molgraph → a valid :class:`molpy.Frame`.

    A Frame passes through unchanged. A graph (anything with ``to_frame``) is
    exported with ``to_frame()``; an ``Atomistic`` first gets localized
    ``bond_number`` on aromatic bonds from ``Perceive.find_kekule_orders`` —
    the same chemistry the page runs through molrs-wasm — so multi-stick bonds
    render. A perception failure is logged as a warning and the graph is
    exported as it is, so unusual chemistry cannot break a draw.

    Either way the Frame is judged by molrs's ``Frame.validate`` before it is
    handed on, so a broken frame (a bond endpoint past the last atom) fails
    here, at the caller, instead of in the browser.

    Raises:
        TypeError: *obj* is neither a Frame nor a graph, or ``to_frame`` did
            not return a Frame.
        ValueError: molrs's validator rejects the Frame, or ``to_frame``
            refuses the export (a property that contradicts the Frame schema).
    """
    if obj is None:
        raise TypeError("structure argument is required (got None)")
    if isinstance(obj, mp.Frame):
        obj.validate()
        return obj
    if not callable(getattr(obj, "to_frame", None)):
        raise TypeError(
            "expected a molpy Frame or a graph with to_frame() "
            f"(Atomistic / molgraph); got {type(obj)!r}"
        )

    if isinstance(obj, mp.Atomistic):
        try:
            obj = mp.Perceive().find_kekule_orders(obj)
        except ValueError as exc:
            logger.warning("Kekulé perception failed; drawing without it: %s", exc)

    frame = obj.to_frame()
    if not isinstance(frame, mp.Frame):
        raise TypeError(
            f"{type(obj).__name__}.to_frame() returned {type(frame)!r}, not a Frame"
        )
    frame.validate()
    return frame


def _first_data_param(sig: inspect.Signature) -> str:
    params = [
        p
        for p in sig.parameters.values()
        if p.name != "self"
        and p.kind
        in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    ]
    if not params:
        raise TypeError("method must have a first data parameter after self")
    return params[0].name


def frame_arg(fn: Callable[..., R]) -> Callable[..., R]:
    """Decorator: first data arg is Frame | molgraph | Atomistic.

    Supports positional and keyword calls (``draw_frame(f)`` /
    ``draw_frame(frame=f)``).
    """

    sig = inspect.signature(fn)
    data_name = _first_data_param(sig)

    @functools.wraps(fn)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> R:
        bound = sig.bind(self, *args, **kwargs)
        bound.apply_defaults()
        bound.arguments[data_name] = coerce_to_frame(bound.arguments[data_name])
        return fn(*bound.args, **bound.kwargs)

    wrapper.__signature__ = sig  # type: ignore[attr-defined]
    return wrapper  # type: ignore[return-value]


def frames_arg(fn: Callable[..., R]) -> Callable[..., R]:
    """Decorator: first data arg is an iterable of structures → list[Frame]."""

    sig = inspect.signature(fn)
    data_name = _first_data_param(sig)

    @functools.wraps(fn)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> R:
        bound = sig.bind(self, *args, **kwargs)
        bound.apply_defaults()
        frames = bound.arguments[data_name]
        if frames is None:
            raise TypeError("frames argument is required (got None)")
        seq = list(frames)
        if not seq:
            raise ValueError("expected a non-empty sequence of frames/structures")
        bound.arguments[data_name] = [coerce_to_frame(item) for item in seq]
        return fn(*bound.args, **bound.kwargs)

    wrapper.__signature__ = sig  # type: ignore[attr-defined]
    return wrapper  # type: ignore[return-value]
