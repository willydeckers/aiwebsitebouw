import { createServer } from "node:http";
import { createWorkerClient } from "../shared/supabase.js";

// De site tonen zoals ze eruitziet, in een echte browser.
//
// Waarom dit bestaat: op *.supabase.co lukt dat niet. De edge-gateway daar
// herschrijft élk antwoord dat niet al text/plain is naar text/plain — HTML én
// XML, gemeten op 2026-09-03 — met `Content-Security-Policy: default-src
// 'none'; sandbox` erbij. Een bezoeker ziet dus broncode. Dat is een
// platformregel op dat domein, geen instelling die wij kunnen zetten, en er is
// geen content-type dat eraan ontsnapt.
//
// Tot er een eigen domein is, serveert de worker de site daarom zelf. Dezelfde
// bestanden uit Storage, alleen zonder gateway ertussen, dus met de juiste
// Content-Type — en dan rendert een browser gewoon wat er staat.
//
// Bewust géén tweede implementatie van track-and-serve: geen toegangscodes,
// geen sitemap, geen rate limiting. Dit is een kijkvenster op de bestanden.
// Formulier- en review-verzoeken worden doorgestuurd naar de echte functie,
// zodat een demo waarin iemand het contactformulier invult niet halverwege
// stukloopt.

const STANDAARD_POORT = 4321;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
};

