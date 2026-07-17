"use client";

import { useActionState, useEffect, useRef } from "react";
import { createLead } from "./actions";

export function AddLeadDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [error, formAction, pending] = useActionState(createLead, null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !error) {
      formRef.current?.reset();
      onClose();
    }
    wasPending.current = pending;
  }, [pending, error, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
      <form
        ref={formRef}
        action={formAction}
        className="w-full max-w-md space-y-3 rounded-lg bg-white p-6 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">
            Lead toevoegen
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-neutral-500 hover:text-neutral-800"
          >
            Sluiten
          </button>
        </div>

        <Field label="Bedrijfsnaam" name="bedrijfsnaam" required />
        <Field label="Sector" name="sector" required />
        <Field label="Adres" name="adres" />
        <Field label="Contact e-mail" name="contact_email" type="email" />
        <Field label="Contactpersoon" name="contact_naam" />

        <div className="space-y-1">
          <label htmlFor="notities" className="text-sm text-neutral-600">
            Notities / briefing
          </label>
          <textarea
            id="notities"
            name="notities"
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
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
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="text-sm text-neutral-600">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      />
    </div>
  );
}
