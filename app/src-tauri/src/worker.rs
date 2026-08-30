//! Runs the job worker inside the desktop app.
//!
//! Research, generatie, review and the Shopify jobs all happen in a separate
//! Node process (`worker/`). Until now that had to be started by hand from a
//! git checkout, which meant an installed copy of this app could show leads and
//! versions but every pipeline step would sit in the queue forever — and
//! "queued" looked exactly like "nothing is running", which is how three
//! Shopify jobs went unnoticed for three weeks.
//!
//! So the app starts it itself: no window, no console, alive for exactly as
//! long as the app is.
//!
//! Its secrets are NOT compiled in. The service-role key bypasses row-level
//! security completely, so baking it into an installer would hand full database
//! access to anyone who receives the file. It is read at runtime from a config
//! file in the user's own app-data directory, written by the settings screen.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows CREATE_NO_WINDOW — without it every launch flashes a console.
#[cfg(windows)]
const GEEN_VENSTER: u32 = 0x0800_0000;

/// What the worker needs to do its job. Serialised to worker.json beside the
/// app's other per-user data.
///
/// The three required fields match `controleerOmgeving()` in the worker; the
/// Shopify pair is optional there too, and its absence only disables the
/// Shopify job types rather than blocking startup.
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkerConfig {
    pub supabase_url: String,
    pub supabase_service_role_key: String,
    pub anthropic_api_key: String,
    pub shopify_partner_organization_id: String,
    pub shopify_partner_access_token: String,
    pub shopify_app_client_id: String,
    pub shopify_app_client_secret: String,
}

impl WorkerConfig {
    fn volledig(&self) -> bool {
        !self.supabase_url.trim().is_empty()
            && !self.supabase_service_role_key.trim().is_empty()
            && !self.anthropic_api_key.trim().is_empty()
    }

    fn omgeving(&self) -> Vec<(&'static str, &str)> {
        vec![
            ("SUPABASE_URL", self.supabase_url.trim()),
            ("SUPABASE_SERVICE_ROLE_KEY", self.supabase_service_role_key.trim()),
            ("ANTHROPIC_API_KEY", self.anthropic_api_key.trim()),
            (
                "SHOPIFY_PARTNER_ORGANIZATION_ID",
                self.shopify_partner_organization_id.trim(),
            ),
            (
                "SHOPIFY_PARTNER_ACCESS_TOKEN",
                self.shopify_partner_access_token.trim(),
            ),
            ("SHOPIFY_APP_CLIENT_ID", self.shopify_app_client_id.trim()),
            ("SHOPIFY_APP_CLIENT_SECRET", self.shopify_app_client_secret.trim()),
        ]
    }
}

#[derive(Serialize)]
pub struct WorkerToestand {
    pub draait: bool,
    pub ingesteld: bool,
    /// Why it isn't running, in words the settings screen can show as-is.
    pub reden: String,
}

/// Holds the running child so it can be stopped and restarted. Only ever one:
/// two workers claiming the same jobs is a genuine bug, not just waste.
#[derive(Default)]
pub struct WorkerProces(pub Mutex<Option<Child>>);

fn config_pad(app: &AppHandle) -> Result<PathBuf, String> {
    let map = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Geen configuratiemap beschikbaar: {e}"))?;
    std::fs::create_dir_all(&map).map_err(|e| format!("Kon {} niet aanmaken: {e}", map.display()))?;
    Ok(map.join("worker.json"))
}

pub fn lees_config(app: &AppHandle) -> WorkerConfig {
    let Ok(pad) = config_pad(app) else {
        return WorkerConfig::default();
    };
    std::fs::read_to_string(pad)
        .ok()
        .and_then(|ruw| serde_json::from_str(&ruw).ok())
        .unwrap_or_default()
}

