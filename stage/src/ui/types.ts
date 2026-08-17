/**
 * Base interface for all GUI components
 */
export interface GUIComponent {
  element: HTMLElement;
  mount(container: HTMLElement): void;
  unmount(): void;
  update(data: unknown): void;
  show(): void;
  hide(): void;
}

/**
 * Camera view presets
 */
export type CameraView = "front" | "back" | "left" | "right" | "top" | "bottom";

/**
 * Camera projection modes
 */
export type ProjectionMode = "perspective" | "orthographic";
