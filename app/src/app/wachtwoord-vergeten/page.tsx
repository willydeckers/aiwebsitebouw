"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function WachtwoordVergetenPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const email = new FormData(e.currentTarget).get("email") as string;
    const supabase = createClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/wachtwoord-resetten`,
    });

    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-3xl border border-white/60 bg-white/70 p-8 shadow-xl shadow-blue-200/40 backdrop-blur-xl">
        <h1 className="text-lg font-semibold text-slate-900">Wachtwoord vergeten</h1>

        {sent ? (
          <p className="text-sm text-slate-600">
            Als dat e-mailadres bij ons bekend is, is er een reset-link naartoe gestuurd.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="text-sm text-slate-600">
                E-mailadres
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                spellCheck={false}
                autoCorrect="off"
                className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
              />
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-blue-300/50 transition hover:bg-blue-500 disabled:opacity-50"
            >
              {pending ? "Bezig..." : "Verstuur reset-link"}
            </button>
          </form>
        )}

        <Link href="/login" className="block text-center text-sm text-blue-600 underline">
          Terug naar inloggen
        </Link>
      </div>
    </div>
  );
}
