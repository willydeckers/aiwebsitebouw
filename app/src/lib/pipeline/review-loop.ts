import type { Lead } from "@/lib/types";
import { runGenerateDemo, type StijlVoorkeur, type SectorKennis, type GenerateUsage } from "./generate-demo";
import { reviewDemo, type ReviewResult, type ReviewUsage } from "./review";
import { takeScreenshot } from "./screenshot";

const MAX_ITERATIONS = 5;

export type ReviewLoopIteration = {
  html: string;
  generateUsage: GenerateUsage;
  review: ReviewResult;
  reviewUsage: ReviewUsage;
};

export type ReviewLoopResult = {
  approved: boolean;
  iterations: ReviewLoopIteration[];
};

/**
 * Runs the review loop against the demo already at `demoUrl` (spec section
 * 3.4). On rejection, regenerates the HTML with the review feedback folded
 * into the prompt and hands the (still-to-be-uploaded) HTML back to the
 * caller via `onRegenerated` so it can re-upload before the next screenshot.
 */
export async function runReviewLoop(
  lead: Lead,
  demoUrl: string,
  stijlvoorkeuren: StijlVoorkeur[],
  sectorKennis: SectorKennis[],
  onRegenerated: (html: string) => Promise<void>,
): Promise<ReviewLoopResult> {
  const iterations: ReviewLoopIteration[] = [];
  const zeroUsage: GenerateUsage = { model: "", tokensIn: 0, tokensOut: 0 };
  let currentHtml: string | null = null;
  let pendingGenerateUsage: GenerateUsage = zeroUsage;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (currentHtml) {
      await onRegenerated(currentHtml);
    }

    const screenshot = await takeScreenshot(demoUrl);
    const { result: review, usage: reviewUsage } = await reviewDemo(
      screenshot,
      lead,
      stijlvoorkeuren,
    );

    iterations.push({
      html: currentHtml ?? "",
      generateUsage: pendingGenerateUsage,
      review,
      reviewUsage,
    });

    if (review.goedgekeurd) {
      return { approved: true, iterations };
    }

    if (i === MAX_ITERATIONS - 1) {
      return { approved: false, iterations };
    }

    const feedback = [
      review.feedback,
      review.mist.length > 0 ? `Ontbreekt: ${review.mist.join("; ")}` : null,
      review.klopt_niet.length > 0 ? `Klopt niet: ${review.klopt_niet.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const { html, usage: generateUsage } = await runGenerateDemo(
      lead,
      stijlvoorkeuren,
      sectorKennis,
      feedback,
    );

    currentHtml = html;
    pendingGenerateUsage = generateUsage;
  }

  return { approved: false, iterations };
}
