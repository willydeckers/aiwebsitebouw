"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Lead, ReviewLogEntry, SiteVersion } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { startGeneration } from "./generate-actions";
import { startPatchEdit } from "./patch-actions";
import { fetchDemoSite, type DemoSite } from "./version-actions";
import { uploadEnLees } from "./site-interactie-actions";
import {
  afzenderLabel,
  fetchChatGeschiedenis,
  voegChatBerichtToe,
  type ChatBericht,
} from "./chat-geschiedenis";
import {
  bouwPreviewDocument,
  PREVIEW_NAVIGATIE_BERICHT,
  START_PAGINA,
  type PreviewNavigatieBericht,
} from "./preview-document";
import { SendDialog } from "./send-dialog";

type Viewport = "desktop" | "mobiel";

const VIEWPORT_WIDTH: Record<Viewport, string> = {
  desktop: "100%",
  mobiel: "375px",
};

export function DemoPreview({
  lead,
  demoUrl,
  siteVersion,
  reviewLog,
  onChanged,
}: {
  lead: Lead;
  demoUrl: string | null;
  siteVersion: SiteVersion;
  reviewLog: ReviewLogEntry[];
  onChanged: () => void;
}) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const bestandInput = useRef<HTMLInputElement>(null);
  const [uploadPending, startUploadTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatBericht[]>([]);
  const [chatPending, startChatTransition] = useTransition();
  const [previewVersion, setPreviewVersion] = useState(0);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [site, setSite] = useState<DemoSite | null>(null);
  const [huidigePagina, setHuidigePagina] = useState(START_PAGINA);
  const [previewHash, setPreviewHash] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Loads the actual demo content so it renders where a preview should be,
  // regardless of whether a public hosting link exists yet — most leads
  // don't have one until their first version is approved (spec 3.4), and
  // that's exactly when you most want to see the concept.
  useEffect(() => {
    let cancelled = false;

    fetchDemoSite(siteVersion).then((geladen) => {
      if (cancelled) return;
      setSite(geladen);
      setHuidigePagina(START_PAGINA);
      setPreviewHash("");
      setPreviewError(siteVersion.content_referentie && !geladen ? "Kon deze versie niet laden." : null);
    });

    return () => {
      cancelled = true;
    };
    // siteVersion is re-fetched by the parent on every change; the two fields
    // below are what actually determine the content, plus previewVersion which
    // forces a reload after a chat-edit rewrote the same paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteVersion.content_referentie, siteVersion.paginas, previewVersion]);

  // The conversation is loaded from the database rather than kept in component
  // state: closing the panel used to throw it away, and the other user could
  // never see what had been asked. Realtime keeps both dashboards in step.
  useEffect(() => {
    let afgebroken = false;
    fetchChatGeschiedenis(lead.id).then((berichten) => {
      if (!afgebroken) setChatMessages(berichten);
    });

    const supabase = createClient();
    const channel = supabase
      .channel(`chat-${lead.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_berichten", filter: `lead_id=eq.${lead.id}` },
        (payload) => {
          const nieuw = payload.new as ChatBericht;
          setChatMessages((prev) => (prev.some((b) => b.id === nieuw.id) ? prev : [...prev, nieuw]));
        },
      )
      .subscribe();

    return () => {
      afgebroken = true;
      supabase.removeChannel(channel);
    };
  }, [lead.id]);

  // Internal links inside the preview can't navigate on their own (no origin,
  // no directory — see preview-document.ts), so the iframe asks for the page
  // and the swap happens here.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const bericht = event.data as PreviewNavigatieBericht | undefined;
      if (bericht?.type !== PREVIEW_NAVIGATIE_BERICHT) return;
      if (!site) return;
      if (!site[bericht.bestand]) {
        setPreviewError(`Deze link wijst naar ${bericht.bestand}, maar die pagina bestaat niet in deze versie.`);
        return;
      }
      setPreviewError(null);
      setHuidigePagina(bericht.bestand);
      setPreviewHash(bericht.hash);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [site]);

  const paginaLabel = (bestand: string) =>
    siteVersion.paginas?.find((p) => p.bestand === bestand)?.nav_label ?? bestand;

  const previewHtml = site?.[huidigePagina] ?? null;

  function handleRegenerate() {
    setError(null);
    const instructie = chatInput.trim();
    startTransition(async () => {
      const result = await startGeneration(lead.id, instructie || undefined);
      if (result) {
        setError(result);
        return;
      }
      if (instructie) {
        setChatInput("");
        await voegChatBerichtToe({
          leadId: lead.id,
          rol: "gebruiker",
          tekst: instructie,
          soort: "regeneratie",
          siteVersionId: siteVersion.id,
        });
      }
      await voegChatBerichtToe({
        leadId: lead.id,
        rol: "systeem",
        soort: "regeneratie",
        siteVersionId: siteVersion.id,
        tekst: instructie
          ? "Hele site wordt opnieuw gegenereerd met deze instructie; dat levert een nieuwe versie op."
          : "Hele site wordt opnieuw gegenereerd; dat levert een nieuwe versie op.",
      });
      onChanged();
    });
  }

  // Uploading from the chat box rather than a separate panel: adding a menu
  // photo IS a change to the site, so it belongs in the same place as "die
  // kleur moet anders". The transcription comes back as a chat reply so it
  // can be checked immediately — it is OCR of a photo, not gospel.
  function handleUpload(file: File) {
    setError(null);
    if (bestandInput.current) bestandInput.current.value = "";

    startUploadTransition(async () => {
      await voegChatBerichtToe({
        leadId: lead.id,
        rol: "gebruiker",
        tekst: `Bestand toegevoegd: ${file.name}`,
        soort: "upload",
        siteVersionId: siteVersion.id,
      });

      const resultaat = await uploadEnLees(lead.id, file, "");
      if (resultaat.error) {
        await voegChatBerichtToe({
          leadId: lead.id,
          rol: "systeem",
          soort: "upload",
          tekst: resultaat.error,
        });
        return;
      }
      await voegChatBerichtToe({
        leadId: lead.id,
        rol: "systeem",
        soort: "upload",
        siteVersionId: siteVersion.id,
        tekst: resultaat.tekst
            ? `Uitgelezen uit ${resultaat.bestandsnaam}:

${resultaat.tekst}

Klopt dit? Genereer opnieuw om het op de site te zetten.`
          : `${resultaat.bestandsnaam} staat klaar. Er stond geen leesbare tekst op, dus dit wordt als afbeelding gebruikt. Genereer opnieuw om het op de site te zetten.`,
      });
      onChanged();
    });
  }

  function handleSendChat() {
    const instruction = chatInput.trim();
    if (!instruction) return;

    setChatInput("");

    startChatTransition(async () => {
      await voegChatBerichtToe({
        leadId: lead.id,
        rol: "gebruiker",
        tekst: instruction,
        soort: "patch",
        siteVersionId: siteVersion.id,
      });

      const result = await startPatchEdit(lead.id, instruction);
      if (result.error) {
        await voegChatBerichtToe({
          leadId: lead.id,
          rol: "systeem",
          soort: "patch",
          tekst: result.error,
        });
        return;
      }
      await voegChatBerichtToe({
        leadId: lead.id,
        rol: "ai",
        soort: "patch",
        siteVersionId: siteVersion.id,
        tekst: result.antwoord ?? (result.toegepast ? "Wijziging doorgevoerd." : "Geen wijziging doorgevoerd."),
      });
      if (result.toegepast) {
        setPreviewVersion((v) => v + 1);
        onChanged();
      }
    });
  }

  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">
          Demo-preview
          {site && Object.keys(site).length > 1 ? (
            <span className="ml-2 font-normal text-slate-400">
              {paginaLabel(huidigePagina)} — klik in de navigatie om te bladeren
            </span>
          ) : null}
        </h3>
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
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-blue-100 bg-blue-50/60">
        {previewHtml ? (
          <iframe
            key={`${huidigePagina}${previewHash}`}
            srcDoc={bouwPreviewDocument(previewHtml, previewHash)}
            title={`Demo-preview — ${paginaLabel(huidigePagina)}`}
            className="h-[500px] bg-white/80 transition-[width]"
            style={{ width: VIEWPORT_WIDTH[viewport] }}
          />
        ) : (
          <p className="p-4 text-xs text-slate-400">{previewError ?? "Preview laden..."}</p>
        )}
      </div>
      {previewHtml && previewError ? <p className="text-xs text-red-600">{previewError}</p> : null}

      {demoUrl ? (
        <p className="text-xs text-slate-400">
          Publieke link: <span className="text-slate-500">{demoUrl}</span>
        </p>
      ) : null}

      {reviewLog.length > 0 ? (
        <div className="space-y-1 text-sm">
          <h4 className="font-medium text-slate-700">Review-log (3.4)</h4>
          {reviewLog.map((entry) => (
            <p key={entry.id} className="text-slate-600">
              [{entry.bron}] {entry.instructie_of_bevinding ?? entry.resultaat ?? entry.error_message}
            </p>
          ))}
        </div>
      ) : null}

      {/* Everything that changes the site happens here: one input, so there's
          never a question of which box an instruction belongs in. */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-slate-500">
          Aanpassen — typ hier wat er moet veranderen (3.5)
        </h4>

        {chatMessages.length > 0 || chatPending || uploadPending ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-blue-100 p-2 text-xs">
            {chatMessages.map((msg) => (
              <li
                key={msg.id}
                className={`whitespace-pre-wrap ${
                  msg.rol === "gebruiker"
                    ? "text-slate-800"
                    : msg.rol === "ai"
                      ? "text-slate-600"
                      : "text-slate-400"
                }`}
              >
                <span className="font-medium">{afzenderLabel(msg)}: </span>
                {msg.bericht}
                <span className="ml-1 text-[10px] text-slate-400">
                  {new Date(msg.aangemaakt_op).toLocaleString("nl-BE", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
            {chatPending || uploadPending ? (
              <li className="flex items-center gap-1.5 text-slate-400">
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                </span>
                {uploadPending ? "bestand uitlezen..." : "aan het verwerken..."}
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="flex gap-2">
          <input
            ref={bestandInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
          <button
            type="button"
            onClick={() => bestandInput.current?.click()}
            disabled={chatPending || uploadPending}
            title="Voeg een foto of document toe: een menukaart of prijslijst wordt uitgelezen, een gewone foto komt op de site."
            aria-label="Bestand toevoegen"
            className="rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 disabled:opacity-50"
          >
            +
          </button>
          <input
            id="chatbox"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendChat();
            }}
            placeholder="bv. die kleur moet anders — of voeg links een menukaart toe"
            className="flex-1 rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none text-slate-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
          <button
            type="button"
            onClick={handleSendChat}
            disabled={chatPending || uploadPending}
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {chatPending ? "Bezig..." : "Verstuur"}
          </button>
        </div>

        {/* Same text, bigger hammer: a patch edit changes what you asked for,
            a regeneration rebuilds the whole site with it as guidance. */}
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={pending || chatPending || uploadPending}
          className="w-full rounded-xl border border-blue-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50"
        >
          {pending
            ? "Bezig..."
            : chatInput.trim()
              ? "Of: hele site opnieuw genereren met deze instructie"
              : "Of: hele site opnieuw genereren"}
        </button>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>

      <button
        type="button"
        onClick={() => setSendDialogOpen(true)}
        disabled={lead.status !== "klaar" || !lead.contact_email}
        title={
          lead.status !== "klaar"
            ? "Enkel beschikbaar zodra de status 'Klaar' is (spec 3.6)."
            : !lead.contact_email
              ? "Deze lead heeft geen contact e-mailadres."
              : undefined
        }
        className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:bg-blue-50 disabled:text-slate-500"
      >
        Verstuur naar lead
      </button>

      {sendDialogOpen ? (
        <SendDialog lead={lead} onClose={() => setSendDialogOpen(false)} onSent={onChanged} />
      ) : null}
    </section>
  );
}
