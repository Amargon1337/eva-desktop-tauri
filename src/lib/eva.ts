// Eva Desktop (Tauri) — data layer.
//
// ARCHITECTURE (single boundary): React NEVER touches the network. Every call
// goes through Tauri IPC → Rust → the FastAPI Eva core (:8770, the one memory
// writer). Rust owns the HTTP, timeouts, streaming and the child runtime. This
// file is a thin typed wrapper over three Rust commands:
//   api_get(path)                 → GET  /api/*
//   api_send(method, path, body)  → POST/PUT/DELETE /api/*
//   api_upload(path, file…)       → multipart /api/attach
// plus eva_chat_stream over a Tauri Channel for real SSE.
//
// invoke() is imported from @tauri-apps/api/core (the bundler-correct path;
// withGlobalTauri is also on, but the import is what makes it reliable).

import { invoke, Channel } from "@tauri-apps/api/core";

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

// ── the one boundary ─────────────────────────────────────────────────────────
async function apiGet<T>(path: string): Promise<T> {
  return invoke<T>("api_get", { path });
}
async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  return invoke<T>("api_send", { method, path, body: body ?? null });
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  state: () => apiGet<LiveState>("/api/state"),
  reachable: async () => { try { await apiGet("/api/state"); return true; } catch { return false; } },

  conversations: (limit = 60) => apiGet<ConversationRow[]>(`/api/conversations${qs({ limit })}`),
  conversationMessages: (id: string, limit = 300) =>
    apiGet<{ id: number; role: string; content: string; ts: string }[]>(`/api/conversations/${encodeURIComponent(id)}/messages${qs({ limit })}`),
  deleteConversation: (id: string) => apiSend<{ ok: boolean; deleted: number }>("DELETE", `/api/conversations/${encodeURIComponent(id)}`),
  history: (limit = 80, conversation_id = "eva_desktop") =>
    apiGet<HistoryRow[]>(`/api/history${qs({ limit, conversation_id })}`),

  memory: (search?: string, limit = 80, includeArchived = false) =>
    apiGet<MemoryRow[]>(`/api/memory${qs(search ? { search, include_archived: includeArchived || undefined } : { limit, include_archived: includeArchived || undefined })}`),
  memoryGet: (id: number) => apiGet<{ memory: MemoryRow; history: MemoryHistory[] }>(`/api/memory/${id}`),
  memoryCreate: (b: { content: string; memory_type?: string; importance?: string; category?: string; confidence?: number; tags?: string[] }) =>
    apiSend<{ ok: boolean; id: number; memory: MemoryRow }>("POST", "/api/memory", b),
  memoryUpdate: (id: number, b: Partial<{ content: string; memory_type: string; importance: string; category: string; confidence: number; status: string; tags: string[] }>) =>
    apiSend<{ ok: boolean; memory: MemoryRow }>("PUT", `/api/memory/${id}`, b),
  memoryDelete: (id: number, hard = false) => apiSend<{ ok: boolean }>("DELETE", `/api/memory/${id}${qs({ hard })}`),
  pins: (limit = 12) => apiGet<PinRow[]>(`/api/pins${qs({ limit })}`),

  promptfiles: () => apiGet<PromptFileMeta[]>("/api/promptfiles"),
  promptfileGet: (key: string) => apiGet<{ key: string; name: string; content: string }>(`/api/promptfiles/${key}`),
  promptfileWrite: (key: string, content: string) => apiSend<{ ok: boolean; chars: number }>("PUT", `/api/promptfiles/${key}`, { content }),

  entities: (limit = 100) => apiGet<EntityRow[]>(`/api/entities${qs({ limit })}`),
  contradictions: () => apiGet<any[]>("/api/contradictions"),
  jokes: () => apiGet<any[]>("/api/jokes"),
  thoughts: (limit = 80, mood?: string) => apiGet<ThoughtRow[]>(`/api/thoughts${qs({ limit, mood: mood && mood !== "all" ? mood : undefined })}`),
  reflect: () => apiSend<{ ok: boolean }>("POST", "/api/reflect", {}),

  services: () => apiGet<ServiceRow[]>("/api/services"),
  serviceAction: (id: string, action: "start" | "stop" | "restart") =>
    apiSend<{ ok: boolean; message?: string; error?: string; killed_processes?: number; pid?: number }>("POST", `/api/services/${encodeURIComponent(id)}/action`, { action }),
  serviceLogs: (id: string, lines = 120) =>
    apiGet<{ success: boolean; lines?: string[]; path?: string; total_lines?: number; error?: string }>(`/api/services/${encodeURIComponent(id)}/logs${qs({ lines })}`),
  tokens: () => apiGet<{ days: { date: string; tokens: number }[] }>("/api/tokens"),
  models: () => apiGet<ModelCatalog>("/api/models"),
  skills: () => apiGet<SkillRow[]>("/api/skills"),
  skillGet: (path: string) => apiGet<{ path: string; content: string }>(`/api/skills/${path.split("/").map(encodeURIComponent).join("/")}`),
  skillWrite: (path: string, content: string) =>
    apiSend<{ ok: boolean; chars: number }>("PUT", `/api/skills/${path.split("/").map(encodeURIComponent).join("/")}`, { content }),
  toolsets: () => apiGet<ToolsetRow[]>("/api/toolsets"),
  toolsetToggle: (name: string, enabled: boolean) =>
    apiSend<{ ok: boolean; name: string; enabled: boolean; note?: string }>("POST", `/api/toolsets/${encodeURIComponent(name)}/toggle`, { enabled }),

  // File attach: read the File in the WebView, hand base64 to Rust which posts
  // a real multipart form to /api/attach (text → inline, image → Gemini vision).
  attach: async (f: File) => {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)) as unknown as number[]);
    }
    const data_base64 = btoa(bin);
    return invoke<{ ok: boolean; kind: string; name: string; size: number; block: string; error?: string }>(
      "api_upload", { path: "/api/attach", filename: f.name, contentType: f.type || "", dataBase64: data_base64 },
    );
  },

  chat: (message: string, mode: Mode, conversation_id = "eva_desktop") =>
    apiSend<{ reply: string; mode: string }>("POST", "/api/chat", { message, mode, conversation_id }),
};

// ── streamed chat over a Tauri Channel (real SSE forwarded by Rust) ──────────
export async function chatStream(
  message: string, mode: Mode, conversation_id: string,
  onToken: (t: string) => void, onDone: (reply: string) => void, onError: (e: string) => void,
  provider?: string, model?: string, effort?: string,
) {
  try {
    const channel = new Channel<any>();
    channel.onmessage = (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.kind === "token" && typeof msg.token === "string") onToken(msg.token);
      else if (msg.kind === "done") onDone(typeof msg.reply === "string" ? msg.reply : "");
    };
    await invoke("eva_chat_stream", {
      message, mode, conversationId: conversation_id,
      provider: provider ?? null, model: model ?? null, effort: effort ?? null,
      onEvent: channel,
    });
  } catch (e) {
    onError(String(e));
  }
}

// ── OS + local desktop state (Rust-owned) ────────────────────────────────────
async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

export const os = {
  notify: (title: string, bodyText: string) => invokeSafe<void>("notify", { title, body: bodyText }),
  runtimeStatus: () => invokeSafe<{ reachable: boolean; launched_by_us: boolean; bridge_url: string }>("runtime_status"),
  // desktop-persistent settings live in eva.db (single source of truth, not localStorage)
  getSettings: () => invokeSafe<Record<string, string>>("all_settings"),
  setSetting: (key: string, value: string) => invokeSafe<void>("set_setting", { key, value }),
};
