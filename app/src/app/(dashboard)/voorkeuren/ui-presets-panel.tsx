"use client";

import { useEffect, useState } from "react";
import { applyUiPreset, getStoredPresetId, setStoredPresetId, type UiPreset } from "@/lib/ui-preset";
import { createPreset, deletePreset, fetchOwnPresets } from "./preset-actions";

export function UiPresetsPanel() {
  const [presets, setPresets] = useState<UiPreset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredPresetId(),
  );
  const [naam, setNaam] = useState("");
  const [achtergrondkleur, setAchtergrondkleur] = useState("#eff6ff");
  const [accentkleur, setAccentkleur] = useState("#2563eb");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    fetchOwnPresets().then(setPresets);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!naam.trim()) {
      setError("Naam is verplicht.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await createPreset({ naam: naam.trim(), thema: null, achtergrondkleur, accentkleur });
    setSaving(false);
    if (result) {
      setError(result);
      return;
    }
    setNaam("");
    load();
  }

  async function handleDelete(id: string) {
    const result = await deletePreset(id);
    if (result) {
      setError(result);
      return;
    }
    if (activeId === id) {
      setStoredPresetId(null);
      setActiveId(null);
      applyUiPreset(null);
    }
    load();
  }

  function handleApply(preset: UiPreset) {
    setStoredPresetId(preset.id);
    setActiveId(preset.id);
    applyUiPreset(preset);
  }

  function handleResetDefault() {
    setStoredPresetId(null);
    setActiveId(null);
    applyUiPreset(null);
  }

  return (
    <section className="mt-6 max-w-md space-y-3 rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl">
      <h2 className="text-sm font-medium text-slate-700">UI-presets (spec sectie 5/6)</h2>

      {presets.length > 0 ? (
        <ul className="space-y-1">
          {presets.map((preset) => (
            <li
              key={preset.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-blue-100 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2 text-slate-700">
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-full border border-slate-300"
                  style={{ backgroundColor: preset.accentkleur ?? undefined }}
                />
                {preset.naam}
                {activeId === preset.id ? <span className="text-xs text-blue-600">(actief)</span> : null}
              </span>
              <span className="flex gap-2 text-xs">
                <button type="button" onClick={() => handleApply(preset)} className="text-blue-600 hover:underline">
                  Toepassen
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(preset.id)}
                  className="text-slate-500 hover:underline"
                >
                  Verwijder
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Nog geen presets aangemaakt.</p>
      )}

      {activeId ? (
        <button type="button" onClick={handleResetDefault} className="text-xs text-slate-500 hover:underline">
          Terug naar standaardthema
        </button>
      ) : null}

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="space-y-1">
          <label htmlFor="preset-naam" className="text-xs text-slate-600">
            Nieuwe preset — naam
          </label>
          <input
            id="preset-naam"
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex gap-3">
          <label className="flex flex-1 items-center gap-2 text-xs text-slate-600">
            Achtergrond
            <input
              type="color"
              value={achtergrondkleur}
              onChange={(e) => setAchtergrondkleur(e.target.value)}
              className="h-8 w-full rounded"
            />
          </label>
          <label className="flex flex-1 items-center gap-2 text-xs text-slate-600">
            Accent
            <input
              type="color"
              value={accentkleur}
              onChange={(e) => setAccentkleur(e.target.value)}
              className="h-8 w-full rounded"
            />
          </label>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <button
          type="button"
          onClick={handleCreate}
          disabled={saving}
          className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {saving ? "Bezig..." : "Preset opslaan"}
        </button>
      </div>
    </section>
  );
}
