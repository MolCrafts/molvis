# python/tests

One flat lane: `tests/test_<module>.py` mirrors `src/molvis/<module>.py`.
Everything is collected by default and the whole suite runs in seconds.

Unit tests only: no speed, regression or e2e tests. Nothing here opens a
socket, starts a server or runs an external binary. The relay over a live
molrs Publisher, the WebSocket handshake over loopback and `write_video`
through ffmpeg are not covered by this suite.

If a new test needs a browser, a built artifact, a network peer or a
subprocess, the seam is wrong — inject a fake instead of adding a lane.

Run:

```bash
uv run --extra dev python -m pytest tests
```

`__pycache__/`, `.pyc`, coverage output, and temporary media are generated
artifacts, not fixtures. Keep committed fixtures explicit and place them in a
named `fixtures/` directory next to the tests that own them.
