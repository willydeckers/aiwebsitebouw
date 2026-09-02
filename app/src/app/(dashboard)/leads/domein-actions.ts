import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import { describeFunctionError } from "@/lib/supabase/function-error";
import { controleerDomein, normaliseerDomein, type DomeinType } from "@/lib/pakketten";
import type { DomeinStatus, DomeinVerificatie } from "@/lib/types";

export type KoppelResultaat = {
  status: DomeinStatus | null;
  verificatie?: DomeinVerificatie | null;
  instructie?: string | null;
};

/**
 * Het domein wordt eerst opgeslagen en pas daarna aangevraagd. Dat is bewust
 * die volgorde: de Edge Function leest het uit `klanten`, en zo blijft er ook
 * na een mislukte aanvraag staan wát er geprobeerd is — anders is een fout
 * niet te reproduceren zonder alles opnieuw in te typen.
 */
export async function bewaarEnKoppelDomein(
  klantId: string,
  leadId: string,
  domeinType: DomeinType,
  domeinRuw: string,
): Promise<{ fout: string | null; resultaat?: KoppelResultaat }> {
  const fout = controleerDomein(domeinType, domeinRuw);
  if (fout) return { fout };

  const domein = normaliseerDomein(domeinRuw);
  const supabase = createClient();

  const { error: opslaanError } = await supabase
    .from("klanten")
    .update({ definitief_domein: domein, domein_type: domeinType, domein_status: "in_aanvraag" })
    .eq("id", klantId);

  if (opslaanError) {
    if (opslaanError.code === "23505") {
      return { fout: `Het domein ${domein} is al aan een andere klant gekoppeld.` };
    }
    return { fout: `Opslaan mislukt: ${opslaanError.message}` };
  }

  const { data, error } = await supabase.functions.invoke("domein-koppelen", {
    body: { klantId, actie: "koppel" },
  });

  if (error) {
    return { fout: `Koppelen mislukt: ${await describeFunctionError(error)}` };
  }

  await logAudit("domein_gekoppeld", leadId, { domein, type: domeinType });
  return { fout: null, resultaat: data as KoppelResultaat };
}

/** Cloudflare rondt de certificaataanvraag asynchroon af; dit haalt op waar ze staat. */
export async function ververDomeinStatus(klantId: string): Promise<{ fout: string | null; resultaat?: KoppelResultaat }> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("domein-koppelen", {
    body: { klantId, actie: "status" },
  });

  if (error) return { fout: `Status ophalen mislukt: ${await describeFunctionError(error)}` };
  return { fout: null, resultaat: data as KoppelResultaat };
}

export async function ontkoppelDomein(klantId: string, leadId: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.functions.invoke("domein-koppelen", {
    body: { klantId, actie: "ontkoppel" },
  });

  if (error) return `Ontkoppelen mislukt: ${await describeFunctionError(error)}`;

  await logAudit("domein_ontkoppeld", leadId, {});
  return null;
}
