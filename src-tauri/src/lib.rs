// Eva Desktop — Tauri 2 core.
//
// Rust owns everything that has no business in React:
//   • launching, health-checking & tearing down the Hermes/Eva runtime (:8770)
//   • the Eva Bridge — the ONE network boundary; React reaches the core ONLY
//     through these #[tauri::command]s, never a direct fetch
//   • local SQLite (eva.db: settings, events, presence)
//   • system tray, global hotkey, Windows notifications, single-instance
//   • a presence poller that turns runtime telemetry into a live event stream
//
// React only paints. Every request crosses this boundary.

mod bridge;
mod db;

use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{
    ipc::Channel,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_notification::NotificationExt;

use db::Db;

// ── shared app state ─────────────────────────────────────────────────────────
#[derive(Default)]
struct Runtime {
    /// The Hermes child WE launched (so we only ever kill our own, and we can
    /// reap it on exit). None = we attached to Ivan's already-running core.
    child: Mutex<Option<Child>>,
}

#[derive(Serialize, Clone)]
struct RuntimeStatus {
    reachable: bool,
    launched_by_us: bool,
    bridge_url: String,
}

// ── bridge commands: generic passthrough (one boundary for ALL core HTTP) ────
//
// React calls `api_get(path)` / `api_send(method, path, body)` for the whole
// FastAPI surface (memory, promptfiles, skills, toolsets, services, models,
// conversations, thoughts, entities, …). No per-endpoint Rust command to drift.

#[tauri::command]
async fn api_get(path: String) -> Result<Value, String> {
    guard_path(&path)?;
    bridge::request("GET", &path, None).await
}

#[tauri::command]
async fn api_send(method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    guard_path(&path)?;
    bridge::request(&method, &path, body).await
}

/// Multipart upload for /api/attach. React hands base64 (WebView can't stream a
/// File across IPC cheaply); Rust decodes and posts a real multipart form.
#[tauri::command]
async fn api_upload(
    path: String,
    filename: String,
    content_type: Option<String>,
    data_base64: String,
) -> Result<Value, String> {
    guard_path(&path)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("bad base64: {e}"))?;
    bridge::upload(&path, &filename, content_type.as_deref().unwrap_or(""), bytes).await
}

/// Only allow the core's own /api/* surface across the boundary — a WebView
/// XSS can't ask Rust to fetch arbitrary hosts.
fn guard_path(path: &str) -> Result<(), String> {
    if path.starts_with("/api/") {
        Ok(())
    } else {
        Err(format!("path not allowed: {path}"))
    }
}

/// Real streamed chat: open the core's SSE endpoint and forward each token to
/// React over a Tauri Channel (ordered delivery), never a fake word-splitter.
#[tauri::command]
async fn eva_chat_stream(
    message: String,
    mode: String,
    conversation_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let body = json!({
        "message": message,
        "mode": mode,
        "conversation_id": conversation_id.unwrap_or_else(|| "eva_desktop".to_string()),
        "provider": provider,
        "model": model,
        "effort": effort,
    });
    let url = format!("{}/api/chat/stream", bridge::base());
    let resp = bridge::client()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("chat/stream → HTTP {}", resp.status()));
    }

    let _ = on_event.send(json!({ "kind": "presence", "state": "thinking" }));
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        // SSE frames are separated by a blank line
        while let Some(idx) = buf.find("\n\n") {
            let frame = buf[..idx].to_string();
            buf.drain(..idx + 2);
            for line in frame.lines() {
                let line = line.trim();
                if let Some(payload) = line.strip_prefix("data:") {
                    let payload = payload.trim();
                    if let Ok(v) = serde_json::from_str::<Value>(payload) {
                        if v.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
                            let _ = on_event.send(json!({
                                "kind": "done",
                                "reply": v.get("reply").cloned().unwrap_or(Value::Null)
                            }));
                            let _ = on_event.send(json!({ "kind": "presence", "state": "present" }));
                            return Ok(());
                        } else if let Some(tok) = v.get("token").and_then(|t| t.as_str()) {
                            let _ = on_event.send(json!({ "kind": "presence", "state": "speaking" }));
                            let _ = on_event.send(json!({ "kind": "token", "token": tok }));
                        }
                    }
                }
            }
        }
    }
    // stream ended without an explicit done frame
    let _ = on_event.send(json!({ "kind": "done", "reply": Value::Null }));
    let _ = on_event.send(json!({ "kind": "presence", "state": "present" }));
    Ok(())
}

