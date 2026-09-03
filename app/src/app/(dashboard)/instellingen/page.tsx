"use client";

import { useEffect, useState } from "react";
import {
  ALLE_INSTELLINGEN,
  BOOTSTRAP_SLEUTELS,
  INSTELLINGEN,
  type Instelling,
} from "@/lib/instellingen-catalogus";
import { bewaarInstelling, fetchInstellingen, type OpgeslagenInstelling } from "./instellingen-actions";
import { WorkerInstellingen } from "../voorkeuren/worker-instellingen";

// Alle sleutels op één scherm.
//
// Ze stonden verspreid over app/.env.local, worker/.env en de secrets van
// Supabase — drie bestanden die niets van elkaar weten. Wie iets wilde
// aanpassen moest eerst weten wélk bestand, en dat staat nergens. Precies zo
// stond SHOPIFY_PARTNER_ORGANIZATION_ID drie weken in het ene bestand en niet
// in het andere, waardoor elke winkelaanmaak stierf op regel één.

function InstellingRij({
  instelling,
  opgeslagen,
  onBewaard,
}: {
  instelling: Instelling;
  opgeslagen: OpgeslagenInstelling | undefined;
  onBewaard: () => void;
}) {
  const [waarde, setWaarde] = useState(opgeslagen?.waarde ?? "");
  const [tonen, setTonen] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);

  const gewijzigd = waarde.trim() !== (opgeslagen?.waarde ?? "");
  const ingesteld = !!opgeslagen?.waarde;

  async function bewaar() {
    setBezig(true);
    setMelding(null);
    const fout = await bewaarInstelling(instelling.sleutel, waarde, !!instelling.geheim);
    setBezig(false);
    setMelding(fout ?? "Bewaard.");
    if (!fout) onBewaard();
  }

  return (
    <div className="space-y-1 border-t border-blue-100 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={instelling.sleutel} className="text-sm font-medium text-slate-800">
          {instelling.label}
        </label>
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
          {instelling.sleutel}
        </code>
        {ingesteld ? (
          <span className="text-[11px] font-medium text-emerald-700">ingesteld</span>
        ) : (
          <span className="text-[11px] text-amber-700">
            leeg{instelling.nodigVoor ? ` — ${instelling.nodigVoor} werkt niet` : ""}
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">{instelling.uitleg}</p>
      {instelling.waar ? <p className="text-xs text-slate-400">Vind je hier: {instelling.waar}</p> : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <input
          id={instelling.sleutel}
          type={instelling.geheim && !tonen ? "password" : "text"}
          value={waarde}
          onChange={(e) => setWaarde(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Niet ingesteld"
          className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white/80 px-3 py-2 font-mono text-xs text-slate-900 outline-none placeholder:font-sans placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
        />
        {instelling.geheim ? (
          <button
            type="button"
            onClick={() => setTonen((v) => !v)}
            className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-blue-50"
          >
            {tonen ? "Verberg" : "Toon"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={bewaar}
          disabled={bezig || !gewijzigd}
          className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:bg-slate-100 disabled:text-slate-400"
        >
          {bezig ? "Bezig…" : "Bewaar"}
        </button>
      </div>

      {melding ? <p className="text-xs text-slate-500">{melding}</p> : null}
      {opgeslagen?.bijgewerkt_door ? (
        <p className="text-[11px] text-slate-400">
          Laatst gewijzigd door {opgeslagen.bijgewerkt_door} op{" "}
          {new Date(opgeslagen.bijgewerkt_op).toLocaleDateString("nl-BE")}
        </p>
      ) : null}
    </div>
  );
}

export default function InstellingenPage() {
  const [opgeslagen, setOpgeslagen] = useState<Record<string, OpgeslagenInstelling>>({});
  const [geladen, setGeladen] = useState(false);

  function herlaad() {
    fetchInstellingen().then((rijen) => {
      setOpgeslagen(rijen);
      setGeladen(true);
    });
  }

  useEffect(herlaad, []);

  const ontbreekt = ALLE_INSTELLINGEN.filter(
    (i) => i.nodigVoor && !opgeslagen[i.sleutel]?.waarde,
  );

  return (
    <div className="pb-12">
      <h1 className="text-lg font-semibold text-slate-900">Instellingen</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Alle sleutels en adressen die dit dashboard en de worker gebruiken. Wat je hier invult,
        wordt door de worker opgepikt zodra die (her)start — je hoeft geen bestanden meer te
        zoeken.
      </p>

      {geladen && ontbreekt.length > 0 ? (
        <div className="mt-4 max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Nog niet ingevuld</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {ontbreekt.map((i) => (
              <li key={i.sleutel}>
                <span className="font-medium">{i.label}</span> — zolang dit leeg is werkt{" "}
                {i.nodigVoor} niet.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {INSTELLINGEN.map((groep) => (
        <section
          key={groep.naam}
          className="mt-6 max-w-3xl rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl"
        >
          <h2 className="text-sm font-semibold text-slate-800">{groep.naam}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{groep.uitleg}</p>

          <div className="mt-3">
            {groep.instellingen.map((instelling) => (
              <InstellingRij
                // De bewaarde waarde is de beginwaarde van het veld. Verandert
                // ze (na bewaren, of doordat de ander ze aanpaste), dan hoort
                // dit een nieuw veld te zijn in plaats van een bestaand veld
                // dat zichzelf via een effect probeert bij te trekken.
                key={`${instelling.sleutel}:${opgeslagen[instelling.sleutel]?.bijgewerkt_op ?? ""}`}
                instelling={instelling}
                opgeslagen={opgeslagen[instelling.sleutel]}
                onBewaard={herlaad}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="mt-6 max-w-3xl rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl">
        <h2 className="text-sm font-semibold text-slate-800">Verbinding met de database</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Deze twee staan bewust niet hierboven: de worker heeft ze nodig om deze instellingen
          überhaupt te kunnen ophalen. Ze horen dus lokaal te blijven —{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5">worker/.env</code> vanuit een
          checkout, of het blok hieronder in de geïnstalleerde app.
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          {BOOTSTRAP_SLEUTELS.map((sleutel) => (
            <li key={sleutel}>
              <code className="rounded bg-slate-100 px-1 py-0.5">{sleutel}</code>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6 max-w-3xl">
        <WorkerInstellingen />
      </div>
    </div>
  );
}
