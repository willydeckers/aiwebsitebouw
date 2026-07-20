# Web Agency Dashboard — CLAUDE.md v9.0 (bindend contract)

*Zelfstandig leesbaar. Wijzigingen t.o.v. v8: expliciete hostinglaag voor publiek toegankelijke
demo's/sites (dit ontbrak volledig), race-condition-fixes voor de budgetstop en de
"max 1 actieve job"-regel via databankconstraints i.p.v. applicatiecode, Storage-opruiming bij
lead-verwijdering, een dwingender GDPR-waarschuwing, een `geannuleerd`-jobstatus, expliciete
AI-modeltiers per stap, en een minimale testaanbeveling.*

------------------------------------------------------------------------

## 0. Visie

Warre en Garen runnen een webagency die websites en webshops bouwt voor Belgische KMO's, met
nadruk op ambachten (bloemenwinkels, bakkers, slagers, gelijkaardige sectoren) als startpunt.
Dit dashboard is hun interne werktool: van geautomatiseerd gevonden of manueel ingevoerde lead
tot betalende klant, inclusief nazorg. Twee mensen gebruiken dit — geen klant komt hier ooit in.

**Kernprincipe:** elke stap doet exact één ding, in een vaste, voorspelbare volgorde.

## 1. Niet-doelen (bewust buiten scope v1)

- Geen login voor klanten op dit dashboard.
- Geen systeem dat zelf beslist wie te bellen/mailen of wanneer.
- Geen vectordatabank voor voorkeuren/kennis.
- Geen orchestratie-framework (LangChain/CrewAI/LangGraph).
- Geen automatische verzending van outreach-mails.
- Geen combineren van elementen uit verschillende versies. Toekomstdoel, niet nu.
- Geen ingebouwde mailclient.
- Geen vooraf handgetekende ER-/sequence-diagrammen — gegenereerd bij oplevering uit de
  effectieve implementatie (sectie 9).
- **Geen grootschalige verzending vóór de GDPR-blokkade in sectie 7 is opgelost** (nieuw, zie
  daar).

## 2. Architectuur

- **Client:** Tauri-app — React/Next.js verpakt tot een geïnstalleerde desktop-applicatie,
  eigen venster en icoon (eigen logo, geen placeholder). Altijd online. Static export
  (`output: 'export'`), geen dynamic routes (query-parameters i.p.v. `/lead/[id]`).
- **Backend/databank:** Supabase (Postgres + Auth + Storage). RLS aan op elke tabel, enkel
  geauthenticeerde gebruikers, beide accounts volledige rechten. Dagelijkse back-ups/
  point-in-time recovery ingeschakeld.
- **Publieke hostinglaag voor demo's/sites (nieuw, ontbrak volledig — dit is een apart
  architectuurcomponent, geen detail van sectie 3.6):**
  - Een lichte Edge Function serveert de **actieve** `site_versions`-inhoud van een lead/klant
    publiek, op een eigen domein met een leesbare structuur — bv.
    `demo.jouwagency.be/{lead-slug}`. Deze functie haalt de HTML op uit Supabase Storage
    (zie hieronder) en serveert die rechtstreeks; geen kale Storage-object-URL wordt ooit naar
    een lead gestuurd.
  - De trackinglink uit sectie 3.6 wijst naar een aparte route op datzelfde domein (bv.
    `demo.jouwagency.be/t/{token}`) die het openen logt in `email_events` en dan doorstuurt naar
    de eigenlijke demo-URL hierboven.
  - Voor `shopify`-klanten is deze laag niet nodig — Shopify serveert zijn eigen (development-
    of live) store rechtstreeks.
- **Opslag van gegenereerde HTML:** Supabase Storage, met `content_referentie` in
  `site_versions` als het pad daarin (voor `demo`/`statisch`) of het Shopify `theme_id` (voor
  `shopify`).
