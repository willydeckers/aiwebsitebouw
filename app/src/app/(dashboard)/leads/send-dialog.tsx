"use client";

import { useState, useTransition } from "react";
import type { Lead } from "@/lib/types";
import { sendDemoEmail } from "./send-actions";

export function SendDialog({
  lead,
  onClose,
  onSent,
}: {
  lead: Lead;
  onClose: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState(`Jouw nieuwe website: ${lead.bedrijfsnaam}`);
  const [body, setBody] = useState(
    `Hallo${lead.contact_naam ? ` ${lead.contact_naam}` : ""},\n\n` +
      `We hebben alvast een demo van jullie nieuwe website klaargezet.`,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await sendDemoEmail(lead.id, subject, body);
      if (result) {
        setError(result);
      } else {
        onClose();
        onSent();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm">
      <div className="w-full max-w-lg space-y-3 rounded-2xl bg-white/80 p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Verstuur naar {lead.contact_email}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Sluiten
          </button>
        </div>

        <div className="space-y-1">
          <label htmlFor="subject" className="text-sm text-slate-600">
            Onderwerp
          </label>
          <input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none text-slate-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="body" className="text-sm text-slate-600">
            Bericht
          </label>
          <textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none text-slate-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
          <p className="text-xs text-slate-400">
            De tracking-link naar de demo wordt automatisch onderaan toegevoegd.
          </p>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Versturen..." : "Bevestigen en versturen"}
        </button>
      </div>
    </div>
  );
}
