"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Only a real sign-out sends you back to the login screen.
      //
      // This used to redirect on ANY null session, which is why the app
      // sometimes threw you out mid-click: onAuthStateChange also fires with
      // null for transient states — an INITIAL_SESSION before storage has been
      // read, or a token refresh that briefly has nothing in hand. Treating
      // those as "logged out" logged people out while they were using the app,
      // and again right after they logged back in.
      if (event === "SIGNED_OUT") {
        setSession(null);
        router.replace("/login");
        return;
      }
      if (newSession) setSession(newSession);
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
    <div
      className="flex min-h-screen gap-4 p-4"
      style={{ backgroundColor: "var(--ui-bg, transparent)" }}
    >
      <aside className="w-56 shrink-0 rounded-3xl border border-white/70 bg-white/50 p-4 shadow-lg shadow-blue-200/30 backdrop-blur-2xl backdrop-saturate-150">
        <Link
          href="/"
          className="mb-4 block rounded-xl px-2 py-1 text-sm font-semibold tracking-tight text-slate-800 transition hover:bg-white/60"
        >
          Web Agency
        </Link>
        <NavLinks />
      </aside>

      <div className="flex flex-1 flex-col gap-4">
        <header className="flex items-center justify-between rounded-full border border-white/70 bg-white/50 px-6 py-3 shadow-lg shadow-blue-200/30 backdrop-blur-2xl backdrop-saturate-150">
          <p className="text-sm font-medium text-slate-600">Dashboard</p>
          <ProfileBubble user={session.user} />
        </header>

        <main className="flex-1">
          <div className="mx-auto h-full max-w-6xl rounded-3xl border border-white/70 bg-white/55 p-6 shadow-lg shadow-blue-200/30 backdrop-blur-2xl backdrop-saturate-150">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
