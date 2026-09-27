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
use url::Url;

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

/// Only http(s) to a loopback host is allowed. A WebView XSS (or a poisoned
/// eva.db setting) must never be able to point the bridge at a remote host and
/// exfiltrate memory. Returns false for anything not local.
///
/// Uses the `url` crate's RFC 3986 parser — NOT hand-rolled string slicing — so
/// userinfo tricks (`http://127.0.0.1:8770@evil.com`), IPv4-in-IPv6
/// (`http://[::ffff:8.8.8.8]/`), octal/decimal IP encodings and friends are
/// parsed correctly: the userinfo before `@` lands in url.username(), the
/// REAL host is in url.host_str().
pub fn is_local_url(u: &str) -> bool {
    let Ok(url) = Url::parse(u) else { return false };
    // only http/https on the loopback interface
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }
    // explicit rejection of userinfo: `http://127.0.0.1@evil.com` is NOT local —
    // `127.0.0.1` would be the username, `evil.com` the actual host.
    if url.username() != "" || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else { return false };
    // Port isn't constrained: any loopback port is still loopback.
    // IPv6 zone-ids ("fe80::1%eth0") and any other host form fail the match.
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// (host, port) parsed from the current base with the `url` crate, for handing
/// to the spawned core. Brackets are stripped from IPv6 for the host arg.
/// Falls back to 127.0.0.1:8770 when unparseable (base() is loopback-validated
/// already, so this only guards against a hand-corrupted env var).
pub fn host_port() -> (String, u16) {
    let b = base();
    if let Ok(url) = Url::parse(&b) {
        if let Some(host) = url.host_str() {
            let port = url.port().unwrap_or(if url.scheme() == "https" { 443 } else { 80 });
            return (host.to_string(), port);
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
