# Web Agency Dashboard — CLAUDE.md v2.0 (bindend contract)

*Voor Claude Code — volledige bouwinstructies. Dit document is het resultaat van een
uitgebreide vergadering tussen Warre en Claude, gebaseerd op twee eerdere projecten
(AIWebCompany en Wouter v5) die als bronmateriaal dienden — niet als fundament om op
verder te bouwen. Dit is een nieuw project.*

------------------------------------------------------------------------

## 0. Visie en context

Warre Deckers & Garen Yousef runnen een webagency die websites en webshops bouwt voor
Belgische KMO's, met focus op ambachten (bloemenwinkels, bakkers, slagers, en gelijkaardig)
als startsectoren.

Dit dashboard is de **interne werktool** van het bureau: van koude lead tot betalende klant,
inclusief nazorg. Het vervangt geen mens — het is geen "collega" zoals Wouter dat probeerde te
zijn (dat faalde precies daardoor), het is een gereedschap dat Warre en Garen zelf bedienen,
knop per knop.

**Kernprincipe, leidend voor elke bouwbeslissing:** simpel > compleet. Elke stap doet één ding.
Geen enkele stap probeert te raden of te improviseren wat de volgende stap nodig heeft —
alles wat de pipeline nodig heeft, wordt expliciet doorgegeven.

## 1. Niet-doelen (bewust buiten scope v1)

- Geen klant-login op dit dashboard — de klant komt hier nooit in. Voor webshops krijgt de
  klant een *Shopify staff-account* (zie sectie 6), niet toegang tot deze app.
- Geen AI-orchestrator die zelf beslist wie te bellen/mailen of wanneer — elke actie wordt
  door Warre of Garen bewust gestart via een knop.
- Geen ChromaDB / vectordatabank — voorkeuren en sectorkennis zijn gewone databanktabellen
  met keyword/tag-matching. Pas heroverwegen als het aantal regels in de honderden loopt en
  keyword-matching niet meer volstaat (dan: pgvector-extensie op dezelfde Postgres-databank,
  geen apart systeem).
- Geen "versies combineren" (bv. "structuur van v4, kleuren van v1") — bekende, mogelijk
  waardevolle uitbreiding, maar niet nu bouwen. Enkel oppikken als na een paar weken gebruik
  blijkt dat het gemist wordt.
- Geen ingebouwde mailclient/inbox — een knop die Gmail opent, gefilterd op het e-mailadres
  van de lead/klant, volstaat.
- Geen automatische follow-up mailsequenties — opvolging blijft manueel (bellen/mailen door
  Warre/Garen), het dashboard toont enkel wie geopend heeft en hoe lang geleden.

## 2. Architectuur

- **Client:** Tauri-app (lichter dan Electron) — een React/Next.js-interface verpakt tot een
  installeerbare desktop-app op Windows, met eigen venster en icoon. Reden: Warre en Garen
  willen een "echte applicatie", niet een browsertab, maar wel altijd online (geen offline-modus
  — alle data en AI-calls vereisen internet toch al).
- **Backend/databank:** Supabase (Postgres + Auth + Storage) — één centrale, gedeelde bron.
  Warre en Garen loggen elk apart in met eigen account en zien exact dezelfde data, live.
  Geen sync-laag nodig — er is maar één bron.
- **Achtergrondtaken:** een `jobs`-tabel + lichte worker (Supabase Edge Functions of een
  polling-worker) — geen agent-framework, geen LangChain/CrewAI/LangGraph.
- **Auth:** exact 2 accounts (Warre, Garen) via Supabase Auth. Geen publieke registratie.
- **Externe API's:** Anthropic (research/generatie/review/chat-edit), Shopify Admin API,
  Gmail API (verzenden) — alle calls lopen server-side (Edge Function secrets), nooit met
  blootgestelde keys in de geïnstalleerde client.

## 3. De pipeline

### 3.1 — Lead intake
- Bron: manueel toegevoegd via `+ Lead`, of een aparte, reeds bestaande KBO-scraping-stap die
  leads in dezelfde tabel plaatst (dit dashboard bouwt de scraper niet zelf, enkel de consumptie
  ervan — anders wordt lead-generatie zelf weer een apart project).
- Statusketen: `Nieuw → Research → Genereren → Klaar → Verzonden → Geopend → Klant → Dood`
- Elke lead heeft een `notities`/briefing-veld: alles wat Warre/Garen expliciet weten van
  een salesgesprek. Dit heeft **voorrang** boven wat de AI zelf online vindt.

