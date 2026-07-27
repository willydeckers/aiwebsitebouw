"use client";

import { useActionState, useEffect, useRef } from "react";
import { createLead } from "./actions";

export function AddLeadDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [error, formAction, pending] = useActionState(createLead, null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !error) {
      formRef.current?.reset();
      onCreated();
      onClose();
    }
    wasPending.current = pending;
  }, [pending, error, onClose, onCreated]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm">
      <form
        ref={formRef}
        action={formAction}
        className="w-full max-w-md space-y-3 overflow-hidden rounded-3xl border border-white/60 bg-white/80 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Lead toevoegen
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sluiten"
            className="rounded-full p-1.5 text-slate-400 transition-all duration-200 hover:rotate-90 hover:bg-slate-900/5 hover:text-slate-700"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <Field label="Bedrijfsnaam" name="bedrijfsnaam" required />
        <Field label="Sector" name="sector" required />
        <Field label="Adres" name="adres" />
        <Field label="Contact e-mail" name="contact_email" type="email" noSpellCheck />
        <Field label="Contactpersoon" name="contact_naam" noSpellCheck />

        <div className="space-y-1">
          <label htmlFor="notities" className="text-sm text-slate-600">
            Notities / briefing
          </label>
          <textarea
            id="notities"
            name="notities"
            rows={3}
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-blue-300/50 transition hover:bg-blue-500 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Toevoegen"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  noSpellCheck = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  noSpellCheck?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="text-sm text-slate-600">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        spellCheck={!noSpellCheck}
        autoCorrect={noSpellCheck ? "off" : undefined}
        className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
      />
    </div>
  );
}
