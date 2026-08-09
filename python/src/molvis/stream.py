"""Relay a live ``molrs::stream`` Frame stream into a viewer.

Where this sits
---------------

MolVis already owns a socket to the browser: JSON-RPC over
:class:`~molvis.transport.WebSocketTransport`, with the page's token handshake
and the whole RPC catalog behind it. A simulation that produces frames — a Rust
MD loop, a job on a cluster, a Python integrator that would rather not also
serve HTTP — speaks a *different* protocol: raw MessagePack ``Frame`` payloads
from ``molrs::stream::Publisher``.

:class:`FrameStream` joins the two::

    producer ──► molrs Publisher ──ws://──► FrameStream ──► Molvis.append_frame ──► browser

The browser therefore keeps exactly one protocol and one auth story, and the
producer keeps a socket it can bind anywhere — including a machine the browser
cannot reach, as long as this process can.

Nothing here parses the wire itself. Payloads are decoded by
:func:`molrs.io.read_frame_bytes`, whose format molrs owns; re-deriving the
layout in Python is how the two ends drift apart.

Threading
---------

Two threads, and **only bytes cross between them**. A ``molrs`` ``Frame`` is
backed by the shared FFI store, which is single-threaded and GIL-guarded — pyo3
enforces it, so a frame decoded on one thread and dropped on another aborts the
interpreter rather than corrupting anything quietly. So:

- the reader thread owns the socket and puts raw payloads on a bounded queue;
- the worker thread takes payloads, decodes them, and appends. Every ``Frame``
  is born and dies there.

The queue is bounded on purpose. When the viewer cannot keep up — a browser
that has not attached yet is the common case — the reader drops the oldest
pending payload instead of growing a backlog, which is the same policy the
producer's own send buffer uses.

**A streamed ``Frame`` must not be retained.** It is valid for the duration of
the ``append_frame`` call and no longer: it belongs to the worker thread, so
whatever still holds it when the main thread's garbage collector gets to it
raises during collection instead of being freed.
:meth:`~molvis.scene.Molvis.append_frame` respects this — it serializes into
the outbound WebSocket message and keeps nothing. Code that needs a streamed
frame's data must copy what it wants (``np.array(frame["atoms"]["x"])``)
inside the call. For the same reason nothing here stores an exception object:
a traceback reaches back to the raising frame's locals.

Known limitation
----------------

Even with no frame retained, molrs's Python objects take part in reference
cycles, and a cycle is freed by the *cyclic* collector — which runs on
whichever thread crosses the allocation threshold, not necessarily the one
that built the object. When that is the main thread, pyo3's thread check
raises during collection; Python reports it as an unraisable ``RuntimeError``
and the object is not reclaimed.

In practice this is confined to very short streams: a worker that keeps
decoding crosses its own generation-0 threshold and collects its own garbage
on the right thread. Measured over 200 and 400 forwarded frames it does not
occur at all. The real fix is in molrs — making the FFI store thread-safe so
``Frame`` need not be ``unsendable`` — and cannot be done from here; forcing a
collection on the worker would only move the problem, since ``gc.collect()``
is global and would free *other* threads' objects on this one.

Example
-------
::

    import molvis

    viewer = molvis.Molvis()
    with molvis.FrameStream(viewer, "ws://localhost:8765") as stream:
        stream.wait_for_frames(10)          # or just leave it running
        stream.send_command(molrs.stream.ControlCommand.pause())
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from typing import TYPE_CHECKING, Any, Self

if TYPE_CHECKING:
    from .scene import Molvis

logger = logging.getLogger("molvis")

__all__ = ["FrameStream", "StreamError"]

#: Seconds the reader waits between reconnect attempts.
RECONNECT_DELAY_S = 1.0

#: Default depth of the reader→worker payload queue. Matches the default
#: ``buffer_size`` of ``molrs.stream.Publisher``, so both ends of the hop hold
#: the same small number of frames in flight.
DEFAULT_QUEUE_SIZE = 4


class StreamError(RuntimeError):
    """The stream could not be established, or died in a way worth reporting."""


def _frame_codec() -> Any:
    """The decode function molrs owns for its stream wire format.

    Reading bytes into a ``Frame`` is a reader\'s job, so it lives in
    ``molrs.io`` rather than on ``Frame`` itself. An older molrs installed
    under a new molvis would otherwise surface as an ``AttributeError`` once
    the first payload landed — long after the mistake, on a background thread,
    where it reads as a corrupt stream rather than a stale dependency.
    """
    try:
        from molrs.io import read_frame_bytes
    except ImportError as exc:
        raise StreamError(
            "This molpy/molrs build has no molrs.io.read_frame_bytes, so a "
            "molrs stream cannot be decoded. Upgrade molcrafts-molrs to a "
            "release that ships molrs.stream (the same one that provides "
            "molrs.stream.Publisher)."
        ) from exc
    return read_frame_bytes


class FrameStream:
    """Reads a ``molrs::stream::Publisher`` socket and appends into a viewer.

    Runs its own asyncio loop on a daemon thread, so a notebook cell or a
    script keeps control while frames arrive. Nothing is read until
    :meth:`start` (or ``with``).

    Args:
        viewer: The :class:`~molvis.scene.Molvis` to append into.
        url: The producer's WebSocket URL, e.g. ``"ws://localhost:8765"``.
        format: Wire encoding the producer writes. Must match its
            ``ServerConfig.format`` — a mismatch is a decode error per frame,
            not a silent misread, because the codec is molrs's.
        follow: Passed through to
            :meth:`~molvis.commands.frame.FrameCommandsMixin.append_frame`.
            ``True`` (default) keeps the viewer on the newest frame.
        reconnect: Re-dial when the producer goes away. A simulation that has
            not started yet, or one restarted between runs, is the normal case
            rather than an error.
        max_rate_hz: Deliberately downsample to at most this many frames per
            second. ``None`` (default) forwards everything the queue admits.
            This is a *choice* about how much detail the viewer needs; it is
            not the overflow guard — that is ``queue_size``.
        queue_size: Payloads that may wait between the reader and the worker.
            When it is full the oldest is dropped, so a viewer that stalls
            costs frames rather than memory. See the module docstring.
    """

    def __init__(
        self,
        viewer: Molvis,
        url: str,
        *,
        format: str = "msgpack",
        follow: bool = True,
        reconnect: bool = True,
        max_rate_hz: float | None = None,
        queue_size: int = DEFAULT_QUEUE_SIZE,
    ) -> None:
        if not url.startswith(("ws://", "wss://")):
            raise ValueError(
                f"url must be a ws:// or wss:// endpoint, got {url!r}"
            )
        if format not in ("msgpack", "json"):
            raise ValueError(
                f"format must be 'msgpack' or 'json', got {format!r}"
            )
        if max_rate_hz is not None and not max_rate_hz > 0:
            raise ValueError(
                f"max_rate_hz must be positive or None, got {max_rate_hz!r}"
            )
        if queue_size < 1:
            raise ValueError(
                f"queue_size must be at least 1, got {queue_size!r}"
            )

        self._viewer = viewer
        self._url = url
        self._format = format
        self._follow = follow
        self._reconnect = reconnect
        self._min_interval = 0.0 if max_rate_hz is None else 1.0 / max_rate_hz

        self._thread: threading.Thread | None = None
        self._worker: threading.Thread | None = None
        self._task: asyncio.Task[None] | None = None
        self._inbox: queue.Queue[bytes | None] = queue.Queue(maxsize=queue_size)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._connected = threading.Event()

        self._lock = threading.Lock()
        self._frames_received = 0
        self._frames_forwarded = 0
        self._frames_dropped = 0
        self._last_error: str | None = None
        self._progress = threading.Condition(self._lock)

        self._socket: Any | None = None

    # ------------------------------------------------------------------
    # Read-only state
    # ------------------------------------------------------------------

    @property
    def url(self) -> str:
        """The producer endpoint this stream dials."""
        return self._url

    @property
    def connected(self) -> bool:
        """True while a socket to the producer is open."""
        return self._connected.is_set()

    @property
    def frames_received(self) -> int:
        """Frames decoded off the wire, including any dropped by rate limiting."""
        with self._lock:
            return self._frames_received

    @property
    def frames_forwarded(self) -> int:
        """Frames handed to the viewer."""
        with self._lock:
            return self._frames_forwarded

    @property
    def frames_dropped(self) -> int:
        """Frames decoded but skipped to honour ``max_rate_hz``."""
        with self._lock:
            return self._frames_dropped

    @property
    def last_error(self) -> str | None:
        """Description of the most recent read/decode/append failure.

        A stream that reconnects can otherwise fail silently forever — the
        socket keeps re-dialling and no frame ever arrives.

        A string, not the exception: an exception object reaches back through
        its traceback to the locals of the frame that raised, which on the
        worker thread includes a molrs ``Frame``. Storing it would keep that
        frame alive past its thread and hand it to whichever thread later
        collects this object.
        """
        with self._lock:
            return self._last_error

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self, timeout: float = 5.0) -> Self:
        """Begin reading. Returns ``self``.

        Blocks until the reader loop is running (not until a producer is
        found — that is :meth:`wait_for_connection`).
        """
        if self._thread is not None:
            return self

        self._stop.clear()
        self._worker = threading.Thread(
            target=self._drain,
            name=f"molvis-stream-decode-{self._viewer.name}",
            daemon=True,
        )
        self._worker.start()
        self._thread = threading.Thread(
            target=self._run,
            name=f"molvis-stream-{self._viewer.name}",
            daemon=True,
        )
        self._thread.start()
        if not self._ready.wait(timeout=timeout):
            raise StreamError(
                f"stream reader failed to start within {timeout}s"
            )
        return self

    def stop(self, timeout: float = 5.0) -> None:
        """Stop reading and join both threads. Idempotent.

        Cancels the reader rather than waiting for it to notice: it is parked
        in ``async for message in socket``, which wakes only when a frame
        arrives. A producer that has gone quiet would otherwise keep the thread
        alive for the whole join timeout and beyond.
        """
        self._stop.set()
        loop = self._loop
        task = self._task
        if loop is not None and task is not None:
            loop.call_soon_threadsafe(task.cancel)
        elif loop is not None:  # pragma: no cover — start() not finished
            loop.call_soon_threadsafe(lambda: None)
        thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout)
            self._thread = None
        worker = self._worker
        if worker is not None:
            # Sentinel so the worker does not sit out its queue timeout.
            try:
                self._inbox.put_nowait(None)
            except queue.Full:
                pass
            worker.join(timeout=timeout)
            self._worker = None
        self._loop = None
        self._connected.clear()
        self._ready.clear()

    def __enter__(self) -> Self:
        return self.start()

    def __exit__(self, *_exc: object) -> bool:
        self.stop()
        return False

    def wait_for_connection(self, timeout: float | None = None) -> None:
        """Block until the producer's socket is open.

        Raises:
            TimeoutError: No producer within *timeout* seconds.
        """
        if timeout is None:
            self._connected.wait()
            return
        if not self._connected.wait(timeout=timeout):
            raise TimeoutError(
                f"No producer at {self._url} within {timeout}s"
                + (f" (last error: {self.last_error})" if self.last_error else "")
            )

    def wait_for_frames(self, count: int = 1, timeout: float | None = 30.0) -> int:
        """Block until *count* frames have been forwarded; return the total.

        Raises:
            TimeoutError: Fewer than *count* frames arrived in time.
        """
        deadline_reached = False
        with self._progress:
            if timeout is None:
                while self._frames_forwarded < count:
                    self._progress.wait()
            else:
                deadline_reached = not self._progress.wait_for(
                    lambda: self._frames_forwarded >= count, timeout=timeout
                )
            total = self._frames_forwarded
        if deadline_reached:
            raise TimeoutError(
                f"Only {total} of {count} frame(s) arrived from {self._url} "
                f"within {timeout}s"
                + (f" (last error: {self.last_error})" if self.last_error else "")
            )
        return total

    # ------------------------------------------------------------------
    # Upstream control
    # ------------------------------------------------------------------

    def send_command(self, command: Any, timeout: float = 5.0) -> None:
        """Send a ``molrs.stream.ControlCommand`` back to the producer.

        The producer decides what a command means; this only delivers it.

        The command is encoded in this stream's ``format``, and — this part is
        load-bearing — sent as the matching WebSocket frame type. ``Publisher``
        picks its decoder from the frame type alone: a **text** frame is parsed
        as JSON, a **binary** frame as MessagePack. Sending JSON bytes as binary
        is not an error the producer reports; the command is simply dropped.

        Raises:
            StreamError: No socket is open.
            TypeError: *command* is not a ``ControlCommand``.
        """
        encode = getattr(command, "to_bytes", None)
        if not callable(encode):
            raise TypeError(
                "command must be a molrs.stream.ControlCommand (needs to_bytes); "
                f"got {type(command)!r}"
            )
        # The command's own encoder owns the wire shape — see the module
        # docstring on not re-deriving layouts here.
        encoded = encode(self._format)
        payload: str | bytes = (
            encoded.decode("utf-8") if self._format == "json" else encoded
        )

        loop = self._loop
        socket = self._socket
        if loop is None or socket is None:
            raise StreamError(
                f"not connected to {self._url}; start the stream and wait for "
                "the producer before sending commands"
            )
        future = asyncio.run_coroutine_threadsafe(socket.send(payload), loop)
        future.result(timeout=timeout)

    # ------------------------------------------------------------------
    # Reader thread
    # ------------------------------------------------------------------

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        task = loop.create_task(self._read_forever())
        self._task = task
        self._ready.set()
        try:
            loop.run_until_complete(task)
        except asyncio.CancelledError:
            pass  # stop() asked for this
        except Exception:  # pragma: no cover — defensive
            logger.exception("molvis stream reader crashed")
        finally:
            self._task = None
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

    async def _read_forever(self) -> None:
        try:
            import websockets
        except ImportError as exc:  # pragma: no cover — install-time guard
            raise ImportError(
                "The 'websockets' package is required to relay a stream. "
                "Install with: pip install 'websockets>=13.0'"
            ) from exc

        while not self._stop.is_set():
            try:
                async with websockets.connect(self._url) as socket:
                    self._socket = socket
                    self._connected.set()
                    logger.info("molvis stream attached to %s", self._url)
                    await self._pump(socket)
            except asyncio.CancelledError:  # pragma: no cover
                raise
            except Exception as exc:
                # Includes "producer not up yet", which is the normal case
                # when the viewer is opened before the simulation starts.
                self._note_failure("read failed", exc, level=logging.DEBUG)
            finally:
                self._socket = None
                self._connected.clear()

            if not self._reconnect:
                return
            if self._stop.is_set():
                return
            await asyncio.sleep(RECONNECT_DELAY_S)

    async def _pump(self, socket: Any) -> None:
        """Queue every payload on *socket* until it closes or we stop.

        Deliberately does no decoding: a decoded ``Frame`` belongs to one
        thread, and this one is not it (see the module docstring).
        """
        loop = asyncio.get_running_loop()
        next_allowed = 0.0

        async for message in socket:
            if self._stop.is_set():
                return
            payload = message.encode("utf-8") if isinstance(message, str) else message

            with self._lock:
                self._frames_received += 1

            now = loop.time()
            if self._min_interval and now < next_allowed:
                with self._lock:
                    self._frames_dropped += 1
                continue
            next_allowed = now + self._min_interval

            self._offer(payload)

    def _offer(self, payload: bytes) -> None:
        """Hand a payload to the worker, dropping the oldest when saturated."""
        try:
            self._inbox.put_nowait(payload)
            return
        except queue.Full:
            pass
        try:
            self._inbox.get_nowait()
        except queue.Empty:  # pragma: no cover — the worker just drained it
            pass
        with self._lock:
            self._frames_dropped += 1
        try:
            self._inbox.put_nowait(payload)
        except queue.Full:  # pragma: no cover — another producer refilled it
            with self._lock:
                self._frames_dropped += 1

    def _drain(self) -> None:
        """Decode and append, forever, on this one thread.

        Every ``Frame`` this stream produces is created and released here.
        """
        while not self._stop.is_set():
            try:
                payload = self._inbox.get(timeout=0.1)
            except queue.Empty:
                continue
            if payload is None:  # stop sentinel
                return

            try:
                frame = self._decode(payload)
            except Exception as exc:
                self._note_failure("could not decode a frame", exc)
                continue

            try:
                self._append(frame)
            except Exception as exc:
                self._note_failure("could not append a frame", exc)
                continue
            finally:
                # Rebinding on the next iteration would drop it here anyway;
                # being explicit keeps the thread-affinity rule visible.
                del frame

            with self._progress:
                self._frames_forwarded += 1
                self._progress.notify_all()

    def _note_failure(
        self, what: str, exc: BaseException, *, level: int = logging.WARNING
    ) -> None:
        """Record and log a failure as **text**, never as the exception object.

        An exception reaches back through its traceback to the locals of the
        frame that raised — on the worker thread that includes a molrs
        ``Frame``. Handing the object to :mod:`logging` is enough to keep it
        alive: a ``LogRecord`` holds its args, and anything retaining records
        (pytest's capture, a memory handler, a queue handler) then drops that
        frame from whichever thread collects the record.
        """
        detail = f"{type(exc).__name__}: {exc}"
        with self._lock:
            self._last_error = detail
        logger.log(level, "molvis stream %s: %s", what, detail)

    def _decode(self, payload: bytes) -> Any:
        """Bytes → Frame, using molrs's own codec."""
        return _frame_codec()(payload, self._format)

    def _append(self, frame: Any) -> None:
        self._viewer.append_frame(frame, follow=self._follow)
