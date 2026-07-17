"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchCostSummary, type CostSummary } from "@/lib/costs";

export async function getCostSummary(leadId: string): Promise<CostSummary> {
  const supabase = await createClient();
  return fetchCostSummary(supabase, leadId);
}
