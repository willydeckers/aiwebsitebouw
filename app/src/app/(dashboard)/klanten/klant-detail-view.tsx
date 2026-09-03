"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { huidigEmail } from "@/lib/huidige-gebruiker";
import { fetchDemoSite, type DemoSite } from "../leads/version-actions";
import { ChatVenster } from "../leads/chat-venster";
import { SiteContactPanel } from "../leads/site-contact-panel";
import { SitePreviewVenster } from "../leads/site-preview-venster";
import {
  bouwPreviewDocument,
  PREVIEW_NAVIGATIE_BERICHT,
  START_PAGINA,
  type PreviewNavigatieBericht,
} from "../leads/preview-document";
import { fetchCostSummary, type CostSummary } from "@/lib/costs";
import { CostSummaryView } from "../leads/cost-summary-view";
import { VersionHistory } from "../leads/version-history";
import { StaffInviteButton } from "./staff-invite-button";
import { startKlantChatEdit } from "./chat-actions";
import { GEBRUIKER_COLORS, useKlantenPresence } from "./presence";
import type { SiteVersion } from "@/lib/types";

type KlantDetail = {
  id: string;
  type: "statisch" | "shopify";
  site_status: string | null;
  shopify_staff_account_status: string | null;
  shopify_domain: string | null;
  lead: { id: string; bedrijfsnaam: string; sector: string } | null;
};

