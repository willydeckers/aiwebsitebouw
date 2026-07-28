import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";

// Transcribes one uploaded image on demand, so a menu photo dropped into the
// chat box comes back readable straight away instead of only mattering at the
// next generation.
//
// This one CAN stay an Edge Function, unlike research and generation: it's a
// single vision call on a single image, seconds rather than minutes, nowhere
// near the ~150s ceiling that forced those two onto the worker.
//
// The worker runs the same transcription during generation for anything that
// hasn't been read yet (see media-ingest.ts), so an upload that happens while
// the app is closed still gets picked up. The cached result is what stops it
// being done twice.
const MODEL = Deno.env.get("MODEL_KWALITEIT") ?? "claude-opus-4-8";
const PROMPT_VERSIE = "lees-afbeelding-v1";

const LEES_PROMPT = `Je krijgt een foto die een klant heeft aangeleverd, meestal van een menukaart,
prijslijst of folder. Transcribeer wat er letterlijk op staat, zo volledig mogelijk en in dezelfde
taal als op de foto.

Regels:
- Neem ALLE items over, met hun prijzen en eventuele beschrijvingen. Sla niets over omdat het
  onbelangrijk lijkt; dit is de productlijst waarmee de website gebouwd wordt.
- PRIJZEN ZIJN VERPLICHT. Op een menukaart staat de prijs bijna altijd rechts uitgelijnd op
  dezelfde regel als het item, soms met puntjes of veel witruimte ertussen. Die hoort bij dat
  item — schrijf hem er pal achter, als "Item — € 4,20". Een item zonder prijs overnemen terwijl
  er wel een op de foto staat, is de ergste fout die je hier kan maken. Staat er echt nergens een
  prijs, laat het dan weg.
- Behoud de groepering (bv. "Warme dranken", "Koude dranken") als kopjes.
- Verzin NIETS. Kan je een woord of prijs niet met zekerheid lezen, zet er dan [onleesbaar]
  achter in plaats van te gokken.
- Is dit duidelijk geen menu/prijslijst/folder maar bijvoorbeeld een sfeerfoto of een logo,
  antwoord dan exact: GEEN_TEKST`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { bestandId } = await req.json();
    if (!bestandId) throw new Error("bestandId is verplicht.");

    const { data: rij, error: rijError } = await supabase
      .from("site_bestanden")
      .select("id, lead_id, bestandsnaam, opslag_pad, content_type")
      .eq("id", bestandId)
      .single();
    if (rijError || !rij) throw new Error(`Bestand niet gevonden: ${rijError?.message}`);

    if (!(rij.content_type ?? "").startsWith("image/") || rij.content_type === "image/svg+xml") {
      return new Response(JSON.stringify({ ok: true, tekst: null, reden: "geen afbeelding" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from("demos")
      .download(rij.opslag_pad);
    if (downloadError || !blob) throw new Error(`Kon afbeelding niet ophalen: ${downloadError?.message}`);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > 5 * 1024 * 1024) {
      throw new Error("Afbeelding is te groot om uit te lezen (max 5 MB).");
    }

    // btoa() on a big string blows the argument limit, so chunk it.
    let binair = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binair += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const base64 = btoa(binair);

    const client = createAnthropicClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: rij.content_type, data: base64 } },
            { type: "text", text: LEES_PROMPT },
          ],
        },
      ],
    });

    const blok = response.content.find((b) => b.type === "text");
    const ruw = blok && blok.type === "text" ? blok.text.trim() : "";
    const bruikbaar = ruw !== "" && !/^GEEN_TEKST$/i.test(ruw);

    await supabase.rpc("record_project_kost_if_under_budget", {
      p_lead_id: rij.lead_id,
      p_stap: "research",
      p_model: MODEL,
      p_tokens_in: response.usage.input_tokens,
      p_tokens_out: response.usage.output_tokens,
      p_kost_eur: calculateKostEur(MODEL, response.usage.input_tokens, response.usage.output_tokens),
      p_prompt_versie: PROMPT_VERSIE,
    });

    // "" rather than null when nothing readable: null means "not looked at
    // yet", and the worker would otherwise re-read this image on every run.
    await supabase
      .from("site_bestanden")
      .update({
        geextraheerde_tekst: bruikbaar ? ruw : "",
        tekst_geextraheerd_op: new Date().toISOString(),
      })
      .eq("id", rij.id);

    return new Response(JSON.stringify({ ok: true, tekst: bruikbaar ? ruw : null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
