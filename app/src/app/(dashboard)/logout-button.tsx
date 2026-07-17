"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-lg border border-blue-200 bg-white/70 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-blue-50"
    >
      Uitloggen
    </button>
  );
}
