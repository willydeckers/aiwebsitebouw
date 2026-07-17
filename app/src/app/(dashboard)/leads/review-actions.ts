"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runReviewLoop } from "@/lib/pipeline/review-loop";
import { calculateKostEur } from "@/lib/anthropic/pricing";
import type { Lead } from "@/lib/types";

const UNIQUE_VIOLATION = "23505";

export async function startReview(leadId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: leadRow, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !leadRow) {
    return `Lead niet gevonden: ${leadError?.message}`;
  }

  const lead = leadRow as Lead;

  if (!lead.demo_url) {
    return "Genereer eerst een demo — de review-stap heeft een demo_url nodig.";
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({ lead_id: leadId, type: "review", status: "running" })
    .select("id")
    .single();

  if (jobError) {
    if (jobError.code === UNIQUE_VIOLATION) {
      return "Er loopt al een actieve job voor deze lead.";
    }
    return `Kon job niet aanmaken: ${jobError.message}`;
  }

  try {
    const [{ data: stijlvoorkeuren }, { data: sectorKennis }] = await Promise.all([
      supabase.from("stijlvoorkeuren").select("regel, context"),
      supabase.from("sector_kennis").select("regel").eq("sector", lead.sector),
    ]);

    const result = await runReviewLoop(
      lead,
      lead.demo_url,
      stijlvoorkeuren ?? [],
      sectorKennis ?? [],
      async (html) => {
        const { error: uploadError } = await supabase.storage
          .from("demos")
          .upload(`${leadId}/index.html`, html, { contentType: "text/html", upsert: true });
        if (uploadError) {
          throw new Error(`Upload naar storage mislukt: ${uploadError.message}`);
        }
      },
    );

    for (const iteration of result.iterations) {
      if (iteration.generateUsage.tokensIn > 0) {
        await supabase.from("project_kosten").insert({
          lead_id: leadId,
          stap: "generatie",
          model: iteration.generateUsage.model,
          tokens_in: iteration.generateUsage.tokensIn,
          tokens_out: iteration.generateUsage.tokensOut,
          kost_eur: calculateKostEur(
            iteration.generateUsage.model,
            iteration.generateUsage.tokensIn,
            iteration.generateUsage.tokensOut,
          ),
        });
      }

      await supabase.from("project_kosten").insert({
        lead_id: leadId,
        stap: "review",
        model: iteration.reviewUsage.model,
        tokens_in: iteration.reviewUsage.tokensIn,
        tokens_out: iteration.reviewUsage.tokensOut,
        kost_eur: calculateKostEur(
          iteration.reviewUsage.model,
          iteration.reviewUsage.tokensIn,
          iteration.reviewUsage.tokensOut,
        ),
      });
    }

    const lastIteration = result.iterations[result.iterations.length - 1];
    await supabase
      .from("leads")
      .update({
        review_notitie: {
          goedgekeurd: result.approved,
          iteraties: result.iterations.length,
          feedback: lastIteration?.review.feedback ?? null,
          mist: lastIteration?.review.mist ?? [],
          klopt_niet: lastIteration?.review.klopt_niet ?? [],
        },
        status: result.approved ? "klaar" : "geblokkeerd",
      })
      .eq("id", leadId);

    await supabase
      .from("jobs")
      .update({ status: "done", afgerond_op: new Date().toISOString() })
      .eq("id", job.id);
  } catch (err) {
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : String(err),
        afgerond_op: new Date().toISOString(),
      })
      .eq("id", job.id);

    revalidatePath("/leads");
    return `Review mislukt: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/leads");
  return null;
}