- **Live UI-updates:** Supabase Realtime op `jobs`, `site_versions`, `review_log`.
- **Achtergrondtaken:**
  - Lichte taken (research, generatie, chat-edits, sourcing, KBO/Places, Gmail, het serveren
    van demo's): Edge Functions.
  - Zware taken (review-loop met Playwright/ffmpeg, Shopify-store-opbouw): aparte gehoste
    Node/Python-worker.
- **Auth (app-login):** 2 accounts, Supabase Auth, e-mail/wachtwoord, wachtwoord-vergeten-flow.
- **Auth (Gmail-verzending):** aparte OAuth-koppeling per gebruiker, scope `gmail.send`,
  Google-project in "In production"-status vóór oplevering.
- **Secrets:** Anthropic-, Shopify-, Google (Places+OAuth)- en Supabase-service-role-keys, stuk
  voor stuk als environment variables, server-side, nooit gecommit.
- **AI-modeltiers per stap (nieuw — was nergens vastgelegd, terwijl het budgetsysteem erop
  steunt):** configureerbaar via environment variable per stap (geen hard verankerde
  modelnaam in deze spec, want die veranderen sneller dan dit document):
  - Sourcing: contactnaam-extractie + personalisatie-pitch → een **goedkoop, snel model**
    (kleinste beschikbare tier)
  - Research, generatie, chat-edits → een **kwalitatief sterker model** (middelste/hoogste
    beschikbare tier — dit bepaalt de uiteindelijke kwaliteit van wat verkocht wordt)
  - Review-beoordeling → hetzelfde niveau als generatie, en **moet screenshots kunnen
    interpreteren** (vision-vaardig)
  Deze indeling ligt aan de basis van alle kostenramingen in dit document (€5/demo, €0,10/lead)
  — bij een modelwissel moet de raming herbekeken worden.

## 3. De pipeline

```
[Automatische sourcing-run] ─┐
                              ├─→ Lead, status "Nieuw"
[Manuele invoer]  ───────────┘
              → Research → Genereren (versie 1) → Review-loop
              → [chat-gestuurde aanpassingen, elke afgeronde ronde = nieuwe versie]
              → Versturen → Geopend → Klant (statisch of shopify)
              → [onderhoud: zelfde chat + versiemechanisme, nu op de live site]
```

### 3.1 — Lead intake

**a) Automatische sourcing-run** — jobtype `sourcing_run`:
1. Sourcing (KBO Open Data, NACE+postcode+actief-filter, KBO-nummer genormaliseerd naar pure
   cijfers vóór opslag/dedupe tegen `leads.kbo_nummer`)
2. KBO-webveld-check (gratis, vóór Places)
3. Places-matching (indien nodig, bij twijfel niet koppelen; enkel `google_place_id` onbeperkt
   bewaard)
4. Website-check (geen/kapot/matig, heuristiek gelogd)
5. Filteren (actief + sector + regio + website-status)
6. Verrijking (contactgegevens van de eigen bedrijfswebsite; manuele invoer heeft voorrang) —
   **let op de GDPR-regel in sectie 7 zodra een naam-gebonden e-mailadres gevonden wordt**
7. Personalisatie (pitch-tekst → startwaarde `notities`)
8. Opslag (nieuwe rij in `leads`, status `Nieuw`)

Budget: < €0,10/lead. Configureerbaar via het tandwiel-icoon op het Leads-scherm.

**b) Manuele invoer** — `+ Lead toevoegen`.

**LeadStatus (enum):** `Nieuw | Research | Genereren | Klaar | Verzonden | Geopend | Klant |
Dood`.

### 3.2 — Research-stap
Logo, bedrijfsverhaal, sfeerbeelden. Nooit verzinnen: onzekere feiten → open vraag.

