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
  const [profiel, setProfiel] = useState<Profiel | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const gebruiker = gebruikerFromEmail(user.email);

    supabase
      .from("gebruikers_profiel")
      .select("naam, profielfoto_url")
      .eq("gebruiker", gebruiker)
      .maybeSingle()
      .then(({ data }) => setProfiel(data));
  }, [user.email]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
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

      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-48 rounded-2xl border border-white/60 bg-white/90 p-3 text-sm shadow-lg shadow-blue-200/40 backdrop-blur-xl">
          <p className="truncate font-medium text-slate-800">{label}</p>
          <p className="truncate text-xs text-slate-500">{user.email}</p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 w-full rounded-lg border border-blue-200 bg-white/70 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-blue-50"
          >
            Uitloggen
          </button>
        </div>
      ) : null}
    </div>
  );
}
