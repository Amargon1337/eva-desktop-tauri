// Eva Desktop — Tauri 2 core.
//
// Rust owns everything that has no business in React:
//   • launching & health-checking the Hermes/Eva runtime (:8770 FastAPI core)
//   • the Eva Bridge (chat/memory/state/... over localhost, streamed)
//   • local SQLite (eva.db: settings, events, presence)
//   • system tray, global hotkey, Windows notifications
//   • a presence poller that turns runtime telemetry into a live "state"
//
// React only paints. All IPC crosses this #[tauri::command] boundary.

mod bridge;
mod db;

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_notification::NotificationExt;

use db::Db;

// ── shared app state ─────────────────────────────────────────────────────────
#[derive(Default)]
struct Runtime {
    /// pid of a Hermes process we launched ourselves (so we don't kill Ivan's)
    launched_pid: Mutex<Option<u32>>,
}

#[derive(Serialize, Clone)]
struct RuntimeStatus {
    reachable: bool,
    launched_by_us: bool,
    bridge_url: String,
}

// ── bridge commands (thin async pass-throughs to the FastAPI core) ───────────
#[tauri::command]
async fn eva_state() -> Result<Value, String> {
    bridge::get_json("/api/state").await
}

#[tauri::command]
async fn eva_history(limit: Option<i64>) -> Result<Value, String> {
    bridge::get_json(&format!("/api/history?limit={}", limit.unwrap_or(60))).await
}

#[tauri::command]
async fn eva_memory(search: Option<String>, limit: Option<i64>) -> Result<Value, String> {
    let path = match search {
        Some(q) if !q.trim().is_empty() => {
            format!("/api/memory?search={}", urlencoding(&q))
        }
        _ => format!("/api/memory?limit={}", limit.unwrap_or(60)),
    };
    bridge::get_json(&path).await
}

#[tauri::command]
async fn eva_pins(limit: Option<i64>) -> Result<Value, String> {
    bridge::get_json(&format!("/api/pins?limit={}", limit.unwrap_or(10))).await
}

#[tauri::command]
async fn eva_thoughts(limit: Option<i64>, mood: Option<String>) -> Result<Value, String> {
    let mut path = format!("/api/thoughts?limit={}", limit.unwrap_or(60));
    if let Some(m) = mood {
        if m != "all" && !m.is_empty() {
            path.push_str(&format!("&mood={}", urlencoding(&m)));
        }
    }
    bridge::get_json(&path).await
}

#[tauri::command]
async fn eva_services() -> Result<Value, String> {
    bridge::get_json("/api/services").await
}

#[tauri::command]
async fn eva_reflect() -> Result<Value, String> {
    bridge::post_json("/api/reflect", json!({})).await
}

/// Buffered chat (simple path). Streaming variant emits `eva://token` events.
#[tauri::command]
async fn eva_chat(message: String, mode: String) -> Result<Value, String> {
    bridge::post_json("/api/chat", json!({ "message": message, "mode": mode })).await
}

/// Streamed chat: POST to the core, then fake-stream the reply as token events
/// so the UI lives (idle→thinking→speaking). If the core ever exposes SSE we
/// swap the body here without touching React.
#[tauri::command]
async fn eva_chat_stream(app: AppHandle, message: String, mode: String) -> Result<(), String> {
    app.emit("eva://presence", json!({"state":"thinking"})).ok();
    let res = bridge::post_json("/api/chat", json!({ "message": message, "mode": mode })).await;
    match res {
        Ok(v) => {
            let reply = v.get("reply").and_then(|r| r.as_str()).unwrap_or("").to_string();
            app.emit("eva://presence", json!({"state":"speaking"})).ok();
            // chunk on word boundaries — cheap, smooth, no WebGL nonsense
            let words: Vec<&str> = reply.split_inclusive(' ').collect();
            for w in words {
                app.emit("eva://token", json!({ "token": w })).ok();
                tokio::time::sleep(Duration::from_millis(14)).await;
            }
            app.emit("eva://done", json!({ "reply": reply, "mode": mode })).ok();
            app.emit("eva://presence", json!({"state":"idle"})).ok();
            Ok(())
        }
        Err(e) => {
            app.emit("eva://presence", json!({"state":"idle"})).ok();
            app.emit("eva://error", json!({ "error": e.clone() })).ok();
            Err(e)
        }
    }
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

#[tauri::command]
async fn runtime_status(app: AppHandle, rt: State<'_, Runtime>) -> Result<RuntimeStatus, String> {
    let reachable = bridge::ping().await;
    let launched_by_us = rt.launched_pid.lock().unwrap().is_some();
    Ok(RuntimeStatus {
        reachable,
        launched_by_us,
        bridge_url: bridge_url_from_db(&app),
    })
}

/// Start the FastAPI core if nothing answers on :8770. We remember the pid so
/// we only ever stop a process we started.
#[tauri::command]
async fn runtime_start(app: AppHandle, rt: State<'_, Runtime>) -> Result<RuntimeStatus, String> {
    if bridge::ping().await {
        return runtime_status(app, rt).await;
    }
    let pythonw = PathBuf::from(
        r"C:\Users\VaNyasha\AppData\Local\hermes\hermes-agent\venv\Scripts\pythonw.exe",
    );
    let server = PathBuf::from(r"C:\Tools\eva-desktop\server.py");
    if pythonw.exists() && server.exists() {
        match Command::new(&pythonw)
            .arg(&server)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg("8770")
            .current_dir(r"C:\Tools\eva-desktop")
            .spawn()
        {
            Ok(child) => {
                *rt.launched_pid.lock().unwrap() = Some(child.id());
                if let Some(state) = app.try_state::<Db>() {
                    if let Ok(conn) = state.0.lock() {
                        db::log_event(&conn, "runtime_start", &child.id().to_string()).ok();
                    }
                }
            }
            Err(e) => return Err(format!("не смогла поднять ядро: {e}")),
        }
        // wait up to ~15s for it to answer
        for _ in 0..30 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if bridge::ping().await {
                break;
            }
        }
    }
    runtime_status(app, rt).await
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

fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

// ── presence poller: telemetry → live state + local trail ────────────────────
fn spawn_presence_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_state = String::new();
        loop {
            if let Ok(v) = bridge::get_json("/api/state").await {
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
            tokio::time::sleep(Duration::from_secs(20)).await;
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
                    let _ = bridge::post_json("/api/reflect", json!({})).await;
                    app2.notification()
                        .builder()
                        .title("Ева подумала 🐾")
                        .body("Новая страница в дневнике.")
                        .show()
                        .ok();
                });
            }
            "quit" => app.exit(0),
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
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
            // open eva.db next to the app data dir
            let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&dir).ok();
            let conn = db::open(&dir.join("eva.db")).expect("open eva.db");
            app.manage(Db(Mutex::new(conn)));

            build_tray(app.handle())?;
            spawn_presence_poller(app.handle().clone());

            // best-effort: bring the runtime up in the background
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let rt = handle.state::<Runtime>();
                let _ = runtime_start(handle.clone(), rt).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            eva_state,
            eva_history,
            eva_memory,
            eva_pins,
            eva_thoughts,
            eva_services,
            eva_reflect,
            eva_chat,
            eva_chat_stream,
            runtime_status,
            runtime_start,
            get_setting,
            set_setting,
            local_events,
            local_presence,
            notify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eva Desktop");
}
