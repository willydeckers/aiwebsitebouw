import { createClient } from "@/lib/supabase/client";

export type SourcingConfig = {
  id: string;
  nace_codes: string[];
  postcodes: string[];
  kwaliteitsdrempel_matig: boolean;
  run_frequentie: string | null;
  max_leads_per_run: number;
  laatst_uitgevoerd_op: string | null;
};

export async function fetchSourcingConfig(): Promise<SourcingConfig | null> {
  const supabase = createClient();
  const { data } = await supabase.from("sourcing_config").select("*").limit(1).maybeSingle();
  return data as SourcingConfig | null;
}

export async function saveSourcingConfig(
  config: Pick<SourcingConfig, "nace_codes" | "postcodes" | "kwaliteitsdrempel_matig" | "run_frequentie" | "max_leads_per_run"> & {
    id?: string;
  },
): Promise<string | null> {
  const supabase = createClient();

  if (config.id) {
    const { error } = await supabase
      .from("sourcing_config")
      .update({
        nace_codes: config.nace_codes,
        postcodes: config.postcodes,
        kwaliteitsdrempel_matig: config.kwaliteitsdrempel_matig,
        run_frequentie: config.run_frequentie,
        max_leads_per_run: config.max_leads_per_run,
      })
      .eq("id", config.id);
    return error ? `Opslaan mislukt: ${error.message}` : null;
  }

  const { error } = await supabase.from("sourcing_config").insert({
    nace_codes: config.nace_codes,
    postcodes: config.postcodes,
    kwaliteitsdrempel_matig: config.kwaliteitsdrempel_matig,
    run_frequentie: config.run_frequentie,
    max_leads_per_run: config.max_leads_per_run,
  });
  return error ? `Opslaan mislukt: ${error.message}` : null;
}

export async function startSourcingRun(): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("sourcing-run", { body: {} });

  if (error) return `Sourcing-run mislukt: ${error.message}`;
  if (data?.error) return data.error as string;

  return null;
}