### 3.3 — Generatie (versie 1)
Eén AI-call, volledig HTML-bestand (Tailwind CDN, componentenbibliotheken +
voorkeuren/sectorkennis). Automatisch **versie 1**, opgeslagen in Supabase Storage.
**Budget-hardstop, race-condition-vrij (nieuw — was vorige versie applicatie-niveau, nu
databank-niveau):** de check "cumulatieve kost < €5" en het wegschrijven van een nieuwe
`project_kosten`-rij gebeuren in **één atomaire databanktransactie** (een Postgres-functie met
een advisory lock per `lead_id`, of gelijkwaardige serialisatie) — niet als twee aparte stappen
vanuit de applicatiecode. Dit voorkomt dat twee gelijktijdige acties (bv. Warre en Garen die
tegelijk op dezelfde lead werken) allebei "nog onder budget" lezen vlak voor het plafond en het
alsnog overschrijden. Bij het bereiken van €5: status `Budget overschreden`, zichtbaar met het
exacte bedrag, manuele "toch doorgaan"-actie beschikbaar.

### 3.4 — Review-loop (aparte worker-service)
Playwright-screenshot (desktop+mobiel; bij animaties ook video + ffmpeg-sleutelbeelden).
AI-beoordeling (vision-vaardig model, zie sectie 2) tegen voorkeuren + research. Max 5
iteraties, elk gelogd (`review_log`) met foutdetails. Na 5 zonder goedkeuring: `Geblokkeerd`.

### 3.5 — Chat-gestuurde aanpassingen + versiegeschiedenis
Eén concept-versie + (na eerste afronding) één actieve versie. Instructie → gerichte patch. AI
stelt zelf voor de ronde af te ronden; handmatige knop ook beschikbaar. Teruggaan naar een
oudere versie maakt een nieuwe versie als kopie. Concurrency: UI toont via Realtime of de
andere gebruiker net bewerkt, weigert een conflicterende actie. Eenrichtingsregel (Shopify →
statisch) herkend en geweigerd met uitleg.

### 3.6 — Versturen naar de lead
Mail-preview → bevestigen → Gmail API. De verstuurde link wijst naar de trackingroute op de
hostinglaag (sectie 2), niet naar een kale Storage-URL. Bij opening: status → `Geopend`,
meldingsmail naar Warre/Garen.

### 3.7 — Conversie naar klant
`Markeer als klant`, automatisch bij klik (nooit automatisch gepubliceerd). Keuze
`statisch`/`shopify`, eenrichtingsverkeer. Actieve demo-versie wordt het startpunt.

### 3.8 — Shopify-opbouw en onderhoud (aparte worker-service)
Development store via Shopify Partner API, Dawn-basistheme. Rate limiter (verplicht,
race-condition-vrij: gebruik de `X-Shopify-Shop-Api-Call-Limit`-header en, bij gelijktijdige
calls vanuit beide gebruikers, een gedeelde teller met atomaire updates, geen losse lokale
tellers per sessie). Elke versie = een Shopify-thema; `Maak deze actief` publiceert zonder de
live site te verstoren. Onderhoud via dezelfde chatbox.

## 4. Klantbeheer door de klant zelf (enkel `shopify`)
Shopify staff-account, rechten beperkt tot Producten (+ optioneel Bestellingen).

## 5. UI/UX
Ongewijzigd t.o.v. v8 — login, layout met profielbol, Overzicht, Leads, Demo-preview, Versturen,
Verstuurd, Klanten, Voorkeuren.

## 6. Datamodel