// ── runtime lifecycle ────────────────────────────────────────────────────────
fn bridge_url_from_db(app: &AppHandle) -> String {
    if let Some(state) = app.try_state::<Db>() {
        if let Ok(conn) = state.0.lock() {
            if let Some(u) = db::get_setting(&conn, "bridge_url") {
                std::env::set_var("EVA_BRIDGE_URL", &u);
                return u;
            }
        }
    }
    "http://127.0.0.1:8770".to_string()
}

/// Auto-discover the Hermes home, the venv pythonw and the eva-desktop server.py
/// instead of hardcoding one machine's paths. Order:
///   1. EVA_HERMES_HOME / HERMES_HOME env
///   2. %LOCALAPPDATA%\hermes
///   3. ~/.hermes
/// server.py: EVA_SERVER_PY env → C:\Tools\eva-desktop\server.py → <home>\eva-desktop\server.py
fn discover_runtime() -> Option<(PathBuf, PathBuf, PathBuf)> {
    let mut homes: Vec<PathBuf> = vec![];
    for k in ["EVA_HERMES_HOME", "HERMES_HOME"] {
        if let Ok(v) = std::env::var(k) {
            if !v.is_empty() {
                homes.push(PathBuf::from(v));
            }
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        homes.push(PathBuf::from(local).join("hermes"));
    }
    if let Some(home) = dirs_home() {
        homes.push(home.join(".hermes"));
    }

    let home = homes.into_iter().find(|h| h.exists())?;
    // venv pythonw (Windows) or python
    let pythonw = {
        let w = home.join("hermes-agent").join("venv").join("Scripts").join("pythonw.exe");
        let p = home.join("hermes-agent").join("venv").join("Scripts").join("python.exe");
        let nix = home.join("hermes-agent").join("venv").join("bin").join("python");
        if w.exists() { w } else if p.exists() { p } else if nix.exists() { nix } else { return None }
    };
    // server.py
    let server = if let Ok(s) = std::env::var("EVA_SERVER_PY") {
        PathBuf::from(s)
    } else {
        let tools = PathBuf::from(r"C:\Tools\eva-desktop\server.py");
        if tools.exists() { tools } else { home.join("eva-desktop").join("server.py") }
    };
    if !server.exists() {
        return None;
    }
    let cwd = server.parent().map(|p| p.to_path_buf()).unwrap_or(home.clone());
    Some((pythonw, server, cwd))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var("USERPROFILE").ok().map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))
}

async fn build_status(app: &AppHandle) -> RuntimeStatus {
    let reachable = bridge::ping().await;
    let launched_by_us = app
        .try_state::<Runtime>()
        .map(|rt| rt.child.lock().unwrap().is_some())
        .unwrap_or(false);
    RuntimeStatus {
        reachable,
        launched_by_us,
        bridge_url: bridge_url_from_db(app),
    }
}

#[tauri::command]
async fn runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    Ok(build_status(&app).await)
}

/// Start the FastAPI core if nothing answers. Idempotent and single-owner:
/// only ONE caller (the setup hook) ever invokes this, and it no-ops when the
/// port already answers or when we already spawned a child.
#[tauri::command]
async fn runtime_start(app: AppHandle) -> Result<RuntimeStatus, String> {
    // apply configured bridge url BEFORE probing, so we check the right port
    let _ = bridge_url_from_db(&app);

    if bridge::ping().await {
        return Ok(build_status(&app).await);
    }
    // already have a child? don't double-spawn
    if let Some(rt) = app.try_state::<Runtime>() {
        if rt.child.lock().unwrap().is_some() {
            return Ok(build_status(&app).await);
        }
    }

    if let Some((pythonw, server, cwd)) = discover_runtime() {
        let child = std::process::Command::new(&pythonw)
            .arg(&server)
            .arg("--host").arg("127.0.0.1")
            .arg("--port").arg("8770")
            .current_dir(&cwd)
            .spawn();
        match child {
            Ok(c) => {
                let pid = c.id();
                if let Some(rt) = app.try_state::<Runtime>() {
                    *rt.child.lock().unwrap() = Some(c);
                }
                if let Some(state) = app.try_state::<Db>() {
                    if let Ok(conn) = state.0.lock() {
                        db::log_event(&conn, "runtime_start", &pid.to_string()).ok();
                    }
                }
            }
            Err(e) => return Err(format!("не смогла поднять ядро: {e}")),
        }
        for _ in 0..30 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if bridge::ping().await {
                break;
            }
        }
    }
    Ok(build_status(&app).await)
}

