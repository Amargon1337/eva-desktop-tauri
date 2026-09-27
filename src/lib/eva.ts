// Eva Desktop (Tauri) — data layer.
// DESIGN NOTE: the rich data API lives in the FastAPI core on localhost:8770
// (one memory writer, the real memory.db). React hits it directly over HTTP —
// CSP is disabled and the backend sets CORS *. Duplicating the whole memory
// CRUD / prompt-file / conversation API through Rust IPC would balloon the
// binary and force a 6-min recompile per tweak. Rust keeps what only Rust can
// do: system tray, global hotkey, native notifications, runtime bootstrap —
// reached via invokeSafe(), which no-ops gracefully in a plain dev browser.

const BASE = "http://127.0.0.1:8770";

export type Mode = "sakura" | "yandere";
export type PresenceState = "present" | "idle" | "away" | "thinking" | "speaking";

export type LiveState = {
  version: string; mode: Mode; sliders: Record<string, number>; uptime: string;
  ssd_percent: number; cpu_percent: number; ram_percent: number; presence: string;
  idle_seconds: number; is_night: boolean; active_window: string;
  visible_apps: { title?: string; proc?: string }[];
  stats: { memories: number; thoughts: number; messages: number; entities: number };
};
export type MemoryRow = {
  id: number; content: string; category: string | null; type: string; importance: string;
  status: string; epistemic_kind: string | null; confidence: number; stability: number;
  peer: string; tags: string[]; created_at: string; updated_at: string; access_count: number; score: number | null;
};
export type MemoryHistory = {
  id: number; action: string; old_content: string | null; new_content: string | null;
  reason: string | null; changed_by: string; created_at: string;
};
export type PinRow = { id: number; content: string; type: string };
export type ThoughtRow = { id: number; type: string | null; mood: string | null; trigger: string | null; content: string; created_at: string | null };
export type ServiceRow = {
  id: string; name: string; running: boolean; port: number | null; memory_mb: number; uptime: string;
  category?: string; description?: string; pid?: number | null; process_count?: number;
  autostart_enabled?: boolean; autostart_supported?: boolean; log_available?: boolean;
};
export type HistoryRow = { role: string; content: string; ts: string };
export type ConversationRow = { id: string; title: string; count: number; last_ts: string; first_ts: string; is_desktop: boolean };
export type EntityRow = { id: number; name: string; type: string; summary: string };
export type PromptFileMeta = { key: string; name: string; chars: number; exists: boolean };
export type ProviderRow = { provider: string; label: string; base_url: string; default: string; models: string[] };
export type ModelCatalog = { providers: ProviderRow[]; current: { provider: string; model: string }; aliases: { alias: string; target: string }[] };
export type Effort = "off" | "minimal" | "low" | "medium" | "high";
export type SkillRow = { name: string; description: string; category: string; version: string; path?: string; chars?: number };
export type ToolsetRow = { name: string; enabled: boolean; description?: string };

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}
function body(method: string, b: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) };
}