```
leads
  id, bedrijfsnaam, sector, adres, contact_email, contact_naam, notities, open_vragen,
  status (LeadStatus), klant_type (null | statisch | shopify), shopify_store_id,
  herkomst (sourcing|manueel), kbo_nummer (uniek, genormaliseerd), rechtsvorm, nace_code,
  oprichtingsdatum, google_place_id, telefoon, telefoon_bron, website_status, website_url,
  website_url_bron, contact_email_bron, contact_email_persoonsgebonden (boolean, nieuw — zie
  GDPR-regel sectie 7), contact_method, bron_match,
  laatst_bewerkt_door, laatst_bewerkt_op, aangemaakt_op

jobs
  id, lead_id, type, status (JobStatus: wachtrij|bezig|klaar|mislukt|timeout|geannuleerd),
  gestart_op, afgerond_op, error_message, pogingen
  -- State machine: wachtrij→bezig→klaar (eindstatus) | bezig→timeout | timeout→wachtrij
  -- (manuele retry) | mislukt→wachtrij (manuele retry) | wachtrij/bezig→geannuleerd (manueel).
  -- "Max 1 actieve job per lead" afgedwongen via een partial unique index op (lead_id, type)
  -- WHERE status IN ('wachtrij','bezig') — databankconstraint, geen applicatie-check, om de
  -- race condition tussen twee gelijktijdige gebruikers uit te sluiten.

site_versions
  id, lead_id (fk, NOT NULL), site_type (demo|statisch|shopify), versienummer,
  status (concept|afgerond|actief), content_referentie, prompt_versie,
  laatst_bewerkt_door, laatst_bewerkt_op, aangemaakt_op

review_log
  id, lead_id (fk), site_version_id (fk), bron, instructie_of_bevinding, resultaat,
  error_message, prompt_versie, timestamp

klanten
  id, lead_id (fk), type, definitief_domein, shopify_staff_account_status,
  site_status, laatst_gecontroleerd_op

email_events
  id, lead_id (fk), type, timestamp

gmail_koppeling
  id, gebruiker (warre|garen), refresh_token (versleuteld), gekoppeld_op, status (actief|verlopen)

stijlvoorkeuren
  id, regel, context, toegevoegd_door, datum

sector_kennis
  id, sector, regel, bron, datum

project_kosten
  id, lead_id (fk), stap, model, prompt_versie, tokens_in, tokens_out, kost_eur, timestamp

sourcing_config
  id, nace_codes, postcodes, kwaliteitsdrempel_matig, run_frequentie,
  max_leads_per_run, laatst_uitgevoerd_op

gebruikers_profiel
  id, gebruiker (warre|garen), naam, profielfoto_url

ui_presets
  id, gebruiker, naam, thema, achtergrondkleur, accentkleur

audit_log
  id, gebruiker, actie, lead_id (fk, nullable), detail, timestamp
```

`ON DELETE CASCADE` op alle foreign keys naar `leads.id`. **Nieuw, verplicht:** een
databank-trigger (of een Edge Function die op de delete reageert) verwijdert bij het wissen van
een lead ook de bijhorende objecten in Supabase Storage (HTML-versies, screenshots) —
`ON DELETE CASCADE` ruimt enkel databankrijen op, niet de bestanden zelf; zonder deze stap
blijven verweesde, kostendragende Storage-objecten achter die nergens in de UI nog zichtbaar
zijn.

## 7. Security & compliance (verplichte sectie)

- Geen publieke registratie — 2 accounts, volwaardige wachtwoord-vergeten-flow
- RLS aan op elke tabel, enkel geauthenticeerde gebruikers, beide accounts volledige rechten
- Alle API-keys/tokens server-side via environment variables
- Gmail OAuth-consentscherm in "In production"-status vóór oplevering
- Tracking-redirect-endpoint (nieuw gespecificeerd in sectie 2): whitelist enkel het eigen
  demo-domein, geen open redirect
- **Race-condition-vrije constraints (nieuw):** "max 1 actieve job per lead" via een
  databank-constraint, niet een applicatie-check; de budgetstop via een atomaire transactie,
  niet check-dan-schrijf vanuit de applicatiecode
- Places-cachingregel: enkel `google_place_id` onbeperkt bewaard
- KBO-portaal-/website-scraping: robots.txt, redelijke snelheid, herkenbare User-Agent
- **GDPR/ePrivacy — aangescherpt, nieuw:** zolang de verrijkingsstap enkel generieke adressen
  vindt (`info@`, `contact@` van een rechtspersoon), is een opt-outlijst een redelijke basis.
  **Zodra een naam-gebonden adres gevonden wordt (`voornaam.naam@bedrijf.be`) betreft het een
  persoonsgegeven van een natuurlijke persoon, en is de rechtsgrond voor cold B2B-outreach
  onder Belgisch/EU-recht genuinely discutabel terrein — dit dekt een opt-outlijst niet
  automatisch af.** Concreet, bindend voor de bouw: markeer elk gevonden e-mailadres met een
  boolean `contact_email_persoonsgebonden` (op basis van een simpele heuristiek: bevat het
  adres een herkenbaar voornaam-achternaam-patroon i.p.v. een generiek voorvoegsel). **Voor
  grootschalig gebruik (voorbij een kleine testgroep) moet dit onderwerp eerst afgetoetst worden
  bij een advocaat gespecialiseerd in Belgisch/EU privacyrecht, specifiek voor deze opzet** —
  dit is geen vakgebied waar een spec-document of een AI-assistent een sluitend antwoord op kan
  geven. Tot die bevestiging er is: gebruik bij voorkeur het generieke adres wanneer er zowel
  een generiek als een persoonsgebonden adres gevonden wordt.
