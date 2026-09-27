// Eva Bridge — the ONLY network boundary between the desktop and the Hermes/Eva
// runtime. React never touches the network: every request crosses a #[tauri::command]
// and lands here, so Rust owns the HTTP to the FastAPI core (:8770) that owns memory.db.
//
// One shared reqwest client (pooled, timeouts), a generic request passthrough,
// a multipart upload, a real SSE reader for streamed chat, and a hard rule that
// the core is only ever reached on the loopback interface.

use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Base URL of the Hermes/Eva core. Configurable via EVA_BRIDGE_URL (set from
/// the eva.db `bridge_url` setting at startup) BUT only ever a loopback URL —
/// see `is_local_url`. Defaults to localhost:8770.
pub fn base() -> String {
    let raw = std::env::var("EVA_BRIDGE_URL").unwrap_or_default();
    if !raw.is_empty() && is_local_url(&raw) {
        raw.trim_end_matches('/').to_string()
    } else {
        "http://127.0.0.1:8770".to_string()
    }
}

/// Only http(s) to loopback is allowed. A WebView XSS (or a poisoned eva.db
/// setting) must never be able to point the bridge at a remote host and
/// exfiltrate memory. Returns false for anything not local.
pub fn is_local_url(u: &str) -> bool {
    let lower = u.to_ascii_lowercase();
    let rest = match lower.strip_prefix("http://").or_else(|| lower.strip_prefix("https://")) {
        Some(r) => r,
        None => return false,
    };
    // host is up to the next ':' or '/'
    let host: String = rest.chars().take_while(|c| *c != ':' && *c != '/').collect();
    matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1" | "[::1]")
}

/// (host, port) parsed from the current base, for handing to the spawned core.
/// Defaults to 127.0.0.1:8770 when unparseable.
pub fn host_port() -> (String, u16) {
    let b = base();
    let rest = b
        .strip_prefix("http://")
        .or_else(|| b.strip_prefix("https://"))
        .unwrap_or(&b);
    let authority: String = rest.chars().take_while(|c| *c != '/').collect();
    // strip IPv6 brackets for the host arg, keep it simple for our loopback case
    if let Some((h, p)) = authority.rsplit_once(':') {
        if let Ok(port) = p.parse::<u16>() {
            return (h.trim_matches(|c| c == '[' || c == ']').to_string(), port);
        }
    }
    ("127.0.0.1".to_string(), 8770)
}

/// One pooled client for the whole app. connect timeout guards a dead port;
/// no total timeout here (per-request timeouts are applied by callers, and the
/// stream reader must not be capped).
pub fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy() // localhost only; never route Eva through a proxy
            .connect_timeout(Duration::from_secs(8))
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("build reqwest client")
    })
}

/// Generic JSON request: GET/POST/PUT/DELETE. `body` is sent for POST/PUT.
/// A 30s request timeout guards hung calls (chat/logs/etc.) without touching
/// the separate streaming path.
pub async fn request(method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let url = format!("{}{}", base(), path);
    let m = method.to_uppercase();
    let mut rb = match m.as_str() {
        "GET" => client().get(&url),
        "POST" => client().post(&url),
        "PUT" => client().put(&url),
        "DELETE" => client().delete(&url),
        other => return Err(format!("unsupported method {other}")),
    };
    rb = rb.timeout(Duration::from_secs(30));
    if let Some(b) = body {
        rb = rb.json(&b);
    }
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let tail = resp.text().await.unwrap_or_default();
        return Err(format!("{path} → HTTP {status} {}", tail.chars().take(200).collect::<String>()));
    }
    // Some endpoints (204, empty) may return no body — tolerate it.
    let txt = resp.text().await.map_err(|e| e.to_string())?;
    if txt.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str::<Value>(&txt).map_err(|e| e.to_string())
}

/// Multipart file upload (for /api/attach). Raw bytes arrive from React.
pub async fn upload(path: &str, filename: &str, content_type: &str, bytes: Vec<u8>) -> Result<Value, String> {
    let url = format!("{}{}", base(), path);
    let mut part = reqwest::multipart::Part::bytes(bytes).file_name(filename.to_string());
    if !content_type.is_empty() {
        part = part.mime_str(content_type).map_err(|e| e.to_string())?;
    }
    let form = reqwest::multipart::Form::new().part("file", part);
    let resp = client()
        .post(&url)
        .timeout(Duration::from_secs(120)) // vision on a big image can be slow
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{path} → HTTP {}", resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

/// Is the runtime reachable at all? (short-timeout GET /api/state)
pub async fn ping() -> bool {
    let url = format!("{}/api/state", base());
    match client()
        .get(&url)
        .timeout(Duration::from_secs(4))
        .send()
        .await
    {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}
