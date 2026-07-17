# VS Code configuration

The extension exposes two validated objects in user or workspace settings.
They apply when a viewer starts or reloads.

## `molvis.config`

Core construction options control UI availability and canvas creation:

```jsonc
{
  "molvis.config": {
    "showUI": true,
    "useRightHandedSystem": true,
    "ui": {
      "showInfoPanel": true,
      "showPerfPanel": false,
      "showContextMenu": true
    },
    "canvas": {
      "antialias": true,
      "alpha": false,
      "stencil": true
    }
  }
}
```

## `molvis.settings`

Runtime settings tune camera, grid, and graphics behavior:

```jsonc
{
  "molvis.settings": {
    "cameraRotateSpeed": 1.0,
    "cameraZoomSpeed": 1.5,
    "grid": {
      "enabled": true,
      "size": 100,
      "opacity": 0.3
    },
    "graphics": {
      "fxaa": true,
      "hardwareScaling": 1.0
    }
  }
}
```

VS Code validates known fields and offers completion. Unknown forward-compatible
fields are allowed so the extension does not block newer core options.

## Apply changes

Existing webviews do not reconstruct themselves for every settings edit. Run
**MolVis: Reload View** or reopen the editor/workspace after changing either
object.

Prefer workspace settings for project-specific conventions and user settings
for hardware/performance preferences.

Continue with [Remote workspaces](remote.md).
