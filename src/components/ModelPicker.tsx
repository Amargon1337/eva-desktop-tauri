import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Cpu, Search, Zap, ZapOff, X } from "lucide-react";
import type { ModelCatalog, Effort } from "../lib/eva";

export type ModelChoice = { provider: string; model: string } | null;

const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: "off", label: "выкл", hint: "без рассуждений — быстрее" },
  { id: "minimal", label: "min", hint: "лёгкое обдумывание" },
  { id: "low", label: "low", hint: "короткая цепочка мыслей" },
  { id: "medium", label: "med", hint: "среднее рассуждение" },
  { id: "high", label: "high", hint: "максимум размышлений" },
];

// Providers whose transport supports a reasoning/thinking knob at all.
// Everyone gets the toggle; it's harmless (extra JSON field) but we surface it as meaningful.
export default function ModelPicker({
  catalog, chosen, effort, onPick, onClear, onEffort,
}: {
  catalog: ModelCatalog | null;
  chosen: ModelChoice;
  effort: Effort;
  onPick: (provider: string, model: string) => void;
  onClear: () => void;
  onEffort: (e: Effort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => { window.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const query = q.toLowerCase().trim();
  const groups = useMemo(() => {
    const provs = catalog?.providers ?? [];
    return provs
      .map((p) => {
        const models = query
          ? p.models.filter((m) => m.toLowerCase().includes(query) || p.label.toLowerCase().includes(query) || p.provider.toLowerCase().includes(query))
          : p.models;
        return { ...p, models };
      })
      .filter((p) => p.models.length > 0);
  }, [catalog, query]);

  const totalModels = useMemo(() => groups.reduce((n, g) => n + g.models.length, 0), [groups]);
  // Trigger always shows a real model name + the active effort, never a bare "по умолчанию".
  const coreModel = catalog?.current?.model || "модель ядра";
  const activeModel = chosen ? chosen.model : coreModel;
  const effortLabel = EFFORTS.find((e) => e.id === effort)?.label ?? effort;

  function toggleGroup(slug: string) { setCollapsed((c) => ({ ...c, [slug]: !c[slug] })); }

  return (
    <div className="model-wrap" ref={wrapRef}>
      <button className={`model-trigger ${chosen ? "model-trigger-set" : ""}`} onClick={() => setOpen((o) => !o)} title="Выбор модели и уровня рассуждений">
        <Cpu size={13} /><span>{activeModel}</span>
        <em className={`model-effort-badge ${effort === "off" ? "model-effort-off" : ""}`}>{effort === "off" ? "eff·off" : `eff·${effortLabel}`}</em>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="model-popover model-popover-wide">
          <div className="model-search-row">
            <Search size={14} />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск моделей…" />
            {q && <button className="model-search-clear" onClick={() => setQ("")}><X size={13} /></button>}
          </div>

          <button className={`model-opt model-default-opt ${!chosen ? "model-opt-active" : ""}`} onClick={onClear}>
            <span className="model-opt-dot" />
            <span className="model-opt-main"><strong>Модель ядра — {coreModel}</strong><small>цепочка Hermes по умолчанию (рефлексия)</small></span>
            {!chosen && <span className="model-opt-check">✓</span>}
          </button>

          <div className="model-scroll">
            {groups.length === 0 && <p className="model-empty">Ничего не нашлось по «{q}»</p>}
            {groups.map((p) => {
              const isCollapsed = collapsed[p.provider] && !query;
              return (
                <div className="model-group" key={p.provider}>
                  <button className="model-group-head" onClick={() => toggleGroup(p.provider)}>
                    {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    <span>{p.label}</span>
                    <em>{p.models.length}</em>
                  </button>
                  {!isCollapsed && p.models.map((m) => {
                    const active = chosen?.provider === p.provider && chosen?.model === m;
                    return (
                      <button key={p.provider + m} className={`model-opt ${active ? "model-opt-active" : ""}`} onClick={() => { onPick(p.provider, m); setOpen(false); }}>
                        <span className="model-opt-dot" />
                        <span className="model-opt-main"><strong>{m}</strong></span>
                        {active && <span className="model-opt-check">✓</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="model-effort-bar">
            <div className="model-effort-label">{effort === "off" ? <ZapOff size={12} /> : <Zap size={12} />} УРОВЕНЬ РАССУЖДЕНИЙ</div>
            <div className="model-effort-seg">
              {EFFORTS.map((e) => (
                <button key={e.id} className={effort === e.id ? "effort-on" : ""} title={e.hint} onClick={() => onEffort(e.id)}>{e.label}</button>
              ))}
            </div>
          </div>

          <div className="model-popover-foot">
            <span>{totalModels} моделей · {groups.length} провайдеров</span>
            <span>{chosen ? `${chosen.provider}` : "рефлексия ядра"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
