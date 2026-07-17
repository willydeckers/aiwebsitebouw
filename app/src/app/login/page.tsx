"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(signIn, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-neutral-900">Dashboard</h1>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm text-neutral-600">
            E-mailadres
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm text-neutral-600">
            Wachtwoord
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Inloggen"}
        </button>
      </form>
    </div>
  );
}
