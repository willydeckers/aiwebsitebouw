"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
    });

    setPending(false);

    if (error) {
      setError("Ongeldige combinatie van e-mailadres en wachtwoord.");
      return;
    }

    router.replace("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-3xl border border-white/60 bg-white/70 p-8 shadow-xl shadow-blue-200/40 backdrop-blur-xl"
      >
        <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>

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
            autoCapitalize="off"
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm text-slate-600">
            Wachtwoord
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            spellCheck={false}
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-blue-300/50 transition hover:bg-blue-500 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Inloggen"}
        </button>

        <Link
          href="/wachtwoord-vergeten"
          className="block text-center text-sm text-blue-600 underline"
        >
          Wachtwoord vergeten?
        </Link>
      </form>
    </div>
  );
}
