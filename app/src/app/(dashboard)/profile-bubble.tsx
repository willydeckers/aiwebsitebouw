"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type Profiel = { naam: string | null; profielfoto_url: string | null };

// The datamodel (spec section 6) ties gebruikers_profiel to a `gebruiker`
// enum ('warre'|'garen'), not to auth.users.id directly — there's no other
// link given, so this derives it from the known account emails.
function gebruikerFromEmail(email: string | undefined): "warre" | "garen" {
  return email?.toLowerCase().includes("garen") ? "garen" : "warre";
}

export function ProfileBubble({ user }: { user: User }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profiel, setProfiel] = useState<Profiel | null>(null);
  const [naamInput, setNaamInput] = useState("");
  const [fotoInput, setFotoInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const gebruiker = gebruikerFromEmail(user.email);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function opKlik(e: MouseEvent) {
      if (!wrapper.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    }
    function opToets(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setEditing(false);
      }
    }

    document.addEventListener("mousedown", opKlik);
    document.addEventListener("keydown", opToets);
    return () => {
      document.removeEventListener("mousedown", opKlik);
      document.removeEventListener("keydown", opToets);
    };
  }, [open]);

  useEffect(() => {
    const supabase = createClient();

    supabase
      .from("gebruikers_profiel")
      .select("naam, profielfoto_url")
      .eq("gebruiker", gebruiker)
      .maybeSingle()
      .then(({ data }) => setProfiel(data));
  }, [gebruiker]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function startEditing() {
    setNaamInput(profiel?.naam ?? "");
    setFotoInput(profiel?.profielfoto_url ?? "");
    setSaveError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    const supabase = createClient();
    const { error } = await supabase
      .from("gebruikers_profiel")
      .upsert(
        { gebruiker, naam: naamInput.trim() || null, profielfoto_url: fotoInput.trim() || null },
        { onConflict: "gebruiker" },
      );

    setSaving(false);
    if (error) {
      setSaveError(`Opslaan mislukt: ${error.message}`);
      return;
    }

    setProfiel({ naam: naamInput.trim() || null, profielfoto_url: fotoInput.trim() || null });
    setEditing(false);
  }

  const label = profiel?.naam ?? user.email ?? "?";
  const initials = label.trim().slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-blue-600 text-xs font-semibold text-white shadow-md shadow-blue-300/50"
      >
        {profiel?.profielfoto_url ? (
          // Static export has no image optimization server, and this is a
          // small user-uploaded avatar, not worth a loader for.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profiel.profielfoto_url}
            alt={label}
            className="h-full w-full object-cover"
          />
        ) : (
          initials
        )}
      </button>

      {open && !editing ? (
        // Een menu dat enkel je eigen naam herhaalt is een doodlopend spoor.
        // Vanaf hier moet je ergens naartoe kunnen: naar je instellingen, naar
        // je voorkeuren, of eruit.
        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm shadow-xl shadow-slate-300/40">
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="truncate font-medium text-slate-800">{label}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>

          <div className="p-1.5">
            <Link
              href="/instellingen"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Instellingen
              <span className="block text-xs text-slate-400">API-sleutels en configuratie</span>
            </Link>
            <Link
              href="/voorkeuren"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Voorkeuren
              <span className="block text-xs text-slate-400">Gmail, AI-regels, weergave</span>
            </Link>
            <button
              type="button"
              onClick={startEditing}
              className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            >
              Profiel bewerken
            </button>
          </div>

          <div className="border-t border-slate-100 p-1.5">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            >
              Uitloggen
            </button>
          </div>
        </div>
      ) : null}

      {open && editing ? (
        <div className="absolute right-0 z-10 mt-2 w-64 space-y-2 rounded-2xl border border-white/60 bg-white/90 p-3 text-sm shadow-lg shadow-blue-200/40 backdrop-blur-xl">
          <div className="space-y-1">
            <label htmlFor="profiel-naam" className="text-xs text-slate-600">
              Naam
            </label>
            <input
              id="profiel-naam"
              value={naamInput}
              onChange={(e) => setNaamInput(e.target.value)}
              className="w-full rounded-lg border border-blue-200 bg-white/80 px-2 py-1 text-xs text-slate-900 outline-none focus:border-blue-400"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="profiel-foto" className="text-xs text-slate-600">
              Profielfoto-URL
            </label>
            <input
              id="profiel-foto"
              value={fotoInput}
              onChange={(e) => setFotoInput(e.target.value)}
              className="w-full rounded-lg border border-blue-200 bg-white/80 px-2 py-1 text-xs text-slate-900 outline-none focus:border-blue-400"
            />
          </div>
          {saveError ? <p className="text-xs text-red-600">{saveError}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? "Bezig..." : "Opslaan"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Annuleer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