export function KlantDetailView({ klantId, onBack }: { klantId: string; onBack: () => void }) {
  const [klant, setKlant] = useState<KlantDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [siteVersions, setSiteVersions] = useState<SiteVersion[]>([]);
  const [site, setSite] = useState<DemoSite | null>(null);
  const [huidigePagina, setHuidigePagina] = useState(START_PAGINA);
  const [previewHash, setPreviewHash] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<"desktop" | "mobiel">("desktop");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void huidigEmail(supabase).then(setEmail);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("klanten")
      .select(
        "id, type, site_status, shopify_staff_account_status, shopify_domain, lead:leads(id, bedrijfsnaam, sector)",
      )
      .eq("id", klantId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setLoadError(error?.message ?? "Klant niet gevonden.");
          return;
        }
        setKlant(data as unknown as KlantDetail);
      });

    return () => {
      cancelled = true;
    };
  }, [klantId]);

  const leadId = klant?.lead?.id ?? null;

  const loadVersions = useCallback((supabase: ReturnType<typeof createClient>) => {
    if (!leadId) return;
    supabase
      .from("site_versions")
      .select("*")
      .eq("lead_id", leadId)
      .order("versienummer", { ascending: false })
      .then(({ data }) => {
        const versions = (data as SiteVersion[]) ?? [];
        setSiteVersions(versions);
        const latest = versions[0];
        if (!latest?.content_referentie) {
          setSite(null);
          setPreviewError("Nog geen site-versie beschikbaar.");
          return;
        }
        fetchDemoSite(latest).then((geladen) => {
          setSite(geladen);
          setHuidigePagina(START_PAGINA);
          setPreviewHash("");
          setPreviewError(geladen ? null : "Kon de site niet laden.");
        });
      });
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;
    const supabase = createClient();

    loadVersions(supabase);
    fetchCostSummary(supabase, leadId).then(setCostSummary);

    // Realtime keeps the OTHER person (just watching, see presence below)
    // up to date live. It is deliberately not the only path to an update
    // for whoever just sent a message themselves — see handleSend, which
    // refetches directly once its own request resolves, so "did my message
    // do anything" never silently depends on a websocket event arriving.
    const channel = supabase
      .channel(`klant-detail-${klantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_versions", filter: `lead_id=eq.${leadId}` },
        () => loadVersions(supabase),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [klantId, leadId, loadVersions]);

  // Interne links kunnen in een srcdoc-preview niet zelf navigeren; de iframe
  // vraagt de pagina op en de wissel gebeurt hier. Zie preview-document.ts.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const bericht = event.data as PreviewNavigatieBericht | undefined;
      if (bericht?.type !== PREVIEW_NAVIGATIE_BERICHT || previewOpen || !site) return;
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
  }, [site, previewOpen]);

  const presence = useKlantenPresence(email, klantId);
  const here = (presence[klantId] ?? []).slice().sort((a, b) => a.onlineAt - b.onlineAt);
  const editor = here[0] ?? null;
  const isEditor = !email || !editor || editor.email === email;
  const editorLabel = editor ? GEBRUIKER_COLORS[editor.gebruiker].label : null;

  // Eén chat-interface voor statisch en Shopify: welke backend het wordt,
  // beslist startKlantChatEdit op klant_type. Dat was hier al zo; wat verandert
  // is dat het nu dezelfde chatcomponent is als bij een lead, met dezelfde
  // geschiedenis, uploads, modelkeuze en versieknoppen.
  const chatOpties = useMemo(
    () => ({
      patch: async (_leadId: string, instructie: string) => {
        const resultaat = await startKlantChatEdit(klantId, instructie);
        return {
          error: resultaat.error,
          antwoord: resultaat.antwoord,
          toegepast: resultaat.toegepast,
        };
      },
    }),
    [klantId],
  );

  const latestVersion = siteVersions[0] ?? null;
  const paginas = latestVersion?.paginas ?? [];
  const previewPagina = site?.[huidigePagina] ?? null;

  if (loadError) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <p className="mt-4 text-sm text-red-600">Kon klant niet laden: {loadError}</p>
      </div>
    );
  }

  if (!klant) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <p className="mt-4 text-sm text-slate-500">Laden...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BackButton onBack={onBack} />
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {klant.lead?.bedrijfsnaam ?? "Onbekend"}
            </h1>
            <p className="text-xs text-slate-500">
              {klant.lead?.sector} · {klant.type === "shopify" ? "Shopify" : "Statisch"}
              {klant.site_status ? ` · ${klant.site_status}` : ""}
            </p>
          </div>
        </div>

        {editor ? (
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${GEBRUIKER_COLORS[editor.gebruiker].badge}`}
          >
            <span className={`h-2 w-2 rounded-full ${GEBRUIKER_COLORS[editor.gebruiker].dot}`} />
            {isEditor ? "Jij bewerkt nu" : `${editorLabel} is nu aan het bewerken`}
          </span>
        ) : null}
      </div>

      {/* Het werkveld: de site links, het gesprek rechts.
          Dit was hier een eigen, armere chat die review_log-regels toonde in
          plaats van het echte gesprek, zonder uploads, modelkeuze of
          versieknoppen — en daarnaast stond nóg een apart blok "site herwerken
          met extra informatie". Nu is het dezelfde component als bij een lead,
          met hergenereren als keuze ín de chat. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
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
            <div className="flex gap-1 text-xs">
              {(["desktop", "mobiel"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewport(v)}
                  className={`rounded-xl px-2 py-1 font-medium ${
                    viewport === v
                      ? "bg-blue-600 text-white"
                      : "border border-blue-200 text-slate-600 hover:bg-blue-50"
                  }`}
                >
                  {v === "desktop" ? "Desktop" : "Mobiel"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                disabled={!latestVersion}
                title="Bekijk de site op volledig scherm"
                className="rounded-xl border border-blue-200 px-2 py-1 font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-40"
              >
                Volledig scherm
              </button>
            </div>
          </div>

          <div className="flex justify-center overflow-hidden rounded-2xl border border-blue-100 bg-blue-50/60">
            {previewPagina ? (
              <iframe
                key={`${huidigePagina}${previewHash}`}
                srcDoc={bouwPreviewDocument(previewPagina, previewHash)}
                title="Website"
                className="h-[70vh] bg-white transition-[width]"
                style={{ width: viewport === "mobiel" ? "375px" : "100%" }}
              />
            ) : (
              <p className="p-6 text-sm text-slate-400">{previewError ?? "Preview laden..."}</p>
            )}
          </div>
          {previewPagina && previewError ? (
            <p className="mt-1 text-xs text-red-600">{previewError}</p>
          ) : null}
        </div>

        <div className="h-[calc(70vh+2.25rem)]">
          {klant.lead ? (
            <ChatVenster
              ingebed
              lead={{ id: klant.lead.id, bedrijfsnaam: klant.lead.bedrijfsnaam }}
              siteVersion={latestVersion ?? null}
              liveVersion={siteVersions.find((v) => v.status === "actief") ?? null}
              chatOpties={chatOpties}
              // Shopify-sites worden door Shopify gerenderd, niet door onze
              // generator — "hele site hergenereren" bestaat daar dus niet.
              magHergenereren={klant.type === "statisch"}
              readOnly={!isEditor}
              readOnlyReden={
                !isEditor && editorLabel
                  ? `${editorLabel} is deze klant nu aan het bewerken — je kan meekijken, typen kan zodra ${editorLabel} klaar is.`
                  : undefined
              }
              onChanged={() => {
                const supabase = createClient();
                loadVersions(supabase);
              }}
            />
          ) : null}
        </div>
      </div>

      {previewOpen && latestVersion ? (
        <SitePreviewVenster
          version={latestVersion}
          titel={klant.lead?.bedrijfsnaam}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}

      {leadId ? <SiteContactPanel leadId={leadId} /> : null}

      <div className="mt-4 flex flex-wrap items-start gap-4">
        {klant.type === "shopify" ? (
          <StaffInviteButton
            klantId={klant.id}
            status={klant.shopify_staff_account_status}
            onChanged={() => {}}
          />
        ) : null}
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

      {leadId ? (
        <VersionHistory
          leadId={leadId}
          versions={siteVersions}
          onChanged={() => {
            const supabase = createClient();
            loadVersions(supabase);
          }}
        />
      ) : null}

      {costSummary ? <CostSummaryView summary={costSummary} /> : null}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label="Terug naar klanten"
      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-800"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
