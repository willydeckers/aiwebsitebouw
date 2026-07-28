import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";

export type AutomatiseringStap = {
  id: string;
  stap: string;
  selector: string | null;
  resultaat: "ok" | "overgeslagen" | "mislukt" | "wacht_op_mens";
  detail: string | null;
  schermafbeelding_pad: string | null;
  timestamp: string;
};

export type ShopifyStore = {
  id: string;
  lead_id: string;
  shop_domein: string;
  store_naam: string | null;
  app_geinstalleerd: boolean;
  status: "aangemaakt" | "app_geinstalleerd" | "klaar" | "mislukt";
  fout_melding: string | null;
  toegang_scopes: string | null;
  aangemaakt_op: string;
};

/**
 * Queues the browser-automation job. The one-active-job-per-(lead,type) index
 * is what actually prevents a double run — the disabled button is only the
 * polite half of that.
 */
export async function startStoreAanmaak(leadId: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase
    .from("jobs")
    .insert({ lead_id: leadId, type: "shopify_store_aanmaak", status: "wachtrij" });

  if (error) {
    if (error.code === "23505") return "Er loopt al een store-aanmaakjob voor deze lead.";
    return `Kon job niet aanmaken: ${error.message}`;
  }
  await logAudit("shopify_store_aanmaak_gestart", leadId, {});
  return null;
}

/** Hands control back to the automation after a human cleared a challenge. */
export async function hervatStoreAanmaak(jobId: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase
    .from("jobs")
    .update({ status: "bezig", error_message: null })
    .eq("id", jobId)
    .eq("status", "wacht_op_mens");
  return error ? `Hervatten mislukt: ${error.message}` : null;
}

export async function annuleerStoreAanmaak(jobId: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("jobs").update({ status: "geannuleerd" }).eq("id", jobId);
  return error ? `Annuleren mislukt: ${error.message}` : null;
}

export async function fetchAutomatiseringLog(jobId: string): Promise<AutomatiseringStap[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("shopify_automatisering_log")
    .select("id, stap, selector, resultaat, detail, schermafbeelding_pad, timestamp")
    .eq("job_id", jobId)
    .order("timestamp", { ascending: true });
  return (data as AutomatiseringStap[] | null) ?? [];
}

export async function fetchShopifyStore(leadId: string): Promise<ShopifyStore | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("shopify_stores")
    .select("id, lead_id, shop_domein, store_naam, app_geinstalleerd, status, fout_melding, toegang_scopes, aangemaakt_op")
    .eq("lead_id", leadId)
    .maybeSingle();
  return (data as ShopifyStore | null) ?? null;
}

/** Marks the agency app as installed on this store, which is what unlocks
 *  programmatic token minting for it. */
export async function markeerAppGeinstalleerd(storeId: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase
    .from("shopify_stores")
    .update({ app_geinstalleerd: true, status: "app_geinstalleerd" })
    .eq("id", storeId);
  return error ? `Bijwerken mislukt: ${error.message}` : null;
}

/**
 * The live view is a single JPEG the worker overwrites a few times per second.
 * Downloading it (rather than linking a public URL) is the same reason the
 * demo previews do: Storage serves objects with a locked-down sandbox, and the
 * bucket shouldn't be public just to show a progress image.
 */
export async function fetchLiveFrame(jobId: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.storage.from("demos").download(`automatisering/${jobId}/live.jpg`);
  if (!data) return null;
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(data);
  });
}
