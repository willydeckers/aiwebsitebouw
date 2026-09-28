"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import type { SiteVersion } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { startGeneration } from "./generate-actions";
import { startPatchEdit, type PatchEditResult } from "./patch-actions";
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
  /** Zonder argument: wat er in het invoerveld staat. De hergenereer-dialoog
   *  geeft zijn eigen tekst mee. */
  genereerOpnieuw: (instructie?: string) => void;
  voegBestandToe: (file: File) => void;
};

/**
 * `siteVersion` mag null zijn: dan bestaat er nog geen site om aan te passen.
 * Dat is geen randgeval maar de gewone toestand van een verse lead, en tot nu
 * was de chat daar simpelweg onbereikbaar terwijl het paneel wel suggereerde
 * dat je kon chatten. Zonder versie wordt een bericht een briefing voor de
 * eerste generatie in plaats van een patch — dezelfde tekst, het enige
 * zinnige gevolg.
 */
export type ChatOpties = {
  /**
   * Hoe een gerichte aanpassing wordt uitgevoerd. Standaard gaat dat naar
   * chat-edit-static; het klantenscherm geeft hier een variant mee die op
   * klant_type kiest tussen de statische en de Shopify-backend. Zo blijft er
   * één chat-interface, met de backendkeuze op één plek — en niet twee
   * schermen die uit elkaar groeien, wat precies is wat er gebeurd was.
   */
  patch?: (leadId: string, instructie: string, versionId: string) => Promise<PatchEditResult>;
};

export function useLeadChat(
  leadId: string,
  siteVersion: SiteVersion | null,
  onChanged: () => void,
  onVersieGewijzigd?: () => void,
  opties: ChatOpties = {},
): LeadChat {
  // Elke aanroep van deze hook krijgt zijn eigen kanaalnaam.
  //
  // supabase-js geeft voor dezelfde topic hetzelfde kanaalobject terug, en een
  // tweede .on(...) daarop ná subscribe() gooit "cannot add postgres_changes
  // callbacks ... after subscribe()". Dat gebeurde zodra het strookje in het
  // paneel en de grote chatbox tegelijk openstonden — allebei dezelfde lead,
  // dus allebei dezelfde topic — en die uitzondering nam de hele pagina mee.
  // Dat is wat "de grote chatbox werkt niet" was.
  const instantieId = useId();
  const [berichten, setBerichten] = useState<ChatBericht[]>([]);
  const [invoer, setInvoer] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, startBezig] = useTransition();
  const [uploadBezig, startUpload] = useTransition();
  const genereerOpnieuwRef = useRef<(() => void) | null>(null);

  // History lives in the database, so it survives closing the panel and both
  // users see the same thread. Realtime keeps the two dashboards in step.
  useEffect(() => {
    let afgebroken = false;
    fetchChatGeschiedenis(leadId).then((rijen) => {
      if (!afgebroken) setBerichten(rijen);
    });

    const supabase = createClient();
    const channel = supabase
      .channel(`chat-${leadId}-${instantieId}`)
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
  }, [leadId, instantieId]);

  const verstuur = useCallback(() => {
    const instructie = invoer.trim();
    if (!instructie) return;
    setFout(null);

    // Nog geen site: dan valt er niets te patchen en is de enige zinnige
    // uitkomst dat deze tekst de briefing wordt voor de eerste generatie.
    if (!siteVersion) {
      genereerOpnieuwRef.current?.();
      return;
    }

    setInvoer("");

    startBezig(async () => {
      await voegChatBerichtToe({
        leadId,
        rol: "gebruiker",
        tekst: instructie,
        soort: "patch",
        siteVersionId: siteVersion.id,
      });

      // Expliciet de versie die op het scherm staat: sinds hergenereren een
      // nieuwe versie maakt, is "de nieuwste" niet noodzakelijk die.
      const resultaat = await (opties.patch ?? startPatchEdit)(leadId, instructie, siteVersion.id);
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
  }, [invoer, leadId, siteVersion, onChanged, onVersieGewijzigd, opties.patch]);

  const genereerOpnieuw = useCallback((meegegeven?: string) => {
    setFout(null);
    const uitInvoer = meegegeven === undefined;
    const instructie = (meegegeven ?? invoer).trim();

    startBezig(async () => {
      const resultaat = await startGeneration(leadId, instructie || undefined);
      if (resultaat) {
        setFout(resultaat);
        return;
      }
      if (uitInvoer) setInvoer("");
      if (instructie) {
        await voegChatBerichtToe({
          leadId,
          rol: "gebruiker",
          tekst: instructie,
          soort: "regeneratie",
          siteVersionId: siteVersion?.id ?? null,
        });
      }
      await voegChatBerichtToe({
        leadId,
        rol: "systeem",
        soort: "regeneratie",
        siteVersionId: siteVersion?.id ?? null,
        tekst: siteVersion
          ? `De hele site wordt opnieuw gegenereerd${instructie ? " met deze instructie" : ""}. Dat ` +
            `wordt een nieuwe versie; versie ${siteVersion.versienummer} blijft ongewijzigd staan. ` +
            "Duurt enkele minuten, en de worker moet draaien."
          : instructie
            ? "De site wordt voor het eerst gegenereerd met deze briefing. De worker moet daarvoor draaien."
            : "De site wordt voor het eerst gegenereerd. De worker moet daarvoor draaien.",
      });
      onChanged();
    });
  }, [invoer, leadId, siteVersion, onChanged]);

  const voegBestandToe = useCallback(
    (file: File) => {
      setFout(null);
      startUpload(async () => {
        await voegChatBerichtToe({
          leadId,
          rol: "gebruiker",
          tekst: `Bestand toegevoegd: ${file.name}`,
          soort: "upload",
          siteVersionId: siteVersion?.id ?? null,
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
          siteVersionId: siteVersion?.id ?? null,
          tekst: resultaat.tekst
            ? `Uitgelezen uit ${resultaat.bestandsnaam}:\n\n${resultaat.tekst}\n\nKlopt dit? Genereer opnieuw om het op de site te zetten.`
            : `${resultaat.bestandsnaam} staat klaar. Er stond geen leesbare tekst op, dus dit wordt als afbeelding gebruikt. Genereer opnieuw om het op de site te zetten.`,
        });
        onChanged();
      });
    },
    [leadId, siteVersion, onChanged],
  );

  // verstuur() valt hierop terug zolang er nog geen site is. Via een ref,
  // zodat de twee callbacks niet elk in elkaars afhankelijkheden moeten staan.
  useEffect(() => {
    genereerOpnieuwRef.current = genereerOpnieuw;
  }, [genereerOpnieuw]);

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
