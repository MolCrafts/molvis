import { describe, expect, it } from "@rstest/core";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../src/components/ui/dropdown-menu";
import { enableReactActEnvironment } from "../../react_harness";

enableReactActEnvironment();

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("DropdownMenu portal layering", () => {
  it("renders Content above ViewerSidePanel's z-10 layer", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await React.act(async () => {
      root.render(
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent data-testid="menu-content">
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      await nextFrame();
    });

    try {
      const content = document.body.querySelector<HTMLElement>(
        '[data-testid="menu-content"]',
      );
      expect(content).not.toBeNull();
      expect(content?.classList.contains("z-50")).toBe(true);
    } finally {
      await React.act(async () => root.unmount());
      host.remove();
    }
  });

  it("renders SubContent above ViewerSidePanel's z-10 layer", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await React.act(async () => {
      root.render(
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-testid="submenu-content">
                <DropdownMenuItem>Nested item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      await nextFrame();
    });

    try {
      const content = document.body.querySelector<HTMLElement>(
        '[data-testid="submenu-content"]',
      );
      expect(content).not.toBeNull();
      expect(content?.classList.contains("z-50")).toBe(true);
    } finally {
      await React.act(async () => root.unmount());
      host.remove();
    }
  });
});
