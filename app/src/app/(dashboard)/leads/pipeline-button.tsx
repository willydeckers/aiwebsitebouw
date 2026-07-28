"use client";

import { useState, useTransition } from "react";
import { startResearch } from "./research-actions";
import { startGeneration } from "./generate-actions";
import { startReview } from "./review-actions";
import { formatteerDuur, type DuurSchattingen } from "@/lib/job-duur";

/**
 * Spec 3.1b→3.4: manual intake gets the same automatic
 * research → genereren → review-loop chain a sourced lead gets. This
 * replaces the three separate per-step test buttons with one trigger;
 * each step is skipped if it's already done, so retrying a lead that's
 * mid-pipeline doesn't re-run (and re-bill) completed steps.
 */
export function PipelineButton({
  leadId,
  alreadyResearched,
  alreadyGenerated,
  reviewHandled,
  duurSchattingen,
  geblokkeerd = false,
  onChanged,
}: {
  leadId: string;
  alreadyResearched: boolean;
  alreadyGenerated: boolean;
  reviewHandled: boolean;
  duurSchattingen: DuurSchattingen;
  /** Another job holds this lead — see lead-detail-panel. */
  geblokkeerd?: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      if (!alreadyResearched) {
        setStep(`Research loopt... (${formatteerDuur(duurSchattingen.research?.seconden ?? 80)})`);
        const researchError = await startResearch(leadId);
        if (researchError) {
          setError(researchError);
          setStep(null);
          return;
        }
        onChanged();
      }

      if (!alreadyGenerated) {
        setStep("Demo-job in de wachtrij zetten...");
        const generateError = await startGeneration(leadId);
        if (generateError) {
          setError(generateError);
          setStep(null);
          return;
        }
        onChanged();
      }

      if (!reviewHandled) {
        setStep("Review-job aanmaken...");
        const reviewError = await startReview(leadId);
        if (reviewError) {
          setError(reviewError);
          setStep(null);
          return;
        }
        onChanged();
      }

      setStep(null);
    });
  }

  const alreadyDone = alreadyResearched && alreadyGenerated && reviewHandled;

  // What's still to do, so the estimate on the button matches the steps this
  // click will actually run rather than the whole pipeline every time.
  const resterendeStappen = [
    alreadyResearched ? null : duurSchattingen.research,
    alreadyGenerated ? null : duurSchattingen.generatie,
    reviewHandled ? null : duurSchattingen.review,
  ].filter((s): s is NonNullable<typeof s> => !!s);
  const totaal = resterendeStappen.reduce((som, s) => som + s.seconden, 0);
  const gemeten = resterendeStappen.every((s) => s.gemeten);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || alreadyDone || geblokkeerd}
        title="Doorloopt research (3.2) → generatie (3.3) → review-loop (3.4) automatisch; slaat stappen over die al gebeurd zijn."
        className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-blue-300/50 transition hover:bg-blue-500 disabled:opacity-50"
      >
        {pending
          ? step ?? "Bezig..."
          : alreadyDone
            ? "Pipeline gestart — voortgang hierboven"
            : alreadyResearched || alreadyGenerated
              ? "Verder met pipeline"
              : "Start pipeline (research → demo → review)"}
      </button>
      {!alreadyDone && totaal > 0 ? (
        <p className="text-center text-xs text-slate-400">
          Duurt samen {formatteerDuur(totaal)}
          {gemeten ? "" : " (ruwe schatting)"} — je mag dit venster sluiten, de pipeline loopt door.
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
