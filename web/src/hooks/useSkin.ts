import { useState } from "react";

/** Two skins, same structure: "lcd" (dark charcoal, iKnow) and "classic" (Winamp base skin). */
export type Skin = "lcd" | "classic";
const KEY = "iknow:skin";

const read = (): Skin => {
  try {
    return localStorage.getItem(KEY) === "classic" ? "classic" : "lcd";
  } catch {
    return "lcd";
  }
};

/** Sets the skin on <html> so every window, dialog and the boot screen follow it. */
export function applySkin(skin: Skin = read()) {
  document.documentElement.dataset.skin = skin;
}

export function useSkin() {
  const [skin, setSkin] = useState<Skin>(read);
  const toggle = () => {
    const next: Skin = skin === "lcd" ? "classic" : "lcd";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the skin lasts for the page */
    }
    applySkin(next);
    setSkin(next);
  };
  return { skin, toggle };
}
