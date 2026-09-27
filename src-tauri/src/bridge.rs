// Eva Bridge — the ONLY network boundary between the desktop and the Hermes/Eva
// runtime. React never touches the network: every request crosses a #[tauri::command]
// and lands here, so Rust owns the HTTP to the FastAPI core (:8770) that owns memory.db.
//
// One shared reqwest client (pooled, timeouts), a generic request passthrough,
// a multipart upload, a real SSE reader for streamed chat, and a hard rule that
// the core is only ever reached on the loopback interface.

use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;
use url::{Host, Url};

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

/// Only plain http to the loopback address is allowed. A WebView XSS (or a
/// poisoned eva.db setting) must never be able to point the bridge at a remote
/// host and exfiltrate memory. Returns false for anything not local.
///
/// Uses the `url` crate's WHATWG parser — NOT hand-rolled string slicing — so
/// userinfo tricks (`http://127.0.0.1:8770@evil.com`) land the `127.0.0.1`
/// in url.username() and the REAL host (evil.com) in url.host(); nothing
/// survives as a string we'd have to guess about.
///
/// The decision compares the PARSED host (Host::Ipv4/Host::Ipv6), never the
/// raw string: the WHATWG IPv4 parser canonicalizes shorthands (decimal
/// `2130706433`, octal `0177.0.0.1`, short `127.1`) BEFORE we look, so a
/// non-standard spelling can only ever become the loopback address itself —
/// anything else stays a domain and is rejected. reqwest speaks the same
/// parser, so what we validate is exactly what gets dialed.
///
/// HTTPS is deliberately NOT accepted: runtime_start() spawns a plain-HTTP
/// FastAPI without TLS, so an https:// base would guarantee every request
/// fails. Allow-list stays in lockstep with what the core actually serves.
pub fn is_local_url(u: &str) -> bool {
    let Ok(url) = Url::parse(u) else { return false };
    // plain http only — the core serves no TLS (see doc comment above)
    if url.scheme() != "http" {
        return false;
    }
    // explicit rejection of userinfo: `http://127.0.0.1@evil.com` is NOT local —
    // `127.0.0.1` would be the username, `evil.com` the actual host.
    if url.username() != "" || url.password().is_some() {
        return false;
    }
    // Port isn't constrained: any loopback port is still loopback.
    // IP-literal loopback only — no `localhost` (a hosts-file entry can
    // silently redirect it), no `0.0.0.0`, no IPv4-mapped IPv6, no zone-ids.
    match url.host() {
        Some(Host::Ipv4(ip)) => ip == Ipv4Addr::LOCALHOST,
        Some(Host::Ipv6(ip)) => ip == Ipv6Addr::LOCALHOST,
        _ => false,
    }
}

/// (host, port) parsed from the current base with the `url` crate, for handing
/// to the spawned core. Brackets are stripped from IPv6 for the host arg.
/// Falls back to 127.0.0.1:8770 when unparseable (base() is loopback-validated
/// already, so this only guards against a hand-corrupted env var).
pub fn host_port() -> (String, u16) {
    host_port_of(&base())
}