- SPF/DKIM/DMARC correct ingesteld op het verzenddomein
- Shopify staff-accounts: altijd beperkt tot Producten (+ optioneel Bestellingen)
- Alle databank-writes via de backend, nooit met een service-role key in de client
- Chat-edits wijzigen enkel het gevraagde
- Nieuwe Shopify-thema-versie publiceren enkel via een expliciete, aparte bevestigde actie
- Terugkeren naar een oudere versie is niet-destructief
- Dagelijkse back-ups/point-in-time recovery ingeschakeld
- Storage-opruiming bij lead-verwijdering (zie sectie 6)

## 8. Foutafhandeling, prestatie-eisen en testen

**Automatisch hersteld:** tijdelijke API-fouten (429, netwerktimeout) → backoff/retry op
call-niveau. Een mislukte review-iteratie binnen de 5-iteratielimiet → volgende iteratie
probeert automatisch opnieuw.

**Vereist menselijke tussenkomst:** job op `timeout`/`mislukt` na automatische retries op
call-niveau, `Geblokkeerd`, `Budget overschreden`, verlopen Gmail-koppeling, versie-conflict.

**Richttijden:** UI-update via Realtime binnen 1-2 sec, generatie-call < 1 min, review-iteratie
< 2 min, sourcing-run van 20 leads < 15 min.

**Geautomatiseerde tests (nieuw, minimaal):** een volledige testsuite is niet vereist voor een
team van twee, maar minstens een basis end-to-end-test voor de kritieke pad (lead aanmaken →
job triggeren → status via Realtime zien veranderen) en een test die bevestigt dat RLS-policies
effectief blokkeren voor een niet-geauthenticeerde aanvraag, worden aangeraden — zonder die twee
valt elke regressie pas op bij manueel testen.

## 9. Wat expliciet gecontroleerd/opgeleverd moet worden
- Eigen logo correct, geen placeholder van het UI-framework
- App voelt vlot aan
- RLS-policies effectief getest (beide accounts volledige toegang, niet-geauthenticeerd geweigerd)
- Een test-sourcing-run daadwerkelijk laten draaien
- Versie-kiezer testen: aanmaken, teruggaan, opnieuw actief maken
- Een job kunstmatig laten vastlopen en de timeout + manuele retry controleren
- Een lead verwijderen en zowel de databank-cascade **als de Storage-opruiming** controleren
- Twee gelijktijdige sessies simuleren: het versie-conflict, **en expliciet de race conditions
  op de budgetstop en "max 1 actieve job" — probeer bewust twee acties tegelijk te forceren en
  bevestig dat de databankconstraint/atomaire transactie het plafond nooit laat overschrijden**
- Gmail OAuth in "In production", verzending 7+ dagen na koppeling nog werkend
- Navigeren naar een lead-detailpagina en verversen (F5) — juiste lead blijft staan
- Een lead kunstmatig tegen het €5-budget laten aanlopen, hardstop bevestigen
- Gegenereerd ER-diagram + sequence-diagram van de job-pipeline als opleverdocumentatie
- Back-ups/point-in-time recovery aantoonbaar ingeschakeld
- **Nieuw: een verstuurde demo-link daadwerkelijk openen vanuit een test-mailbox en bevestigen
  dat hij op het eigen domein landt (niet een kale Storage-URL), en dat de trackingroute het
  openen correct logt vóór de doorverwijzing**