/// Starts the worker, replacing any copy already running.
///
/// Returns why it did nothing rather than failing silently — a worker that
/// isn't running has to be visible, which is the whole point of this change.
pub fn start(app: &AppHandle, proces: &WorkerProces) -> Result<(), String> {
    stop(proces);

    let config = lees_config(app);
    if !config.volledig() {
        return Err(
            "De worker is nog niet ingesteld. Vul de Supabase-URL, de service-role-key en de \
             Anthropic-sleutel in bij Voorkeuren → Worker."
                .into(),
        );
    }

    let map = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Geen resourcemap: {e}"))?
        .join("resources")
        .join("worker");

    let node = map.join(if cfg!(windows) { "node.exe" } else { "node" });
    let bundel = map.join("worker.cjs");
    if !node.exists() || !bundel.exists() {
        return Err(format!(
            "De meegeleverde worker ontbreekt in {}. Bouw hem met `cd worker && npm run pak-in` \
             en bouw de app opnieuw.",
            map.display()
        ));
    }

    let mut commando = Command::new(&node);
    commando
        .arg(&bundel)
        .current_dir(&map)
        // Piped, not null: closing this pipe is how the worker learns the app
        // is gone. See stopBijGeslotenInvoer() on the other side.
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Opt in to the stdin watchdog. The worker only honours it when asked,
    // because every other way of starting it (a terminal, a script) hands it a
    // stdin that is already at EOF.
    commando.env("WORKER_STOP_BIJ_GESLOTEN_INVOER", "1");

    for (naam, waarde) in config.omgeving() {
        if waarde.is_empty() {
            commando.env_remove(naam);
        } else {
            commando.env(naam, waarde);
        }
    }

    #[cfg(windows)]
    commando.creation_flags(GEEN_VENSTER);

    let kind = commando
        .spawn()
        .map_err(|e| format!("Kon de worker niet starten: {e}"))?;

    *proces.0.lock().unwrap() = Some(kind);
    Ok(())
}

pub fn stop(proces: &WorkerProces) {
    let mut vak = proces.0.lock().unwrap();
    if let Some(mut kind) = vak.take() {
        // Drop the stdin pipe first and give the worker a moment to notice.
        // It finishes the job it's on that way, instead of being cut off
        // mid-write and leaving a job stuck on 'bezig' — which is exactly the
        // orphan state this project already had to build a recovery path for.
        if let Some(mut invoer) = kind.stdin.take() {
            let _ = invoer.flush();
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        let _ = kind.kill();
        let _ = kind.wait();
    }
}

fn draait(proces: &WorkerProces) -> bool {
    let mut vak = proces.0.lock().unwrap();
    match vak.as_mut() {
        // try_wait returns Ok(None) while the process is still alive.
        Some(kind) => matches!(kind.try_wait(), Ok(None)),
        None => false,
    }
}

// ── Commands the settings screen calls ──────────────────────────────────

#[tauri::command]
pub fn worker_config_lezen(app: AppHandle) -> WorkerConfig {
    lees_config(&app)
}

#[tauri::command]
pub fn worker_config_schrijven(
    app: AppHandle,
    proces: State<'_, WorkerProces>,
    config: WorkerConfig,
) -> Result<WorkerToestand, String> {
    let pad = config_pad(&app)?;
    let ruw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&pad, ruw).map_err(|e| format!("Kon {} niet schrijven: {e}", pad.display()))?;

    // Restart straight away, so saving a corrected key is enough — no
    // "now restart the app" step that people forget and then report as a bug.
    let reden = start(&app, &proces).err().unwrap_or_default();
    Ok(WorkerToestand {
        draait: draait(&proces),
        ingesteld: config.volledig(),
        reden,
    })
}

#[tauri::command]
pub fn worker_toestand(app: AppHandle, proces: State<'_, WorkerProces>) -> WorkerToestand {
    let config = lees_config(&app);
    let loopt = draait(&proces);
    WorkerToestand {
        draait: loopt,
        ingesteld: config.volledig(),
        reden: if loopt {
            String::new()
        } else if config.volledig() {
            "De worker is gestopt. Klik op Herstarten.".into()
        } else {
            "De worker is nog niet ingesteld.".into()
        },
    }
}

#[tauri::command]
pub fn worker_herstarten(app: AppHandle, proces: State<'_, WorkerProces>) -> WorkerToestand {
    let reden = start(&app, &proces).err().unwrap_or_default();
    WorkerToestand {
        draait: draait(&proces),
        ingesteld: lees_config(&app).volledig(),
        reden,
    }
}
