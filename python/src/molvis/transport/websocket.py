"""
The single transport for every MolVis host.

:class:`WebSocketTransport` runs a local HTTP + WebSocket server inside a
background asyncio loop. The bundled `dist/` is served on ``/`` and a
WebSocket endpoint lives at ``/ws``. A host (page tab, notebook cell host
script, VSCode webview …) loads the page bundle and dials back via
``?ws_url=ws://…/ws&token=…&session=…`` (standalone) or the inline
embed flow (notebook).

Handshake
---------

    client → server  {"type":"hello", "token":"…", "session":"…"}
    server → client  {"type":"ready"}              ✓
                     ws.close(1008, "auth")         ✗ token mismatch

After ``ready``, both ends speak JSON-RPC 2.0 with the binary-frame codec
from :mod:`._codec`. Requests carry ``id``; notifications (frontend events)
omit ``id`` and are routed to the attached :class:`~molvis.events.EventBus`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import pathlib
import re
import secrets
import threading
import urllib.parse
import webbrowser
from dataclasses import asdict, dataclass
from importlib.resources import files
from queue import Empty, Queue
from typing import TYPE_CHECKING, Any

from ..types import JsonRPCRequest
from ..wire import resolve_buffers
from ._codec import decode_binary_frame, encode_binary_frame
from ._jupyter_env import resolve_endpoints

if TYPE_CHECKING:
    from ..events import EventBus

logger = logging.getLogger("molvis")

#: Default seconds to wait **per attempt** for a browser to attach (or for
#: the hello frame after TCP accept). Closing a tab is normal; RPC must not
#: hang forever — agents and scripts need a finite failure.
DEFAULT_HANDSHAKE_TIMEOUT_S = 2.0

#: How many times :meth:`WebSocketTransport.send_request` re-waits for a
#: browser when the tab is closed / not yet open. Total wait ≈
#: ``handshake_retries * handshake_timeout``.
DEFAULT_HANDSHAKE_RETRIES = 5

__all__ = ["PageEndpoints", "WebSocketTransport", "resolve_dist"]


mimetypes.add_type("application/wasm", ".wasm")

_SCRIPT_SRC_RE = re.compile(
    r"<script\b[^>]*\bsrc=[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
_LINK_TAG_RE = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
_LINK_HREF_RE = re.compile(r"\bhref=[\"']([^\"']+)[\"']", re.IGNORECASE)
_LINK_REL_RE = re.compile(r"\brel=[\"']([^\"']+)[\"']", re.IGNORECASE)


def _cors_headers(extra: dict[str, str] | None = None) -> Any:
    """Headers that let a notebook webview (different origin) fetch us.

    VSCode notebook webviews run on `vscode-webview://…`; their service
    worker enforces CORS on `fetch(...)` (incl. WebAssembly streaming
    instantiation). Without these headers, the WASM chunk load fails
    even though the kernel is serving the bytes correctly.
    """
    from websockets.datastructures import Headers

    base = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
    }
    if extra:
        base.update(extra)
    return Headers(base)


def _extract_stylesheet_links(html_text: str) -> tuple[str, ...]:
    """Find all `<link rel="stylesheet" href="...">` regardless of attribute order."""
    out: list[str] = []
    for tag in _LINK_TAG_RE.findall(html_text):
        rel = _LINK_REL_RE.search(tag)
        if rel is None or rel.group(1).lower() != "stylesheet":
            continue
        href = _LINK_HREF_RE.search(tag)
        if href is not None:
            out.append(href.group(1))
    return tuple(out)


def resolve_dist() -> pathlib.Path:
    """Resolve the directory containing the pre-built page app.

    Default is the package resource ``molvis/dist/`` 

    ``MOLVIS_DIST`` overrides the default, useful when pointing at a
    freshly-built local ``page/dist/`` or a ``npm run dev:python`` watch
    tree during development.
    """
    override = os.environ.get("MOLVIS_DIST")
    if override:
        return pathlib.Path(override).expanduser().resolve()
    resource = files("molvis").joinpath("dist")
    return pathlib.Path(str(resource))


@dataclass(frozen=True)
class PageEndpoints:
    """Resolved viewer endpoints for one session.

    Attributes
    ----------
    base_url
        Where page assets are served from. Trailing slash. Used to
        build absolute ``<script src>`` and ``<link href>`` URLs.
    ws_url
        WebSocket URL the page dials for JSON-RPC traffic.
    session
        Session label echoed in the hello frame.
    token
        Pre-shared token validated during handshake.
    scripts
        Absolute URLs of ``<script>`` files in load order.
    css
        Absolute URLs of CSS files (typically loaded into a Shadow DOM
        root by the embedding host).
    standalone_url
        Convenience URL for opening the standalone page directly in a
        browser tab — equivalent to ``base_url`` plus the
        ``ws_url``/``token``/``session`` query params consumed by
        :func:`page/src/lib/mount-opts.readMountOptsFromUrl`.
    """

    base_url: str
    ws_url: str
    session: str
    token: str
    scripts: tuple[str, ...]
    css: tuple[str, ...]
    standalone_url: str


class WebSocketTransport:
    """Transport that hosts the page bundle and drives it over a WebSocket.

    Parameters
    ----------
    page_base_url
        External base URL the page is served from (e.g. a CDN). When
        ``None`` (default), the transport also serves the bundled
        ``dist/`` on its own HTTP port. Trailing slash optional.
    host, port
        Host/port the WS server binds to. ``port=0`` (default) asks the
        OS to pick a free port.
    token
        Shared secret embedded in the standalone URL and checked during
        the hello handshake. Auto-generated if ``None``.
    open_browser
        If ``True`` (default), call :func:`webbrowser.open` on the
        standalone URL when ``start()`` is called. Notebook hosts pass
        ``False``.
    dist
        Override the local static asset directory. Ignored when
        ``page_base_url`` is given.
    event_bus
        :class:`~molvis.events.EventBus` to dispatch frontend-pushed
        JSON-RPC notifications into. Usually set by :class:`Molvis`.
    surface
        Page chrome preset: ``"full"`` (default) or ``"canvas"`` (no
        chrome — TopBar, sidebars, timeline hidden). Standalone URL gets
        ``&surface=canvas`` when set to ``"canvas"``.
    handshake_timeout
        Seconds to wait **per attempt** for the browser hello handshake —
        both on the server side (after a TCP accept, before a hello
        frame arrives) and on the client side (``send_request`` blocking
        until a browser is attached). Defaults to
        :data:`DEFAULT_HANDSHAKE_TIMEOUT_S` (2s). Pass ``None`` only when
        you deliberately want an infinite wait (interactive notebooks that
        open a tab later). Closing a tab clears the connection; the next
        RPC re-waits with retries, then raises — it never hangs forever.
    handshake_retries
        How many times ``send_request`` re-waits for a browser when none
        is attached (default :data:`DEFAULT_HANDSHAKE_RETRIES` = 5). Total
        client-side wait ≈ ``retries * handshake_timeout``. Ignored when
        ``handshake_timeout`` is ``None``.
    serve_page
        When ``True`` (default), HTTP requests to paths other than
        ``/ws`` serve the bundled ``dist/`` — useful for notebook
        hosts and the VSCode webview. Pass ``False`` for WS-only mode
        where the frontend is hosted elsewhere (e.g. an
        already-open ``npm run dev:page`` tab) and only the
        ``ws://…?token=…&session=…`` URL is shared.
    plugins
        Optional list of page plugin sources (``owner/repo[@tag]`` or
        HTTPS URL). Injected into the standalone URL and notebook
        ``MolvisApp.mount`` opts so the page loads them on start.
    """

    def __init__(
        self,
        *,
        page_base_url: str | None = None,
        host: str = "localhost",
        port: int = 0,
        token: str | None = None,
        open_browser: bool = True,
        dist: pathlib.Path | None = None,
        event_bus: EventBus | None = None,
        surface: str = "full",
        appearance: str | None = None,
        background: str | None = None,
        handshake_timeout: float | None = DEFAULT_HANDSHAKE_TIMEOUT_S,
        handshake_retries: int = DEFAULT_HANDSHAKE_RETRIES,
        serve_page: bool = True,
        plugins: list[str] | None = None,
        session: str = "default",
    ) -> None:
        self._page_base_url = page_base_url.rstrip("/") + "/" if page_base_url else None
        self._host = host
        self._port = port
        self._token = token or secrets.token_urlsafe(24)
        self._open_browser = open_browser
        self._dist = dist or resolve_dist()
        self._event_bus = event_bus
        if surface not in ("full", "canvas"):
            raise ValueError(f"surface must be 'full' or 'canvas', got {surface!r}")
        self._surface = surface
        self._appearance = appearance
        self._background = background
        if handshake_timeout is not None and handshake_timeout <= 0:
            raise ValueError(
                f"handshake_timeout must be positive or None, got {handshake_timeout!r}"
            )
        if handshake_retries < 1:
            raise ValueError(
                f"handshake_retries must be >= 1, got {handshake_retries!r}"
            )
        self._handshake_timeout = handshake_timeout
        self._handshake_retries = handshake_retries
        self._serve_page = serve_page
        # Plugin sources (owner/repo[@tag] or HTTPS URL) injected into the
        # page mount opts / standalone URL. Empty list means none.
        self._plugins: list[str] = list(plugins or [])
        # Session label for open_browser + connection_url defaults (Stage name).
        self._session_label = session or "default"

        self._response_lock = threading.Lock()
        self._request_counter = 0
        self._responses: dict[int, Queue[dict[str, Any]]] = {}

        self._ready_event = threading.Event()
        self._connected_event = threading.Event()
        self._disconnected_event = threading.Event()
        self._started = False

        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ws: Any | None = None
        self._ws_server: Any | None = None
        self._bound_port: int = 0
        self._bound_session: str = ""

        self._asset_scripts: tuple[str, ...] = ()
        self._asset_css: tuple[str, ...] = ()

    # ------------------------------------------------------------------
    # Read-only properties
    # ------------------------------------------------------------------

    @property
    def port(self) -> int:
        return self._bound_port

    @property
    def token(self) -> str:
        return self._token

    @property
    def connected(self) -> bool:
        return self._connected_event.is_set()

    def set_session_name(self, session: str) -> None:
        """Align open/page URLs with the Stage name (e.g. molmcp session id)."""
        self._session_label = session or "default"

    def attach_event_bus(self, event_bus: EventBus) -> None:
        """Wire a late-constructed event bus. No-op if already set."""
        if self._event_bus is None:
            self._event_bus = event_bus

    # ------------------------------------------------------------------
    # URL helpers
    # ------------------------------------------------------------------

    def page_endpoints(self, *, session: str) -> PageEndpoints:
        """Compose viewer endpoints for ``session``.

        Pulls the env-aware base + WS URLs from
        :func:`~molvis.transport._jupyter_env.resolve_endpoints` (when
        no external ``page_base_url`` was set), reads the asset list
        from ``index.html``, and returns a :class:`PageEndpoints`.

        Raises
        ------
        RuntimeError
            ``start()`` has not been called yet.
        """
        if self._bound_port == 0:
            raise RuntimeError("Call start() before requesting page endpoints")
        if self._page_base_url is not None:
            base = self._page_base_url
            ws = f"ws://{self._host}:{self._bound_port}/ws"
        else:
            base, ws = resolve_endpoints(self._host, self._bound_port)

        scripts = tuple(self._absolute(base, s) for s in self._asset_scripts)
        css = tuple(self._absolute(base, c) for c in self._asset_css)

        sep = "&" if "?" in base else "?"
        params: dict[str, str] = {
            "ws_url": ws,
            "token": self._token,
            "session": session,
        }
        if self._surface != "full":
            params["surface"] = self._surface
        if self._appearance:
            params["theme"] = self._appearance
        if self._background:
            params["background"] = self._background
        if self._plugins:
            # Comma-separated list; page `readMountOptsFromUrl` splits it.
            params["plugins"] = ",".join(self._plugins)
        query = urllib.parse.urlencode(params)
        standalone_url = f"{base}{sep}{query}"

        return PageEndpoints(
            base_url=base,
            ws_url=ws,
            session=session,
            token=self._token,
            scripts=scripts,
            css=css,
            standalone_url=standalone_url,
        )

    @property
    def plugins(self) -> list[str]:
        """Plugin sources forwarded to the page on mount / standalone URL."""
        return list(self._plugins)

    def connection_url(self, *, session: str | None = None) -> str:
        """Return a single pasteable ``ws://…`` URL with token + session.

        The user pastes this one string into the page's Settings → Backend
        dialog; the frontend extracts ``token`` and ``session`` from the
        query component before opening the socket. Prefer this over
        :meth:`page_endpoints` when the frontend is already open in a
        browser (e.g. a long-running ``npm run dev:page``).

        *session* defaults to the label set at construction /
        :meth:`set_session_name` (Stage name), not a hardcoded ``default``.

        Raises
        ------
        RuntimeError
            ``start()`` has not been called yet.
        """
        if self._bound_port == 0:
            raise RuntimeError("Call start() before requesting a connection URL")
        label = session if session is not None else self._session_label
        query = urllib.parse.urlencode({"token": self._token, "session": label})
        return f"ws://{self._host}:{self._bound_port}/ws?{query}"

    @staticmethod
    def _absolute(base: str, asset_path: str) -> str:
        """Join an asset path from ``index.html`` with the resolved base."""
        if asset_path.startswith(("http://", "https://", "//")):
            return asset_path
        return base + asset_path.lstrip("/")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> int:
        if self._started:
            return self._bound_port
        self._started = True

        self._load_asset_manifest()

        self._thread = threading.Thread(
            target=self._run_loop,
            name="molvis-transport",
            daemon=True,
        )
        self._thread.start()
        if not self._ready_event.wait(timeout=10):
            raise RuntimeError("WebSocketTransport failed to start within 10 seconds")
        logger.info(
            "MolVis transport listening on ws://%s:%d/ws",
            self._host,
            self._bound_port,
        )
        if self._open_browser:
            try:
                webbrowser.open(
                    self.page_endpoints(session=self._session_label).standalone_url
                )
            except Exception:  # pragma: no cover — best-effort UX
                logger.exception("webbrowser.open failed")
        return self._bound_port

    def stop(self) -> None:
        loop = self._loop
        if loop is None:
            self._started = False
            return

        async def _shutdown() -> None:
            if self._ws_server is not None:
                self._ws_server.close()
                await self._ws_server.wait_closed()
            loop.stop()

        asyncio.run_coroutine_threadsafe(_shutdown(), loop)

        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
        self._loop = None
        self._ws = None
        self._started = False

    def wait_for_connection(self, timeout: float | None = None) -> None:
        """Block until a browser finishes the hello handshake.

        Parameters
        ----------
        timeout
            Maximum seconds to wait. ``None`` (default) waits
            indefinitely — appropriate when the user may open the
            browser tab at any time. Pass a concrete number to fail
            fast when the browser is expected to be ready already.
        """
        if timeout is None:
            self._connected_event.wait()
            return
        if not self._connected_event.wait(timeout=timeout):
            raise TimeoutError(
                f"No browser session within {timeout}s. "
                "The page may not have loaded or the token may be wrong."
            )

    def wait_for_disconnection(self, timeout: float | None = None) -> bool:
        return self._disconnected_event.wait(timeout=timeout)

    # ------------------------------------------------------------------
    # Asset manifest
    # ------------------------------------------------------------------

    def _load_asset_manifest(self) -> None:
        """Parse ``index.html`` once to discover the hashed asset URLs.

        Falls back to empty lists if the file is missing or malformed —
        the standalone URL still works (it loads index.html directly).
        """
        index_path = self._dist / "index.html"
        if not index_path.is_file():
            logger.debug("index.html not found at %s", index_path)
            return
        try:
            text = index_path.read_text(encoding="utf-8")
        except OSError:
            logger.debug("Failed reading %s", index_path)
            return
        self._asset_scripts = tuple(_SCRIPT_SRC_RE.findall(text))
        self._asset_css = _extract_stylesheet_links(text)
        logger.debug(
            "Asset manifest: %d scripts, %d stylesheets",
            len(self._asset_scripts),
            len(self._asset_css),
        )

    # ------------------------------------------------------------------
    # Outbound — main thread → browser
    # ------------------------------------------------------------------

    def _browser_wait_hint(self) -> str:
        """Human hint for TimeoutError when no tab is attached."""
        session = self._bound_session or self._session_label or "default"
        try:
            url = self.page_endpoints(session=session).standalone_url
        except Exception:  # pragma: no cover — endpoints need a bound port
            url = self.connection_url(session=session)
        return (
            f"Viewer tab is not connected (closed or never opened). "
            f"Re-open: {url}"
        )

    def _wait_until_browser_connected(self) -> None:
        """Block until a browser is attached, with finite retries by default.

        Closing the tab clears the connection flag — that is normal. The next
        RPC call waits ``handshake_retries`` × ``handshake_timeout`` then
        raises :class:`TimeoutError`. Pass ``handshake_timeout=None`` for the
        old infinite wait (interactive notebooks only).
        """
        if self._connected_event.is_set():
            return

        timeout = self._handshake_timeout
        if timeout is None:
            # Explicit infinite wait — documented opt-in only.
            self._connected_event.wait()
            return

        retries = self._handshake_retries
        for attempt in range(1, retries + 1):
            if self._connected_event.wait(timeout=timeout):
                return
            logger.info(
                "No browser after attempt %d/%d (%.3gs each)",
                attempt,
                retries,
                timeout,
            )

        total = timeout * retries
        raise TimeoutError(
            f"No browser connected after {retries} attempt(s) "
            f"({timeout:g}s each, {total:g}s total). "
            f"{self._browser_wait_hint()}"
        )

    def send_request(
        self,
        method: str,
        params: dict[str, Any],
        *,
        buffers: list[Any] | None = None,
        wait_for_response: bool = False,
        timeout: float = 10.0,
    ) -> dict[str, Any] | None:
        self._wait_until_browser_connected()

        if self._ws is None or self._loop is None:
            raise RuntimeError(
                "WebSocket transport is not connected. "
                f"{self._browser_wait_hint()}"
            )

        # Params arrive already wire-encoded: dense columns are buffer
        # references into `buffers`. Re-encoding here is what used to give the
        # same Frame two different dtypes depending on which path built it.
        encoded_params = params

        with self._response_lock:
            self._request_counter += 1
            request_id = self._request_counter
            response_queue: Queue[dict[str, Any]] | None = None
            if wait_for_response:
                response_queue = Queue(maxsize=1)
                self._responses[request_id] = response_queue

        request = JsonRPCRequest(
            jsonrpc="2.0",
            method=method,
            params=encoded_params,
            id=request_id,
        )

        payload_buffers: list[Any] = list(buffers or [])
        if payload_buffers:
            frame = encode_binary_frame(asdict(request), payload_buffers)
            future = asyncio.run_coroutine_threadsafe(self._ws.send(frame), self._loop)
        else:
            text = json.dumps(asdict(request))
            future = asyncio.run_coroutine_threadsafe(self._ws.send(text), self._loop)

        try:
            future.result(timeout=timeout)
        except Exception:
            with self._response_lock:
                self._responses.pop(request_id, None)
            raise

        if not wait_for_response or response_queue is None:
            return None

        try:
            return response_queue.get(timeout=timeout)
        except Empty:
            raise TimeoutError(
                f"No response from frontend for '{method}' after {timeout}s"
            ) from None
        finally:
            with self._response_lock:
                self._responses.pop(request_id, None)

    # ------------------------------------------------------------------
    # Inbound — browser → main thread
    # ------------------------------------------------------------------

    def _dispatch_inbound(self, message: Any) -> None:
        if isinstance(message, bytes):
            try:
                json_payload, buffers = decode_binary_frame(message)
            except Exception as exc:  # pragma: no cover
                logger.warning("Failed to decode binary frame: %s", exc)
                return
        elif isinstance(message, str):
            try:
                json_payload = json.loads(message)
            except json.JSONDecodeError as exc:
                logger.debug("Ignoring non-JSON text message: %s", exc)
                return
            buffers = []
        else:
            logger.debug("Ignoring unexpected WS message type: %s", type(message))
            return

        if not isinstance(json_payload, dict):
            logger.debug("Ignoring non-object JSON payload")
            return

        # JSON-RPC notification: has method, no id.
        if "method" in json_payload and "id" not in json_payload:
            self._dispatch_notification(json_payload, buffers)
            return

        # Otherwise treat as response.
        self._dispatch_response(json_payload, buffers)

    def _dispatch_notification(
        self, payload: dict[str, Any], buffers: list[Any]
    ) -> None:
        bus = self._event_bus
        if bus is None:
            return
        method = payload.get("method")
        if not isinstance(method, str):
            return
        raw_params = payload.get("params") or {}
        try:
            params = resolve_buffers(raw_params, buffers)
        except Exception as exc:
            logger.warning("Failed to decode notification '%s': %s", method, exc)
            return
        try:
            bus.dispatch(method, params if isinstance(params, dict) else {})
        except Exception:
            logger.exception("Event bus raised while dispatching '%s'", method)

    def _dispatch_response(self, payload: dict[str, Any], buffers: list[Any]) -> None:
        try:
            # Resolve buffer references using each column's declared dtype, so
            # callers see plain arrays and never have to carry the buffer list.
            decoded = resolve_buffers(payload, buffers)
        except Exception as exc:
            logger.warning("Failed to decode response: %s", exc)
            return
        if not isinstance(decoded, dict):
            return
        request_id = decoded.get("id")
        if request_id is None:
            logger.debug("Dropping response without request id")
            return
        with self._response_lock:
            queue = self._responses.get(int(request_id))
        if queue is None:
            logger.debug("No waiter for request id %s", request_id)
            return
        queue.put_nowait(decoded)

    # ------------------------------------------------------------------
    # asyncio event loop in background thread
    # ------------------------------------------------------------------

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        try:
            loop.run_until_complete(self._start_server())
            loop.run_forever()
        except Exception:  # pragma: no cover — defensive
            logger.exception("MolVis transport event loop crashed")
        finally:
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

    async def _start_server(self) -> None:
        try:
            import websockets
            from websockets.asyncio.server import serve
        except ImportError as exc:  # pragma: no cover — install-time guard
            raise ImportError(
                "The 'websockets' package is required. "
                "Install with: pip install 'websockets>=13.0'"
            ) from exc

        async def handler(ws: Any) -> None:
            if self._connected_event.is_set():
                await ws.close(1013, "session already bound")
                return

            # Reset the disconnect event so a re-connect (e.g. React
            # StrictMode's dev double-mount) does not leave stale state
            # that would trip the next wait_for_disconnection().
            self._disconnected_event.clear()
            self._ws = ws
            try:
                await self._handshake(ws)
                self._connected_event.set()
                async for message in ws:
                    self._dispatch_inbound(message)
            except websockets.exceptions.ConnectionClosed:
                pass
            except _HandshakeError as err:
                logger.warning("Rejecting WS connection: %s", err)
                try:
                    await ws.close(err.code, err.reason)
                except Exception:  # pragma: no cover
                    pass
            finally:
                self._ws = None
                self._connected_event.clear()
                self._disconnected_event.set()

        async def process_request(connection: Any, request: Any) -> Any:
            from websockets.datastructures import Headers
            from websockets.http11 import Response

            path = request.path.split("?", 1)[0]
            if path == "/ws":
                return None
            if self._page_base_url is not None or not self._serve_page:
                return Response(404, "Not Found", Headers())
            return self._serve_static(path, Response)

        ws_server = await serve(
            handler,
            self._host,
            self._port,
            process_request=process_request,
        )
        self._ws_server = ws_server
        for sock in ws_server.sockets:
            self._bound_port = sock.getsockname()[1]
            break
        self._ready_event.set()

    async def _handshake(self, ws: Any) -> None:
        """Wait for the client hello, validate the token, respond ready."""
        try:
            if self._handshake_timeout is None:
                raw = await ws.recv()
            else:
                raw = await asyncio.wait_for(ws.recv(), timeout=self._handshake_timeout)
        except asyncio.TimeoutError as exc:
            raise _HandshakeError(1008, "handshake timeout") from exc
        if not isinstance(raw, str):
            raise _HandshakeError(1003, "expected text hello frame")
        try:
            hello = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise _HandshakeError(1003, "malformed hello") from exc
        if not isinstance(hello, dict) or hello.get("type") != "hello":
            raise _HandshakeError(1008, "first message must be hello")
        token = str(hello.get("token") or "")
        if not secrets.compare_digest(token, self._token):
            raise _HandshakeError(1008, "auth")
        self._bound_session = str(hello.get("session") or "default")
        await ws.send(json.dumps({"type": "ready"}))

    # ------------------------------------------------------------------
    # Static file serving (only when page_base_url is None)
    # ------------------------------------------------------------------

    def _serve_static(self, path: str, response_cls: type) -> Any:
        if path == "/" or path == "":
            path = "/index.html"

        try:
            requested = (self._dist / path.lstrip("/")).resolve()
            if not requested.is_relative_to(self._dist.resolve()):
                return response_cls(403, "Forbidden", _cors_headers())
        except (ValueError, OSError):
            return response_cls(400, "Bad Request", _cors_headers())

        if not requested.is_file():
            index = self._dist / "index.html"
            if index.is_file():
                requested = index
            else:
                return response_cls(404, "Not Found", _cors_headers())

        content_type, _ = mimetypes.guess_type(str(requested))
        if content_type is None:
            content_type = "application/octet-stream"
        try:
            body = requested.read_bytes()
        except OSError:
            return response_cls(500, "Internal Server Error", _cors_headers())

        headers = _cors_headers(
            {
                "Content-Type": content_type,
                "Content-Length": str(len(body)),
                "Cache-Control": "no-cache",
            }
        )
        return response_cls(200, "OK", headers, body)


class _HandshakeError(Exception):
    """Raised inside the WS handler when the hello frame is invalid."""

    def __init__(self, code: int, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason
