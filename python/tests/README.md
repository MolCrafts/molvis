# python/tests

One flat lane: `tests/test_<module>.py` mirrors `src/molvis/<module>.py`.
Everything is collected by default and the whole suite runs in seconds.

There is no separate integration lane and no e2e. Two suites reach real
machinery because nothing else covers it, and both stay in-process:

- `test_websocket_transport.py` drives `WebSocketTransport` over loopback
  (`proxy=None`, never leaves the machine) — the only coverage of the
  hello/ready handshake and token validation.
- `test_video.py` runs the ffmpeg binary vendored by the `imageio-ffmpeg`
  dev dependency — the only coverage of `write_video`.

If a new test needs a browser, a built artifact, or a network peer, the
seam is wrong — inject a fake instead of adding a lane.

Run:

```bash
uv run --extra dev python -m pytest tests
```

`__pycache__/`, `.pyc`, coverage output, and temporary media are generated
artifacts, not fixtures. Keep committed fixtures explicit and place them in a
named `fixtures/` directory next to the tests that own them.