/// Kill the Hermes child we launched (only ours). Called on window close/quit.
fn reap_runtime(app: &AppHandle) {
    if let Some(rt) = app.try_state::<Runtime>() {
        if let Ok(mut guard) = rt.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
                if let Some(state) = app.try_state::<Db>() {
                    if let Ok(conn) = state.0.lock() {
                        db::log_event(&conn, "runtime_stop", "reaped-on-exit").ok();
                    }
                }
            }
        }
    }
}

// ── local db commands ────────────────────────────────────────────────────────
#[tauri::command]
fn get_setting(db: State<'_, Db>, key: String) -> Option<String> {
    let conn = db.0.lock().ok()?;
    db::get_setting(&conn, &key)
}

#[tauri::command]
fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn all_settings(db: State<'_, Db>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::all_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn local_events(db: State<'_, Db>, limit: Option<i64>) -> Result<Vec<db::EventRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::recent_events(&conn, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
fn local_presence(db: State<'_, Db>, limit: Option<i64>) -> Result<Vec<db::PresenceRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::recent_presence(&conn, limit.unwrap_or(40)).map_err(|e| e.to_string())
}

// ── OS integration ───────────────────────────────────────────────────────────
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

// ── presence poller: telemetry → live state + local trail ────────────────────
// Single source of presence truth. React subscribes to `eva://presence` and
// does NOT poll /api/state itself.
fn spawn_presence_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_state = String::new();
        loop {
            if let Ok(v) = bridge::request("GET", "/api/state", None).await {
                let idle = v.get("idle_seconds").and_then(|x| x.as_f64()).unwrap_or(0.0);
                let win = v
                    .get("active_window")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let state = if idle > 900.0 {
                    "away"
                } else if idle > 120.0 {
                    "idle"
                } else {
                    "present"
                };
                // always push the live snapshot so the UI has fresh telemetry…
                app.emit(
                    "eva://state",
                    json!({ "state": state, "snapshot": v }),
                )
                .ok();
                // …but only log a presence transition when it changes
                if state != last_state {
                    last_state = state.to_string();
                    app.emit(
                        "eva://presence",
                        json!({ "state": state, "active_window": win }),
                    )
                    .ok();
                    if let Some(dbs) = app.try_state::<Db>() {
                        if let Ok(conn) = dbs.0.lock() {
                            db::log_presence(&conn, state, &win).ok();
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    });
}

// ── tray ─────────────────────────────────────────────────────────────────────
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Показать Еву 🦇", true, None::<&str>)?;
    let reflect = MenuItem::with_id(app, "reflect", "Новая мысль ✨", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &reflect, &quit])?;

    let _tray = TrayIconBuilder::with_id("eva-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Ева · рядом 🦇")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "reflect" => {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = bridge::request("POST", "/api/reflect", Some(json!({}))).await;
                    app2.notification()
                        .builder()
                        .title("Ева подумала 🐾")
                        .body("Новая страница в дневнике.")
                        .show()
                        .ok();
                });
            }
            "quit" => {
                reap_runtime(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let visible = w.is_visible().unwrap_or(false);
                    if visible {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single instance MUST be the first plugin — a second launch focuses
        // the existing window instead of spawning a second Hermes owner.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.unminimize();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("CmdOrCtrl+Shift+E")
                .unwrap()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            let visible = w.is_visible().unwrap_or(false);
                            if visible {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .manage(Runtime::default())
        .setup(|app| {
            let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&dir).ok();
            let conn = db::open(&dir.join("eva.db")).expect("open eva.db");
            app.manage(Db(Mutex::new(conn)));

            build_tray(app.handle())?;
            spawn_presence_poller(app.handle().clone());

            // runtime bootstrap — the ONLY caller of runtime_start (no UI race).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = runtime_start(handle).await;
            });
            Ok(())
        })
        // reap our Hermes child when the last window is destroyed
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                reap_runtime(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            api_get,
            api_send,
            api_upload,
            eva_chat_stream,
            runtime_status,
            runtime_start,
            get_setting,
            set_setting,
            all_settings,
            local_events,
            local_presence,
            notify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eva Desktop");
}
