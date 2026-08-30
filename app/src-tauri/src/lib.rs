mod worker;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(worker::WorkerProces::default())
    .invoke_handler(tauri::generate_handler![
      worker::worker_config_lezen,
      worker::worker_config_schrijven,
      worker::worker_toestand,
      worker::worker_herstarten,
      worker::worker_log,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // The job worker starts with the app, hidden. A missing configuration is
      // not a startup failure — the app is still perfectly usable for reading
      // leads and versions, and the settings screen says what's missing.
      if let Err(reden) = worker::start(app.handle(), &app.state::<worker::WorkerProces>()) {
        log::info!("Worker niet gestart: {reden}");
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app, event| {
      // Closing the app must take the worker with it. Two workers claiming the
      // same jobs is a real bug, and an invisible leftover process is one
      // nobody would think to look for.
      if let RunEvent::Exit = event {
        worker::stop(&app.state::<worker::WorkerProces>());
      }
    });
}