/// Parse (host, port) from a validated loopback base URL. Host comes from the
/// PARSED address (Ipv6Addr serializes without brackets — the form the spawned
/// core's `--host` flag wants); explicit port wins, otherwise the scheme
/// default (80 for http — the core serves no TLS).
fn host_port_of(b: &str) -> (String, u16) {
    if let Ok(url) = Url::parse(b) {
        let port = url.port().unwrap_or(if url.scheme() == "https" { 443 } else { 80 });
        match url.host() {
            Some(Host::Ipv4(ip)) => return (ip.to_string(), port),
            Some(Host::Ipv6(ip)) => return (ip.to_string(), port),
            _ => {}
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_url_accepts_loopback_http() {
        assert!(is_local_url("http://127.0.0.1:8770"));
        assert!(is_local_url("http://127.0.0.1"));
        assert!(is_local_url("http://127.0.0.1:9"));
        assert!(is_local_url("http://[::1]:8770"));
        assert!(is_local_url("http://[::1]"));
    }

    #[test]
    fn local_url_rejects_userinfo_attack() {
        // the whole reason we parse properly: real host is evil.com
        assert!(!is_local_url("http://127.0.0.1:8770@evil.com"));
        assert!(!is_local_url("http://127.0.0.1@evil.com"));
        assert!(!is_local_url("http://user:pass@127.0.0.1"));
        assert!(!is_local_url("http://[::1]@evil.com"));
    }

    #[test]
    fn local_url_rejects_remote_hosts() {
        assert!(!is_local_url("http://evil.com"));
        assert!(!is_local_url("http://127.0.0.1.nip.io"));
        assert!(!is_local_url("http://0.0.0.0:8770"));
        assert!(!is_local_url("http://[::ffff:127.0.0.1]:8770"));
        assert!(!is_local_url("http://[fe80::1%25eth0]:8770"));
        // a shorthand that is NOT loopback must stay rejected
        assert!(!is_local_url("http://16843009:8770")); // decimal 1.1.1.1
    }

    #[test]
    fn nonstandard_ipv4_spellings_cannot_smuggle_remote() {
        // the WHATWG parser canonicalizes IPv4 shorthands BEFORE we compare,
        // so these spellings of 127.0.0.1 are accepted AS loopback — and by
        // the same token NO spelling can ever canonicalize to a remote IP.
        // reqwest uses the same parser, so what we validate is what's dialed.
        assert!(is_local_url("http://2130706433:8770")); // decimal 127.0.0.1
        assert!(is_local_url("http://0177.0.0.1:8770")); // octal 127
        assert!(is_local_url("http://127.1:8770")); // 127.0.x shorthand
    }

    #[test]
    fn local_url_rejects_localhostname() {
        // hosts-file entries can silently redirect "localhost" elsewhere
        assert!(!is_local_url("http://localhost:8770"));
        assert!(!is_local_url("http://LOCALHOST:8770"));
    }

    #[test]
    fn local_url_rejects_unsupported_schemes_and_garbage() {
        // https is deliberately out: runtime_start() spawns plain-HTTP FastAPI
        assert!(!is_local_url("https://127.0.0.1:8770"));
        assert!(!is_local_url("https://[::1]"));
        assert!(!is_local_url("ftp://127.0.0.1"));
        assert!(!is_local_url("file:///etc/passwd"));
        assert!(!is_local_url("unix:/run/hermes.sock"));
        assert!(!is_local_url(""));
        assert!(!is_local_url("127.0.0.1:8770"));
        assert!(!is_local_url("http://"));
    }

    #[test]
    fn host_port_explicit_ports_and_fallbacks() {
        // host_port_of() is pure — no env reads, safe under parallel tests
        assert_eq!(host_port_of("http://127.0.0.1:8770"), ("127.0.0.1".to_string(), 8770));
        assert_eq!(host_port_of("http://[::1]:9000"), ("::1".to_string(), 9000));
        // no port → scheme default
        assert_eq!(host_port_of("http://127.0.0.1"), ("127.0.0.1".to_string(), 80));
        // garbage falls back, never panics
        assert_eq!(host_port_of(""), ("127.0.0.1".to_string(), 8770));
        assert_eq!(host_port_of("http://"), ("127.0.0.1".to_string(), 8770));
        assert_eq!(host_port_of("nonsense://x"), ("127.0.0.1".to_string(), 8770));
        assert_eq!(host_port_of("http://[::1]@evil.com"), ("127.0.0.1".to_string(), 8770));
    }

    #[test]
    fn base_and_host_port_respect_env_gate() {
        // the ONLY test that touches EVA_BRIDGE_URL — env is process-global,
        // so everything env-dependent must stay in this single test
        std::env::set_var("EVA_BRIDGE_URL", "http://evil.com:8770");
        assert_eq!(base(), "http://127.0.0.1:8770");
        assert_eq!(host_port(), ("127.0.0.1".to_string(), 8770));

        std::env::set_var("EVA_BRIDGE_URL", "https://127.0.0.1:8770");
        assert_eq!(base(), "http://127.0.0.1:8770"); // https gated off

        std::env::set_var("EVA_BRIDGE_URL", "http://localhost:8770");
        assert_eq!(base(), "http://127.0.0.1:8770"); // no hostnames

        std::env::set_var("EVA_BRIDGE_URL", "http://[::1]:1234");
        assert_eq!(base(), "http://[::1]:1234");
        assert_eq!(host_port(), ("::1".to_string(), 1234));

        std::env::remove_var("EVA_BRIDGE_URL");
        assert_eq!(base(), "http://127.0.0.1:8770");
        assert_eq!(host_port(), ("127.0.0.1".to_string(), 8770));
    }
}
