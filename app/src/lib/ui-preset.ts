// Spec section 6: ui_presets (thema/achtergrondkleur/accentkleur), per
// gebruiker. Actually re-theming every hardcoded Tailwind color across the
// app is out of scope here — this applies the active preset's colors as
// CSS custom properties on the document root, which nav-links.tsx (the
// active-item highlight) and the dashboard shell (background) read via
// var(--ui-accent, ...)/var(--ui-bg, ...) fallbacks, so "no preset active"
// looks identical to the current fixed blue theme.
const STORAGE_KEY = "ui-preset-active-id";

export type UiPreset = {
  id: string;
  naam: string;
  thema: string | null;
  achtergrondkleur: string | null;
  accentkleur: string | null;
};

export function applyUiPreset(preset: Pick<UiPreset, "achtergrondkleur" | "accentkleur"> | null) {
  const root = document.documentElement;
  if (preset?.achtergrondkleur) root.style.setProperty("--ui-bg", preset.achtergrondkleur);
  else root.style.removeProperty("--ui-bg");

  if (preset?.accentkleur) root.style.setProperty("--ui-accent", preset.accentkleur);
  else root.style.removeProperty("--ui-accent");
}

export function getStoredPresetId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredPresetId(id: string | null) {
  if (id) localStorage.setItem(STORAGE_KEY, id);
  else localStorage.removeItem(STORAGE_KEY);
}
