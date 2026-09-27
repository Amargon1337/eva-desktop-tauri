import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, ChevronDown, Database, Fingerprint, Pencil, Plus, Search, Trash2, X, Check, History,
} from "lucide-react";
import { api, type LiveState, type MemoryRow, type MemoryHistory } from "../lib/eva";

const TYPES = ["fact", "preference", "trait", "relationship", "event", "goal", "project", "experience", "communication_pattern", "inferred", "other"];
const IMPORTANCE = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

function impClass(imp: string) {
  const u = (imp || "").toUpperCase();
  if (u.includes("CRITICAL")) return "imp-critical";
  if (u.includes("HIGH")) return "imp-high";
  if (u.includes("MEDIUM")) return "imp-medium";
  return "imp-low";
}

type Draft = { content: string; memory_type: string; importance: string; category: string; confidence: number };
const emptyDraft: Draft = { content: "", memory_type: "fact", importance: "MEDIUM", category: "general", confidence: 0.85 };

export default function MemoryPane({ live, notify, onBack }: { live: LiveState | null; notify: (m: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, MemoryHistory[]>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const load = useCallback(async (search?: string) => {
    setLoading(true);
    try { setRows(await api.memory(search || undefined, 80, includeArchived)); }
    catch { setRows([]); }
    finally { setLoading(false); }
  }, [includeArchived]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [includeArchived]);

  async function openRow(id: number) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!history[id]) {
      try { const d = await api.memoryGet(id); setHistory((h) => ({ ...h, [id]: d.history })); }
      catch { /**/ }
    }
  }

  function startEdit(m: MemoryRow) {
    setEditing(m.id);
    setDraft({ content: m.content, memory_type: m.type, importance: m.importance, category: m.category || "general", confidence: m.confidence });
  }

  async function saveEdit(id: number) {
    try {
      await api.memoryUpdate(id, draft);
      notify("Память обновлена");
      setEditing(null);
      await load(query.trim() || undefined);
    } catch { notify("Не удалось сохранить"); }
  }

  async function createMemory() {
    if (!draft.content.trim()) { notify("Пустая запись"); return; }
    try {
      await api.memoryCreate(draft);
      notify("Новая память записана в базу");
      setCreating(false); setDraft(emptyDraft);
      await load();
    } catch { notify("Не удалось создать"); }
  }

  async function archive(id: number) {
    try { await api.memoryDelete(id, false); notify("Отправлено в архив (можно вернуть)"); await load(query.trim() || undefined); }
    catch { notify("Не удалось"); }
  }
  async function hardDelete(id: number) {
    try { await api.memoryDelete(id, true); notify("Удалено навсегда"); await load(query.trim() || undefined); }
    catch { notify("Не удалось"); }
  }

  const editor = (mode: "create" | "edit", id?: number) => (
    <div className="mem-editor">
      <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="Текст воспоминания…" rows={4} />
      <div className="mem-editor-row">
        <label>Тип<select value={draft.memory_type} onChange={(e) => setDraft({ ...draft, memory_type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Важность<select value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: e.target.value })}>{IMPORTANCE.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Категория<input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label>
        <label>Confidence<input type="number" min={0} max={1} step={0.05} value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: parseFloat(e.target.value) || 0 })} /></label>
      </div>
      <div className="mem-editor-actions">
        <button className="mem-save" onClick={() => (mode === "create" ? createMemory() : saveEdit(id!))}><Check size={14} /> {mode === "create" ? "Создать" : "Сохранить"}</button>
        <button className="mem-cancel" onClick={() => { mode === "create" ? setCreating(false) : setEditing(null); }}><X size={14} /> Отмена</button>
      </div>
    </div>
  );

  return (
    <div className="utility-screen">
      <div className="pane-topbar utility-topbar">
        <div className="pane-title-group"><span className="pane-eyebrow">EVA / АРХИВ · ЖИВАЯ БАЗА</span><h1>Память</h1></div>
        <button className="quiet-text-button" onClick={onBack}>К разговору <ArrowRight size={14} /></button>
      </div>
      <div className="utility-scroll">
        <div className="utility-content">
          <div className="utility-intro">
            <span className="section-index">EVA / 02</span>
            <h2>Я помню не на глаз.</h2>
            <p>Настоящие записи из memory.db. Гибридный поиск (FTS5 + смысловая близость), редактирование с аудит-историей, архив и жёсткое удаление. Один писатель — это та же база, которой пользуется Ева.</p>
          </div>

          <div className="memory-explainer"><span className="annotation-number">{live ? `${live.stats.memories} MEMORIES` : "RECALL"}</span><p>Сначала <strong>messages_fts</strong>, затем вектора, важность и свежесть. Правки не затирают историю — каждое изменение логируется в memory_history.</p></div>

          <div className="mem-toolbar">
            <form className="archive-search" onSubmit={(e) => { e.preventDefault(); load(query.trim() || undefined); }}>
              <Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Гибридный поиск по памяти (Enter)…" />
              <button type="submit" className="archive-search-go">{loading ? "…" : "ИСКАТЬ"}</button>
            </form>
            <button className={`mem-filter ${includeArchived ? "on" : ""}`} onClick={() => setIncludeArchived((v) => !v)}>архив</button>
            <button className="mem-new" onClick={() => { setCreating(true); setDraft(emptyDraft); }}><Plus size={14} /> Добавить</button>
          </div>

          {creating && editor("create")}

          <div className="archive-list">
            {loading && <p className="archive-empty">ищу в памяти…</p>}
            {!loading && rows.length === 0 && <p className="archive-empty">Ничего не нашлось.</p>}
            {!loading && rows.map((m) => (
              <div className={`archive-item ${open === m.id ? "archive-item-open" : ""}`} key={m.id}>
                {editing === m.id ? editor("edit", m.id) : <>
                  <button className="archive-row" onClick={() => openRow(m.id)}>
                    <span className={`archive-number ${impClass(m.importance)}`}>{String(m.id).padStart(3, "0")}</span>
                    <span className="archive-main"><small>{m.type} / {m.importance}{m.status !== "CONFIRMED" ? ` · ${m.status}` : ""}{m.score != null ? ` · score ${m.score}` : ""}</small><strong>{m.content.slice(0, 76)}{m.content.length > 76 ? "…" : ""}</strong></span>
                    <ChevronDown size={17} className="archive-chevron" />
                  </button>
                  <AnimatePresence initial={false}>{open === m.id && (
                    <motion.div className="archive-detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.23 }}>
                      <p>{m.content}</p>
                      <div className="memory-provenance">
                        <span><Fingerprint size={13} /> {m.category || "—"}</span>
                        <span>CONFIDENCE: {Math.round((m.confidence ?? 0) * 100)}%</span>
                        <span>обращений: {m.access_count}</span>
                        {m.tags.length > 0 && <span>#{m.tags.join(" #")}</span>}
                      </div>
                      <div className="mem-row-actions">
                        <button onClick={() => startEdit(m)}><Pencil size={13} /> Изменить</button>
                        <button onClick={() => archive(m.id)}><Trash2 size={13} /> В архив</button>
                        <button className="danger" onClick={() => hardDelete(m.id)}><X size={13} /> Удалить навсегда</button>
                      </div>
                      {history[m.id] && history[m.id].length > 0 && (
                        <div className="mem-history">
                          <div className="mem-history-head"><History size={12} /> ИСТОРИЯ ИЗМЕНЕНИЙ</div>
                          {history[m.id].slice(0, 6).map((h) => (
                            <div className="mem-history-row" key={h.id}><span>{h.action}</span><small>{h.reason || ""} · {(h.created_at || "").slice(0, 16).replace("T", " ")}</small></div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}</AnimatePresence>
                </>}
              </div>
            ))}
          </div>
          <div className="memory-architecture-foot"><span>memory.db</span><span>memories · messages + FTS5 · eva_thoughts · entities · events · contradictions · embeddings</span></div>
        </div>
      </div>
    </div>
  );
}