export const api = {
  state: () => j<LiveState>("/api/state"),
  reachable: async () => { try { await j("/api/state"); return true; } catch { return false; } },

  conversations: (limit = 60) => j<ConversationRow[]>(`/api/conversations?limit=${limit}`),
  conversationMessages: (id: string, limit = 300) =>
    j<{ id: number; role: string; content: string; ts: string }[]>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${limit}`),
  deleteConversation: (id: string) => j<{ ok: boolean; deleted: number }>(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  history: (limit = 80, conversation_id = "eva_desktop") =>
    j<HistoryRow[]>(`/api/history?limit=${limit}&conversation_id=${encodeURIComponent(conversation_id)}`),

  memory: (search?: string, limit = 80, includeArchived = false) =>
    j<MemoryRow[]>(`/api/memory?${search ? `search=${encodeURIComponent(search)}` : `limit=${limit}`}${includeArchived ? "&include_archived=true" : ""}`),
  memoryGet: (id: number) => j<{ memory: MemoryRow; history: MemoryHistory[] }>(`/api/memory/${id}`),
  memoryCreate: (b: { content: string; memory_type?: string; importance?: string; category?: string; confidence?: number; tags?: string[] }) =>
    j<{ ok: boolean; id: number; memory: MemoryRow }>("/api/memory", body("POST", b)),
  memoryUpdate: (id: number, b: Partial<{ content: string; memory_type: string; importance: string; category: string; confidence: number; status: string; tags: string[] }>) =>
    j<{ ok: boolean; memory: MemoryRow }>(`/api/memory/${id}`, body("PUT", b)),
  memoryDelete: (id: number, hard = false) => j<{ ok: boolean }>(`/api/memory/${id}?hard=${hard}`, { method: "DELETE" }),
  pins: (limit = 12) => j<PinRow[]>(`/api/pins?limit=${limit}`),

  promptfiles: () => j<PromptFileMeta[]>("/api/promptfiles"),
  promptfileGet: (key: string) => j<{ key: string; name: string; content: string }>(`/api/promptfiles/${key}`),
  promptfileWrite: (key: string, content: string) => j<{ ok: boolean; chars: number }>(`/api/promptfiles/${key}`, body("PUT", { content })),

  entities: (limit = 100) => j<EntityRow[]>(`/api/entities?limit=${limit}`),
  contradictions: () => j<any[]>("/api/contradictions"),
  jokes: () => j<any[]>("/api/jokes"),
  thoughts: (limit = 80, mood?: string) => j<ThoughtRow[]>(`/api/thoughts?limit=${limit}${mood && mood !== "all" ? `&mood=${encodeURIComponent(mood)}` : ""}`),
  reflect: () => j<{ ok: boolean }>("/api/reflect", { method: "POST" }),

  services: () => j<ServiceRow[]>("/api/services"),
  serviceAction: (id: string, action: "start" | "stop" | "restart") =>
    j<{ ok: boolean; message?: string; error?: string; killed_processes?: number; pid?: number }>(
      `/api/services/${encodeURIComponent(id)}/action`, body("POST", { action })),
  serviceLogs: (id: string, lines = 120) =>
    j<{ success: boolean; lines?: string[]; path?: string; total_lines?: number; error?: string }>(
      `/api/services/${encodeURIComponent(id)}/logs?lines=${lines}`),
  tokens: () => j<{ days: { date: string; tokens: number }[] }>("/api/tokens"),
  models: () => j<ModelCatalog>("/api/models"),
  skills: () => j<SkillRow[]>("/api/skills"),
  skillGet: (path: string) => j<{ path: string; content: string }>(`/api/skills/${path.split("/").map(encodeURIComponent).join("/")}`),
  skillWrite: (path: string, content: string) =>
    j<{ ok: boolean; chars: number }>(`/api/skills/${path.split("/").map(encodeURIComponent).join("/")}`, body("PUT", { content })),
  toolsets: () => j<ToolsetRow[]>("/api/toolsets"),
  toolsetToggle: (name: string, enabled: boolean) =>
    j<{ ok: boolean; name: string; enabled: boolean; note?: string }>(`/api/toolsets/${encodeURIComponent(name)}/toggle`, body("POST", { enabled })),

  attach: async (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch(BASE + "/api/attach", { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<{ ok: boolean; kind: string; name: string; size: number; block: string; error?: string }>;
  },

  chat: (message: string, mode: Mode, conversation_id = "eva_desktop") =>
    j<{ reply: string; mode: string }>("/api/chat", body("POST", { message, mode, conversation_id })),
};

// Streaming chat over SSE — onToken per word, onDone at the end.
export async function chatStream(
  message: string, mode: Mode, conversation_id: string,
  onToken: (t: string) => void, onDone: (reply: string) => void, onError: (e: string) => void,
  provider?: string, model?: string, effort?: string,
) {
  try {
    const r = await fetch(BASE + "/api/chat/stream", body("POST", { message, mode, conversation_id, provider, model, effort }));
    if (!r.ok || !r.body) { onError(`HTTP ${r.status}`); return; }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        try {
          const p = JSON.parse(line.slice(5).trim());
          if (p.done) onDone(p.reply || "");
          else if (p.token) onToken(p.token);
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    onError(String(e));
  }
}

// ── OS integration via Rust (optional; no-op in a plain browser) ─────────────
async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const w = window as any;
    const invoke = w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke;
    if (!invoke) return null;
    return await invoke(cmd, args);
  } catch {
    return null;
  }
}

export const os = {
  notify: (title: string, bodyText: string) => invokeSafe<void>("notify", { title, body: bodyText }),
  runtimeStart: () => invokeSafe<any>("runtime_start"),
  runtimeStatus: () => invokeSafe<any>("runtime_status"),
};
