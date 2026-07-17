# Install the Python binding

MolVis requires Python 3.12 or newer. Install the distribution into the same
environment that runs your script or notebook kernel:

```bash
python -m pip install molcrafts-molvis
```

The distribution name is `molcrafts-molvis`; the import name is `molvis`:

```python
import molvis as mv
```

The wheel contains the frontend page bundle. Node.js and a separate web server
are not required for ordinary Python/Jupyter use.

## Optional video support

Install the video extra when Python should encode PNG frames as MP4:

```bash
python -m pip install "molcrafts-molvis[video]"
```

The extra supplies an FFmpeg binary through `imageio-ffmpeg`. MolVis still uses
a system `ffmpeg` first when one is already available on `PATH`.

## Verify the environment

```bash
python -c "import molvis; print(molvis.__version__)"
```

In Jupyter, verify the active kernel rather than the terminal environment:

```python
import sys
print(sys.executable)
```

If these paths differ, install with `%pip install molcrafts-molvis` inside the
notebook and restart the kernel.

Continue with [Notebook scenes](notebooks.md).
