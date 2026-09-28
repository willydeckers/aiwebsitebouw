"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { huidigEmail } from "@/lib/huidige-gebruiker";
import { fetchCostSummary, type CostSummary } from "@/lib/costs";
import { demoBasisUrl, lokaleLink } from "@/lib/demo-link";
import { isDesktopApp, openInEditor } from "@/lib/desktop";
import { pakketVan } from "@/lib/pakketten";
import type { Klant, Lead, ReviewLogEntry, SiteVersion } from "@/lib/types";
import { LEAD_STATUS_LABELS } from "@/lib/types";
import { fetchDemoSite, kopieerVersie, type DemoSite } from "./version-actions";
import { ChatVenster } from "./chat-venster";
import { SitePreviewVenster } from "./site-preview-venster";
import {
  bouwPreviewDocument,
  PREVIEW_NAVIGATIE_BERICHT,
  START_PAGINA,
  type PreviewNavigatieBericht,
} from "./preview-document";
import { fetchKlant } from "./convert-actions";
import { ConvertButton } from "./convert-button";
import { KlantPanel } from "./klant-panel";
import { SiteContactPanel } from "./site-contact-panel";
import { SiteInteractiePanel } from "./site-interactie-panel";
import { StoreAanmaakPanel } from "./store-aanmaak-panel";
import { VersionHistory } from "./version-history";
import { CostSummaryView } from "./cost-summary-view";
import { NotitiesBlok, OpenVragenBlok } from "./notities-blok";
import { LeadInstellingenBlok } from "./lead-instellingen-blok";
import { PubliekeLinkInhoud, ReviewLogLijst } from "./publieke-link";
import { StaffInviteButton } from "../klanten/staff-invite-button";
import { startKlantChatEdit } from "../klanten/chat-actions";
import { GEBRUIKER_COLORS, useKlantenPresence } from "../klanten/presence";

// De werkruimte van één site: de site links, het gesprek rechts, en daaronder
// alles wat er over deze lead of klant te weten en in te stellen valt.
//
// Eén component voor twee plekken. Het klantenscherm had een grote werkruimte
// maar miste de helft van wat het leadpaneel toonde (briefing, bedrijfs-
// gegevens, site-interactie, pakket & domein, publieke link, review-log); het
// leadpaneel had alles, maar geen werkruimte. Twee schermen die elk een deel
// deden, groeiden uit elkaar — zoals de chat eerder al had gedaan. Nu opent het
// leadpaneel deze werkruimte als overlay, en is het klantenscherm deze
// werkruimte als pagina.
//
// De werkruimte laadt zelf wat ze nodig heeft, op basis van enkel het lead-id.
// Zo hoeft geen van beide aanroepers te weten wat erin staat.

type Viewport = "desktop" | "mobiel";