### 3.2 — Research (nieuwe, herbruikbare stap — niet in v1 van AIWebCompany, wél nodig)
- Zoekt: logo, publieke bedrijfsinfo, "verhaal" van het bedrijf, sfeerbeelden
- **Regel: nooit verzinnen.** Onzekere feiten (bv. een oprichtingsjaar dat niet met zekerheid
  te bevestigen is) worden weggelaten, nooit gegokt. Info die de klant zelf gaf via het
  notities-veld wordt wél vertrouwd en gebruikt zonder verificatie.
- Output gaat naar **twee** plekken: de generator (om mee te bouwen) én de reviewer (om achteraf
  te controleren of wat gegenereerd werd, klopt met wat gevonden werd) — dit is een bewuste
  wijziging t.o.v. Wouter, waar de reviewer enkel de eindsite zag, niet de bronnen.

### 3.3 — Generatie (twee paden, afhankelijk van fase)
**Koude demo (vóór conversie, altijd):**
- Eén AI-call genereert een volledig zelfstandig HTML-bestand (Tailwind CDN), naar het
  patroon van AIWebCompany's `website_builder.py` — snel, goedkoop, geen Shopify-infrastructuur
  nodig voor iets dat nog geen betalende klant is.
- Voordien wordt relevante `sector_kennis` en `stijlvoorkeuren` opgehaald (zie 3.7) en meegegeven
  in de prompt — retrieval als stap in de pipeline, geen zelfstandig "brein".
- Ontwerp: gebruik een beperkte set gecureerde layout-/kleurpatronen per sectorcategorie
  (horeca, ambacht, diensten...) als richtlijn in de prompt, geen vrij-verzonnen design —
  dit verkleint het risico op een lelijk resultaat en het aantal nodige review-iteraties.
- Budget: **max €5 per gegenereerde demo** (research + generatie + review-iteraties samen).
  Ruwe schatting bij normaal gebruik: €0,60 (1 iteratie) tot €2,70 (5 iteraties) — er is marge,
  maar de budgetbewaking (zie 3.9, overgenomen uit Wouter) moet er wel zijn zodat een
  uitschieter zichtbaar wordt, niet blind doorloopt.

**Echte bouw (na conversie naar klant):** zie sectie 3.8.

### 3.4 — Visuele review-loop (overgenomen principe uit Wouter, losstaand van de rest)
- Playwright headless screenshot van de gegenereerde site (homepage minstens)
- Een AI-call beoordeelt de screenshot(s) tegen `stijlvoorkeuren` én tegen de research-output
  (klopt de info?) — geeft gestructureerde feedback terug (goedgekeurd? wat mist? wat klopt niet?)
- Max 5 iteraties. Bij falen na 5 iteraties: status wordt `Geblokkeerd`, zichtbaar in de UI,
  geen automatische escalatie nodig (geen telefoon/mail-laag zoals Wouter — Warre/Garen zien
  het gewoon in de queue).

### 3.5 — Chat-based patch editing (kernbeslissing van deze spec — niet hetzelfde als generatie)
- Wanneer Warre/Garen na de review "die kleur moet anders" typen in de chatbox naast de
  preview: dit is **geen nieuwe generatie-call**. Een generatie-call herschrijft de hele pagina
  en verandert daardoor onvermijdelijk ook dingen die niet gevraagd waren.
- In plaats daarvan: een gerichte edit-call die de bestaande HTML/CSS (of, na conversie, de
  Shopify theme-instellingen) krijgt + de instructie, en enkel het gevraagde stuk aanpast —
  zelfde patch-principe als een `str_replace`-edit, niet een volledige herschrijving.
- Correcties die hier gegeven worden, worden opgeslagen in `stijlvoorkeuren`/`sector_kennis`
  voor toekomstige generaties (zie 3.7).
- Na conversie naar klant werkt dezelfde chatbox-interface op de `Klanten`-pagina, maar dan
  gericht op productbeheer i.p.v. design — zie 3.8.

### 3.6 — Versturen
- Knop `Verstuur` (actief zodra status `Klaar`) → mail-preview-venster (onderwerp + body,
  bewerkbaar) → bevestigen → verzending via Gmail API
- Trackinglink met redirect + open-tracking (whitelist enkel eigen demo-domeinen — geen open
  redirect)
- Bij opening: status → `Geopend` **en** een melding (mail naar het account van Warre/Garen):
  "[Klant] heeft je website geopend"

### 3.7 — Voorkeuren en sectorkennis (twee simpele tabellen, geen apart geheugensysteem)
```
stijlvoorkeuren: regel, context (optioneel), toegevoegd_door, datum
sector_kennis:   sector, regel, bron ("handmatig" | "geleerd uit review"), datum
```
- Startsectoren om handmatig te vullen: bloemenwinkels, bakkers, slagers, en vergelijkbare
  ambachten. Andere sectoren groeien organisch aan via de reviewloop.
