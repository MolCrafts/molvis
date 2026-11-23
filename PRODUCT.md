# MolVis editing surfaces

MolVis is a molecular visualization and editing toolkit with peer 2D Sketch
and 3D Stage engines. Researchers use the standalone Sketch editor to draw
chemical connectivity, inspect a 3D conformation and make structural edits.

The standalone editor retains its compact chemical drawing tools and large
paper canvas. Its optional linked Stage starts closed and opens only through
the toolbar or drawing context menu. Both views edit the same connectivity
automatically. A divider controls their relative size; narrow windows stack
the views. In Stage Edit mode, empty-space dragging rotates the view;
dragging from an atom creates a bond and a new atom. Closing Stage releases
its renderer and retains the current
conformation for reopening when connectivity has not changed.

2D connectivity edits regenerate 3D coordinates. 3D connectivity edits produce
a coherent fresh 2D depiction while retaining current atom/bond styling.
Selection, navigation and depiction-only moves do not regenerate the other
view. Failed conversions preserve the drawing and expose a retry action.
Wedge stereochemistry currently lacks a Sketch chiral-reference export; the
linked view reports this limitation rather than silently removing stereo.

This feature belongs to the standalone editor host shipped with Python.
Read-only previews, PNG exports and the published Sketch custom element
retain their existing 2D surfaces. The engines remain independent packages.
