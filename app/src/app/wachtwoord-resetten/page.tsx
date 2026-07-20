"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function WachtwoordResettenPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // Supabase's client parses the recovery token from the URL fragment
    // automatically and fires this event once the recovery session is set.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirm = formData.get("confirm") as string;

    if (password !== confirm) {
      setError("Wachtwoorden komen niet overeen.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.replace("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-3xl border border-white/60 bg-white/70 p-8 shadow-xl shadow-blue-200/40 backdrop-blur-xl">
        <h1 className="text-lg font-semibold text-slate-900">Nieuw wachtwoord instellen</h1>

        {!ready ? (
          <p className="text-sm text-slate-500">Reset-link wordt gecontroleerd...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm text-slate-600">
                Nieuw wachtwoord
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirm" className="text-sm text-slate-600">
                Bevestig wachtwoord
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
              />
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-blue-300/50 transition hover:bg-blue-500 disabled:opacity-50"
            >
              {pending ? "Bezig..." : "Wachtwoord instellen"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
