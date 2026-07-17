# Tutorial

This tutorial teaches MolVis from the data outward. It does not begin with a
tour of every button, and it does not mix Python, VS Code, and TypeScript setup
into the same workflow. The interactive examples on these pages are the
workspace: you only need a modern browser.

## What you will build

You will start with one three-atom water structure and gradually answer seven
questions:

1. [What molecular data is MolVis displaying?](first-structure.md)
2. [How does the camera turn a 3-D scene into a 2-D canvas?](camera.md)
3. [What does a molecular representation change?](representations.md)
4. [What is a selection, and why do interaction modes exist?](selection.md)
5. [How does the modifier pipeline transform source data?](pipeline.md)
6. [How is a trajectory different from a single structure?](trajectory.md)
7. [Which state is captured when you export?](export.md)

Each page introduces one new concept, uses the vocabulary established by the
previous pages, and ends with a short checkpoint.

## The four nouns to recognize first

You do not need to memorize the MolVis API, but these nouns will appear
throughout the manual:

| Noun | Meaning |
|---|---|
| **Frame** | Atom/bond data for one point in time, plus an optional periodic box. |
| **Scene** | The rendered objects, camera, lights, overlays, and current visual state. |
| **Representation** | The rules used to turn atoms and bonds into visible geometry. |
| **Pipeline** | The ordered transformations between loaded source data and the rendered frame. |

The important boundary is this: a **frame is molecular data**; a **scene is how
that data is currently being viewed**. Changing the camera or representation
does not rewrite the frame.

## Use an interface after the tutorial

When the concepts are clear, choose the binding that matches your work:

- [Web & TypeScript](../interfaces/web/index.md)
- [Python & Jupyter](../interfaces/python/index.md)
- [VS Code](../interfaces/vscode/index.md)

Start with [Your first structure](first-structure.md).
