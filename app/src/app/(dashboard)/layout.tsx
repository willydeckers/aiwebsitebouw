import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavLinks } from "./nav-links";
import { LogoutButton } from "./logout-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  // getSession() reads the local session cookie with no network round-trip.
  // proxy.ts already did the authoritative, network-validated getUser()
  // check for this exact request before it reached this layout — doing
  // that again here just doubles the Supabase Auth latency on every
  // navigation for no extra security.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const user = session.user;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-white/60 bg-white/50 p-4 backdrop-blur-xl">
        <NavLinks />
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-white/60 bg-white/40 px-6 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{user.email}</span>
            <LogoutButton />
          </div>
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
