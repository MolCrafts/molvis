import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "molvis-theme";
const DEFAULT_THEME: Theme = "dark";

/**
 * Extra roots that own theme classes. Standalone mode only needs
 * `document.documentElement`. Shadow-DOM embeds (Jupyter, etc.) inject CSS
 * into the shadow tree, so custom properties inherit from the *host*
 * element — toggling `html.dark` alone does nothing for that tree.
 */
const themeRoots = new Set<HTMLElement>();

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* private mode / blocked storage */
  }
  return DEFAULT_THEME;
}

function applyThemeToElement(el: Element, theme: Theme): void {
  if (theme === "dark") {
    el.classList.add("dark");
  } else {
    el.classList.remove("dark");
  }
  if (el instanceof HTMLElement) {
    el.style.colorScheme = theme;
  }
}

function applyTheme(theme: Theme): void {
  applyThemeToElement(document.documentElement, theme);
  for (const root of themeRoots) {
    applyThemeToElement(root, theme);
  }
  // Notify BabylonJS to re-read the viewer-local canvas color token.
  // Without this, the React UI restyles via CSS but the 3D scene clearColor
  // stays stale. MolvisWrapper listens for this event.
  window.dispatchEvent(new Event("molvis:theme-change"));
}

/**
 * Register a Shadow-DOM host (or other scoped root) so light/dark toggles
 * update its class list. Applies the current stored theme immediately.
 * Call {@link unregisterThemeRoot} on dispose.
 *
 * When `seed` is provided and no preference is stored yet, seeds
 * `localStorage` so notebook embeds default dark without clobbering a
 * user choice on the next cell remount.
 */
export function registerThemeRoot(el: HTMLElement, seed?: Theme): void {
  if (seed === "light" || seed === "dark") {
    try {
      if (localStorage.getItem(STORAGE_KEY) == null) {
        localStorage.setItem(STORAGE_KEY, seed);
      }
    } catch {
      /* private mode / blocked storage */
    }
  }
  themeRoots.add(el);
  applyThemeToElement(el, readStoredTheme());
}

/** Drop a previously registered theme root (e.g. on embed dispose). */
export function unregisterThemeRoot(el: HTMLElement): void {
  themeRoots.delete(el);
}

/** Call once before React hydrates to avoid a flash of the wrong theme. */
export function bootstrapTheme(seed?: Theme): void {
  // A host-supplied appearance (`mv.Stage(appearance=...)` → `?theme=`)
  // seeds the very first paint only; once the user picks a side in
  // Settings the stored preference wins.
  applyTheme(seed ?? readStoredTheme());
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / blocked storage */
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readStoredTheme();
      applyTheme(next);
      setThemeState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { theme, setTheme, toggleTheme, isDark: theme === "dark" };
}
