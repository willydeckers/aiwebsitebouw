"use client";

import { useState } from "react";
import { leesAuthLogboek, wisAuthLogboek, type AuthLogRegel } from "@/lib/auth-logboek";

/**
 * Shows what actually happened to the session.
 *
 * Being logged out "for no visible reason" can't be diagnosed from a
 * description — by the time you notice, you're on the login screen. Every auth
 * event is recorded to localStorage as it fires, so it survives the redirect
 * and can be read back here. Event names and timings only, never a token.
 */
export function SessieDiagnose() {
  const [regels, setRegels] = useState<AuthLogRegel[]>([]);
  const [open, setOpen] = useState(false);

  // Read on click rather than in an effect: localStorage is synchronous and
  // this is a user action, not something to synchronise with.
  function schakel() {
    if (!open) setRegels(leesAuthLogboek());
    setOpen((v) => !v);
  }

  return (
    <section className="mt-6 max-w-3xl rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl">
      <button
        type="button"
        onClick={schakel}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-medium text-slate-700">Sessie-diagnose</span>
        <span className="text-xs text-slate-400">{open ? "verbergen" : "tonen"}</span>
      </button>

      {open ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            Word je onverwacht uitgelogd? Hier staat wat er met je sessie gebeurde. Alleen
            gebeurtenisnamen en tijdstippen — geen tokens.
          </p>
          {regels.length === 0 ? (
            <p className="text-sm text-slate-400">Nog niets geregistreerd.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
              {[...regels].reverse().map((r, i) => (
                <li key={i} className="rounded-lg border border-slate-100 px-2 py-1">
                  <span className="text-slate-400">
                    {new Date(r.moment).toLocaleString("nl-BE")}
                  </span>{" "}
                  <span className="font-medium text-slate-800">{r.gebeurtenis}</span>
                  <span className="text-slate-500">
                    {r.sessieAanwezig ? " · sessie aanwezig" : " · geen sessie"}
                    {r.verlooptOverSeconden !== null
                      ? ` · verloopt over ${Math.round(r.verlooptOverSeconden / 60)} min`
                      : ""}
                  </span>
                  {r.detail ? <span className="block text-slate-500">{r.detail}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              wisAuthLogboek();
              setRegels([]);
            }}
            className="text-xs text-slate-500 hover:underline"
          >
            Logboek wissen
          </button>
        </div>
      ) : null}
    </section>
  );
}