function contentType(naam: string): string {
  const ext = naam.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

export function lokaleHostingUrl(): string {
  const poort = Number(process.env.LOKALE_HOSTING_POORT ?? STANDAARD_POORT);
  return `http://localhost:${poort}`;
}

export function startLokaleHosting(): void {
  const poort = Number(process.env.LOKALE_HOSTING_POORT ?? STANDAARD_POORT);
  const supabase = createWorkerClient();
  const functieBasis = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${poort}`);
      const delen = url.pathname.split("/").filter(Boolean);
      const leadId = delen[0];

      if (!leadId) {
        res.writeHead(200, { "Content-Type": TYPES.html });
        res.end(
          "<!DOCTYPE html><meta charset='utf-8'><title>Lokale site-hosting</title>" +
            "<p style=\"font-family:system-ui;padding:2rem;color:#334155\">Voeg een lead-id toe aan het " +
            "adres, bijvoorbeeld <code>/&lt;lead-id&gt;/</code>. De link staat in het dashboard bij de site.</p>",
        );
        return;
      }

      // Formulieren en reviews blijven naar de echte functie gaan: die kent de
      // honeypot, de rate limiting en de moderatie, en dat willen we hier niet
      // half overdoen.
      const rest = delen.slice(1);
      if (rest[0] === "formulier" || rest[0] === "reviews") {
        if (!functieBasis) {
          res.writeHead(503, { "Content-Type": TYPES.txt });
          res.end("Geen SUPABASE_URL ingesteld, dus formulieren kunnen niet doorgestuurd worden.");
          return;
        }
        const doel = `${functieBasis}/functions/v1/track-and-serve/${leadId}/${rest[0]}`;
        // Buffer voldoet niet aan BodyInit in deze typings; als tekst
        // doorsturen is hier prima, het is JSON.
        const body = req.method === "POST" ? (await lees(req)).toString("utf8") : undefined;
        const antwoord = await fetch(doel, {
          method: req.method,
          headers: { "Content-Type": req.headers["content-type"] ?? "application/json" },
          body,
        });
        res.writeHead(antwoord.status, {
          "Content-Type": antwoord.headers.get("content-type") ?? TYPES.json,
        });
        res.end(Buffer.from(await antwoord.arrayBuffer()));
        return;
      }

      // Geüploade bestanden (een logo, een menukaart) staan niet in de map van
      // de versie maar op hun eigen pad in `site_bestanden`. Zonder deze route
      // zocht ik ze in de versiemap, vond ik niets, en bleef een logo leeg —
      // terwijl het in de app wél verscheen, want die vervangt afbeeldingen
      // door data-URI's voor de srcdoc-preview.
      if (rest[0] === "bestanden" && rest[1]) {
        const naam = decodeURIComponent(rest.slice(1).join("/"));
        const { data: rij } = await supabase
          .from("site_bestanden")
          .select("opslag_pad, content_type, bestandsnaam")
          .eq("lead_id", leadId)
          .eq("bestandsnaam", naam)
          .maybeSingle();

        if (!rij) {
          res.writeHead(404, { "Content-Type": TYPES.txt });
          res.end("Bestand niet gevonden.");
          return;
        }

        const { data: blob, error: bestandsFout } = await supabase.storage
          .from("demos")
          .download(rij.opslag_pad);
        if (bestandsFout || !blob) {
          res.writeHead(500, { "Content-Type": TYPES.txt });
          res.end("Kon bestand niet ophalen.");
          return;
        }

        // Zelfde afweging als track-and-serve: afbeeldingen inline, want een
        // logo hoort in een <img>. SVG niet — dat kan script bevatten en mag
        // hier niet uitvoeren.
        const type = rij.content_type ?? "application/octet-stream";
        const inline = type.startsWith("image/") && type !== "image/svg+xml";
        res.writeHead(200, {
          "Content-Type": type,
          "Content-Disposition": inline
            ? "inline"
            : `attachment; filename="${rij.bestandsnaam.replace(/"/g, "")}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        });
        res.end(Buffer.from(await blob.arrayBuffer()));
        return;
      }

      // De actieve versie is wat je wil tonen; is er nog geen, dan de nieuwste,
      // zodat een concept ook te bekijken is voor het live staat.
      const { data: versies } = await supabase
        .from("site_versions")
        .select("content_referentie, paginas, status, versienummer")
        .eq("lead_id", leadId)
        .order("versienummer", { ascending: false });

      const versie =
        (versies ?? []).find((v) => v.status === "actief") ?? (versies ?? [])[0] ?? null;

      if (!versie?.content_referentie) {
        res.writeHead(404, { "Content-Type": TYPES.html });
        res.end(
          "<!DOCTYPE html><meta charset='utf-8'><title>Geen site</title>" +
            "<p style=\"font-family:system-ui;padding:2rem;color:#334155\">Voor deze lead is nog geen " +
            "site gegenereerd.</p>",
        );
        return;
      }

      const map = versie.content_referentie.replace(/\/index\.html$/, "");
      const gevraagd = rest.join("/") || "index.html";
      const pad = gevraagd === "index.html" ? versie.content_referentie : `${map}/${gevraagd}`;

      // Alleen binnen de map van deze versie, en geen pad-trucs.
      if (gevraagd.includes("..")) {
        res.writeHead(400, { "Content-Type": TYPES.txt });
        res.end("Ongeldig pad.");
        return;
      }

      const { data: bestand, error } = await supabase.storage.from("demos").download(pad);
      if (error || !bestand) {
        res.writeHead(404, { "Content-Type": TYPES.html });
        res.end(
          "<!DOCTYPE html><meta charset='utf-8'><title>Niet gevonden</title>" +
            `<p style="font-family:system-ui;padding:2rem;color:#334155">${gevraagd} zit niet in deze versie.</p>`,
        );
        return;
      }

      res.writeHead(200, {
        "Content-Type": contentType(gevraagd),
        // Tijdens het werken wil je na een hergeneratie meteen het nieuwe zien.
        "Cache-Control": "no-store",
      });
      res.end(Buffer.from(await bestand.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { "Content-Type": TYPES.txt });
      res.end(`Fout: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  server.on("error", (err) => {
    console.error(`Lokale hosting kon niet starten op poort ${poort}: ${err.message}`);
  });

  server.listen(poort, () => {
    console.log(`Lokale site-hosting draait op ${lokaleHostingUrl()}/<lead-id>/`);
  });
}

function lees(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stukken: Buffer[] = [];
    req.on("data", (c) => stukken.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(stukken)));
    req.on("error", reject);
  });
}
