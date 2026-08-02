"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { SiteVersion } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { startGeneration } from "./generate-actions";
import { startPatchEdit } from "./patch-actions";
import { uploadEnLees } from "./site-interactie-actions";
import {
  fetchChatGeschiedenis,
  voegChatBerichtToe,
  type ChatBericht,
} from "./chat-geschiedenis";

// One conversation, two places to have it: the strip in the lead panel and the
// full-screen window. This hook owns all of it — history, sending, uploading,
// regenerating — so the two views can never drift apart in behaviour. They
// differ only in layout.

export type LeadChat = {
  berichten: ChatBericht[];
  invoer: string;
  setInvoer: (waarde: string) => void;
  bezig: boolean;
  uploadBezig: boolean;
  fout: string | null;
  verstuur: () => void;
  genereerOpnieuw: () => void;
  voegBestandToe: (file: File) => void;
};

export function useLeadChat(
  leadId: string,
  siteVersion: SiteVersion,
  onChanged: () => void,
  onVersieGewijzigd?: () => void,
): LeadChat {
  const [berichten, setBerichten] = useState<ChatBericht[]>([]);
  const [invoer, setInvoer] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, startBezig] = useTransition();
  const [uploadBezig, startUpload] = useTransition();

  // History lives in the database, so it survives closing the panel and both
  // users see the same thread. Realtime keeps the two dashboards in step.
  useEffect(() => {
    let afgebroken = false;
    fetchChatGeschiedenis(leadId).then((rijen) => {
      if (!afgebroken) setBerichten(rijen);
    });

    const supabase = createClient();
    const channel = supabase
      .channel(`chat-${leadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_berichten", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const nieuw = payload.new as ChatBericht;
          setBerichten((prev) => (prev.some((b) => b.id === nieuw.id) ? prev : [...prev, nieuw]));
        },
      )
      .subscribe();

    return () => {
      afgebroken = true;
      supabase.removeChannel(channel);
    };
  }, [leadId]);

  const verstuur = useCallback(() => {
    const instructie = invoer.trim();
    if (!instructie) return;
    setFout(null);
    setInvoer("");

    startBezig(async () => {
      await voegChatBerichtToe({
        leadId,
        rol: "gebruiker",
        tekst: instructie,
        soort: "patch",
        siteVersionId: siteVersion.id,
      });

      const resultaat = await startPatchEdit(leadId, instructie);
      if (resultaat.error) {
        await voegChatBerichtToe({ leadId, rol: "systeem", soort: "patch", tekst: resultaat.error });
        return;
      }
      await voegChatBerichtToe({
        leadId,
        rol: "ai",
        soort: "patch",
        siteVersionId: siteVersion.id,
        tekst:
          resultaat.antwoord ??
          (resultaat.toegepast ? "Wijziging doorgevoerd." : "Geen wijziging doorgevoerd."),
      });
      if (resultaat.toegepast) {
        onVersieGewijzigd?.();
        onChanged();
      }
    });
  }, [invoer, leadId, siteVersion.id, onChanged, onVersieGewijzigd]);

  const genereerOpnieuw = useCallback(() => {
    setFout(null);
    const instructie = invoer.trim();

    startBezig(async () => {
      const resultaat = await startGeneration(leadId, instructie || undefined);
      if (resultaat) {
        setFout(resultaat);
        return;
      }
      if (instructie) {
        setInvoer("");
        await voegChatBerichtToe({
          leadId,
          rol: "gebruiker",
          tekst: instructie,
          soort: "regeneratie",
          siteVersionId: siteVersion.id,
        });
      }
      await voegChatBerichtToe({
        leadId,
        rol: "systeem",
        soort: "regeneratie",
        siteVersionId: siteVersion.id,
        tekst: instructie
          ? "Hele site wordt opnieuw gegenereerd met deze instructie; dat levert een nieuwe versie op."
          : "Hele site wordt opnieuw gegenereerd; dat levert een nieuwe versie op.",
      });
      onChanged();
    });
  }, [invoer, leadId, siteVersion.id, onChanged]);

  const voegBestandToe = useCallback(
    (file: File) => {
      setFout(null);
      startUpload(async () => {
        await voegChatBerichtToe({
          leadId,
          rol: "gebruiker",
          tekst: `Bestand toegevoegd: ${file.name}`,
          soort: "upload",
          siteVersionId: siteVersion.id,
        });

        const resultaat = await uploadEnLees(leadId, file, "");
        if (resultaat.error) {
          await voegChatBerichtToe({ leadId, rol: "systeem", soort: "upload", tekst: resultaat.error });
          return;
        }
        await voegChatBerichtToe({
          leadId,
          rol: "systeem",
          soort: "upload",
          siteVersionId: siteVersion.id,
          tekst: resultaat.tekst
            ? `Uitgelezen uit ${resultaat.bestandsnaam}:\n\n${resultaat.tekst}\n\nKlopt dit? Genereer opnieuw om het op de site te zetten.`
            : `${resultaat.bestandsnaam} staat klaar. Er stond geen leesbare tekst op, dus dit wordt als afbeelding gebruikt. Genereer opnieuw om het op de site te zetten.`,
        });
        onChanged();
      });
    },
    [leadId, siteVersion.id, onChanged],
  );

  return {
    berichten,
    invoer,
    setInvoer,
    bezig,
    uploadBezig,
    fout,
    verstuur,
    genereerOpnieuw,
    voegBestandToe,
  };
}
