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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4">
        <NavLinks />
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-neutral-200 px-6 py-3">
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            <span>{user.email}</span>
            <LogoutButton />
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
