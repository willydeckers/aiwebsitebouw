import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import {
  controleerDomein,
  normaliseerDomein,
  pakketVan,
  type Betaalstatus,
  type DomeinType,
  type PakketType,
} from "@/lib/pakketten";
import type { Klant } from "@/lib/types";

export type ConversieKeuze = {
  pakket: PakketType;
  /** Verplicht zodra het pakket hosting bevat; null bij aankoop. */
  domeinType: DomeinType | null;
  domein: string;
  dealBedrag: string;
  betaalstatus: Betaalstatus;
  dealNotities: string;
};

/**
 * Spec section 3.7/2: statisch conversion is a plain DB write (no secret
 * needed). Shopify conversion enqueues a shopify_opbouw job — a "zware taak"
 * per spec section 2, processed by the separate hosted worker.
 *
 * That job used to be expected to create the development store itself. It
 * can't: the Partner API has no store-creation mutation (verified against the
 * live schema — see worker/src/shared/shopify-partner-client.ts). The store is
 * created by hand in the Partner Dashboard and its domain passed in here; the
 * job does everything after that point.
 *
 * Sinds 2026-09-01 legt deze stap ook vast WAT de klant afneemt (pakket,
 * domein, dealbedrag). Dat is het moment waarop die afspraak bestaat, dus het
 * is ook het moment om ze te noteren — achteraf reconstrueren lukt niet.
 */
export async function convertToKlant(
  leadId: string,
  type: "statisch" | "shopify",
  keuze: ConversieKeuze,
  shopifyDomain?: string,
): Promise<string | null> {
  const supabase = createClient();

  const pakket = pakketVan(keuze.pakket);
  if (!pakket) return "Kies een pakket.";

  let domein: string | null = null;
  if (pakket.hosting) {
    if (!keuze.domeinType) return "Kies waar de site komt te staan.";
    const fout = controleerDomein(keuze.domeinType, keuze.domein);
    if (fout) return fout;
    domein = normaliseerDomein(keuze.domein);
  }

  const bedragRuw = keuze.dealBedrag.trim().replace(",", ".");
  if (bedragRuw && !/^\d+(\.\d{1,2})?$/.test(bedragRuw)) {
    return "Het bedrag moet een getal zijn, bv. 1250 of 1250.00.";
  }

  // De afspraak zelf geldt voor beide soorten klanten; het domein niet. Bij
  // een Shopify-klant is `definitief_domein` het myshopify.com-adres, want
  // Shopify bedient die winkel zelf (track-and-serve weigert een shopify-klant
  // expliciet). Vandaar twee blokken in plaats van één met een uitzondering.
  const dealVelden = {
    pakket_type: keuze.pakket,
    wijzigingen_inbegrepen: pakket.wijzigingenPerPeriode,
    periode_gestart_op: pakket.hosting ? new Date().toISOString().slice(0, 10) : null,
    deal_bedrag: bedragRuw ? Number(bedragRuw) : null,
    betaalstatus: keuze.betaalstatus,
    deal_notities: keuze.dealNotities.trim() || null,
  };

  const domeinVelden = {
    definitief_domein: domein,
    domein_type: pakket.hosting ? keuze.domeinType : null,
  };

  if (type === "statisch") {
    const { error: klantError } = await supabase.from("klanten").insert({
      lead_id: leadId,
      type: "statisch",
      site_status: "Actief (statische demo als startpunt)",
      ...dealVelden,
      ...domeinVelden,
    });

    if (klantError) {
      // Het unieke-index-conflict is de enige die een mens zelf kan oplossen,
      // dus die verdient een echte uitleg in plaats van de Postgres-tekst.
      if (klantError.code === "23505" && klantError.message.includes("definitief_domein")) {
        return `Het domein ${domein} is al aan een andere klant gekoppeld.`;
      }
      return `Conversie mislukt: ${klantError.message}`;
    }

    const { error: leadError } = await supabase
      .from("leads")
      .update({ klant_type: "statisch", status: "klant" })
      .eq("id", leadId);

    if (leadError) {
      return `Conversie mislukt: ${leadError.message}`;
    }

    await logAudit("lead_geconverteerd", leadId, {
      type: "statisch",
      pakket: keuze.pakket,
      domein,
    });

    return null;
  }

  const shopDomein = shopifyDomain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!shopDomein || !/^[a-z0-9-]+\.myshopify\.com$/.test(shopDomein)) {
    return (
      "Vul het myshopify.com-domein in van de development store die je in het Partner Dashboard " +
      "hebt aangemaakt (bv. mijnwinkel.myshopify.com). Shopify biedt geen API om die store voor ons aan te maken."
    );
  }

  const { error: jobError } = await supabase.from("jobs").insert({
    lead_id: leadId,
    type: "shopify_opbouw",
    status: "wachtrij",
    // Enkel dealVelden: het domein wordt door de job zelf gezet, op het
    // myshopify-adres van de winkel die ze opbouwt.
    payload: { shopifyDomain: shopDomein, klantVelden: dealVelden },
  });

  if (jobError) {
    if (jobError.code === "23505") {
      return "Er loopt al een actieve job voor deze lead.";
    }
    return `Kon job niet aanmaken: ${jobError.message}`;
  }

  // Not "lead_geconverteerd" here — the shopify_opbouw job hasn't run yet,
  // this only enqueues it (worker/src/pipeline/shopify-build-job.ts does
  // the actual conversion once it picks the job up).
  await logAudit("lead_conversie_gestart", leadId, { type: "shopify", pakket: keuze.pakket });

  return null;
}

export async function updateKlantPakket(
  klantId: string,
  velden: {
    /** Een klant van bundel wisselen kon nergens na het promoveren — een
     *  afspraak die verandert, hoort geen nieuwe klant te vragen. */
    pakket_type?: PakketType;
    wijzigingen_inbegrepen: number | null;
    deal_bedrag: number | null;
    betaalstatus: Betaalstatus | null;
    deal_notities: string | null;
  },
) {
  const supabase = createClient();
  const { error } = await supabase.from("klanten").update(velden).eq("id", klantId);
  return error ? `Opslaan mislukt: ${error.message}` : null;
}

/**
 * Geen automatische cron: er is geen betaalcyclus in dit systeem om op te
 * reageren, dus de periode start wanneer jij zegt dat ze start.
 */
export async function startNieuwePeriode(klantId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("klanten")
    .update({ wijzigingen_gebruikt_periode: 0, periode_gestart_op: new Date().toISOString().slice(0, 10) })
    .eq("id", klantId);
  return error ? `Opslaan mislukt: ${error.message}` : null;
}

export async function fetchKlant(leadId: string): Promise<Klant | null> {
  const supabase = createClient();
  // limit(1): klanten.lead_id is niet uniek in het schema. Twee rijen zijn een
  // fout, maar maybeSingle() zou daarop gewoon niets tonen in plaats van één.
  const { data } = await supabase
    .from("klanten")
    .select("*")
    .eq("lead_id", leadId)
    .order("id")
    .limit(1)
    .maybeSingle();
  return (data as Klant) ?? null;
}
