# Web and TypeScript

The Web binding is the foundation used by every other MolVis host. It exposes a
browser application object for full control and Web Components for declarative
documentation or content pages.

## Choose the integration level

| Need | Use |
|---|---|
| Complete MolVis UI in an application | `mountMolvis()` / `MolvisApp` |
| Canvas-only scripted rendering | `MolvisRenderer` |
| One declarative structure in HTML/Markdown | `molvis-viewer` |
| Read-only representation comparison | `molvis-style-gallery` formatter |

All four routes use the same loaders, frame model, representation catalog, and
BabylonJS renderer. They differ in lifecycle and how much UI they create.

## Read this section

1. [Install and bundle](install.md)
2. [Mount an application and load data](application.md)
3. [Use Web Components and formatter fences](components.md)
4. [Manage resize, visibility, and disposal](lifecycle.md)

Use the [TypeScript API reference](../../api/typescript.md) after the guide when
you need exact signatures.