export function SiteWerkruimte({
  leadId,
  weergave,
  onSluiten,
}: {
  leadId: string;
  /** "overlay": schermvullend over het leadpaneel. "pagina": het klantenscherm. */
  weergave: "overlay" | "pagina";
  onSluiten: () => void;
}) {
  const instantieId = useId();
  const [lead, setLead] = useState<Lead | null>(null);
  const [klant, setKlant] = useState<Klant | null>(null);
  const [siteVersions, setSiteVersions] = useState<SiteVersion[]>([]);
  const [reviewLog, setReviewLog] = useState<ReviewLogEntry[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [laadFout, setLaadFout] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  // null = volg de nieuwste versie. Zo spring je vanzelf naar de nieuwe versie
  // die een hergeneratie oplevert, tot je zelf een andere kiest.
  const [gekozenId, setGekozenId] = useState<string | null>(null);
  const [site, setSite] = useState<DemoSite | null>(null);
  const [huidigePagina, setHuidigePagina] = useState(START_PAGINA);
  const [previewHash, setPreviewHash] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [volledigScherm, setVolledigScherm] = useState(false);
  const [editorMelding, setEditorMelding] = useState<string | null>(null);
  const [editorBezig, startEditor] = useTransition();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const geladenVersieId = useRef<string | null>(null);

  const laadLead = useCallback(() => {
    const supabase = createClient();
    supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setLaadFout(error?.message ?? "Lead niet gevonden.");
        else setLead(data as Lead);
      });
  }, [leadId]);

  const laadKlant = useCallback(() => {
    void fetchKlant(leadId).then(setKlant);
  }, [leadId]);

  const laadVersies = useCallback(() => {
    const supabase = createClient();
    supabase
      .from("site_versions")
      .select("*")
      .eq("lead_id", leadId)
      .order("versienummer", { ascending: false })
      .then(({ data }) => setSiteVersions((data as SiteVersion[]) ?? []));
  }, [leadId]);

  const laadKosten = useCallback(() => {
    void fetchCostSummary(createClient(), leadId).then(setCostSummary);
  }, [leadId]);

  const herlaad = useCallback(() => {
    laadLead();
    laadKlant();
    laadVersies();
    laadKosten();
  }, [laadLead, laadKlant, laadVersies, laadKosten]);

  useEffect(() => {
    const supabase = createClient();
    void huidigEmail(supabase).then(setEmail);
    herlaad();

    supabase
      .from("review_log")
      .select("*")
      .eq("lead_id", leadId)
      .order("timestamp", { ascending: false })
      .limit(5)
      .then(({ data }) => setReviewLog((data as ReviewLogEntry[]) ?? []));

    // Realtime houdt vooral de ándere gebruiker bij: wie zelf iets doet, laadt
    // ook rechtstreeks opnieuw via onChanged. Eigen kanaalnaam per instantie —
    // supabase-js deelt kanalen per naam, en een tweede .on() na subscribe()
    // gooit (zie use-lead-chat.ts).
    //
    // Enkel tabellen die in de publicatie supabase_realtime staan (jobs,
    // site_versions, review_log). Hier stonden ook `leads` en `klanten` bij;
    // die staan er niet in, en dan komt er op het HELE kanaal niets meer binnen
    // — ook niet de site_versions-wijziging die de preview moet verversen.
    const channel = supabase
      .channel(`werkruimte-${leadId}-${instantieId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_versions", filter: `lead_id=eq.${leadId}` },
        () => laadVersies(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "review_log", filter: `lead_id=eq.${leadId}` },
        (payload) => setReviewLog((prev) => [payload.new as ReviewLogEntry, ...prev].slice(0, 5)),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, instantieId, herlaad, laadVersies]);

  const gekozen = siteVersions.find((v) => v.id === gekozenId) ?? siteVersions[0] ?? null;
  const liveVersion = siteVersions.find((v) => v.status === "actief") ?? null;

  // De site van de gekozen versie ophalen. laatst_bewerkt_op zit erbij omdat
  // een chat-edit of een bewaring in de editor dezelfde paden overschrijft: het
  // is het enige veld dat zegt "de inhoud is veranderd".
  useEffect(() => {
    if (!gekozen?.content_referentie) return;
    let afgebroken = false;
    fetchDemoSite(gekozen).then((geladen) => {
      if (afgebroken) return;
      setSite(geladen);
      // Een andere versie begint op de home; dezelfde versie met nieuwe inhoud
      // laat je staan waar je stond, zolang die pagina nog bestaat.
      if (geladenVersieId.current !== gekozen.id || !geladen?.[huidigePagina]) {
        setHuidigePagina(START_PAGINA);
        setPreviewHash("");
      }
      geladenVersieId.current = gekozen.id;
      setPreviewError(geladen ? null : "Kon deze versie niet laden.");
    });
    return () => {
      afgebroken = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gekozen?.id, gekozen?.content_referentie, gekozen?.laatst_bewerkt_op]);

  // Interne links kunnen in een srcdoc-preview niet zelf navigeren; de iframe
  // vraagt de pagina op en de wissel gebeurt hier. Enkel berichten uit ónze
  // iframe: over het leadpaneel heen luistert de demo-preview daar ook.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const bericht = event.data as PreviewNavigatieBericht | undefined;
      if (bericht?.type !== PREVIEW_NAVIGATIE_BERICHT || !site) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!site[bericht.bestand]) {
        setPreviewError(`Deze link wijst naar ${bericht.bestand}, maar die pagina bestaat niet.`);
        return;
      }
      setPreviewError(null);
      setHuidigePagina(bericht.bestand);
      setPreviewHash(bericht.hash);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [site]);

  // Escape sluit de werkruimte — maar niet ook het leadpaneel eronder. Op
  // `document` in de bubbelfase: dat komt vóór de luisteraar van het paneel op
  // `window`, en na die van dialogen die zelf in de capture-fase luisteren.
  useEffect(() => {
    if (weergave !== "overlay") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (volledigScherm) setVolledigScherm(false);
      else onSluiten();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [weergave, volledigScherm, onSluiten]);

  // Bewerk-vergrendeling, enkel voor een klant: wie er eerst was, bewerkt.
  const presence = useKlantenPresence(email, klant?.id ?? null);
  const hier = klant ? (presence[klant.id] ?? []).slice().sort((a, b) => a.onlineAt - b.onlineAt) : [];
  const editor = hier[0] ?? null;
  const isEditor = !email || !editor || editor.email === email;
  const editorLabel = editor ? GEBRUIKER_COLORS[editor.gebruiker].label : null;

  // Eén chat-interface voor statisch en Shopify. Voor een klant kiest
  // startKlantChatEdit de backend op klant_type; zonder klant is het de
  // gewone statische patch (de standaard in useLeadChat).
  const klantId = klant?.id ?? null;
  const chatOpties = useMemo(
    () =>
      klantId
        ? {
            patch: async (_leadId: string, instructie: string, versionId: string) => {
              const resultaat = await startKlantChatEdit(klantId, instructie, versionId);
              return { error: resultaat.error, antwoord: resultaat.antwoord, toegepast: resultaat.toegepast };
            },
          }
        : undefined,
    [klantId],
  );

  function openEditor() {
    if (!gekozen) return;
    setEditorMelding(null);
    startEditor(async () => {
      let doel = gekozen;
      // De live versie bewerk je niet rechtstreeks: elke Ctrl+S — ook een
      // halve, kapotte tussenstand — zou meteen online staan. Eerst een kopie,
      // en die zet je live wanneer je klaar bent.
      if (gekozen.status === "actief") {
        const { fout, versie } = await kopieerVersie(leadId, gekozen);
        if (fout || !versie) {
          setEditorMelding(fout ?? "Kon de live versie niet kopiëren.");
          return;
        }
        doel = versie;
        setGekozenId(versie.id);
        laadVersies();
      }
      try {
        await openInEditor(doel.id, email);
        setEditorMelding(
          (doel.id !== gekozen.id
            ? `De live versie is eerst gekopieerd naar versie ${doel.versienummer}; die bewerk je nu. Zet ze live als je klaar bent. `
            : "") +
            `Versie ${doel.versienummer} wordt geopend in je editor — elke keer dat je bewaart, wordt ze hier bijgewerkt.`,
        );
      } catch (err) {
        setEditorMelding(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const paginas = gekozen?.paginas ?? [];
  // Een versie zonder inhoud toont niets — ook niet wat er van de vorige nog in
  // `site` zit.
  const previewPagina = gekozen?.content_referentie ? (site?.[huidigePagina] ?? null) : null;
  const klantType = klant?.type ?? lead?.klant_type ?? null;
  const demoBasis = demoBasisUrl();
  const demoUrl = liveVersion && demoBasis ? `${demoBasis}/${leadId}/` : null;
  const opDesktop = isDesktopApp();

  const inhoud = (
    <div className={weergave === "overlay" ? "mx-auto max-w-[1600px] p-4 sm:p-6" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSluiten}
            aria-label={weergave === "overlay" ? "Werkruimte sluiten" : "Terug"}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-800"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{lead?.bedrijfsnaam ?? "Laden…"}</h1>
            {lead ? (
              <p className="text-xs text-slate-500">
                {lead.sector}
                {` · ${LEAD_STATUS_LABELS[lead.status] ?? lead.status}`}
                {klantType ? ` · ${klantType === "shopify" ? "Shopify" : "Statisch"}` : ""}
                {klant?.pakket_type ? ` · ${pakketVan(klant.pakket_type)?.label ?? klant.pakket_type}` : ""}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {editor ? (
            <span
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${GEBRUIKER_COLORS[editor.gebruiker].badge}`}
            >
              <span className={`h-2 w-2 rounded-full ${GEBRUIKER_COLORS[editor.gebruiker].dot}`} />
              {isEditor ? "Jij bewerkt nu" : `${editorLabel} is nu aan het bewerken`}
            </span>
          ) : null}
          {weergave === "overlay" ? (
            <button
              type="button"
              onClick={onSluiten}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Sluiten
            </button>
          ) : null}
        </div>
      </div>

      {laadFout ? <p className="mt-4 text-sm text-red-600">Kon niet laden: {laadFout}</p> : null}

      {/* Het werkveld: de site links, het gesprek rechts. */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {siteVersions.length > 0 ? (
                <select
                  value={gekozen?.id ?? ""}
                  onChange={(e) => setGekozenId(e.target.value)}
                  aria-label="Versie"
                  title="Welke versie je bekijkt. De chat en de editor werken op deze versie."
                  className="rounded-xl border border-blue-200 bg-white/80 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                >
                  {siteVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      Versie {v.versienummer} · {v.status}
                      {v.id === siteVersions[0].id ? " (nieuwste)" : ""}
                    </option>
                  ))}
                </select>
              ) : null}
              {paginas.length > 1 ? (
                <select
                  value={huidigePagina}
                  onChange={(e) => {
                    setHuidigePagina(e.target.value);
                    setPreviewHash("");
                  }}
                  aria-label="Pagina"
                  className="rounded-xl border border-blue-200 bg-white/80 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                >
                  {paginas.map((p) => (
                    <option key={p.bestand} value={p.bestand}>
                      {p.nav_label}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {(["desktop", "mobiel"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewport(v)}
                  className={`rounded-xl px-2 py-1 font-medium ${
                    viewport === v ? "bg-blue-600 text-white" : "border border-blue-200 text-slate-600 hover:bg-blue-50"
                  }`}
                >
                  {v === "desktop" ? "Desktop" : "Mobiel"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setVolledigScherm(true)}
                disabled={!gekozen}
                title="Bekijk de site op volledig scherm"
                className="rounded-xl border border-blue-200 px-2 py-1 font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-40"
              >
                Volledig scherm
              </button>
              {gekozen ? (
                <a
                  href={lokaleLink(leadId, gekozen.versienummer)}
                  target="_blank"
                  rel="noreferrer"
                  title="Deze versie in een echte browser, via de worker op deze machine"
                  className="rounded-xl border border-blue-200 px-2 py-1 font-medium text-slate-600 hover:bg-blue-50"
                >
                  In browser
                </a>
              ) : null}
              <button
                type="button"
                onClick={openEditor}
                disabled={!gekozen || !opDesktop || editorBezig || !isEditor || klantType === "shopify"}
                title={
                  !opDesktop
                    ? "Enkel in de desktop-app. Vanuit een terminal: cd worker && npx tsx --env-file=.env scripts/bewerk-site.ts <leadId>"
                    : klantType === "shopify"
                      ? "Een Shopify-site wordt door Shopify gerenderd, niet uit deze bestanden."
                      : gekozen?.status === "actief"
                        ? "Maakt eerst een kopie van de live versie en opent die in VS Code."
                        : "Open de bouwstenen van deze versie in VS Code. Bewaren werkt de site hier meteen bij."
                }
                className="rounded-xl border border-blue-200 px-2 py-1 font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-40"
              >
                {editorBezig ? "Openen…" : "Openen in editor"}
              </button>
            </div>
          </div>

          {editorMelding ? (
            <p className="mb-2 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-slate-700">
              {editorMelding}
            </p>
          ) : null}

          <div className="flex justify-center overflow-hidden rounded-2xl border border-blue-100 bg-blue-50/60">
            {previewPagina ? (
              <iframe
                ref={iframeRef}
                key={`${gekozen?.id}${huidigePagina}${previewHash}`}
                srcDoc={bouwPreviewDocument(previewPagina, previewHash)}
                title="Website"
                className="h-[70vh] bg-white transition-[width]"
                style={{ width: viewport === "mobiel" ? "375px" : "100%" }}
              />
            ) : (
              <p className="p-6 text-sm text-slate-500">
                {siteVersions.length === 0
                  ? "Nog geen site-versie."
                  : !gekozen?.content_referentie
                    ? "Deze versie heeft geen opgeslagen inhoud."
                    : (previewError ?? "Preview laden...")}
              </p>
            )}
          </div>
          {previewPagina && previewError ? <p className="mt-1 text-xs text-red-600">{previewError}</p> : null}
        </div>

        <div className="h-[calc(70vh+2.25rem)] min-h-[28rem]">
          {lead ? (
            <ChatVenster
              lead={lead}
              siteVersion={gekozen}
              liveVersion={liveVersion}
              chatOpties={chatOpties}
              // Shopify-sites worden door Shopify gerenderd, niet door onze
              // generator — "hele site hergenereren" bestaat daar dus niet.
              magHergenereren={klantType !== "shopify"}
              readOnly={!isEditor}
              readOnlyReden={
                !isEditor && editorLabel
                  ? `${editorLabel} is deze klant nu aan het bewerken — je kan meekijken, typen kan zodra ${editorLabel} klaar is.`
                  : undefined
              }
              onChanged={herlaad}
              onVersieGewijzigd={laadVersies}
            />
          ) : null}
        </div>
      </div>

      {/* Alles over deze lead of klant, in twee kolommen: links wat er met de
          klant is afgesproken en wat de site binnenkrijgt, rechts de site zelf
          en wat erin ging. */}
      {lead ? (
        <div className="mt-6 grid grid-cols-1 gap-x-6 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Klant &amp; account</h2>
            {klantType ? (
              <KlantPanel
                leadId={leadId}
                bedrijfsnaam={lead.bedrijfsnaam}
                klantType={klantType}
                standaardOpen
                vernieuw={gekozen?.laatst_bewerkt_op ?? null}
              />
            ) : (
              <div className="mt-3">
                <ConvertButton leadId={leadId} bedrijfsnaam={lead.bedrijfsnaam} onChanged={herlaad} />
              </div>
            )}
            <SiteContactPanel leadId={leadId} />
            <SiteInteractiePanel leadId={leadId} />
            {klant?.type === "shopify" ? (
              <div className="mt-4 flex flex-wrap items-start gap-4">
                <StaffInviteButton klantId={klant.id} status={klant.shopify_staff_account_status} onChanged={laadKlant} />
                {klant.shopify_domain ? (
                  <a
                    href={`https://${klant.shopify_domain}/admin`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 text-sm text-blue-600 underline"
                  >
                    Open in Shopify admin
                  </a>
                ) : null}
              </div>
            ) : null}
            <StoreAanmaakPanel leadId={leadId} klantType={klantType} onChanged={herlaad} />
            {costSummary ? <CostSummaryView summary={costSummary} /> : null}
          </div>

          <div>
            <VersionHistory leadId={leadId} versions={siteVersions} onChanged={herlaad} />
            <div className="mt-6 space-y-3">
              <NotitiesBlok key={`notities-${lead.id}`} lead={lead} onChanged={laadLead} />
              <OpenVragenBlok openVragen={lead.open_vragen} />
              <LeadInstellingenBlok key={`instellingen-${lead.id}`} lead={lead} onChanged={laadLead} />
              <Uitklapper titel="Publieke link">
                <PubliekeLinkInhoud leadId={leadId} demoUrl={demoUrl} versienummer={gekozen?.versienummer} />
              </Uitklapper>
              <Uitklapper titel={`Review-log (${reviewLog.length})`}>
                <ReviewLogLijst reviewLog={reviewLog} />
              </Uitklapper>
            </div>
          </div>
        </div>
      ) : null}

      {volledigScherm && gekozen ? (
        <SitePreviewVenster
          version={gekozen}
          titel={lead?.bedrijfsnaam}
          onClose={() => setVolledigScherm(false)}
        />
      ) : null}
    </div>
  );

  if (weergave === "pagina") return inhoud;

  // Via een portal naar <body>: een `fixed` element binnen een ouder met
  // backdrop-filter (de glazen kaart van het dashboard, het geblurde leadpaneel)
  // wordt anders tot die ouder beperkt in plaats van het hele venster te vullen.
  //
  // React laat events door een portal heen verder bubbelen naar de ouder in de
  // componentboom — hier de geblurde achtergrond van het leadpaneel, die bij een
  // klik het paneel sluit. Zonder stopPropagation sloot élke klik in de
  // werkruimte het paneel eronder mee.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-50"
      role="dialog"
      aria-modal="true"
      aria-label="Werkruimte"
      onClick={(e) => e.stopPropagation()}
    >
      {inhoud}
    </div>,
    document.body,
  );
}

function Uitklapper({ titel, children }: { titel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-1 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-blue-100 px-3 py-2 text-left font-medium text-slate-700 hover:bg-blue-50"
      >
        <span>{titel}</span>
        <span className="text-xs text-slate-400">{open ? "verbergen" : "tonen"}</span>
      </button>
      {open ? children : null}
    </section>
  );
}
