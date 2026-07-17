# Export and reproducibility

Export is the final concept because it depends on every earlier layer. Before
writing a file, decide whether you want an image of the **scene** or molecular
data from the **pipeline output**.

## Screenshot versus structure

| Output | Captures | Does not capture |
|---|---|---|
| Screenshot | Camera, background, representation, lighting, overlays, visible pipeline result | Editable coordinates as molecular data |
| XYZ/structure export | Current pipeline frame and supported properties | Camera angle, lighting, representation |
| Video | A sequence of rendered scene images under a camera/trajectory schedule | A reusable molecular trajectory unless exported separately |

A screenshot changes when you orbit. An XYZ export does not. Hiding atoms with a
pipeline modifier can affect both because those atoms are no longer in the
rendered/output working frame.

## A reproducible export checklist

Before exporting, record or verify:

1. the source file and active trajectory index;
2. enabled modifiers and their order;
3. current selection if a modifier refers to it;
4. representation, outline, radii, and background for images;
5. camera fit and output resolution for screenshots/video;
6. output format limitations, especially bonds, box, and custom columns.

## Choose the right host

- Use [Web & TypeScript](../interfaces/web/index.md) when export belongs inside a
  web application or automated renderer.
- Use [Python & Jupyter](../interfaces/python/index.md) for scripted snapshots,
  event-driven analysis, and MP4 generation.
- Use [VS Code](../interfaces/vscode/index.md) when editing and saving a workspace
  file is the center of the workflow.

## Tutorial complete

You now have a layered model:

```text
source → active frame → modifier pipeline → representation + scene → camera → image
```

Return to this chain whenever a result is surprising. First ask which layer
changed; then consult the matching interface guide or API reference.
