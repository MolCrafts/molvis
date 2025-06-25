// CSS styles for HTML-based GUI components
export const GUI_STYLES = {
  baseIndicator: `
    position: absolute;
    padding: 8px 12px;
    background: transparent;
    color: white;
    border-radius: 4px;
    font-size: 14px;
    z-index: 1000;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
  `,
  
  modeIndicator: `
    top: 10px;
    right: 10px;
    font-weight: bold;
    font-size: 14px;
  `,
  
  viewIndicator: `
    top: 10px;
    left: 10px;
    font-weight: bold;
    font-size: 14px;
  `,
  
  infoPanel: `
    position: absolute;
    bottom: 3%;
    left: 3%;
    width: 150px;
    height: 40px;
    font-size: 26px;
    color: white;
  `
};

// Helper function to apply styles
export function applyStyles(element: HTMLElement, ...styleStrings: string[]): void {
  element.style.cssText = styleStrings.join('; ');
}
