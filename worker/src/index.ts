import { createWorkerClient } from "./shared/supabase.js";
import { controleerOmgeving } from "./shared/omgeving.js";
import { processGenerateJob } from "./pipeline/generate-job.js";
import { processResearchJob } from "./pipeline/research-job.js";
import { processShopifyStoreAanmaakJob } from "./shopify/store-aanmaak-job.js";
import { processReviewJob } from "./pipeline/review-job.js";
import { processShopifyBuildJob } from "./pipeline/shopify-build-job.js";

const POLL_INTERVAL_MS = 5000;
// Spec section 6: "bezig->timeout" is a job stuck longer than this without
// finishing — handled as a hard cap here rather than a separate watchdog
// process, since this worker processes one job at a time anyway.
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

const HARTSLAG_MS = 15_000;

// Refuses to start on a missing core variable, and reports which job types
// can't be handled with what's configured.
const { onbruikbareTypes } = controleerOmgeving();

const supabase = createWorkerClient();

/**
 * Says "I am alive" every few seconds so the dashboard can tell a busy queue
 * apart from a dead one. Three store-creation jobs sat queued for three weeks
 * because nothing distinguished those two states.
 */
async function hartslag(huidigeJobId: string | null) {
  const { error } = await supabase
    .from("worker_status")
    .update({ laatste_hartslag: new Date().toISOString(), huidige_job_id: huidigeJobId })
    .eq("id", true);
  if (error) console.error("Kon hartslag niet schrijven:", error.message);
}

/**
 * A job this worker is not configured for must fail loudly rather than sit in
 * the queue. Leaving it there looks identical to "busy", which is exactly how
 * the Shopify jobs stayed invisible.
 */
async function weigerOnbruikbaar(job: { id: string; type: string }) {
  const uitleg =
    `Deze worker mist de omgevingsvariabelen voor '${job.type}'. Vul ze aan in worker/.env ` +
    "en herstart de worker; zie de waarschuwing bij het opstarten voor welke.";
  await supabase.from("jobs").update({ status: "bezig" }).eq("id", job.id);
  await supabase
    .from("jobs")
    .update({ status: "mislukt", error_message: uitleg, afgerond_op: new Date().toISOString() })
    .eq("id", job.id);
  console.error(`Job ${job.id} (${job.type}) geweigerd: ${uitleg}`);
}

async function claimNextJob() {
  const { data: candidates, error } = await supabase
    .from("jobs")
    .select("id, lead_id, type")
    .eq("status", "wachtrij")
    .in("type", ["research", "generatie", "review", "shopify_opbouw", "shopify_store_aanmaak"])
    .order("aangemaakt_op", { ascending: true })
    .limit(1);

  if (error) {
    console.error("Kon jobs niet ophalen:", error.message);
    return null;
  }
  const candidate = candidates?.[0];
  if (!candidate) return null;

  // Claim atomically: only succeeds if still 'wachtrij' (guards against a
  // second worker instance grabbing the same row between select and update).
  const { data: claimed, error: claimError } = await supabase
    .from("jobs")
    .update({ status: "bezig", gestart_op: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "wachtrij")
    .select("id, lead_id, type, pogingen, payload")
    .maybeSingle();

  if (claimError || !claimed) return null;
  return claimed;
}

async function runJob(job: {
  id: string;
  lead_id: string | null;
  type: string;
  pogingen: number;
  payload: { extraContext?: string; shopifyDomain?: string } | null;
}) {
  // A job parked on 'wacht_op_mens' is not hung — someone is being asked to
  // solve a CAPTCHA. Timing it out from under them would be exactly wrong, so
  // this checks the current status before declaring a timeout.
  const timeout = setTimeout(async () => {
    const { data } = await supabase.from("jobs").select("status").eq("id", job.id).maybeSingle();
    if (data?.status === "bezig") {
      await supabase.from("jobs").update({ status: "timeout" }).eq("id", job.id);
    }
  }, JOB_TIMEOUT_MS);

  try {
    await supabase.from("jobs").update({ pogingen: job.pogingen + 1 }).eq("id", job.id);

    if (!job.lead_id) throw new Error(`Job ${job.id} (${job.type}) heeft geen lead_id.`);

    if (job.type === "research") {
      await processResearchJob(supabase, job.id, job.lead_id);
    } else if (job.type === "generatie") {
      await processGenerateJob(supabase, job.id, job.lead_id, job.payload);
    } else if (job.type === "review") {
      await processReviewJob(supabase, job.id, job.lead_id);
    } else if (job.type === "shopify_store_aanmaak") {
      await processShopifyStoreAanmaakJob(supabase, job.id, job.lead_id);
    } else if (job.type === "shopify_opbouw") {
      await processShopifyBuildJob(supabase, job.id, job.lead_id, job.payload);
    } else {
      throw new Error(`Onbekend job-type voor deze worker: ${job.type}`);
    }

    clearTimeout(timeout);
    await supabase.from("jobs").update({ status: "klaar" }).eq("id", job.id);
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Job ${job.id} (${job.type}) mislukt:`, message);
    await supabase.from("jobs").update({ status: "mislukt", error_message: message }).eq("id", job.id);
  }
}

async function pollLoop() {
  await hartslag(null);
  const job = await claimNextJob();
  if (job) {
    if (onbruikbareTypes.has(job.type)) {
      await weigerOnbruikbaar(job);
    } else {
      await hartslag(job.id);
      await runJob(job);
    }
    setImmediate(pollLoop);
  } else {
    setTimeout(pollLoop, POLL_INTERVAL_MS);
  }
}

// The poll loop only beats when it comes round; a long job would otherwise
// look like a dead worker halfway through.
setInterval(() => {
  void hartslag(null).catch(() => {});
}, HARTSLAG_MS);

void supabase
  .from("worker_status")
  .update({ gestart_op: new Date().toISOString(), laatste_hartslag: new Date().toISOString() })
  .eq("id", true);

console.log(
  "Worker gestart — pollt jobs (research, generatie, review, shopify_opbouw, " +
    "shopify_store_aanmaak) elke 5s.",
);
pollLoop();