- De generator en de reviewer halen enkel op wat matcht met de sector van de huidige lead —
  geen volledige lijst meesturen bij elke call.

### 3.8 — Conversie naar klant + echte bouw
- Knop `Markeer als klant` (overal beschikbaar, ongeacht status)
- **Automatisch**, geen extra bevestigingsstap: bij klik wordt gestart met de content/structuur
  van de statische demo als startpunt. Bewuste keuze door Warre: "automatisch aanmaken" ≠
  "automatisch live zetten" — er wordt nooit gepubliceerd zonder expliciete actie nadien.
- Bij conversie kiest Warre/Garen expliciet het type: `statisch` of `shopify` — beide moeten
  ondersteund worden, geen automatische afleiding. Reden: niet elke klant heeft een webshop
  nodig, en Shopify kost overhead (abonnement) die je niet wil opleggen aan een klant zonder
  productverkoop.
  - **Type `shopify`:** development store via Shopify Partner API, Dawn-theme als basis,
    nooit gepubliceerd zonder expliciete actie. De chat-editor (3.5) spreekt de Shopify
    Admin API aan voor wijzigingen.
  - **Type `statisch`:** blijft een HTML/CSS-bestand, gehost op een lichte host (bv.
    Vercel/Netlify). De chat-editor patcht rechtstreeks in de bestanden.
  - **Belangrijk voor Claude Code:** de chat-editor-interface in de UI is voor beide types
    identiek — de gebruiker (Warre/Garen) merkt het onderscheid niet. Het systeem kiest
    intern welke backend (Shopify API vs. bestandspatch) wordt aangesproken op basis van
    het klanttype. Dit moet als aparte abstractielaag gebouwd worden, niet als twee
    losse UI's.
- Overgenomen uit Wouter (geen discussie nodig, gewoon meenemen): de rate-limiter voor
  Shopify GraphQL-calls (bucket-tracking via de `X-Shopify-Shop-Api-Call-Limit`-header,
  exponential backoff bij 429).

### 3.9 — Klantbeheer en onderhoud (enkel voor `shopify`-klanten)
- **Producttoevoegingen door de klant zelf:** de klant krijgt een Shopify **staff-account**,
  met permissies beperkt tot Producten (en optioneel Bestellingen) — geen toegang tot
  instellingen, thema, betaalproviders. Dit is Shopify's eigen, al bestaande product-UI —
  er wordt niets voor gebouwd in dit dashboard. De klant logt hier nooit in.
- **Onderhoud/aanpassingen die Warre/Garen zelf doen:** via dezelfde chatbox als 3.5, nu
  gericht op de Shopify Admin API i.p.v. design (bv. "voeg product toe: Lentetaart, €18,50" →
  gerichte `create product`-call). Zo blijft de echte Shopify-admin-interface standaard dicht;
  jullie werken altijd via het eigen dashboard.
- `Open in Shopify admin`-link blijft beschikbaar voor eenmalige instellingen die te specifiek
  zijn voor de chat (verzendinstellingen, betaalproviders) — dingen die maar één keer per klant
  gebeuren.
- **Budgetbewaking per project**, overgenomen uit Wouter maar vereenvoudigd: kost per
  AI-call loggen (project_id, model, tokens in/uit, kost), zichtbaar als totaal per lead/klant
  in het dashboard — geen automatische stop/escalatie nodig zoals bij Wouter, gewoon
  zichtbaarheid zodat een uitschieter opvalt.

## 4. UI/UX — scherm voor scherm

**1. Login** — Supabase Auth, Warre of Garen logt in. Geen registratie zichtbaar.

**2. Layout** — vast linkermenu: `Overzicht | Leads | Verstuurd | Klanten | Voorkeuren`.
Rechtsboven: ingelogde gebruiker + uitloggen.

**3. Overzicht** — kerncijfers in kaartjes: nieuwe leads deze week, demo's in generatie,
verstuurd, geopend (actielijst), nieuwe klanten deze maand. Geen tabel — puur "waar moet ik nu
op klikken".

**4. Leads** — tabel (bedrijfsnaam, sector, status-badge, datum). `+ Lead toevoegen`-knop,
statusfilter. Klik op rij → detailpaneel (side panel, geen page reload):
   - Bedrijfsgegevens + notities/briefing-veld
   - Statusbalk: `Nieuw → Research → Genereren → Klaar → Verzonden → Geopend → Klant`
   - Actieknop die meeverandert met status: `Genereer demo` → `Bezig...` (niet-blokkerend,
     andere leads blijven bruikbaar) → `Bekijk demo`

