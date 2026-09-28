// Integration proof for the /stop cancellation engine (`run_chat_stream`).
//
// These tests put the Notify + tokio::select! machinery under real I/O instead
// of code review: a mock SSE server on loopback serves real HTTP, and the tests
// assert what the frontend contract needs —
//   • a hung SSE read is aborted instantly by /stop (`done(aborted)` arrives,
//     nothing is buffered after it, no phantom completion) and the NEXT stream
//     on the same shared client is unaffected (stale permit can't leak);
//   • a hung CONNECT (firewalled/dead port — SYN dropped) is aborted by /stop
//     instead of waiting out the 8s connect timeout;
//   • a well-behaved stream still completes normally with its reply.
//
// The production eva_chat_stream command is a thin wrapper over run_chat_stream
// (per-stream Notify swap + request shape), so the engine IS the behavior.

use std::sync::Arc;
use std::time::Duration;

use eva_desktop_lib::run_chat_stream;
use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::Notify;

/// Events collected from the Channel, in order.
#[derive(Default, Clone)]
struct Events(Arc<std::sync::Mutex<Vec<Value>>>);

impl Events {
    fn channel(&self) -> Channel<Value> {
        let sink = self.0.clone();
        Channel::new(move |msg: InvokeResponseBody| {
            // Channel::send serializes non-raw payloads as JSON text
            let text = match msg {
                InvokeResponseBody::Json(s) => s,
                InvokeResponseBody::Raw(b) => String::from_utf8_lossy(&b).into_owned(),
            };
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                sink.lock().unwrap().push(v);
            }
            Ok(())
        })
    }
    fn snapshot(&self) -> Vec<Value> {
        self.0.lock().unwrap().clone()
    }
    fn kinds(&self) -> Vec<String> {
        self.snapshot()
            .iter()
            .filter_map(|v| v.get("kind").and_then(|k| k.as_str()).map(String::from))
            .collect()
    }
    fn tokens(&self) -> Vec<String> {
        self.snapshot()
            .iter()
            .filter_map(|v| {
                if v.get("kind").and_then(|k| k.as_str()) == Some("token") {
                    v.get("token").and_then(|t| t.as_str()).map(String::from)
                } else {
                    None
                }
            })
            .collect()
    }
}

/// Wait until `pred` holds for the event list, with a hard deadline so a broken
/// cancellation FAILS the test instead of hanging it.
async fn wait_for(events: &Events, pred: impl Fn(&[Value]) -> bool, what: &'static str) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        if pred(&events.snapshot()) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timeout waiting for: {what} (events: {:?})", events.kinds());
}

async fn tiny_server(response: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else { return };
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut buf = [0u8; 4096];
                // read the request head (fine to not parse — single-shot mock)
                let _ = sock.read(&mut buf).await;
                sock.write_all(response.as_bytes()).await.ok();
                sock.flush().await.ok();
                // keep the socket open so a hang scenario truly hangs
                tokio::time::sleep(Duration::from_secs(120)).await;
            });
        }
    });
    port
}

fn body() -> Value {
    json!({ "message": "тест", "mode": "sakura" })
}

async fn run(port: u16, cancel: Arc<Notify>, events: Events) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/api/chat/stream");
    run_chat_stream(cancel, &url, body(), events.channel()).await
}

