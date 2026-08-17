import type { MenuItem } from "../mode/types";

interface MolvisElementWithData extends HTMLElement {
  data: MenuItem;
}

export function createControl(item: MenuItem): HTMLElement | null {
  let el: HTMLElement | null = null;

  switch (item.type) {
    case "button":
      el = document.createElement("molvis-button");
      (el as MolvisElementWithData).data = item;
      break;
    case "separator":
      el = document.createElement("molvis-separator");
      break;
    case "folder":
      el = document.createElement("molvis-folder");
      (el as MolvisElementWithData).data = item;
      break;
    case "binding":
      el = document.createElement("molvis-slider");
      (el as MolvisElementWithData).data = item;
      break;
  }

  return el;
}