**5. Demo-preview** — binnen het detailpaneel: live preview met desktop/mobiel-toggle
bovenaan (breedte van de iframe wisselt), chatbox ernaast (of eronder in mobiele weergave)
voor gerichte aanpassingen zoals in 3.5. Automatische review-notities zichtbaar. Knoppen:
`Verstuur naar lead` / `Opnieuw genereren met extra instructies`.

**6. Versturen** — mail-preview-venster (onderwerp + body, bewerkbaar) → bevestigen → status
→ `Verzonden`.

**7. Verstuurd** — lijst van alles wat verstuurd is, kolom "geopend? wanneer?" — werklijst voor
opvolging (telefoon/mail, manueel).

**8. Klanten** — lijst: klantnaam, type (statisch/shopify), site-status, link naar demo-editor
(dezelfde chatbox-interface als 5, nu gericht op onderhoud/producten), voor shopify-klanten ook
een `Genereer staff-uitnodiging`-knop (Shopify staff-account met beperkte rechten aanmaken).

**9. Voorkeuren** — twee tabs: `Stijlvoorkeuren` en `Sectorkennis`. Rijen manueel toe te voegen,
groeien automatisch aan via de reviewloop en chat-edits.

## 5. Datamodel (kern)

```
leads
  id, bedrijfsnaam, sector, adres, contact_email, contact_naam, notities,
  status, demo_url, klant_type (null | statisch | shopify), shopify_store_id,
  laatste_update, aangemaakt_op

jobs
  id, lead_id, type (research | generate_demo | review | build_shopify),
  status (queued/running/done/failed), error_message, aangemaakt_op, afgerond_op

klanten
  id, lead_id (fk), type (statisch | shopify), definitief_domein,
  shopify_staff_account_status, site_status, laatst_gecontroleerd_op

email_events
  id, lead_id, type (verzonden/geopend), timestamp

stijlvoorkeuren
  id, regel, context, toegevoegd_door, datum

sector_kennis
  id, sector, regel, bron, datum

project_kosten
  id, lead_id, stap (research/generatie/review/chat_edit), model,
  tokens_in, tokens_out, kost_eur, timestamp
```

## 6. Security (verplichte sectie)

- Geen publieke registratie — enkel 2 vooraf aangemaakte accounts (Warre, Garen) via Supabase Auth
- Shopify API-keys, Gmail credentials en Anthropic API-key nooit in de client — enkel server-side
  (Supabase Edge Function secrets)
- Tracking-redirect-endpoint: whitelist enkel eigen demo-domeinen, geen open redirect
- Rate-limit op `Genereer demo` (max 1 actieve job per lead) om dubbele generaties/stores te
  vermijden
- Shopify staff-accounts voor klanten: altijd expliciet scoped tot Producten (+ optioneel
  Bestellingen), nooit volledige rechten — dit is de enige vorm van "klant-toegang" die bestaat,
  en die loopt via Shopify zelf, niet via dit dashboard
- Alle databank-writes via de backend (Edge Functions), nooit rechtstreeks vanuit de client met
  een service-role key
- Chat-edits (3.5) mogen enkel het specifiek gevraagde wijzigen — de edit-call krijgt nooit
  bredere schrijfrechten dan het huidige bestand/de huidige Shopify-resource waarop gepatcht wordt

## 7. Bouwopdracht voor Claude Code

Bouw stap per stap, elke stap volledig werkend en getest voor je verdergaat. Rapporteer aan
het einde van elke stap, vraag bevestiging voor je verdergaat.

| Stap | Inhoud |
|---|---|
| 1 | Supabase-project: schema (sectie 5), Auth met 2 accounts, RLS-policies |
| 2 | Tauri + Next.js skeleton: layout, login, navigatie (sectie 4.1-4.2) |
| 3 | Leads-scherm + detailpaneel (4.4), CRUD op `leads` |
| 4 | Research-stap (3.2) als job-type, incl. "nooit verzinnen"-regel in de prompt |
| 5 | Generatie-stap statisch (3.3), gebruik makend van `stijlvoorkeuren`/`sector_kennis`-retrieval |
| 6 | Review-loop (3.4): Playwright screenshot + beoordelings-call, max 5 iteraties |
| 7 | Demo-preview scherm (4.5): desktop/mobiel-toggle + chatbox |
| 8 | Chat-based patch editing voor statische sites (3.5, statisch-pad) |
| 9 | Versturen + tracking + open-notificatie (3.6, 4.6, 4.7) |
| 10 | Conversie naar klant (3.8): keuze statisch/shopify, Shopify dev-store-bouw + rate limiter |
| 11 | Chat-based patch editing voor Shopify (3.5/3.9, shopify-pad) incl. productbeheer via chat |
| 12 | Shopify staff-account-uitnodiging vanuit de Klanten-pagina (3.9) |
| 13 | Kostenlogging (`project_kosten`) + zichtbaarheid in UI |


