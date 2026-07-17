"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Lead } from "@/lib/types";
import { startGeneration } from "./generate-actions";
import { startPatchEdit } from "./patch-actions";
import { SendDialog } from "./send-dialog";

type Viewport = "desktop" | "mobiel";

const VIEWPORT_WIDTH: Record<Viewport, string> = {
  desktop: "100%",
  mobiel: "375px",
};

type ChatMessage = { role: "user" | "systeem"; text: string };

export function DemoPreview({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [extraInstructies, setExtraInstructies] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatPending, startChatTransition] = useTransition();
  const [previewVersion, setPreviewVersion] = useState(0);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const result = await startGeneration(lead.id, extraInstructies || undefined);
      if (result) {
        setError(result);
      } else {
        setExtraInstructies("");
        router.refresh();
      }
    });
  }

  function handleSendChat() {
    const instruction = chatInput.trim();
    if (!instruction) return;

    setChatMessages((prev) => [...prev, { role: "user", text: instruction }]);
    setChatInput("");

    startChatTransition(async () => {
      const result = await startPatchEdit(lead.id, instruction);
      if (result) {
        setChatMessages((prev) => [...prev, { role: "systeem", text: result }]);
      } else {
        setChatMessages((prev) => [...prev, { role: "systeem", text: "Wijziging doorgevoerd." }]);
        setPreviewVersion((v) => v + 1);
      }
    });
  }

  const previewSrc = lead.demo_url
    ? `${lead.demo_url}${lead.demo_url.includes("?") ? "&" : "?"}v=${previewVersion}`
    : undefined;

  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-700">Demo-preview</h3>
        <div className="flex gap-1 text-xs">
          {(["desktop", "mobiel"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setViewport(v)}
              className={`rounded-md px-2 py-1 font-medium ${
                viewport === v
                  ? "bg-neutral-900 text-white"
                  : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {v === "desktop" ? "Desktop" : "Mobiel"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
        <iframe
          src={previewSrc}
          title="Demo-preview"
          className="h-[500px] bg-white transition-[width]"
          style={{ width: VIEWPORT_WIDTH[viewport] }}
        />
      </div>

      {lead.review_notitie ? (
        <div className="space-y-1 text-sm">
          <h4 className="font-medium text-neutral-700">Review-notities (3.4)</h4>
          <p className="text-neutral-600">
            {lead.review_notitie.goedgekeurd ? "Goedgekeurd" : "Niet goedgekeurd"} na{" "}
            {lead.review_notitie.iteraties} iteratie
            {lead.review_notitie.iteraties === 1 ? "" : "s"}
          </p>
          {lead.review_notitie.feedback ? (
            <p className="text-neutral-600">{lead.review_notitie.feedback}</p>
          ) : null}
          {lead.review_notitie.mist.length > 0 ? (
            <p className="text-neutral-600">Ontbreekt: {lead.review_notitie.mist.join("; ")}</p>
          ) : null}
          {lead.review_notitie.klopt_niet.length > 0 ? (
            <p className="text-neutral-600">
              Klopt niet: {lead.review_notitie.klopt_niet.join("; ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1">
        <h4 className="text-xs font-medium text-neutral-500">Chat-based bewerken (3.5)</h4>

        {chatMessages.length > 0 ? (
          <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 text-xs">
            {chatMessages.map((msg, i) => (
              <li key={i} className={msg.role === "user" ? "text-neutral-800" : "text-neutral-500"}>
                <span className="font-medium">{msg.role === "user" ? "Jij: " : "Systeem: "}</span>
                {msg.text}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex gap-2">
          <input
            id="chatbox"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendChat();
            }}
            placeholder="bv. die kleur moet anders"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button
            type="button"
            onClick={handleSendChat}
            disabled={chatPending}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {chatPending ? "Bezig..." : "Verstuur"}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="extra-instructies" className="text-xs font-medium text-neutral-500">
          Opnieuw genereren met extra instructies
        </label>
        <textarea
          id="extra-instructies"
          value={extraInstructies}
          onChange={(e) => setExtraInstructies(e.target.value)}
          rows={2}
          placeholder="bv. gebruik een lichtere achtergrondkleur"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={pending}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Opnieuw genereren met extra instructies"}
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
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:bg-neutral-200 disabled:text-neutral-500"
      >
        Verstuur naar lead
      </button>

      {sendDialogOpen ? (
        <SendDialog lead={lead} onClose={() => setSendDialogOpen(false)} />
      ) : null}
    </section>
  );
}
