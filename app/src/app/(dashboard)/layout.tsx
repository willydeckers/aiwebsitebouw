"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { applyUiPreset, getStoredPresetId } from "@/lib/ui-preset";
import { NavLinks } from "./nav-links";
import { ProfileBubble } from "./profile-bubble";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) {
        router.replace("/login");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        router.replace("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    const presetId = getStoredPresetId();
    if (!presetId) return;

    const supabase = createClient();
    supabase
      .from("ui_presets")
      .select("achtergrondkleur, accentkleur")
      .eq("id", presetId)
      .maybeSingle()
      .then(({ data }) => applyUiPreset(data));
  }, []);

  if (session === "loading" || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Laden...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--ui-bg, transparent)" }}>
      <aside className="w-56 shrink-0 border-r border-white/60 bg-white/50 p-4 backdrop-blur-xl">
        <NavLinks />
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-white/60 bg-white/40 px-6 py-3 backdrop-blur-xl">
          <ProfileBubble user={session.user} />
        </header>

        <main className="flex-1 p-6">
          <div className="mx-auto max-w-6xl rounded-3xl border border-white/60 bg-white/60 p-6 shadow-lg shadow-blue-100/50 backdrop-blur-xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
