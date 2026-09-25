import { useState } from "react";

/** Skins, same structure: "lcd" (dark charcoal, iKnow), "classic" (the Winamp 2 base skin) and
 * "modern" (the silver-blue Winamp Modern skin). The iK logo cycles through them. */
export const SKINS = ["lcd", "classic", "modern"] as const;
export type Skin = (typeof SKINS)[number];
const KEY = "iknow:skin";

const read = (): Skin => {
  try {
    const v = localStorage.getItem(KEY);
    return (SKINS as readonly string[]).includes(v ?? "") ? (v as Skin) : "lcd";
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
    const next = SKINS[(SKINS.indexOf(skin) + 1) % SKINS.length];
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
