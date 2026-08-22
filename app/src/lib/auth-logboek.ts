// A trail of what happened to the session, kept in localStorage.
//
// "I get logged out for no visible reason" is impossible to fix from a
// description, because by the time the user notices they are on the login
// screen and the page state is gone. This records every auth event as it
// fires — including the one that caused the redirect — and survives it,
// because localStorage outlives the navigation.
//
// It holds event names and timestamps only. Never a token: this is diagnostic
// data that a user may well paste into a chat.

const SLEUTEL = "auth-logboek";
const MAX = 40;

export type AuthLogRegel = {
  moment: string;
  gebeurtenis: string;
  sessieAanwezig: boolean;
  /** Seconds until the access token expires, when a session is present. */
  verlooptOverSeconden: number | null;
  detail?: string;
};

export function noteerAuthGebeurtenis(regel: Omit<AuthLogRegel, "moment">) {
  if (typeof window === "undefined") return;
  try {
    const bestaand = leesAuthLogboek();
    const nieuw = [...bestaand, { moment: new Date().toISOString(), ...regel }].slice(-MAX);
    window.localStorage.setItem(SLEUTEL, JSON.stringify(nieuw));
  } catch {
    // A full or blocked localStorage must never break the app over a log line.
  }
}

export function leesAuthLogboek(): AuthLogRegel[] {
  if (typeof window === "undefined") return [];
  try {
    const ruw = window.localStorage.getItem(SLEUTEL);
    return ruw ? (JSON.parse(ruw) as AuthLogRegel[]) : [];
  } catch {
    return [];
  }
}

export function wisAuthLogboek() {
  try {
    window.localStorage.removeItem(SLEUTEL);
  } catch {
    // Same reasoning as above.
  }
}
