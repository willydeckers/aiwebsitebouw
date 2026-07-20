"use client";

import { useEffect, useState } from "react";
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
    <div className="relative">
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
        <div className="absolute right-0 z-10 mt-2 w-48 rounded-2xl border border-white/60 bg-white/90 p-3 text-sm shadow-lg shadow-blue-200/40 backdrop-blur-xl">
          <p className="truncate font-medium text-slate-800">{label}</p>
          <p className="truncate text-xs text-slate-500">{user.email}</p>
          <button
            type="button"
            onClick={startEditing}
            className="mt-2 w-full rounded-lg border border-blue-200 bg-white/70 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-blue-50"
          >
            Profiel bewerken
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-1 w-full rounded-lg border border-blue-200 bg-white/70 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-blue-50"
          >
            Uitloggen
          </button>
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
