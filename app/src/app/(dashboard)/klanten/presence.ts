"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The datamodel (spec section 6) ties gebruikers_profiel to a `gebruiker`
// enum ('warre'|'garen'), not to auth.users.id directly — same derivation
// used elsewhere in this app (profile-bubble.tsx, gmail-actions.ts, ...).
export function gebruikerFromEmail(email: string | undefined | null): "warre" | "garen" {
  return email?.toLowerCase().includes("garen") ? "garen" : "warre";
}

export const GEBRUIKER_COLORS: Record<"warre" | "garen", { dot: string; badge: string; label: string }> = {
  warre: { dot: "bg-blue-500", badge: "bg-blue-100 text-blue-700", label: "Warre" },
  garen: { dot: "bg-purple-500", badge: "bg-purple-100 text-purple-700", label: "Garen" },
};

export type PresenceEntry = { gebruiker: "warre" | "garen"; email: string; onlineAt: number };

// Single shared Realtime Presence channel for every open klanten-tab (list
// or detail), rather than one channel per klant — each session tracks which
// klant (if any) it currently has open, so the klanten-list can show a
// colored dot per row and the detail view can tell "am I the only one here"
// from the same live map. Presence key = email, so a user's most recent tab
// wins if they somehow have two open — an accepted simplification for a
// 2-account app.
export function useKlantenPresence(
  email: string | undefined | null,
  activeKlantId: string | null,
): Record<string, PresenceEntry[]> {
  const [presence, setPresence] = useState<Record<string, PresenceEntry[]>>({});

  useEffect(() => {
    if (!email) return;

    const supabase = createClient();
    const channel = supabase.channel("klanten-presence", {
      config: { presence: { key: email } },
    });
    const onlineAt = Date.now();

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{
        klantId: string | null;
        gebruiker: "warre" | "garen";
        onlineAt: number;
      }>();
      const byKlant: Record<string, PresenceEntry[]> = {};
      for (const key of Object.keys(state)) {
        for (const entry of state[key]) {
          if (!entry.klantId) continue;
          (byKlant[entry.klantId] ??= []).push({
            gebruiker: entry.gebruiker,
            email: key,
            onlineAt: entry.onlineAt,
          });
        }
      }
      setPresence(byKlant);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({ klantId: activeKlantId, gebruiker: gebruikerFromEmail(email), onlineAt });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [email, activeKlantId]);

  return presence;
}
