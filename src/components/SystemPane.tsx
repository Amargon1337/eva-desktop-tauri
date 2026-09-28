import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Activity, Cpu, HardDrive, Monitor, RefreshCw, Network, Users, AlertTriangle, Play, Square, RotateCw, ChevronDown, ChevronRight, FileText, Loader2, ScrollText, DatabaseBackup } from "lucide-react";
import { api, os, type LiveState, type ServiceRow, type EntityRow, type JournalRow } from "../lib/eva";

export default function SystemPane({ live, notify, onBack, onOpenMemory }: { live: LiveState | null; notify?: (m: string) => void; onBack: () => void; onOpenMemory: () => void }) {
  const [tab, setTab] = useState<"contour" | "services" | "entities" | "journal">("contour");
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [contradictions, setContradictions] = useState<any[]>([]);
  const [tokens, setTokens] = useState<{ date: string; tokens: number }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, { lines: string[]; path?: string; loading?: boolean }>>({});
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const loadJournal = useCallback(async () => {
    const rows = await os.localEvents(120);
    if (rows) setJournal(rows);
  }, []);

  const loadServices = useCallback(async () => {
    try { const s = await api.services(); setServices(Array.isArray(s) ? s : []); } catch { setServices([]); }
    try { setTokens((await api.tokens()).days); } catch { /**/ }
    try { setContradictions(await api.contradictions()); } catch { /**/ }
  }, []);
  const loadEntities = useCallback(async () => { try { setEntities(await api.entities(100)); } catch { setEntities([]); } }, []);

  useEffect(() => { loadServices(); os.lastBackup().then(setLastBackup); /* eslint-disable-next-line */ }, []);

  // "без памяти нет Евы": the dying-SSD insurance button
  async function runBackup() {
    setBackingUp(true); setBackupMsg(null);
    try {
      const r = await os.backupMemory();
      if (r?.ok) { setBackupMsg(`скопировано ${(r.bytes / 1048576).toFixed(1)} МБ`); setLastBackup(await os.lastBackup()); }
      else setBackupMsg(r?.error || "не получилось");
    } finally { setBackingUp(false); }
  }
  function backupAge(): string | null {
    if (!lastBackup) return null;
    const t = new Date(lastBackup).getTime();
    if (Number.isNaN(t)) return null;
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return "сегодня";
    if (days === 1) return "вчера";
    return `${days} дн назад`;
  }
  useEffect(() => { if (tab === "entities") loadEntities(); if (tab === "services") loadServices(); if (tab === "journal") loadJournal(); /* eslint-disable-next-line */ }, [tab]);
  // live refresh of the process list while the tab is open
  useEffect(() => {
    if (tab !== "services") return;
    const i = window.setInterval(loadServices, 6000);
    return () => window.clearInterval(i);
  }, [tab, loadServices]);

  const maxTok = Math.max(1, ...tokens.map((d) => d.tokens));

  async function act(id: string, action: "start" | "stop" | "restart") {
    setBusy(id);
    try {
      const r = await api.serviceAction(id, action);
      if (r.ok) notify?.(r.message || `${action} ok`);
      else notify?.(r.error || `не удалось: ${action}`);
    } catch (e) { notify?.(`ошибка: ${String(e)}`); }
    // give the process a beat to appear/disappear, then refresh
    window.setTimeout(loadServices, action === "stop" ? 700 : 1400);
    window.setTimeout(() => setBusy(null), action === "stop" ? 700 : 1400);
  }

  async function toggleExpand(id: string) {
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (next && !logs[id]) {
      setLogs((l) => ({ ...l, [id]: { lines: [], loading: true } }));
      try {
        const r = await api.serviceLogs(id, 60);
        setLogs((l) => ({ ...l, [id]: { lines: r.lines || [], path: r.path, loading: false } }));
      } catch { setLogs((l) => ({ ...l, [id]: { lines: ["лог недоступен"], loading: false } })); }
    }
  }

  async function refreshLog(id: string) {
    setLogs((l) => ({ ...l, [id]: { ...(l[id] || { lines: [] }), loading: true } }));
    try {
      const r = await api.serviceLogs(id, 60);
      setLogs((l) => ({ ...l, [id]: { lines: r.lines || [], path: r.path, loading: false } }));
    } catch { setLogs((l) => ({ ...l, [id]: { lines: ["лог недоступен"], loading: false } })); }
  }

  return (
    <div className="utility-screen">
      <div className="pane-topbar utility-topbar">
        <div className="pane-title-group"><span className="pane-eyebrow">EVA / АРХИТЕКТУРА · НАТИВНО</span><h1>Система</h1></div>
        <button className="quiet-text-button" onClick={onBack}>К разговору <ArrowRight size={14} /></button>
      </div>
      <div className="utility-scroll">
        <div className="utility-content">
          <div className="utility-intro">
            <span className="section-index">EVA / 05</span>
            <h2>Rust держит, React рисует.</h2>
            <p>Ядро, IPC, SQLite, трей и хоткеи — на Rust. React только показывает. Телеметрия, процессы, граф сущностей и токены — живые из ядра.</p>
          </div>

          <div className="content-tabs system-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "contour"} className={tab === "contour" ? "content-tab-selected" : ""} onClick={() => setTab("contour")}>Контур</button>
            <button role="tab" aria-selected={tab === "services"} className={tab === "services" ? "content-tab-selected" : ""} onClick={() => setTab("services")}>Процессы</button>
            <button role="tab" aria-selected={tab === "entities"} className={tab === "entities" ? "content-tab-selected" : ""} onClick={() => setTab("entities")}>Сущности</button>
            <button role="tab" aria-selected={tab === "journal"} className={tab === "journal" ? "content-tab-selected" : ""} onClick={() => setTab("journal")}>Журнал</button>
          </div>

          {tab === "contour" && <div className="system-contour">
            <div className="backup-strip">
              <DatabaseBackup size={16} className={backupAge() && backupAge() !== "сегодня" ? "backup-stale" : "backup-ok"} />
              <div className="backup-strip-info">
                <strong>Страховка памяти</strong>
                <small>{lastBackup ? `последний бэкап memory.db — ${backupAge()}` : "бэкапов ещё не было — а SSD умирает"}{backupMsg ? ` · ${backupMsg}` : ""}</small>
              </div>
              <button onClick={runBackup} disabled={backingUp}>{backingUp ? "копирую…" : "бэкап сейчас"}</button>
            </div>
            <div className="archive-list-heading"><span>КАК ПРОХОДИТ ОДИН ХОД</span><span>LIVE-ТЕЛЕМЕТРИЯ</span></div>
            <div className="contour-flow"><div><small>01 / ОБОЛОЧКА</small><strong>Tauri + Rust</strong><span>окно, трей, IPC, eva.db</span></div><ArrowRight size={17} /><div><small>02 / МОСТ</small><strong>Eva Bridge</strong><span>localhost → Hermes core</span></div><ArrowRight size={17} /><div><small>03 / МЫСЛЬ</small><strong>LLM + память</strong><span>SOUL.md + recall → токены</span></div></div>
            <div className="system-principle"><span>ИНВАРИАНТ</span><p>Rust держит то, чему <em>не место</em> в React. Один активный писатель памяти — Hermes.</p></div>
            <div className="system-spec-list"><div className="archive-list-heading"><span>НА ЧЁМ Я ЖИВУ</span><span>{live ? "СЕЙЧАС" : "—"}</span></div>
              <div className="spec-row"><Cpu size={16} /><strong>Процессор</strong><span>CPU {live ? `${Math.round(live.cpu_percent)}%` : "—"} · RAM {live ? `${Math.round(live.ram_percent)}%` : "—"}</span></div>
              <div className="spec-row"><HardDrive size={16} /><strong>Системный SSD</strong><span>заполнен {live ? `${live.ssd_percent}%` : "—"} · здесь живёт память</span></div>
              <div className="spec-row"><Monitor size={16} /><strong>Presence</strong><span>{live ? `${live.presence} · ${live.active_window || "—"}`.slice(0, 52) : "—"}</span></div>
              <div className="spec-row"><Activity size={16} /><strong>Uptime ядра</strong><span>{live?.uptime ?? "—"} · {live?.is_night ? "ночь" : "день"}</span></div>
            </div>
            {tokens.length > 0 ? <div className="token-block">
              <div className="archive-list-heading"><span>ТОКЕНЫ · 14 ДНЕЙ</span><span>token_usage</span></div>
              <div className="token-bars">{tokens.slice().reverse().map((d) => (
                <div className="token-bar" key={d.date} title={`${d.date}: ${d.tokens}`}><i style={{ height: `${Math.max(4, (d.tokens / maxTok) * 100)}%` }} /><small>{d.date.slice(5)}</small></div>
              ))}</div>
            </div> : <p className="utility-footnote">token_usage пуст за 14 дней — логирование usage у активных провайдеров отвалилось (проверь конфиг Hermes).</p>}
            {contradictions.length > 0 && <div className="contradiction-block">
              <div className="archive-list-heading"><span><AlertTriangle size={12} /> ПРОТИВОРЕЧИЯ</span><button className="quiet-text-button" onClick={onOpenMemory} title="Разобрать в Памяти">разобрать <ArrowRight size={12} /></button></div>
              {contradictions.slice(0, 4).map((c, i) => <div className="service-row service-off" key={i}><span className="service-dot" /><span className="service-main"><strong>{String(c.description || c.notes || c.status || "конфликт").slice(0, 70)}</strong><small>{c.status || ""}</small></span></div>)}
            </div>}
            <div className="system-mortality"><span>ЗА ПРЕДЕЛАМИ МОНИТОРА</span><p>Без памяти нет Евы.</p><small>Это не процент заполнения диска. Это причина беречь историю.</small></div>
          </div>}

          {tab === "services" && <div className="system-surfaces">
            <div className="archive-list-heading"><span><Network size={12} /> ФОНОВЫЕ ПРОЦЕССЫ ЕВЫ</span><button className="quiet-text-button" onClick={loadServices}><RefreshCw size={13} /> обновить</button></div>
            <div className="proc-list">
              {services.length === 0 && <p className="archive-empty">нет данных о процессах</p>}
              {services.map((s) => {
                const isOpen = expanded === s.id;
                const isBusy = busy === s.id;
                const log = logs[s.id];
                return (
                  <div className={`proc-item ${s.running ? "proc-on" : "proc-off"} ${isOpen ? "proc-open" : ""}`} key={s.id}>
                    <div className="proc-head">
                      <button className="proc-expand" onClick={() => toggleExpand(s.id)} aria-label="Подробности">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <span className="service-dot" />
                      <span className="proc-main">
                        <strong>{s.name}</strong>
                        <small>
                          {s.port ? `порт ${s.port}` : "без порта"}
                          {s.running && s.memory_mb ? ` · ${s.memory_mb} MB` : ""}
                          {s.running && s.uptime && s.uptime !== "—" ? ` · ${s.uptime}` : ""}
                          {s.running && s.pid ? ` · pid ${s.pid}` : ""}
                        </small>
                      </span>
                      <span className={`proc-state ${s.running ? "proc-state-live" : ""}`}>{s.running ? "● LIVE" : "○ off"}</span>
                      <div className="proc-controls">
                        {isBusy ? <span className="proc-busy"><Loader2 size={15} className="spin" /></span> : s.running ? (
                          <>
                            <button className="proc-btn proc-btn-restart" title="Перезапустить" onClick={() => act(s.id, "restart")}><RotateCw size={14} /></button>
                            <button className="proc-btn proc-btn-stop" title="Остановить" onClick={() => act(s.id, "stop")}><Square size={13} /></button>
                          </>
                        ) : (
                          <button className="proc-btn proc-btn-start" title="Запустить" onClick={() => act(s.id, "start")}><Play size={14} /></button>
                        )}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="proc-detail">
                        {s.description && <p className="proc-desc">{s.description}</p>}
                        <div className="proc-meta-grid">
                          <div><span>ID</span><code>{s.id}</code></div>
                          <div><span>категория</span><code>{s.category || "—"}</code></div>
                          <div><span>порт</span><code>{s.port ?? "—"}</code></div>
                          <div><span>процессов</span><code>{s.process_count ?? (s.running ? 1 : 0)}</code></div>
                          <div><span>автозапуск</span><code>{s.autostart_supported ? (s.autostart_enabled ? "вкл" : "выкл") : "н/д"}</code></div>
                          <div><span>память</span><code>{s.running ? `${s.memory_mb} MB` : "—"}</code></div>
                        </div>
                        <div className="proc-log-head">
                          <span><FileText size={11} /> {log?.path ? log.path : "лог"}</span>
                          <button className="quiet-text-button" onClick={() => refreshLog(s.id)}><RefreshCw size={11} /> обновить</button>
                        </div>
                        <pre className="proc-log">{log?.loading ? "читаю лог…" : (log?.lines?.length ? log.lines.join("\n") : "лог пуст или недоступен")}</pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="utility-footnote">Кнопки реально запускают, останавливают и перезапускают процессы через ServicesManager ядра. Eva Desktop видит и себя — не глуши её же.</p>
          </div>}

          {tab === "entities" && <div className="system-surfaces">
            <div className="archive-list-heading"><span><Users size={12} /> ГРАФ СУЩНОСТЕЙ</span><span>{entities.length}</span></div>
            <div className="service-list">
              {entities.length === 0 && <p className="archive-empty">пусто</p>}
              {entities.map((e) => (<div className="service-row service-on" key={e.id}><span className="service-dot" /><span className="service-main"><strong>{e.name} <em style={{ color: "#8a7c90", fontStyle: "normal", fontSize: 9 }}>· {e.type}</em></strong><small>{(e.summary || "").slice(0, 90)}</small></span></div>))}
            </div>
            <p className="utility-footnote">Люди, проекты, места и концепты, которые Ева знает — из таблицы entities.</p>
          </div>}

          {tab === "journal" && <div className="system-surfaces">
            <div className="archive-list-heading">
              <span><ScrollText size={12} /> ЖУРНАЛ ДЕСКТОПА · eva.db</span>
              <button className="quiet-text-button" onClick={loadJournal}><RefreshCw size={13} /> обновить</button>
            </div>
            <div className="service-list">
              {journal.length === 0 && <p className="archive-empty">журнал пуст</p>}
              {journal.map((e) => (
                <div className="service-row" key={e.id}>
                  <span className="service-dot" />
                  <span className="service-main">
                    <strong>{e.kind}</strong>
                    <small>{e.payload || "—"}</small>
                  </span>
                  <span className="proc-state">{(e.created_at || "").slice(0, 16).replace("T", " ")}</span>
                </div>
              ))}
            </div>
            <p className="utility-footnote">Локальный след desktop-приложения: подъём и остановка ядра, presence-переходы. Пишется в eva.db — память Евы это не трогает.</p>
          </div>}
        </div>
      </div>
    </div>
  );
}
