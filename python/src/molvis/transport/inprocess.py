"""In-process JSON-RPC transport (same catalog as WebSocket).

Used when the controller runs *inside* the page (Pyodide plugin) and can
invoke the frontend :class:`~RPCRouter` directly — no ``ws://`` hop.

The *protocol* is identical to :class:`WebSocketTransport`: method names
from the RPC catalog (``camera.set_pose``, ``scene.draw_frame``, …) and
JSON-RPC 2.0 response envelopes ``{result}`` / ``{error}``.

Typical wiring from a page plugin::

    from molvis import Molvis
    from molvis.transport import InProcessTransport

    # ``call`` is a JS function (Promise-returning) registered by the host:
    #   (method: str, params: dict) -> Promise<result>
    transport = InProcessTransport(js_rpc_call)
    viewer = Molvis(
        name="pyodide",
        transport=transport,
        serve_page=False,
        display_surface=DisplaySurface.HEADLESS,
    )
    viewer.draw_frame(frame)   # → scene.draw_frame via RPCRouter
    viewer.camera.set_pose(alpha=1.0)
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Callable, Mapping
from typing import Any


from ..wire import resolve_buffers

logger = logging.getLogger("molvis")

__all__ = ["InProcessTransport"]

# (method, params) → result | awaitable | JS thenable
RpcInvoker = Callable[[str, dict[str, Any]], Any]


def _is_thenable(value: Any) -> bool:
    return callable(getattr(value, "then", None))


def _pyodide_js_params(params: dict[str, Any]) -> Any:
    """Convert *params* to a real JS object graph under Pyodide.

    This is the **only** marshaller on the in-process path. The browser side
    knows nothing about Pyodide, PyProxies or ``to_js`` — it receives ordinary
    JS values, exactly as it does over the WebSocket.

    Two constraints, both from the JS side of the seam:

    1. Numeric block columns must arrive as **TypedArrays**. A whole-tree
       ``to_js`` is unreliable for deep ``ndarray`` leaves, so each array is
       converted on its own.
    2. The top level must stay a JS **Object**. Building it from a list of
       pre-converted pairs yields a JS Array instead, and the handler then sees
       no ``params.frame``.

    There is deliberately no fallback path. A conversion that half-works
    produces a payload that fails much later, at render time, as "the atoms
    disappeared"; failing here names the value that could not be converted.

    Outside Pyodide this is a no-op (CPython tests never call into JS).
    """
    try:
        from pyodide.ffi import to_js  # type: ignore[import-not-found]
    except ImportError:
        return params

    from js import Array as JsArray  # type: ignore[import-not-found]
    from js import Object as JsObject  # type: ignore[import-not-found]

    import numpy as np

    def _js_array(items: list[Any]) -> Any:
        array = JsArray.new()
        for item in items:
            array.push(item)
        return array

    def _to_js(value: Any) -> Any:
        if isinstance(value, np.ndarray):
            if value.dtype.kind in {"U", "S", "O"}:
                return _js_array([str(item) for item in value.tolist()])
            return to_js(np.ascontiguousarray(value), create_pyproxies=False)
        if isinstance(value, Mapping):
            # Assign properties one by one; rebuilding via fromEntries over
            # already-converted pairs is what turns the object into an Array.
            obj = JsObject.new()
            for key, item in value.items():
                setattr(obj, str(key), _to_js(item))
            return obj
        if isinstance(value, (list, tuple)):
            return _js_array([_to_js(item) for item in value])
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        raise TypeError(
            f"cannot marshal {type(value)!r} across the Pyodide boundary; "
            "convert it to an ndarray, mapping, sequence, or scalar first"
        )

    return _to_js(params)


def _pyodide_to_py(value: Any) -> Any:
    """Convert a JS return value (JsProxy) to plain Python dicts/lists.

    Without this, ``result["pose"]`` raises
    ``TypeError: 'pyodide.ffi.JsProxy' object is not subscriptable`` —
    camera.fit / set_pose all index the RPC result as a mapping.
    """
    if value is None or isinstance(value, (bool, int, float, str, bytes)):
        return value
    # Explicit JsProxy → Python (deep).
    to_py = getattr(value, "to_py", None)
    if callable(to_py):
        try:
            return to_py()
        except Exception:  # noqa: BLE001
            pass
    try:
        from pyodide.ffi import JsProxy  # type: ignore[import-not-found]
    except ImportError:
        return value
    if isinstance(value, JsProxy):
        try:
            return value.to_py()
        except Exception:  # noqa: BLE001
            return value
    return value


async def _await_value(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    if _is_thenable(value):
        # Pyodide JsProxy promises are awaitable; plain thenables need a bridge.
        return await value
    return value


def _resolve_sync(value: Any, *, timeout: float) -> Any:
    """Block until *value* (coro / JS Promise / thenable) resolves.

    Critical for Pyodide: the page has a **single** JS thread. Scheduling a
    task with ``ensure_future`` and then ``fut.result()`` on that same thread
    **deadlocks** — the Promise never settles because the loop cannot run
    while we block. Use ``pyodide.ffi.run_sync`` which pumps the browser
    event loop instead.

    Under Pyodide we **poll** with short sleeps and cooperative
    :func:`molvis.interrupt.check` so the host Interrupt button can abort
    a long ``set_style`` / ``set_theme`` wait mid-flight, instead of
    blocking on one uninterruptible ``run_sync(promise)``.
    """
    if not inspect.isawaitable(value) and not _is_thenable(value):
        return value

    # ── Pyodide (in-page plugin): interruptible pump ───────────────────
    try:
        from pyodide.ffi import run_sync  # type: ignore[import-not-found]
    except ImportError:
        run_sync = None  # type: ignore[assignment]

    if run_sync is not None:
        try:
            from ..interrupt import check as check_interrupt
            from ..interrupt import InterruptRequested
        except Exception:  # pragma: no cover

            def check_interrupt() -> None:
                return None

            class InterruptRequested(Exception):  # type: ignore[no-redef]
                pass

        async def _wait_interruptible() -> Any:
            # Drive the RPC promise as a task so we can poll the interrupt
            # flag between short yields (browser keeps rendering / clicks).
            # Polls molvis.interrupt (Python + host JS latch) — do not rely
            # on Task.cancel re-entering this stack from the Interrupt button.
            task = asyncio.ensure_future(_await_value(value))
            steps = max(1, int(float(timeout) / 0.05) + 1)
            try:
                for _ in range(steps):
                    if task.done():
                        return await task
                    check_interrupt()  # raises InterruptRequested
                    try:
                        return await asyncio.wait_for(
                            asyncio.shield(task), timeout=0.05
                        )
                    except asyncio.TimeoutError:
                        continue
                check_interrupt()
                return await asyncio.wait_for(asyncio.shield(task), timeout=0.05)
            except InterruptRequested:
                task.cancel()
                raise
            except BaseException:
                if not task.done():
                    task.cancel()
                raise

        try:
            return run_sync(_wait_interruptible())
        except TypeError:
            # Not directly usable; fall back to a single await.
            check_interrupt()
            return run_sync(_await_value(value))

    # ── CPython, no running loop ───────────────────────────────────────
    try:
        asyncio.get_running_loop()
        in_loop = True
    except RuntimeError:
        in_loop = False

    if not in_loop:
        return asyncio.run(asyncio.wait_for(_await_value(value), timeout=timeout))

    # ── CPython + running loop: await on a side thread ─────────────────
    # Only safe for pure-Python awaitables (not browser JS Promises).
    import concurrent.futures

    def _thread_run() -> Any:
        return asyncio.run(asyncio.wait_for(_await_value(value), timeout=timeout))

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(_thread_run).result(timeout=timeout + 1.0)


class InProcessTransport:
    """:class:`~molvis.transport.Transport` over an in-process RPC invoker.

    Parameters
    ----------
    invoke
        ``invoke(method, params) -> result | awaitable``. Typically a
        JS function exposed via ``pyodide.registerJsModule`` that calls
        ``RPCRouter.execute({jsonrpc, id, method, params})`` and returns
        the JSON-RPC **result** (not the full envelope). If the invoker
        returns a full envelope ``{result}`` / ``{error}``, that is also
        accepted.
    """

    def __init__(self, invoke: RpcInvoker) -> None:
        if not callable(invoke):
            raise TypeError("invoke must be callable")
        self._invoke = invoke
        self._request_counter = 0
        self.connected = True  # always "connected" — no handshake

    # ------------------------------------------------------------------
    # Optional transport lifecycle (no-ops for in-process)
    # ------------------------------------------------------------------

    def start(self) -> int:
        return 0

    def stop(self) -> None:
        self.connected = False

    def attach_event_bus(self, bus: Any) -> None:
        """In-process does not forward page events yet (no-op)."""
        self._event_bus = bus

    # ------------------------------------------------------------------
    # Transport protocol
    # ------------------------------------------------------------------

    def send_request(
        self,
        method: str,
        params: dict[str, Any],
        *,
        buffers: list[Any] | None = None,
        wait_for_response: bool = False,
        timeout: float = 10.0,
    ) -> dict[str, Any] | None:
        # No socket to carry a side-channel, so fold the binary buffers back
        # into the params. `resolve_buffers` keys off each column's declared
        # dtype, so this is the same data the WebSocket path ships, just inline.
        params = resolve_buffers(dict(params), buffers or [])

        self._request_counter += 1
        request_id = self._request_counter

        # Params are already wire-encoded (molvis.wire, inline mode): every
        # column states its dtype and carries a real ndarray. All that is left
        # is handing those arrays to JS as TypedArrays.
        invoke_params = _pyodide_js_params(dict(params))

        raw = self._invoke(method, invoke_params)
        if not wait_for_response:
            # Fire-and-forget: still schedule async work so side effects run.
            if inspect.isawaitable(raw) or _is_thenable(raw):
                try:
                    loop = asyncio.get_running_loop()
                    asyncio.ensure_future(_await_value(raw), loop=loop)
                except RuntimeError:
                    # No loop: resolve via run_sync / asyncio.run.
                    _resolve_sync(raw, timeout=timeout)
            return None

        resolved = _resolve_sync(raw, timeout=timeout)
        # JS → Python: bare result objects from RPCRouter are JsProxies.
        resolved = _pyodide_to_py(resolved)
        return self._as_response_envelope(resolved, request_id=request_id)

    @staticmethod
    def _as_response_envelope(resolved: Any, *, request_id: int) -> dict[str, Any]:
        """Normalise invoker output to a JSON-RPC response dict.

        Accepts:
        - bare result values
        - full envelopes ``{jsonrpc, id, result|error}``
        - mapping with only ``result`` / ``error``
        """
        # Defensive: convert nested JsProxy if top-level was already a mapping.
        if not isinstance(resolved, Mapping) and callable(
            getattr(resolved, "to_py", None)
        ):
            try:
                resolved = resolved.to_py()
            except Exception:  # noqa: BLE001
                pass

        if isinstance(resolved, Mapping):
            # Ensure nested result/error are plain Python too.
            if "error" in resolved and "result" not in resolved:
                err = resolved["error"]
                if callable(getattr(err, "to_py", None)):
                    try:
                        err = err.to_py()
                    except Exception:  # noqa: BLE001
                        pass
                return {
                    "jsonrpc": "2.0",
                    "id": resolved.get("id", request_id)
                    if hasattr(resolved, "get")
                    else request_id,
                    "error": err,
                }
            if "result" in resolved and "jsonrpc" in resolved:
                out = dict(resolved)
                if callable(getattr(out.get("result"), "to_py", None)):
                    try:
                        out["result"] = out["result"].to_py()
                    except Exception:  # noqa: BLE001
                        pass
                return out
            if "result" in resolved and "error" not in resolved:
                result = resolved["result"]
                if callable(getattr(result, "to_py", None)):
                    try:
                        result = result.to_py()
                    except Exception:  # noqa: BLE001
                        pass
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": result,
                }
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": resolved,
        }