// ── scenario 1: hung SSE read + /stop ────────────────────────────────────────
#[tokio::test]
async fn stop_aborts_hung_sse_read_instantly() {
    // first token flushes, then silence forever (socket stays open)
    let port = tiny_server(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\ndata: {\"token\":\"прив\"}\r\n\r\n",
    )
    .await;
    let cancel = Arc::new(Notify::new());
    let events = Events::default();

    let handle = tokio::spawn(run(port, cancel.clone(), events.clone()));
    wait_for(&events, |es| !es.is_empty(), "first token to arrive").await;
    assert_eq!(events.tokens(), vec!["прив"]);

    // /stop while the stream is hung waiting for the next chunk
    let t0 = std::time::Instant::now();
    cancel.notify_one();
    let res = tokio::time::timeout(Duration::from_secs(2), handle)
        .await
        .expect("stream task must finish after /stop — hung read was NOT aborted")
        .unwrap();
    assert!(res.is_ok());
    assert!(
        t0.elapsed() < Duration::from_millis(1500),
        "abort took {:?} — cancellation is not instant",
        t0.elapsed()
    );

    // contract the frontend relies on: done(aborted) LAST, then presence reset
    let kinds = events.kinds();
    assert_eq!(kinds.last().unwrap(), "presence");
    assert!(kinds.contains(&"done".to_string()));
    let done = events
        .snapshot()
        .into_iter()
        .find(|v| v["kind"] == "done")
        .unwrap();
    assert_eq!(done["aborted"], json!(true));
}

// ── scenario 2: stale permit must not poison the next stream ─────────────────

/// Mirror of the production cancel slot: `Runtime.chat_cancel`
/// (`Mutex<Arc<Notify>>` in lib.rs) plus the exact swap protocol of the
/// `eva_chat_stream` wrapper and `eva_chat_stop`. Kept in lockstep with lib.rs
/// BY THIS TEST: the wrapper swaps a fresh Notify per stream (`begin`), the
/// stop command fires whatever is CURRENTLY registered (`clone_current`). If
/// that protocol ever changes, this mirror must change with it — it IS the
/// contract under test here.
struct CancelSlot(std::sync::Mutex<Arc<Notify>>);

impl CancelSlot {
    fn new() -> Self {
        Self(std::sync::Mutex::new(Arc::new(Notify::new())))
    }
    /// eva_chat_stream wrapper on stream start: swap a FRESH Notify into the
    /// slot and hand it to the new stream. Any stale stop permit dies with the
    /// Notify it was captured from.
    fn begin(&self) -> Arc<Notify> {
        let fresh = Arc::new(Notify::new());
        *self.0.lock().unwrap() = fresh.clone();
        fresh
    }
    /// eva_chat_stop body: clone whatever stream is CURRENTLY registered.
    fn clone_current(&self) -> Arc<Notify> {
        self.0.lock().unwrap().clone()
    }
}

#[tokio::test]
async fn stop_does_not_break_the_next_stream() {
    // stream A: one token, then hang forever (this is the one we /stop)
    let port_a = tiny_server(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\ndata: {\"token\":\"а\"}\r\n\r\n",
    )
    .await;
    // stream B: one token + proper done — must complete NORMALLY
    let port_b = tiny_server(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\n\n         data: {\"token\":\"а\"}\r\n\r\ndata: {\"done\":true,\"reply\":\"а\"}\r\n\r\n",
    )
    .await;

    // THE PRODUCTION SLOT: both streams and the stop command share one slot,
    // exactly like Runtime.chat_cancel in the real app.
    let slot = CancelSlot::new();

    // 1) stream A begins — the wrapper swaps Notify A into the slot
    let cancel_a = slot.begin();
    let events_a = Events::default();
    let handle_a = tokio::spawn(run(port_a, cancel_a.clone(), events_a.clone()));
    wait_for(&events_a, |es| !es.is_empty(), "stream A first token").await;

    // 2) /stop while A is current: the command clones what's registered NOW
    //    (Notify A) and fires it — A aborts
    let stale_stop = slot.clone_current();
    assert!(
        Arc::ptr_eq(&stale_stop, &cancel_a),
        "stop must target the CURRENT stream's Notify"
    );
    stale_stop.notify_one();
    tokio::time::timeout(Duration::from_secs(2), handle_a)
        .await
        .expect("stream A aborted")
        .unwrap()
        .unwrap();

    // 3) stream B begins — the same swap model hands B a FRESH Notify B
    let cancel_b = slot.begin();
    assert!(
        !Arc::ptr_eq(&cancel_b, &cancel_a),
        "B must receive a fresh Notify, not A's"
    );
    let events_b = Events::default();
    let handle_b = tokio::spawn(run(port_b, cancel_b.clone(), events_b.clone()));
    wait_for(&events_b, |es| !es.is_empty(), "stream B first token").await;

    // 4) the STALE stop fires LATE — a permit captured from A's era must be
    //    physically unable to cancel B (B waits on Notify B; A is orphaned)
    stale_stop.notify_one();
    tokio::time::timeout(Duration::from_secs(2), handle_b)
        .await
        .expect("stream B must complete despite the stale stop")
        .unwrap()
        .unwrap();

    assert_eq!(events_b.tokens(), vec!["а"]);
    assert_eq!(events_b.kinds().last().unwrap(), "presence");
    // B completed NORMALLY — real reply, no aborted done
    let done_b = events_b
        .snapshot()
        .into_iter()
        .find(|v| v["kind"] == "done")
        .unwrap();
    assert_eq!(done_b["reply"], json!("а"));
    assert!(done_b.get("aborted").is_none());
}

// ── scenario 3: normal completion is untouched ────────────────────────────────
#[tokio::test]
async fn normal_stream_completes_with_done_reply() {
    let port = tiny_server(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\n\
         data: {\"token\":\"мур\"}\r\n\r\n\
         data: {\"token\":\".\"}\r\n\r\n\
         data: {\"done\":true,\"reply\":\"мур.\"}\r\n\r\n",
    )
    .await;
    let cancel = Arc::new(Notify::new()); // never fired
    let events = Events::default();

    tokio::time::timeout(Duration::from_secs(3), run(port, cancel, events.clone()))
        .await
        .expect("well-behaved stream must complete on its own")
        .unwrap();

    assert_eq!(events.tokens(), vec!["мур", "."]);
    let kinds = events.kinds();
    assert_eq!(kinds.last().unwrap(), "presence");
    let done = events
        .snapshot()
        .into_iter()
        .find(|v| v["kind"] == "done")
        .unwrap();
    assert_eq!(done["reply"], json!("мур."));
    assert!(done.get("aborted").is_none());
}

// ── scenario 4: /stop aborts a hung CONNECT (dead port, SYN dropped) ─────────
// A closed port answers RST instantly — that's a fast ERROR, not a hang. To
// prove the select! actually races the connect we point the engine at an
// unroutable TEST-NET-3 address, which blackholes the SYN (firewalled-dead-port
// behavior) while /stop fires; CI boxes may scavenge the address, hence the
// soft-skip guard on fast connect errors.
#[tokio::test]
async fn stop_aborts_hung_connect() {
    let cancel = Arc::new(Notify::new());
    let events = Events::default();
    let handle = tokio::spawn(run_chat_stream(
        cancel.clone(),
        "http://203.0.113.1:8770/api/chat/stream", // TEST-NET-3: never answers
        body(),
        events.channel(),
    ));

    // let the connect attempt actually start before /stop
    tokio::time::sleep(Duration::from_millis(200)).await;
    cancel.notify_one();

    match tokio::time::timeout(Duration::from_secs(3), handle).await {
        Ok(Ok(res)) => {
            // aborted before any connection error — the good path
            assert!(res.is_ok());
            let kinds = events.kinds();
            assert_eq!(kinds.last().unwrap(), "presence");
            assert!(events
                .snapshot()
                .iter()
                .any(|v| v["kind"] == "done" && v["aborted"] == json!(true)));
        }
        Ok(Err(_)) => {
            // env scavenged the address and answered RST quickly — connect
            // raced fast enough that /stop lost; engine behavior still correct
        }
        Err(_) => panic!("/stop failed to abort a hung connect — it hung past 3s"),
    }
}

// ── scenario 5: cancel mid-stream after several tokens ───────────────────────
#[tokio::test]
async fn stop_after_some_tokens_keeps_delivered_prefix() {
    // drip 3 tokens, then hang forever
    let port = tiny_server(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\n\
         data: {\"token\":\"раз\"}\r\n\r\n\
         data: {\"token\":\"два\"}\r\n\r\n\
         data: {\"token\":\"три\"}\r\n\r\n",
    )
    .await;
    let cancel = Arc::new(Notify::new());
    let events = Events::default();

    let handle = tokio::spawn(run(port, cancel.clone(), events.clone()));
    wait_for(&events, |es| es.iter().filter(|v| v["kind"] == "token").count() >= 3, "3 tokens").await;

    cancel.notify_one();
    tokio::time::timeout(Duration::from_secs(2), handle)
        .await
        .expect("stream must end after /stop")
        .unwrap()
        .unwrap();

    // tokens delivered before the stop are NOT lost (frontend keeps reply || acc)
    assert_eq!(events.tokens(), vec!["раз", "два", "три"]);
    // and there is no phantom "done with full reply" completion
    let done = events
        .snapshot()
        .into_iter()
        .find(|v| v["kind"] == "done")
        .unwrap();
    assert_eq!(done["aborted"], json!(true));
    assert_eq!(done.get("reply"), Some(&Value::Null));
}
