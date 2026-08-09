const SVG_NS = "http://www.w3.org/2000/svg";

export function svgIcon(paths: string, viewBox = "0 0 24 24"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = paths;
  return svg;
}

export function bondOrderIcon(order: 1 | 2 | 3): SVGSVGElement {
  const lines = order === 1 ? [12] : order === 2 ? [9, 15] : [7.5, 12, 16.5];
  return svgIcon(lines.map((y) => `<path d="M4 ${y}h16"/>`).join(""));
}

export function ringSizeIcon(size: number, aromatic = false): SVGSVGElement {
  const points = Array.from({ length: size }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / size;
    return `${12 + Math.cos(angle) * 8},${12 + Math.sin(angle) * 8}`;
  }).join(" ");
  return svgIcon(
    `<polygon points="${points}"/>${aromatic ? '<circle cx="12" cy="12" r="4.3"/>' : ""}`,
  );
}

export function chargeDeltaIcon(delta: 1 | -1): SVGSVGElement {
  return svgIcon(
    `<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>${delta > 0 ? '<path d="M12 8v8"/>' : ""}`,
  );
}

export function stereoModeIcon(mode: "none" | "up" | "down"): SVGSVGElement {
  if (mode === "up") {
    return svgIcon(
      `<polygon points="4,19 20,5 9,17" fill="currentColor" stroke="none"/>`,
    );
  }
  if (mode === "down") {
    return svgIcon(`<path d="M4 19l3-1M7 16l4-1M10 13l5-2M14 9l5-3"/>`);
  }
  return svgIcon(`<path d="M4 18L20 6"/>`);
}

export const ICONS: Record<string, () => SVGSVGElement> = {
  select: () => svgIcon(`<path d="M4 4l7.5 16 2-7 7-2L4 4z"/>`),
  erase: () =>
    svgIcon(
      `<path d="M7 21h10"/><path d="M5.5 13.5l7-7a1.5 1.5 0 0 1 2.1 0l3.9 3.9a1.5 1.5 0 0 1 0 2.1l-7 7H5.5v-6z"/>`,
    ),
  bond: () =>
    svgIcon(
      `<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none"/>`,
    ),
  // Solid nucleus + ring — reads as “place atom”, not Bohr orbits.
  atom: () =>
    svgIcon(
      `<circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/>`,
    ),
  ring: () =>
    svgIcon(`<path d="M12 3.2l7.5 4.3v8.6L12 20.4l-7.5-4.3V7.5L12 3.2z"/>`),
  fragment: () =>
    svgIcon(
      // Scaffold + substituent hint
      `<path d="M8 4l4-2 4 2v4l-4 2-4-2V4z"/><path d="M12 10v4"/><path d="M9 16h6"/><path d="M10 18h4"/>`,
    ),
  chain: () => svgIcon(`<path d="M4 16l4-8 4 8 4-8 4 8"/>`),
  charge: () =>
    svgIcon(`<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>`),
  stereo: () =>
    svgIcon(
      `<path d="M5 19L19 5" stroke-width="1.25"/><path d="M5 19L14 8L16 10z" fill="currentColor" stroke="none"/>`,
    ),
  color: () =>
    svgIcon(
      `<path d="M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a1.5 1.5 0 0 1 0-3h2a7 7 0 0 0-2-12z"/><circle cx="7.5" cy="10" r=".8" fill="currentColor"/><circle cx="10" cy="6.8" r=".8" fill="currentColor"/><circle cx="14" cy="6.8" r=".8" fill="currentColor"/>`,
    ),
  undo: () =>
    svgIcon(`<path d="M9 14L4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 0 10h-3"/>`),
  redo: () =>
    svgIcon(`<path d="M15 14l5-5-5-5"/><path d="M20 9H10a5 5 0 0 0 0 10h3"/>`),
  clear: () =>
    svgIcon(
      `<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>`,
    ),
  fit: () => svgIcon(`<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`),
  export: () =>
    svgIcon(`<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/>`),
  /** Overflow / more actions (horizontal ellipsis). */
  more: () =>
    svgIcon(
      `<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>`,
    ),
  chevron: () => svgIcon(`<path d="M9 6l6 6-6 6"/>`),
};

export function parseSvgMarkup(markup: string): SVGSVGElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(markup, "image/svg+xml");
  const svg = doc.documentElement;
  if (!(svg instanceof SVGSVGElement) || svg.querySelector("parsererror")) {
    // Fallback empty box when exporter markup is unexpected.
    return svgIcon("");
  }
  // Adopt into current document.
  return document.importNode(svg, true);
}
