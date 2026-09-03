// Start alleen de lokale site-hosting, zonder de rest van de worker.
//
// Handig om een site aan iemand te tonen zonder dat de jobs-lus meedraait, en
// om die hosting los te kunnen testen:
//
//   cd worker && npx tsx --env-file=.env scripts/toon-site.ts
//
// De worker start dezelfde server zelf ook op, dus draait die al, dan heb je
// dit script niet nodig.
import { lokaleHostingUrl, startLokaleHosting } from "../src/hosting/lokale-server.js";

startLokaleHosting();
console.log(`Open een site op ${lokaleHostingUrl()}/<lead-id>/`);
