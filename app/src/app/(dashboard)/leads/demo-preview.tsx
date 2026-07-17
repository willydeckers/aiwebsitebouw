"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Lead } from "@/lib/types";
import { startGeneration } from "./generate-actions";

type Viewport = "desktop" | "mobiel";

const VIEWPORT_WIDTH: Record<Viewport, string> = {
  desktop: "100%",
  mobiel: "375px",
};

export function DemoPreview({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [extraInstructies, setExtraInstructies] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const result = await startGeneration(lead.id, extraInstructies || undefined);
      if (result) {
        setError(result);
      } else {
        setExtraInstructies("");
        router.refresh();
      }
    });
  }

  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-700">Demo-preview</h3>
        <div className="flex gap-1 text-xs">
          {(["desktop", "mobiel"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setViewport(v)}
              className={`rounded-md px-2 py-1 font-medium ${
                viewport === v
                  ? "bg-neutral-900 text-white"
                  : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {v === "desktop" ? "Desktop" : "Mobiel"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
        <iframe
          src={lead.demo_url ?? undefined}
          title="Demo-preview"
          className="h-[500px] bg-white transition-[width]"
          style={{ width: VIEWPORT_WIDTH[viewport] }}
        />
      </div>

      {lead.review_notitie ? (
        <div className="space-y-1 text-sm">
          <h4 className="font-medium text-neutral-700">Review-notities (3.4)</h4>
          <p className="text-neutral-600">
            {lead.review_notitie.goedgekeurd ? "Goedgekeurd" : "Niet goedgekeurd"} na{" "}
            {lead.review_notitie.iteraties} iteratie
            {lead.review_notitie.iteraties === 1 ? "" : "s"}
          </p>
          {lead.review_notitie.feedback ? (
            <p className="text-neutral-600">{lead.review_notitie.feedback}</p>
          ) : null}
          {lead.review_notitie.mist.length > 0 ? (
            <p className="text-neutral-600">Ontbreekt: {lead.review_notitie.mist.join("; ")}</p>
          ) : null}
          {lead.review_notitie.klopt_niet.length > 0 ? (
            <p className="text-neutral-600">
              Klopt niet: {lead.review_notitie.klopt_niet.join("; ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="chatbox" className="text-xs font-medium text-neutral-500">
          Chat-based bewerken
        </label>
        <textarea
          id="chatbox"
          disabled
          placeholder="Wordt gebouwd in build stap 8 (spec sectie 3.5) — gerichte patch-edits i.p.v. volledige herschrijving."
          rows={2}
          className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="extra-instructies" className="text-xs font-medium text-neutral-500">
          Opnieuw genereren met extra instructies
        </label>
        <textarea
          id="extra-instructies"
          value={extraInstructies}
          onChange={(e) => setExtraInstructies(e.target.value)}
          rows={2}
          placeholder="bv. gebruik een lichtere achtergrondkleur"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={pending}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Opnieuw genereren met extra instructies"}
        </button>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>

      <button
        type="button"
        disabled
        title="Wordt gebouwd in build stap 9 (spec sectie 3.6)."
        className="w-full rounded-md bg-neutral-200 px-3 py-2 text-sm font-medium text-neutral-500"
      >
        Verstuur naar lead
      </button>
    </section>
  );
}
