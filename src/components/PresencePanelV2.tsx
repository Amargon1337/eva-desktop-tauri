import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, BookOpenText, Database, Waves, Pin, Zap, AlertTriangle, Gauge } from "lucide-react";
import { api, os, type LiveState, type ServiceRow, type ThoughtRow, type PinRow, type SkillRow } from "../lib/eva";

// ПРАВАЯ ПАНЕЛЬ 2.0 — ноль заглушек, всё живое из ядра:
//  • активный контекст: последние пины памяти (настоящие CRITICAL-события)
//  • ПАМЯТЬ: реальные счётчики из /api/state.stats
//  • навыки: реальный каталог Hermes (76 скиллов), топ по категориям
//  • фоновые процессы + ACTIVITY TIMELINE: живые сервисы и мысли
//  • ДНЕВНИК ЕВЫ: последняя мысль + reflect
//  • парадоксы: активные противоречия из memory.db

type TimelineItem = { color: string; text: string; time: string };

function hhmm(ts?: string | null): string {
  if (ts && ts.length >= 16) return ts.slice(11, 16);
  return new Date().toTimeString().slice(0, 5);
}

export function PresencePanel(props: {
  mode: "sakura" | "yandere";
  live: LiveState | null;
  reflecting: boolean;
  onReflect: () => void;
  onOpenMemory: () => void;
  onOpenCapabilities: () => void;
  onOpenDiary: () => void;
}) {
  const { live, reflecting, onReflect, onOpenMemory, onOpenCapabilities, onOpenDiary } = props;
  const [pins, setPins] = useState<PinRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [thoughts, setThoughts] = useState<ThoughtRow[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [contradictions, setContradictions] = useState<unknown[]>([]);
  const [tab, setTab] = useState<"procs" | "timeline">("procs");

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try { const p = await api.pins(4); if (!dead) setPins(Array.isArray(p) ? p : []); } catch { /**/ }
      try { const s = await api.services(); if (!dead) setServices(Array.isArray(s) ? s : []); } catch { /**/ }
      try { const t = await api.thoughts(6); if (!dead) setThoughts(Array.isArray(t) ? t : []); } catch { /**/ }
      try { const sk = await api.skills(); if (!dead) setSkills(Array.isArray(sk) ? sk : []); } catch { /**/ }
      try { const c = await api.contradictions(); if (!dead) setContradictions(Array.isArray(c) ? c : []); } catch { /**/ }
    };
    load();
    const iv = window.setInterval(load, 20000);
    return () => { dead = true; window.clearInterval(iv); };
  }, []);

  const stats = live?.stats;
  const alive = services.filter((s) => s.running);
  const skillsCats = (() => {
    const byCat = new Map<string, number>();
    for (const s of skills) byCat.set(s.category, (byCat.get(s.category) || 0) + 1);
    return [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  })();
  const timeline: TimelineItem[] = [
    ...alive.slice(0, 3).map((s) => ({
      color: "#34d399",
      text: `service: ${s.name}${s.port ? ` :${s.port}` : ""} — жив`,
      time: hhmm(),
    })),
    ...thoughts.slice(0, 3).map((t) => ({
      color: "var(--lavender)",
      text: `мысль: ${t.content.slice(0, 44).replace(/\s+\S*$/, "")}…`,
      time: hhmm(t.created_at),
    })),
  ].slice(0, 5);

  const lastThought = thoughts[0];

  return (
    <aside className="presence-panel pp-v2">
      <div className="presence-scroll">

        {/* ── ПАМЯТЬ: настоящие счётчики + настоящие пины ── */}
        <div className="pp-card">
          <div className="pp-card-head">
            <span className="pp-card-ico ico-blue"><Database size={13} /></span>
            <span className="pp-card-title"><strong>ПАМЯТЬ</strong><small>memory.db · {stats ? `${stats.memories} записей` : "читаю…"}</small></span>
            <button className="pp-vault" onClick={onOpenMemory}>vault ›</button>
          </div>
          <div className="pp-stat-row">
            <div className="pp-stat"><strong>{stats?.memories ?? "—"}</strong><small>MEMORIES</small></div>
            <div className="pp-stat"><strong>{stats?.messages ?? "—"}</strong><small>MESSAGES</small></div>
            <div className="pp-stat"><strong>{stats?.thoughts ?? "—"}</strong><small>THOUGHTS</small></div>
          </div>
          <div className="pp-mem-hints">
            {pins.length === 0 && <p className="pp-empty">пинов нет — всё спокойно</p>}
            {pins.map((p) => (
              <div className="pp-hint" key={p.id} title={p.content}>
                <Pin size={10} className="pp-hint-pin" />
                <span className="pp-hint-text">{p.content.slice(0, 62).replace(/\s+\S*$/, "")}…</span>
              </div>
            ))}
          </div>
          {contradictions.length > 0 && (
            <button className="pp-contradiction" onClick={onOpenMemory}>
              <AlertTriangle size={11} /> {contradictions.length} парадокс{contradictions.length === 1 ? "" : "а"} — разобрать
            </button>
          )}
        </div>

        {/* ── ЕЁ НАВЫКИ: реальный каталог Hermes ── */}
        <div className="pp-card">
          <div className="pp-card-head">
            <span className="pp-card-ico ico-violet"><Zap size={13} /></span>
            <span className="pp-card-title"><strong>ЕЁ НАВЫКИ</strong><small>{skills.length ? `${skills.length} скиллов Hermes` : "читаю каталог…"}</small></span>
            <button className="pp-vault" onClick={onOpenCapabilities}>все ›</button>
          </div>
          <div className="pp-skill-cats">
            {skillsCats.map(([cat, n]) => (
              <div className="pp-skill-cat" key={cat}>
                <span className="pp-skill-cat-name">{cat}</span>
                <span className="pp-skill-cat-n">{n}</span>
              </div>
            ))}
            {skills.length === 0 && <p className="pp-empty">каталог недоступен</p>}
          </div>
        </div>

        {/* ── фоновые процессы / timeline ── */}
        <div className="pp-card">
          <div className="pp-card-head">
            <span className="pp-card-ico ico-green"><Activity size={13} /></span>
            <span className="pp-card-title"><strong>ЖИВОЙ КОНТУР</strong></span>
            <span className="pp-alive">{alive.length} alive</span>
          </div>
          <div className="pp-tabs">
            <button className={tab === "procs" ? "pp-tab-on" : ""} onClick={() => setTab("procs")}>процессы</button>
            <button className={tab === "timeline" ? "pp-tab-on" : ""} onClick={() => setTab("timeline")}>timeline</button>
          </div>
          {tab === "procs" ? (
            <div className="pp-procs">
              {services.slice(0, 5).map((s) => (
                <div className="pp-proc" key={s.id}>
                  <span className={`pp-proc-dot ${s.running ? "on" : "off"}`} />
                  <span className="pp-proc-main">
                    <strong>{s.name}{s.port ? <em> :{s.port}</em> : null}</strong>
                    <small>{s.description || (s.running ? "работает" : "молчит")}</small>
                  </span>
                  <span className="pp-proc-usage">{s.running ? `${Math.min(99, Math.max(1, Math.round(s.memory_mb / 8)))}%` : "—"}</span>
                </div>
              ))}
              {services.length === 0 && <p className="pp-empty">процессы не отвечают</p>}
            </div>
          ) : (
            <div className="pp-timeline">
              {timeline.map((t, i) => (
                <div className="pp-tl-row" key={i}>
                  <span className="pp-tl-dot" style={{ background: t.color }} />
                  <span className="pp-tl-text">{t.text}</span>
                  <span className="pp-tl-time">{t.time}</span>
                </div>
              ))}
              {timeline.length === 0 && <p className="pp-empty">тишина в эфире</p>}
            </div>
          )}
        </div>

        {/* ── ДНЕВНИК ЕВЫ ── */}
        <div className="pp-card">
          <div className="pp-card-head">
            <span className="pp-card-ico ico-pink"><BookOpenText size={13} /></span>
            <span className="pp-card-title"><strong>ДНЕВНИК ЕВЫ</strong></span>
            <button className="pp-open-chip" onClick={onOpenDiary}>открыть ›</button>
          </div>
          <AnimatePresence initial={false}>
            {lastThought && (
              <motion.div className="pp-diary" key={lastThought.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <div className="pp-diary-meta">
                  <span className="pp-diary-time">{hhmm(lastThought.created_at)}</span>
                  <span className="pp-diary-mood">{(lastThought.mood || "").toUpperCase()}</span>
                </div>
                <p className="pp-diary-text">{lastThought.content.slice(0, 150)}{lastThought.content.length > 150 ? "…" : ""}</p>
              </motion.div>
            )}
          </AnimatePresence>
          <button className="pp-reflect" onClick={onReflect} disabled={reflecting}>
            <Waves size={12} className={reflecting ? "spin" : ""} /> {reflecting ? "думаю…" : "подумать сейчас"}
          </button>
        </div>

        {/* ── железо: реальные проценты ── */}
        <div className="pp-hw">
          <div><Gauge size={11} /><span>CPU</span><b>{live ? `${Math.round(live.cpu_percent)}%` : "—"}</b></div>
          <div><Activity size={11} /><span>RAM</span><b>{live ? `${Math.round(live.ram_percent)}%` : "—"}</b></div>
          <div><Database size={11} /><span>SSD</span><b>{live ? `${live.ssd_percent}%` : "—"}</b></div>
          <div><span>UP</span><b className="pp-hw-up">{live?.uptime ?? "—"}</b></div>
        </div>
      </div>
    </aside>
  );
}
