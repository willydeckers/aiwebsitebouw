"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { exchangeGmailCode } from "@/app/(dashboard)/voorkeuren/gmail-actions";

function GmailCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function run() {
      const code = searchParams.get("code");
      const oauthError = searchParams.get("error");

      if (oauthError) {
        setError(`Google gaf een fout terug: ${oauthError}`);
        return;
      }
      if (!code) {
        setError("Geen autorisatiecode ontvangen van Google.");
        return;
      }

      const redirectUri = `${window.location.origin}/gmail-callback`;
      const result = await exchangeGmailCode(code, redirectUri);
      if (result) setError(result);
      else setDone(true);
    }

    run();
  }, [searchParams]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.replace("/voorkeuren"), 1500);
    return () => clearTimeout(timer);
  }, [done, router]);

  return (
    <div className="w-full max-w-sm space-y-2 rounded-3xl border border-white/60 bg-white/70 p-8 text-center shadow-xl shadow-blue-200/40 backdrop-blur-xl">
      {error ? (
        <>
          <p className="text-sm text-red-600">{error}</p>
          <p className="text-sm text-slate-500">Ga terug naar Voorkeuren om opnieuw te koppelen.</p>
        </>
      ) : done ? (
        <p className="text-sm text-slate-700">Gmail gekoppeld. Je wordt teruggestuurd...</p>
      ) : (
        <p className="text-sm text-slate-500">Gmail koppelen...</p>
      )}
    </div>
  );
}

export default function GmailCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={<p className="text-sm text-slate-500">Laden...</p>}>
        <GmailCallbackContent />
      </Suspense>
    </div>
  );
}
