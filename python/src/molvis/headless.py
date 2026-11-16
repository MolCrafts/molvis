"""A headless Chromium that loads a MolVis page so nothing needs a display.

Every MolVis render happens in a real browser: the stage is WebGL, the sketch
is a 2D canvas. On a machine with no display — a coding agent's terminal, CI,
an HPC login node — there is nobody to open the page, so a command would wait
for a browser that never comes. :class:`HeadlessBrowser` is that browser: it
launches Chromium without a window, points it at the page URL the transport
serves, and keeps the page open until :meth:`close`. The page then dials back
over the WebSocket like any tab, and every RPC — including
``snapshot.take`` and the sketch exports — works unchanged.

Playwright drives the browser. It is an optional dependency::

    pip install 'molcrafts-molvis[headless]'
    python -m playwright install chromium

``MOLVIS_CHROMIUM`` names a Chromium/Chrome executable to use instead of the
one Playwright downloads (a site-installed browser on a cluster, say).

WebGL needs no GPU: Chromium is started on SwiftShader, its software
rasterizer, so the same command works on a laptop and on a headless Linux
node.

Threading
---------

Playwright's sync API is bound to the thread that started it, and refuses to
run on a thread that already has an asyncio loop (a notebook kernel's main
thread does). The browser therefore lives on its own daemon thread, which
launches it, loads the page, and then blocks until :meth:`close` asks it to
shut down. Nothing else calls into Playwright, so no cross-thread hand-off is
ever needed.
"""

from __future__ import annotations

import atexit
import logging
import os
import threading
from typing import Any

logger = logging.getLogger("molvis")

__all__ = ["HeadlessBrowser", "HeadlessBrowserUnavailable"]

#: Shown whenever Playwright or its browser is missing.
INSTALL_HINT = (
    "Headless rendering needs Playwright and a Chromium build:\n"
    "    pip install 'molcrafts-molvis[headless]'\n"
    "    python -m playwright install chromium\n"
    "or set MOLVIS_CHROMIUM to an installed Chrome/Chromium executable."
)

#: Chromium flags for WebGL on machines without a usable GPU.
#: SwiftShader is Chromium's software GL; recent builds only fall back to it
#: when ``--enable-unsafe-swiftshader`` is passed explicitly.
CHROMIUM_ARGS = (
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
)

#: Seconds allowed for Chromium to launch and start loading the page.
LAUNCH_TIMEOUT_S = 60.0


class HeadlessBrowserUnavailable(RuntimeError):
    """Playwright or its Chromium build is missing, or Chromium failed to start."""


class HeadlessBrowser:
    """One headless Chromium page, alive from :meth:`open` until :meth:`close`.

    Parameters
    ----------
    width, height
        Page viewport in CSS pixels. A stage snapshot is canvas-sized, so this
        is the size of the PNG a canvas-only page produces.
    executable
        Chromium/Chrome executable. Defaults to ``MOLVIS_CHROMIUM``, then to
        the browser Playwright installed.
    """

    def __init__(
        self,
        *,
        width: int = 1200,
        height: int = 800,
        executable: str | None = None,
    ) -> None:
        if width <= 0 or height <= 0:
            raise ValueError(f"viewport must be positive, got {width}x{height}")
        self.width = width
        self.height = height
        self.executable = executable or os.environ.get("MOLVIS_CHROMIUM") or None
        self._thread: threading.Thread | None = None
        self._loaded = threading.Event()
        self._stop = threading.Event()
        self._error: BaseException | None = None
        self.console: list[str] = []

    @property
    def is_open(self) -> bool:
        """Whether the browser thread is running and the page has loaded."""
        return (
            self._thread is not None
            and self._thread.is_alive()
            and self._loaded.is_set()
            and self._error is None
        )

    def open(self, url: str, *, timeout: float = LAUNCH_TIMEOUT_S) -> None:
        """Launch Chromium and start loading *url*. Returns once navigation began.

        Raises
        ------
        HeadlessBrowserUnavailable
            Playwright is not installed, its browser is missing, or Chromium
            could not start within *timeout* seconds.
        RuntimeError
            The browser is already open.
        """
        if self._thread is not None:
            raise RuntimeError("HeadlessBrowser.open called twice")
        sync_playwright = self._import_playwright()
        self._thread = threading.Thread(
            target=self._run,
            args=(sync_playwright, url),
            name="molvis-headless-browser",
            daemon=True,
        )
        self._thread.start()
        # A daemon thread dies mid-call at interpreter exit; close first so
        # Chromium and Playwright's driver are torn down, not orphaned.
        atexit.register(self.close)
        if not self._loaded.wait(timeout):
            self._stop.set()
            raise HeadlessBrowserUnavailable(
                f"headless Chromium did not load the page within {timeout:g}s"
            )
        if self._error is not None:
            raise HeadlessBrowserUnavailable(self._describe(self._error)) from self._error
        logger.info("MolVis headless browser opened %s", url)

    def check(self) -> None:
        """Raise when the browser thread failed after :meth:`open` returned."""
        if self._error is not None:
            raise HeadlessBrowserUnavailable(self._describe(self._error)) from self._error

    def close(self, timeout: float = 10.0) -> None:
        """Close the page and Chromium, and join the browser thread."""
        atexit.unregister(self.close)
        self._stop.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout)
        self._thread = None

    @staticmethod
    def _import_playwright() -> Any:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise HeadlessBrowserUnavailable(
                f"Playwright is not installed.\n{INSTALL_HINT}"
            ) from exc
        return sync_playwright

    def _run(self, sync_playwright: Any, url: str) -> None:
        """Browser thread body: launch, load, park until close, tear down."""
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    args=list(CHROMIUM_ARGS),
                    executable_path=self.executable,
                )
                try:
                    page = browser.new_page(
                        viewport={"width": self.width, "height": self.height},
                        device_scale_factor=1,
                    )
                    page.on("console", self._record_console)
                    page.on("pageerror", self._record_page_error)
                    page.goto(url, wait_until="domcontentloaded")
                    self._loaded.set()
                    # Park on Playwright's own clock so its event loop keeps
                    # servicing the page while we wait for close().
                    while not self._stop.is_set():
                        page.wait_for_timeout(100)
                finally:
                    browser.close()
        except BaseException as exc:  # reported to the caller via open()/check()
            self._error = exc
            logger.debug("Headless browser thread failed", exc_info=True)
        finally:
            self._loaded.set()

    def _record_console(self, message: Any) -> None:
        line = f"{message.type}: {message.text}"
        self.console.append(line)
        logger.debug("headless page console %s", line)

    def _record_page_error(self, error: Any) -> None:
        line = f"pageerror: {error}"
        self.console.append(line)
        logger.warning("headless page error: %s", error)

    @staticmethod
    def _describe(error: BaseException) -> str:
        text = str(error).strip() or type(error).__name__
        if "Executable doesn't exist" in text or "playwright install" in text:
            return f"Chromium for Playwright is not installed.\n{INSTALL_HINT}"
        return f"headless Chromium failed: {text}\n{INSTALL_HINT}"
