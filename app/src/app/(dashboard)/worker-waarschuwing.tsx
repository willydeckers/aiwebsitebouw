"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchWorkerStatus, stilteLabel, type WorkerStatus } from "@/lib/worker-status";
import { herstartWorker, isDesktopApp } from "@/lib/desktop";

/**
 * Says, plainly, when nothing is processing jobs.
 *
 * Research, generatie, review and Shopify store creation all run in the
 * worker. If it isn't up, every one of those queues silently — which is how
 * three store-creation jobs went unnoticed from 1 August to 21 August. A
 * spinner that never resolves is worse than an error, because it looks like
 * progress.
 *
 * The way out differs per install. In the packaged app the worker is the app's
 * own child process, so the fix is a button; from a checkout it's a separate
 * terminal, so it's a command. Telling a desktop user to run `npx tsx` would be
 * advice they cannot act on.
 */
export function WorkerWaarschuwing() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const desktop = isDesktopApp();

  useEffect(() => {
    const supabase = createClient();
    const controleer = () => fetchWorkerStatus(supabase).then(setStatus);
    controleer();
    const timer = setInterval(controleer, 20_000);
    return () => clearInterval(timer);
  }, []);

  if (!status || status.draait) return null;

  async function starten() {
    setBezig(true);
    setMelding(null);
    try {
      const toestand = await herstartWorker();
      setMelding(
        toestand.draait
          ? "De worker is gestart — hij meldt zich binnen enkele seconden."
          : toestand.reden,
      );
    } catch (err) {
      setMelding(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">
        De worker draait niet — jobs blijven in de wachtrij staan
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Research, genereren, de review-loop en het aanmaken van een Shopify-winkel gebeuren allemaal
        in de worker. Laatste teken van leven: {stilteLabel(status)}.
      </p>

      {desktop ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={starten}
            disabled={bezig}
            className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {bezig ? "Bezig..." : "Worker starten"}
          </button>
          <Link href="/voorkeuren" className="text-xs text-amber-800 underline">
            Instellingen
          </Link>
        </div>
      ) : (
        <p className="mt-1 text-xs text-amber-800">
          Start hem met{" "}
          <code className="rounded bg-amber-100 px-1">npx tsx --env-file=.env src/index.ts</code> in
          de map <code className="rounded bg-amber-100 px-1">worker/</code>.
        </p>
      )}

      {melding ? <p className="mt-1 text-xs text-amber-900">{melding}</p> : null}
    </div>
  );
}
