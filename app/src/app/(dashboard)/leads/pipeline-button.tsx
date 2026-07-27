"use client";

import { useState, useTransition } from "react";
import { startResearch } from "./research-actions";
import { startGeneration } from "./generate-actions";
import { startReview } from "./review-actions";

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
  onChanged,
}: {
  leadId: string;
  alreadyResearched: boolean;
  alreadyGenerated: boolean;
  reviewHandled: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      if (!alreadyResearched) {
        setStep("Research loopt...");
        const researchError = await startResearch(leadId);
        if (researchError) {
          setError(researchError);
          setStep(null);
          return;
        }
        onChanged();
      }

      if (!alreadyGenerated) {
        setStep("Demo wordt gegenereerd...");
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

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || alreadyDone}
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
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
