"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchDemoHtml } from "../leads/version-actions";
import { fetchCostSummary, type CostSummary } from "@/lib/costs";
import { CostSummaryView } from "../leads/cost-summary-view";
import { VersionHistory } from "../leads/version-history";
import { StaffInviteButton } from "./staff-invite-button";
import { startKlantChatEdit } from "./chat-actions";
import { startGeneration } from "../leads/generate-actions";
import { GEBRUIKER_COLORS, useKlantenPresence } from "./presence";
import type { ReviewLogEntry, SiteVersion } from "@/lib/types";

type KlantDetail = {
  id: string;
  type: "statisch" | "shopify";
  site_status: string | null;
  shopify_staff_account_status: string | null;
  shopify_domain: string | null;
  lead: { id: string; bedrijfsnaam: string; sector: string } | null;
};

const CHAT_EDIT_BRONNEN = ["chat-edit", "chat-edit-shopify"];

export function KlantDetailView({ klantId, onBack }: { klantId: string; onBack: () => void }) {
  const [klant, setKlant] = useState<KlantDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [siteVersions, setSiteVersions] = useState<SiteVersion[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [logs, setLogs] = useState<ReviewLogEntry[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [rewriteInput, setRewriteInput] = useState("");
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [rewriteDone, setRewriteDone] = useState(false);
  const [rewritePending, startRewriteTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
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
          setPreviewHtml(null);
          setPreviewError("Nog geen site-versie beschikbaar.");
          return;
        }
        fetchDemoHtml(latest.content_referentie).then((html) => {
          setPreviewHtml(html);
          setPreviewError(html ? null : "Kon de site niet laden.");
        });
      });
  }, [leadId]);

  const loadLogs = useCallback((supabase: ReturnType<typeof createClient>) => {
    if (!leadId) return;
    supabase
      .from("review_log")
      .select("*")
      .eq("lead_id", leadId)
      .in("bron", CHAT_EDIT_BRONNEN)
      .order("timestamp", { ascending: true })
      .then(({ data }) => setLogs((data as ReviewLogEntry[]) ?? []));
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;
    const supabase = createClient();

    loadVersions(supabase);
    loadLogs(supabase);
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "review_log", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const row = payload.new as ReviewLogEntry;
          if (!CHAT_EDIT_BRONNEN.includes(row.bron)) return;
          setLogs((prev) => (prev.some((l) => l.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [klantId, leadId, loadVersions, loadLogs]);

  const presence = useKlantenPresence(email, klantId);
  const here = (presence[klantId] ?? []).slice().sort((a, b) => a.onlineAt - b.onlineAt);
  const editor = here[0] ?? null;
  const isEditor = !email || !editor || editor.email === email;
  const editorLabel = editor ? GEBRUIKER_COLORS[editor.gebruiker].label : null;

  function handleSend() {
    const instruction = input.trim();
    if (!instruction || !isEditor) return;
    setSendError(null);
    setInput("");
    startTransition(async () => {
      const result = await startKlantChatEdit(klantId, instruction);
      const supabase = createClient();
      if (result.error) {
        setSendError(result.error);
      }
      // Refetch regardless of error — a partial/edge-case failure can still
      // have logged something worth showing, and this is the guaranteed
      // path to seeing the result, independent of Realtime.
      loadLogs(supabase);
      if (result.toegepast) loadVersions(supabase);
    });
  }

  // Chat-based bewerken (above) is deliberately limited to small, targeted
  // patches (spec 3.5) — asking it to "take over everything from our old
  // site and add new pages" is out of scope for a str_replace/insert loop
  // and it correctly refuses. This is the actual completeness path: a real
  // generatie run (spec 3.3) with whatever extra source material — the
  // client's own site content, a list of services, anything — that didn't
  // make it in the first time. It lands as a new concept version, so it
  // doesn't touch what's already live until reviewed and activated.
  function handleRewrite() {
    if (!leadId) return;
    const extra = rewriteInput.trim();
    if (!extra) return;
    setRewriteError(null);
    setRewriteDone(false);
    startRewriteTransition(async () => {
      const result = await startGeneration(leadId, extra);
      if (result) {
        setRewriteError(result);
        return;
      }
      setRewriteDone(true);
      setRewriteInput("");
      const supabase = createClient();
      loadVersions(supabase);
    });
  }

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

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border border-blue-100 bg-blue-50/60 lg:col-span-2">
          {previewHtml ? (
            <iframe srcDoc={previewHtml} title="Website" className="h-[70vh] w-full bg-white" />
          ) : (
            <p className="p-6 text-sm text-slate-400">{previewError ?? "Preview laden..."}</p>
          )}
        </div>

        <div className="flex h-[70vh] flex-col rounded-2xl border border-blue-100 p-3">
          <h3 className="text-sm font-medium text-slate-700">Chat-based bewerken (3.5/3.9)</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Zelfde interface voor statisch en Shopify — het systeem kiest zelf de juiste backend.
          </p>

          <ul className="mt-2 flex-1 space-y-2 overflow-y-auto rounded-xl border border-blue-100 p-2 text-xs">
            {logs.length === 0 && !pending ? (
              <li className="text-slate-400">Nog geen wijzigingen via chat.</li>
            ) : (
              logs.map((log) => (
                <li key={log.id} className="space-y-1 rounded-lg bg-blue-50/60 p-2">
                  <p className="text-slate-800">
                    <span className="font-medium">Instructie: </span>
                    {log.instructie_of_bevinding}
                  </p>
                  {log.ai_antwoord ? (
                    <p className="text-slate-600">
                      <span className="font-medium">AI: </span>
                      {log.ai_antwoord}
                    </p>
                  ) : null}
                  <p
                    className={`text-[11px] font-medium ${
                      log.resultaat === "toegepast"
                        ? "text-emerald-600"
                        : log.resultaat === "geen_wijziging"
                          ? "text-amber-600"
                          : "text-red-500"
                    }`}
                  >
                    {log.resultaat === "toegepast"
                      ? "✓ Wijziging doorgevoerd"
                      : log.resultaat === "geen_wijziging"
                        ? "Geen wijziging — zie AI-antwoord"
                        : log.resultaat}
                  </p>
                </li>
              ))
            )}
            {pending ? (
              <li className="flex items-center gap-1.5 rounded-lg bg-blue-50/60 p-2 text-slate-400">
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                </span>
                aan het verwerken...
              </li>
            ) : null}
          </ul>

          {!isEditor ? (
            <p className="mt-2 text-xs text-amber-600">
              {editorLabel} is deze klant nu aan het bewerken — je kan meekijken, typen kan pas
              zodra {editorLabel} klaar is.
            </p>
          ) : null}
          {sendError ? <p className="mt-2 text-xs text-red-600">{sendError}</p> : null}

          <div className="mt-2 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              disabled={!isEditor || pending}
              placeholder="bv. voeg product toe: Lentetaart, €18,50"
              className="flex-1 rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none text-slate-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!isEditor || pending}
              className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "Bezig..." : "Verstuur"}
            </button>
          </div>
        </div>
      </div>

      {klant.type === "statisch" ? (
        <section className="mt-4 rounded-2xl border border-blue-100 p-4">
          <h3 className="text-sm font-medium text-slate-700">
            Site herwerken met extra informatie
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Voor grote aanvullingen — ontbrekende diensten, tekst van hun oude site, nieuwe
            secties — niet voor kleine wijzigingen (gebruik daarvoor de chat hierboven). Plak hier
            gerust ruwe content; dit maakt een nieuwe conceptversie, de live site blijft
            ongewijzigd tot je die versie activeert.
          </p>
          <textarea
            value={rewriteInput}
            onChange={(e) => setRewriteInput(e.target.value)}
            rows={4}
            disabled={!isEditor || rewritePending}
            placeholder="bv. plak hier de tekst/diensten van hun bestaande website die nog ontbreken op onze site"
            className="mt-2 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none text-slate-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50 disabled:text-slate-400"
          />
          {rewriteError ? <p className="mt-1 text-xs text-red-600">{rewriteError}</p> : null}
          {rewriteDone ? (
            <p className="mt-1 text-xs text-emerald-600">
              ✓ Nieuwe conceptversie aangemaakt — bekijk ze bij Versiegeschiedenis hieronder.
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleRewrite}
            disabled={!isEditor || rewritePending || !rewriteInput.trim()}
            className="mt-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {rewritePending ? "Bezig met herwerken..." : "Herwerk site met deze info"}
          </button>
        </section>
      ) : null}

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
