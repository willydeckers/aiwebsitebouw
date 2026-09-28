"use client";

import { useEffect, useState, useTransition } from "react";
import {
  BETAALSTATUSSEN,
  BUREAU_DOMEIN,
  DOMEIN_TYPES,
  PAKKETTEN,
  pakketVan,
  type Betaalstatus,
  type DomeinType,
  type PakketType,
} from "@/lib/pakketten";
import type { Klant } from "@/lib/types";
import { fetchKlant, startNieuwePeriode, updateKlantPakket } from "./convert-actions";
import { bewaarEnKoppelDomein, ontkoppelDomein, ververDomeinStatus } from "./domein-actions";
import { exporteerSite } from "./export-actions";

const STATUS_KLEUR: Record<string, string> = {
  actief: "bg-green-50 text-green-700",
  in_aanvraag: "bg-amber-50 text-amber-700",
  mislukt: "bg-red-50 text-red-700",
};

const STATUS_LABEL: Record<string, string> = {
  actief: "Actief",
  in_aanvraag: "In aanvraag",
  mislukt: "Mislukt",
};

const veld =
  "w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none " +
  "focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-60";

/**
 * Wat er met deze klant is afgesproken, en waar zijn site staat. Twee blokken
 * in één component omdat ze dezelfde rij uit `klanten` lezen: twee losse
 * componenten zouden hem twee keer ophalen en na een wijziging uit elkaar
 * lopen — dan toont het ene blok een domein dat het andere net heeft gewist.
 *
 * Er wordt niets afgedwongen. De teller "wijzigingen gebruikt" toont wat er
 * verbruikt is; hij blokkeert geen zesde chat-edit. Dat past bij de rest van
 * deze app (overal mens-in-de-lus) en bij hoe deze afspraken echt lopen — een
 * klant die één keer over zijn bundel gaat, is een gesprek, geen foutmelding.
 */
