"""Unit tests for molvis.headless.HeadlessBrowser.

Playwright is replaced by a fake: nothing here launches a browser.
"""

from __future__ import annotations

import sys
import threading
from typing import Any

import pytest
from molvis.headless import CHROMIUM_ARGS, HeadlessBrowser, HeadlessBrowserUnavailable


class _Page:
    def __init__(self, record: dict[str, Any]) -> None:
        self.record = record

    def on(self, event: str, handler: Any) -> None:
        self.record.setdefault("events", []).append(event)

    def goto(self, url: str, wait_until: str) -> None:
        self.record["url"] = url
        self.record["wait_until"] = wait_until

    def wait_for_timeout(self, ms: float) -> None:
        threading.Event().wait(ms / 1000)


class _Browser:
    def __init__(self, record: dict[str, Any]) -> None:
        self.record = record

    def new_page(self, **kwargs: Any) -> _Page:
        self.record["page"] = kwargs
        return _Page(self.record)

    def close(self) -> None:
        self.record["closed"] = True


def _fake_playwright(record: dict[str, Any], launch_error: Exception | None = None) -> Any:
    class _Chromium:
        def launch(self, **kwargs: Any) -> _Browser:
            record["launch"] = kwargs
            if launch_error is not None:
                raise launch_error
            return _Browser(record)

    class _Playwright:
        chromium = _Chromium()

    class _Context:
        def __enter__(self) -> _Playwright:
            return _Playwright()

        def __exit__(self, *exc: object) -> None:
            record["stopped"] = True

    return lambda: _Context()


def _patch(monkeypatch: pytest.MonkeyPatch, factory: Any) -> None:
    monkeypatch.setattr(HeadlessBrowser, "_import_playwright", staticmethod(lambda: factory))


def test_opens_the_page_on_swiftshader_and_closes(monkeypatch: pytest.MonkeyPatch) -> None:
    record: dict[str, Any] = {}
    _patch(monkeypatch, _fake_playwright(record))
    monkeypatch.delenv("MOLVIS_CHROMIUM", raising=False)
    browser = HeadlessBrowser(width=640, height=480)
    browser.open("http://localhost:1/?ws_url=x")
    assert browser.is_open
    assert record["url"] == "http://localhost:1/?ws_url=x"
    assert record["page"]["viewport"] == {"width": 640, "height": 480}
    assert record["launch"]["headless"] is True
    assert record["launch"]["executable_path"] is None
    assert set(CHROMIUM_ARGS) <= set(record["launch"]["args"])
    browser.close()
    assert record["closed"] is True
    assert record["stopped"] is True
    assert not browser.is_open


def test_molvis_chromium_names_the_executable(monkeypatch: pytest.MonkeyPatch) -> None:
    record: dict[str, Any] = {}
    _patch(monkeypatch, _fake_playwright(record))
    monkeypatch.setenv("MOLVIS_CHROMIUM", "/opt/chrome/chrome")
    browser = HeadlessBrowser()
    browser.open("http://localhost:1/")
    browser.close()
    assert record["launch"]["executable_path"] == "/opt/chrome/chrome"


def test_missing_playwright_names_the_install_command(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "playwright.sync_api", None)
    with pytest.raises(HeadlessBrowserUnavailable, match=r"molcrafts-molvis\[headless\]"):
        HeadlessBrowser().open("http://localhost:1/")


def test_missing_chromium_names_playwright_install(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("BrowserType.launch: Executable doesn't exist at /x/chrome")
    _patch(monkeypatch, _fake_playwright({}, launch_error=error))
    with pytest.raises(HeadlessBrowserUnavailable, match="playwright install chromium"):
        HeadlessBrowser().open("http://localhost:1/")


def test_other_launch_failures_keep_their_message(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch(monkeypatch, _fake_playwright({}, launch_error=RuntimeError("no libnss3")))
    with pytest.raises(HeadlessBrowserUnavailable, match="no libnss3"):
        HeadlessBrowser().open("http://localhost:1/")


def test_rejects_an_empty_viewport_and_a_second_open(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="viewport"):
        HeadlessBrowser(width=0)
    _patch(monkeypatch, _fake_playwright({}))
    browser = HeadlessBrowser()
    browser.open("http://localhost:1/")
    try:
        with pytest.raises(RuntimeError, match="twice"):
            browser.open("http://localhost:1/")
    finally:
        browser.close()
