import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Blocks, Sparkles, Wrench, Search, X, Save, RotateCcw, FileText, Loader2 } from "lucide-react";
import { api, type SkillRow, type ToolsetRow } from "../lib/eva";

export default function CapabilitiesPane({ notify, onBack }: { notify?: (m: string) => void; onBack: () => void }) {
  const [tab, setTab] = useState<"skills" | "tools">("skills");
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [tools, setTools] = useState<ToolsetRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [toolBusy, setToolBusy] = useState<string | null>(null);

  // skill editor modal state
  const [openSkill, setOpenSkill] = useState<SkillRow | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [skillLoading, setSkillLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSkills(await api.skills()); } catch { setSkills([]); }
    try { setTools(await api.toolsets()); } catch { setTools([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const q = query.toLowerCase().trim();
  const filteredSkills = skills.filter((s) => !q || `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(q));
  const byCategory = filteredSkills.reduce<Record<string, SkillRow[]>>((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s); return acc;
  }, {});

  async function openEditor(s: SkillRow) {
    if (!s.path) { notify?.("У навыка нет пути — не открыть"); return; }
    setOpenSkill(s); setSkillLoading(true); setContent(""); setOriginal("");
    try {
      const d = await api.skillGet(s.path);
      setContent(d.content); setOriginal(d.content);
    } catch { notify?.("Не удалось прочитать SKILL.md"); setContent(""); setOriginal(""); }
    finally { setSkillLoading(false); }
  }
  function closeEditor() { setOpenSkill(null); setContent(""); setOriginal(""); }

  async function saveSkill() {
    if (!openSkill?.path) return;
    setSaving(true);
    try {
      await api.skillWrite(openSkill.path, content);
      setOriginal(content);
      notify?.(`${openSkill.name} сохранён (бэкап сделан).`);
      load();
    } catch { notify?.("Не удалось сохранить навык"); }
    finally { setSaving(false); }
  }

  async function toggleTool(t: ToolsetRow) {
    setToolBusy(t.name);
    const next = !t.enabled;
    try {
      const r = await api.toolsetToggle(t.name, next);
      setTools((ts) => ts.map((x) => x.name === t.name ? { ...x, enabled: r.enabled } : x));
      notify?.(r.note || `${t.name}: ${next ? "включён" : "отключён"}`);
    } catch { notify?.("Не удалось переключить инструмент"); }
    finally { setToolBusy(null); }
  }

  const dirty = content !== original;

  return (
    <div className="utility-screen">
      <div className="pane-topbar utility-topbar">
        <div className="pane-title-group"><span className="pane-eyebrow">EVA / ЧТО Я УМЕЮ</span><h1>Возможности</h1></div>
        <button className="quiet-text-button" onClick={onBack}>К разговору <ArrowRight size={14} /></button>
      </div>
      <div className="utility-scroll">
        <div className="utility-content">
          <div className="utility-intro">
            <span className="section-index">EVA / 04 · ЕДИНОЕ</span>
            <h2>Мой арсенал.</h2>
            <p>Навыки (процедурная память, грузятся по релевантности) и инструменты ядра. Кликни навык — прочитаешь и отредактируешь его SKILL.md прямо тут. Инструмент — переключишь тумблером (правит config.yaml, вступает в силу со следующей сессии).</p>
          </div>

          <div className="content-tabs system-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "skills"} className={tab === "skills" ? "content-tab-selected" : ""} onClick={() => setTab("skills")}><Blocks size={14} /> Навыки <span>{skills.length}</span></button>
            <button role="tab" aria-selected={tab === "tools"} className={tab === "tools" ? "content-tab-selected" : ""} onClick={() => setTab("tools")}><Wrench size={14} /> Инструменты <span>{tools.length}</span></button>
          </div>

          {tab === "skills" && <>
            <div className="archive-search" style={{ marginBottom: 16 }}>
              <Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Фильтр навыков…" />
            </div>
            {loading && <p className="archive-empty">загрузка навыков…</p>}
            {!loading && Object.keys(byCategory).sort().map((cat) => (
              <div className="cap-cat" key={cat}>
                <div className="archive-list-heading"><span>{cat.toUpperCase()}</span><span>{byCategory[cat].length}</span></div>
                <div className="cap-grid">
                  {byCategory[cat].map((s) => (
                    <button className="cap-card cap-card-clickable" key={s.name + (s.path || "")} onClick={() => openEditor(s)} title="Открыть и редактировать SKILL.md">
                      <div className="cap-card-head"><Sparkles size={13} /><strong>{s.name}</strong>{s.version && <em className="cap-ver">v{s.version}</em>}</div>
                      <p>{s.description || "—"}</p>
                      <span className="cap-card-edit"><FileText size={11} /> открыть</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!loading && filteredSkills.length === 0 && <p className="archive-empty">Ничего не нашлось.</p>}
          </>}

          {tab === "tools" && <div className="service-list" style={{ marginTop: 6 }}>
            {tools.map((t) => (
              <div className={`tool-row ${t.enabled ? "tool-on" : "tool-off"}`} key={t.name}>
                <span className="service-dot" />
                <span className="service-main"><strong>{t.name}</strong><small>{t.description || (t.enabled ? "включён" : "отключён")}</small></span>
                {toolBusy === t.name
                  ? <span className="proc-busy"><Loader2 size={15} className="spin" /></span>
                  : <button className={`tool-switch ${t.enabled ? "tool-switch-on" : ""}`} onClick={() => toggleTool(t)} role="switch" aria-checked={t.enabled} title={t.enabled ? "Отключить" : "Включить"}><i /></button>}
              </div>
            ))}
            {tools.length === 0 && <p className="archive-empty">нет данных</p>}
            <p className="utility-footnote">Тумблер правит agent.disabled_toolsets в config.yaml (с бэкапом). Кэш промпта не рвётся — изменение подхватится в следующей сессии Hermes.</p>
          </div>}
        </div>
      </div>

      {openSkill && (
        <div className="skill-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeEditor(); }}>
          <div className="skill-modal" role="dialog" aria-modal="true">
            <div className="skill-modal-head">
              <div className="skill-modal-title">
                <span className="skill-modal-eyebrow">{openSkill.category.toUpperCase()} · SKILL.md{openSkill.version ? ` · v${openSkill.version}` : ""}</span>
                <strong>{openSkill.name}</strong>
              </div>
              <button className="icon-button" onClick={closeEditor} aria-label="Закрыть"><X size={18} /></button>
            </div>
            <p className="skill-modal-desc">{openSkill.description || "—"}</p>
            <div className="skill-modal-editor">
              <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} disabled={skillLoading} placeholder={skillLoading ? "читаю SKILL.md…" : ""} />
            </div>
            <div className="skill-modal-foot">
              <span className="prompt-status">{dirty ? "● есть несохранённые правки" : "сохранено"} · {content.length} символов · {openSkill.path}</span>
              <div className="prompt-buttons">
                <button className="mem-cancel" onClick={() => setContent(original)} disabled={!dirty}><RotateCcw size={14} /> Откатить</button>
                <button className="mem-save" onClick={saveSkill} disabled={!dirty || saving || skillLoading}><Save size={14} /> {saving ? "сохраняю…" : "Сохранить"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
