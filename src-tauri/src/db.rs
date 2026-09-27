// Eva Desktop — local SQLite (eva.db).
//
// Hermes/Eva runtime remains the single source of truth for MEMORY (one active
// writer). This DB holds only desktop-local state that has no business round-
// tripping through Hermes: UI settings, a local event log, and a presence trail.
//
// Tables: settings, events, presence.

use anyhow::Result;
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

#[derive(Serialize, Clone)]
pub struct EventRow {
    pub id: i64,
    pub kind: String,
    pub payload: String,
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct PresenceRow {
    pub id: i64,
    pub state: String,
    pub active_window: String,
    pub created_at: String,
}

pub fn open(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            kind       TEXT NOT NULL,
            payload    TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS presence (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            state         TEXT NOT NULL,
            active_window TEXT NOT NULL DEFAULT '',
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_presence_created ON presence(created_at DESC);
        "#,
    )?;
    // sane defaults
    conn.execute(
        "INSERT OR IGNORE INTO settings(key,value) VALUES ('mode','sakura')",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO settings(key,value) VALUES ('bridge_url','http://127.0.0.1:8770')",
        [],
    )?;
    Ok(conn)
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key,value) VALUES (?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [key, value],
    )?;
    Ok(())
}

pub fn log_event(conn: &Connection, kind: &str, payload: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO events(kind,payload) VALUES (?1,?2)",
        [kind, payload],
    )?;
    // keep the table bounded — this is a rolling trail, not an archive
    conn.execute(
        "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 500)",
        [],
    )?;
    Ok(())
}

pub fn recent_events(conn: &Connection, limit: i64) -> Result<Vec<EventRow>> {
    let mut stmt =
        conn.prepare("SELECT id,kind,payload,created_at FROM events ORDER BY id DESC LIMIT ?1")?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(EventRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                payload: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn log_presence(conn: &Connection, state: &str, active_window: &str) -> Result<()> {
    // only write when the state actually changed, to keep the trail meaningful
    let last: Option<String> = conn
        .query_row(
            "SELECT state FROM presence ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    if last.as_deref() == Some(state) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO presence(state,active_window) VALUES (?1,?2)",
        [state, active_window],
    )?;
    conn.execute(
        "DELETE FROM presence WHERE id NOT IN (SELECT id FROM presence ORDER BY id DESC LIMIT 300)",
        [],
    )?;
    Ok(())
}

pub fn recent_presence(conn: &Connection, limit: i64) -> Result<Vec<PresenceRow>> {
    let mut stmt = conn.prepare(
        "SELECT id,state,active_window,created_at FROM presence ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(PresenceRow {
                id: r.get(0)?,
                state: r.get(1)?,
                active_window: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}
