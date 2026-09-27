// Eva Bridge — the small IPC/API layer between the desktop and the Hermes/Eva
// runtime. We deliberately do NOT reach into Hermes internals; we speak to the
// FastAPI core already running on :8770 (the one that owns memory.db), so there
// is one memory writer and the desktop never forks Eva's memory.
//
// Exposes: chat (buffered + streamed), state, memory, thoughts, pins, services,
// history, reflect. Streaming turns the reply into token/token/token events on
// a Tauri channel so the UI can visually "live" (idle → thinking → speaking).

use serde::{Deserialize, Serialize};
use serde_json::Value;

fn base() -> String {
    std::env::var("EVA_BRIDGE_URL").unwrap_or_else(|_| "http://127.0.0.1:8770".to_string())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy() // localhost only; never route Eva through a proxy
        .build()
        .unwrap_or_default()
}

#[derive(Serialize, Deserialize)]
pub struct ChatArgs {
    pub message: String,
    pub mode: String,
}

pub async fn get_json(path: &str) -> Result<Value, String> {
    let url = format!("{}{}", base(), path);
    let resp = client().get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{} → HTTP {}", path, resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

pub async fn post_json(path: &str, body: Value) -> Result<Value, String> {
    let url = format!("{}{}", base(), path);
    let resp = client()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{} → HTTP {}", path, resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

/// Is the runtime reachable at all?
pub async fn ping() -> bool {
    get_json("/api/state").await.is_ok()
}