export function KlantPanel({
  leadId,
  bedrijfsnaam,
  klantType,
  standaardOpen = false,
  vernieuw,
}: {
  leadId: string;
  bedrijfsnaam: string;
  klantType: "statisch" | "shopify" | null;
  /** In de werkruimte is dit het blok waarvoor je bij een klant komt. */
  standaardOpen?: boolean;
  /** Verandert deze waarde, dan wordt de klant opnieuw opgehaald — zodat de
   *  teller "X van Y" meeloopt na een chat-edit, die hem serverside ophoogt. */
  vernieuw?: string | null;
}) {
  const [open, setOpen] = useState(standaardOpen);
  const [klant, setKlant] = useState<Klant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [pakketType, setPakketType] = useState<PakketType | "">("");
  const [inbegrepen, setInbegrepen] = useState("");
  const [bedrag, setBedrag] = useState("");
  const [betaalstatus, setBetaalstatus] = useState<Betaalstatus | "">("");
  const [notities, setNotities] = useState("");

  const [domeinType, setDomeinType] = useState<DomeinType>("bureau_subdomein");
  const [domein, setDomein] = useState("");

  function vul(k: Klant | null) {
    setKlant(k);
    setPakketType(k?.pakket_type ?? "");
    setInbegrepen(k?.wijzigingen_inbegrepen == null ? "" : String(k.wijzigingen_inbegrepen));
    setBedrag(k?.deal_bedrag == null ? "" : String(k.deal_bedrag));
    setBetaalstatus(k?.betaalstatus ?? "");
    setNotities(k?.deal_notities ?? "");
    setDomein(k?.definitief_domein ?? "");
    if (k?.domein_type) setDomeinType(k.domein_type);
  }

  function herlaad() {
    startTransition(async () => vul(await fetchKlant(leadId)));
  }

  useEffect(() => {
    if (open) herlaad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId, vernieuw]);

  function doe(actie: () => Promise<string | null>) {
    setError(null);
    setMelding(null);
    startTransition(async () => {
      const fout = await actie();
      if (fout) setError(fout);
      else herlaad();
    });
  }

  if (!klantType) return null;

  // Wat er op het scherm staat, ook vóór Bewaren — anders toont het blok nog de
  // oude bundel terwijl je net een andere koos.
  const pakket = pakketVan(pakketType || klant?.pakket_type);
  const gebruikt = klant?.wijzigingen_gebruikt_periode ?? 0;
  const limiet = klant?.wijzigingen_inbegrepen;
  const overschreden = limiet != null && gebruikt > limiet;

  return (
    <section className="mt-6 space-y-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-blue-100 px-3 py-2 text-left font-medium text-slate-700 hover:bg-blue-50"
      >
        <span>
          Pakket &amp; domein
          {klant?.domein_status ? (
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                STATUS_KLEUR[klant.domein_status] ?? "bg-slate-100 text-slate-500"
              }`}
            >
              {STATUS_LABEL[klant.domein_status] ?? klant.domein_status}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-slate-400">{open ? "verbergen" : "tonen"}</span>
      </button>

      {!open ? null : (
        <div className="space-y-5 rounded-xl border border-blue-100 p-3">
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          {melding ? <p className="text-xs text-slate-600">{melding}</p> : null}

          {!klant ? (
            <p className="text-xs text-slate-400">
              {pending ? "Laden..." : "Geen klantgegevens gevonden voor deze lead."}
            </p>
          ) : (
            <>
              {/* ── Pakket & verkoop ──────────────────────────────────── */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Pakket &amp; verkoop
                </h4>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500">Pakket</span>
                  <select
                    aria-label="Pakket"
                    value={pakketType}
                    onChange={(e) => {
                      const nieuw = e.target.value as PakketType | "";
                      setPakketType(nieuw);
                      // Een andere bundel heeft een ander aantal wijzigingen. Vul
                      // de standaard in; wie iets anders afsprak, past het aan
                      // vóór Bewaren.
                      const standaard = pakketVan(nieuw)?.wijzigingenPerPeriode;
                      setInbegrepen(standaard == null ? "" : String(standaard));
                    }}
                    className={veld}
                  >
                    {!klant.pakket_type ? <option value="">Geen pakket vastgelegd</option> : null}
                    {PAKKETTEN.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {pakket ? <span className="block text-xs text-slate-500">{pakket.korte_uitleg}</span> : null}
                  {pakketType && pakketType !== klant.pakket_type ? (
                    <span className="block text-xs text-amber-700">Nog niet bewaard.</span>
                  ) : null}
                </label>

                {pakket?.hosting ? (
                  <p className="text-xs text-slate-600">
                    Wijzigingen deze periode:{" "}
                    <span className={overschreden ? "font-semibold text-amber-700" : "font-medium text-slate-800"}>
                      {gebruikt}
                      {limiet == null ? "" : ` van ${limiet}`}
                    </span>
                    {klant.periode_gestart_op
                      ? ` — periode gestart op ${new Date(klant.periode_gestart_op).toLocaleDateString("nl-BE")}`
                      : null}
                    {overschreden ? " (boven de bundel — apart aan te rekenen)" : null}
                  </p>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs text-slate-500">Wijzigingen inbegrepen (leeg = onbeperkt)</span>
                    <input
                      value={inbegrepen}
                      onChange={(e) => setInbegrepen(e.target.value)}
                      inputMode="numeric"
                      className={veld}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-slate-500">Dealbedrag (EUR)</span>
                    <input
                      value={bedrag}
                      onChange={(e) => setBedrag(e.target.value)}
                      inputMode="decimal"
                      className={veld}
                    />
                  </label>
                </div>

                <label className="space-y-1 block">
                  <span className="text-xs text-slate-500">Betaalstatus</span>
                  <select
                    value={betaalstatus}
                    onChange={(e) => setBetaalstatus(e.target.value as Betaalstatus | "")}
                    className={veld}
                  >
                    <option value="">Niet ingevuld</option>
                    {BETAALSTATUSSEN.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-xs text-slate-500">Notities bij de deal</span>
                  <textarea
                    value={notities}
                    onChange={(e) => setNotities(e.target.value)}
                    rows={2}
                    className={veld}
                  />
                </label>

                <div className="flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      doe(async () => {
                        const getal = inbegrepen.trim();
                        if (getal && !/^\d+$/.test(getal)) return "Wijzigingen inbegrepen moet een heel getal zijn.";
                        const bedragRuw = bedrag.trim().replace(",", ".");
                        if (bedragRuw && !/^\d+(\.\d{1,2})?$/.test(bedragRuw)) {
                          return "Het bedrag moet een getal zijn, bv. 1250 of 1250.00.";
                        }
                        return updateKlantPakket(klant.id, {
                          ...(pakketType ? { pakket_type: pakketType } : {}),
                          wijzigingen_inbegrepen: getal ? Number(getal) : null,
                          deal_bedrag: bedragRuw ? Number(bedragRuw) : null,
                          betaalstatus: betaalstatus || null,
                          deal_notities: notities.trim() || null,
                        });
                      })
                    }
                    className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Bewaren
                  </button>

                  {pakket?.hosting ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => doe(() => startNieuwePeriode(klant.id))}
                      className="text-slate-500 hover:underline disabled:opacity-50"
                      title="Zet de teller op 0 en start de periode vandaag. Er is geen betaalcyclus die dit automatisch doet."
                    >
                      Nieuwe periode starten
                    </button>
                  ) : null}
                </div>
              </div>

              {/* ── Domein ────────────────────────────────────────────── */}
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Domein</h4>

                {klantType === "shopify" ? (
                  <p className="text-xs text-slate-500">
                    Shopify bedient zijn eigen winkeldomein — deze hostinglaag wordt daar niet voor gebruikt.
                  </p>
                ) : (
                  <>
                    <label className="space-y-1 block">
                      <span className="text-xs text-slate-500">Waar komt de site te staan</span>
                      <select
                        value={domeinType}
                        onChange={(e) => setDomeinType(e.target.value as DomeinType)}
                        className={veld}
                      >
                        {DOMEIN_TYPES.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <span className="block text-xs text-slate-400">
                        {DOMEIN_TYPES.find((t) => t.id === domeinType)?.uitleg}
                      </span>
                    </label>

                    <label className="space-y-1 block">
                      <span className="text-xs text-slate-500">Domein</span>
                      <input
                        value={domein}
                        onChange={(e) => setDomein(e.target.value)}
                        placeholder={
                          domeinType === "bureau_subdomein" ? `naam.${BUREAU_DOMEIN}` : "klantnaam.be"
                        }
                        className={veld}
                      />
                    </label>

                    {klant.domein_verificatie ? (
                      <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                        <p className="font-medium text-slate-700">Door te geven aan de klant:</p>
                        <p className="mt-1 font-mono">
                          CNAME {klant.domein_verificatie.cname_naam} → {klant.domein_verificatie.cname_waarde}
                        </p>
                        {klant.domein_verificatie.ssl_status ? (
                          <p className="mt-1">Certificaat: {klant.domein_verificatie.ssl_status}</p>
                        ) : null}
                        {klant.domein_verificatie.fout ? (
                          <p className="mt-1 text-amber-700">{klant.domein_verificatie.fout}</p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-3 text-xs">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          doe(async () => {
                            const { fout, resultaat } = await bewaarEnKoppelDomein(
                              klant.id,
                              leadId,
                              domeinType,
                              domein,
                            );
                            if (!fout && resultaat?.instructie) setMelding(resultaat.instructie);
                            return fout;
                          })
                        }
                        className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {klant.definitief_domein ? "Opnieuw koppelen" : "Koppelen"}
                      </button>

                      {klant.cloudflare_hostname_id ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            doe(async () => {
                              const { fout, resultaat } = await ververDomeinStatus(klant.id);
                              if (!fout && resultaat?.instructie) setMelding(resultaat.instructie);
                              return fout;
                            })
                          }
                          className="text-slate-500 hover:underline disabled:opacity-50"
                        >
                          Status verversen
                        </button>
                      ) : null}

                      {klant.definitief_domein ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => doe(() => ontkoppelDomein(klant.id, leadId))}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          Ontkoppelen
                        </button>
                      ) : null}
                    </div>

                    <p className="text-xs text-slate-400">
                      Een nieuwe versie activeren is meteen zichtbaar op het domein — de hostinglaag leest altijd
                      de versie die op dat moment actief staat, er is geen aparte publicatiestap.
                    </p>
                  </>
                )}
              </div>

              {/* ── Export bij aankoop ────────────────────────────────── */}
              {klant.pakket_type === "aankoop" ? (
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Site overdragen
                  </h4>
                  <p className="text-xs text-slate-600">
                    Levert alle pagina&apos;s en geüploade bestanden als zip. De formulieren, reviews en
                    afgeschermde pagina&apos;s draaien op onze server en werken daarna <strong>niet</strong> meer —
                    de zip bevat een LEESMIJ die dat voor de nieuwe hoster uitlegt.
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      doe(() =>
                        exporteerSite(
                          leadId,
                          bedrijfsnaam,
                          klant.definitief_domein ? `https://${klant.definitief_domein}` : null,
                        ),
                      )
                    }
                    className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  >
                    Site exporteren (.zip)
                  </button>
                  {!klant.definitief_domein ? (
                    <p className="text-xs text-slate-400">
                      Vul hierboven het definitieve domein in vóór je exporteert — dan kloppen de canonical-tags
                      en de sitemap meteen. Zonder domein worden die weggelaten in plaats van fout ingevuld.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}
