---
title: MolVis
description: Molecular visualization for browsers, Python notebooks, and VS Code.
hide:
  - navigation
  - toc
hero:
  kicker: Manual
  title: MolVis
  description: Learn molecular visualization one concept at a time, then use the same renderer from TypeScript, Python, Jupyter, or VS Code.
  actions:
    - { label: Start the tutorial, href: tutorial/, style: primary }
    - { label: Compare rendering styles, href: tutorial/representations/ }
    - { label: Choose an interface, href: interfaces/web/ }
  install:
    label: Install a binding
    align: left
    methods:
      - { label: Python, command: pip install molcrafts-molvis }
      - { label: TypeScript, command: npm install @molcrafts/molvis-core }
---

<h1 class="molcrafts-sr-only">MolVis manual</h1>

<div class="molcrafts-manual-home" markdown>

<section class="molcrafts-manual-section molcrafts-manual-section--compact" markdown>

<div class="molcrafts-manual-section__header" markdown>

<span class="molcrafts-manual-eyebrow">Start here</span>

## Read the manual in order

The tutorial deliberately separates data, camera, representation, selection,
pipeline, trajectory, and export. Learn one idea before the next one depends on
it.

</div>

<nav class="molcrafts-manual-index" aria-label="Manual entry points">
  <a href="tutorial/">
    <span>01</span>
    <strong>Tutorial</strong>
    <em>Open one structure, understand the viewport, and build a mental model from first principles.</em>
  </a>
  <a href="tutorial/representations/">
    <span>02</span>
    <strong>Rendering gallery</strong>
    <em>Compare aspirin in every molecular representation using ten canvases and one BabylonJS engine.</em>
  </a>
  <a href="interfaces/web/">
    <span>03</span>
    <strong>Choose a binding</strong>
    <em>Use the Web/TypeScript, Python/Jupyter, or VS Code documentation as a complete interface-specific guide.</em>
  </a>
  <a href="api/typescript/">
    <span>04</span>
    <strong>Look up an API</strong>
    <em>Jump from the conceptual manual to exact TypeScript and Python signatures.</em>
  </a>
</nav>

</section>

<section class="molcrafts-manual-section molcrafts-manual-section--stack" markdown>

<div class="molcrafts-manual-section__header" markdown>

<span class="molcrafts-manual-eyebrow">Bindings</span>

## Use MolVis where your data already lives

Every binding drives the same rendering core, but installation, lifecycle, file
access, and event handling differ. Each interface therefore has its own manual
section instead of sharing a mixed quickstart.

</div>

<div class="molcrafts-manual-grid molcrafts-manual-grid--cols-3">
  <a href="interfaces/web/">
    <strong>Web &amp; TypeScript</strong>
    <em>Mount the application, load files, embed Web Components, and manage lifecycle.</em>
  </a>
  <a href="interfaces/python/">
    <strong>Python &amp; Jupyter</strong>
    <em>Install the wheel, display notebook scenes, script browsers, receive events, and export video.</em>
  </a>
  <a href="interfaces/vscode/">
    <strong>VS Code</strong>
    <em>Install the extension, use Quick View, work in the full workspace, and configure remote projects.</em>
  </a>
</div>

</section>

<section class="molcrafts-manual-section" markdown>

<div class="molcrafts-manual-section__header" markdown>

<span class="molcrafts-manual-eyebrow">Model</span>

## The concepts stay the same

The host changes, but the vocabulary does not. This shared model is what lets a
notebook, editor, and browser show the same molecular result.

</div>

<dl class="molcrafts-feature-matrix">
  <div>
    <dt>Structure and frame</dt>
    <dd>Atoms, bonds, properties, and an optional periodic box at one point in time.</dd>
  </div>
  <div>
    <dt>Representation</dt>
    <dd>A global visual contract for atom geometry, bond geometry, radii, shading, labels, and outlines.</dd>
  </div>
  <div>
    <dt>Selection and mode</dt>
    <dd>A persistent set of atoms/bonds plus the current interpretation of pointer and keyboard input.</dd>
  </div>
  <div>
    <dt>Pipeline</dt>
    <dd>An ordered, reversible transformation from source data to the frame that is actually rendered.</dd>
  </div>
  <div>
    <dt>Trajectory</dt>
    <dd>An indexed sequence of frames sharing a timeline and, usually, a common topology.</dd>
  </div>
  <div>
    <dt>Scene output</dt>
    <dd>Screenshots, structures, and videos are produced from the current camera and pipeline state.</dd>
  </div>
</dl>

</section>

<section class="molcrafts-manual-section" markdown>

<div class="molcrafts-manual-section__header" markdown>

<span class="molcrafts-manual-eyebrow">Reference</span>

## Continue after the tutorial

Use guides while building; use the API reference when you already know which
object or command you need.

</div>

<div class="molcrafts-manual-list">
  <a href="development/">
    <strong>Development</strong>
    <em>Architecture, setup, extension points, commands, modifiers, and headless rendering.</em>
  </a>
  <a href="api/typescript/">
    <strong>TypeScript API</strong>
    <em>MolvisApp, MolvisRenderer, configuration, events, I/O, and Web Components.</em>
  </a>
  <a href="api/python/">
    <strong>Python API</strong>
    <em>Molvis, transports, drawing, state, events, registry, and error handling.</em>
  </a>
  <a href="https://github.com/molcrafts/molvis">
    <strong>Source and issues</strong>
    <em>Repository, releases, issue tracker, and BSD-3-Clause license.</em>
  </a>
</div>

</section>

</div>
