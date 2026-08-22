"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchWorkerStatus, stilteLabel, type WorkerStatus } from "@/lib/worker-status";

/**
 * Says, plainly, when nothing is processing jobs.
 *
 * Research, generatie, review and Shopify store creation all run in the
 * worker. If it isn't up, every one of those queues silently — which is how
 * three store-creation jobs went unnoticed from 1 August to 21 August. A
 * spinner that never resolves is worse than an error, because it looks like
 * progress.
 */
export function WorkerWaarschuwing() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const controleer = () => fetchWorkerStatus(supabase).then(setStatus);
    controleer();
    const timer = setInterval(controleer, 20_000);
    return () => clearInterval(timer);
  }, []);

  if (!status || status.draait) return null;

  return (
    <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">
        De worker draait niet — jobs blijven in de wachtrij staan
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Research, genereren, de review-loop en het aanmaken van een Shopify-winkel gebeuren allemaal
        in de worker. Laatste teken van leven: {stilteLabel(status)}. Start hem met{" "}
        <code className="rounded bg-amber-100 px-1">npx tsx --env-file=.env src/index.ts</code> in de
        map <code className="rounded bg-amber-100 px-1">worker/</code>.
      </p>
    </div>
  );
}
