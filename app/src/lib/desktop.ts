// The bridge to the desktop shell.
//
// The same build runs in three places: `next dev` in a browser, the static
// export in a browser, and inside Tauri. Only the last one has a Rust side, so
// everything here has to answer sensibly when there isn't one — a browser tab
// is not a broken desktop app, it just doesn't manage the worker itself.

export type WorkerConfig = {
  supabase_url: string;
  supabase_service_role_key: string;
  anthropic_api_key: string;
  shopify_partner_organization_id: string;
  shopify_partner_access_token: string;
  shopify_app_client_id: string;
  shopify_app_client_secret: string;
};

export type WorkerToestand = {
  draait: boolean;
  ingesteld: boolean;
  reden: string;
};

export const LEGE_WORKER_CONFIG: WorkerConfig = {
  supabase_url: "",
  supabase_service_role_key: "",
  anthropic_api_key: "",
  shopify_partner_organization_id: "",
  shopify_partner_access_token: "",
  shopify_app_client_id: "",
  shopify_app_client_secret: "",
};

/**
 * True inside the packaged app.
 *
 * Checks for the internals object Tauri injects rather than sniffing the URL:
 * the origin differs per platform (tauri://localhost, http://tauri.localhost)
 * and has changed between versions.
 */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function roep<T>(commando: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(commando, args);
}

export async function leesWorkerConfig(): Promise<WorkerConfig> {
  if (!isDesktopApp()) return LEGE_WORKER_CONFIG;
  return roep<WorkerConfig>("worker_config_lezen");
}

export async function schrijfWorkerConfig(config: WorkerConfig): Promise<WorkerToestand> {
  return roep<WorkerToestand>("worker_config_schrijven", { config });
}

export async function leesWorkerToestand(): Promise<WorkerToestand | null> {
  if (!isDesktopApp()) return null;
  return roep<WorkerToestand>("worker_toestand");
}

export async function herstartWorker(): Promise<WorkerToestand> {
  return roep<WorkerToestand>("worker_herstarten");
}

/**
 * The worker's own stdout and stderr. It runs without a console, so this file
 * is the only place a startup refusal or a crash is visible at all.
 */
export async function leesWorkerLog(): Promise<string> {
  if (!isDesktopApp()) return "";
  return roep<string>("worker_log");
}

/**
 * Opens a site version in the user's editor (VS Code, else Explorer).
 *
 * The worker does the actual work — mirroring the version's building blocks to
 * a local folder, watching it, and rebuilding + uploading on every save — so
 * this only hands it the request. Over the worker's stdin, via Rust: no port,
 * no token, and the folder is guaranteed to open on THIS machine rather than
 * on whichever machine's worker happens to claim a job first.
 *
 * Resolves once the request is delivered. What happened next shows up in the
 * site's chat as a system message (folder path, or why it didn't work).
 */
export async function openInEditor(versieId: string, email: string | null): Promise<void> {
  await roep<void>("site_bewerken", { versieId, email });
}
