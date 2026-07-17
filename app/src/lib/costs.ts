import type { SupabaseClient } from "@supabase/supabase-js";

export type CostSummary = {
  totalEur: number;
  byStap: Record<string, number>;
};

const DEMO_BUDGET_EUR = 5;

export function exceedsDemoBudget(summary: CostSummary): boolean {
  return summary.totalEur > DEMO_BUDGET_EUR;
}

export async function fetchCostSummary(
  supabase: SupabaseClient,
  leadId: string,
): Promise<CostSummary> {
  const { data } = await supabase
    .from("project_kosten")
    .select("stap, kost_eur")
    .eq("lead_id", leadId);

  const byStap: Record<string, number> = {};
  let totalEur = 0;

  for (const row of (data ?? []) as { stap: string; kost_eur: number }[]) {
    totalEur += row.kost_eur;
    byStap[row.stap] = (byStap[row.stap] ?? 0) + row.kost_eur;
  }

  return { totalEur, byStap };
}
