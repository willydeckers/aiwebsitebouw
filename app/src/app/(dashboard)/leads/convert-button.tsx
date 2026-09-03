"use client";

import { useState, useTransition } from "react";
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
import { convertToKlant } from "./convert-actions";

const VELD =
  "w-full rounded-xl border border-blue-200 bg-white/80 px-2 py-1 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200";

export function ConvertButton({
  leadId,
  bedrijfsnaam,
  onChanged,
}: {
  leadId: string;
  bedrijfsnaam: string;
  onChanged: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [pakket, setPakket] = useState<PakketType>("bundel_1");
  const [domeinType, setDomeinType] = useState<DomeinType>("bureau_subdomein");
  const [domein, setDomein] = useState("");
  const [dealBedrag, setDealBedrag] = useState("");
  const [betaalstatus, setBetaalstatus] = useState<Betaalstatus>("voorgesteld");
  const [dealNotities, setDealNotities] = useState("");
  const [shopifyDomein, setShopifyDomein] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const gekozenPakket = pakketVan(pakket)!;

  function suggestieSubdomein() {
    const label = bedrijfsnaam
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return label ? `${label}.${BUREAU_DOMEIN}` : "";
  }

  function handleChoose(type: "statisch" | "shopify") {
    setError(null);
    startTransition(async () => {
      const result = await convertToKlant(
        leadId,
        type,
        {
          pakket,
          domeinType: gekozenPakket.hosting ? domeinType : null,
          domein,
          dealBedrag,
          betaalstatus,
          dealNotities,
        },
        shopifyDomein,
      );
      if (result) {
        setError(result);
      } else {
        setChoosing(false);
        onChanged();
      }
    });
  }

  if (!choosing) {
    return (
      <button
        type="button"
        onClick={() => setChoosing(true)}
        className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50"
      >
        Markeer als klant
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
      <p className="text-xs text-slate-500">
        Leg de afspraak vast — dit kan later niet meer ongedaan gemaakt worden:
      </p>

      <div className="space-y-1">
        <label htmlFor="convert-pakket" className="text-xs font-medium text-slate-700">
          Pakket
        </label>
        <select
          id="convert-pakket"
          value={pakket}
          onChange={(e) => setPakket(e.target.value as PakketType)}
          className={VELD}
        >
          {PAKKETTEN.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] leading-snug text-slate-500">{gekozenPakket.korte_uitleg}</p>
      </div>

      {gekozenPakket.hosting ? (
        <div className="space-y-1">
          <label htmlFor="convert-domein-type" className="text-xs font-medium text-slate-700">
            Waar komt de site te staan
          </label>
          <select
            id="convert-domein-type"
            value={domeinType}
            onChange={(e) => setDomeinType(e.target.value as DomeinType)}
            className={VELD}
          >
            {DOMEIN_TYPES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <input
              value={domein}
              onChange={(e) => setDomein(e.target.value)}
              placeholder={domeinType === "bureau_subdomein" ? suggestieSubdomein() : "florian-hasselt.be"}
              className={VELD}
            />
            {domeinType === "bureau_subdomein" && !domein ? (
              <button
                type="button"
                onClick={() => setDomein(suggestieSubdomein())}
                className="shrink-0 rounded-xl border border-blue-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-blue-50"
              >
                Vul in
              </button>
            ) : null}
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            {DOMEIN_TYPES.find((d) => d.id === domeinType)!.uitleg}
          </p>
          <p className="text-[11px] leading-snug text-amber-700">
            Let op: het domein wordt hier enkel vastgelegd. De DNS en het certificaat moeten nog
            manueel opgezet worden — zolang dat niet gebeurd is, werkt dit adres nog niet.
          </p>
        </div>
      ) : (
        <p className="text-[11px] leading-snug text-amber-700">
          Bij aankoop hosten wij niet. De formulieren, reviews, downloads en beveiligde pagina&apos;s
          draaien op onze backend en werken dus niet meer na de overdracht — enkel de statische
          pagina&apos;s gaan mee.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor="convert-bedrag" className="text-xs font-medium text-slate-700">
            Bedrag (€)
          </label>
          <input
            id="convert-bedrag"
            value={dealBedrag}
            onChange={(e) => setDealBedrag(e.target.value)}
            placeholder="1250"
            inputMode="decimal"
            className={VELD}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="convert-betaalstatus" className="text-xs font-medium text-slate-700">
            Betaalstatus
          </label>
          <select
            id="convert-betaalstatus"
            value={betaalstatus}
            onChange={(e) => setBetaalstatus(e.target.value as Betaalstatus)}
            className={VELD}
          >
            {BETAALSTATUSSEN.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="convert-notities" className="text-xs font-medium text-slate-700">
          Notities bij de afspraak
        </label>
        <textarea
          id="convert-notities"
          value={dealNotities}
          onChange={(e) => setDealNotities(e.target.value)}
          rows={2}
          placeholder="Bv. eerste jaar hosting inbegrepen, factuur na oplevering."
          className={VELD}
        />
      </div>

      <div className="space-y-1 border-t border-blue-200 pt-2">
        <input
          value={shopifyDomein}
          onChange={(e) => setShopifyDomein(e.target.value)}
          placeholder="mijnwinkel.myshopify.com"
          className={VELD}
        />
        <p className="text-[11px] leading-snug text-slate-400">
          Enkel voor Shopify: maak de development store eerst zelf aan in het Partner Dashboard en
          plak hier het domein. Shopify biedt geen API om een store aan te maken.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleChoose("statisch")}
          disabled={pending}
          className="flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Statisch"}
        </button>
        <button
          type="button"
          onClick={() => handleChoose("shopify")}
          disabled={pending}
          className="flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Shopify"}
        </button>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
