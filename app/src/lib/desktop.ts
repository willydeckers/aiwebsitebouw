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
