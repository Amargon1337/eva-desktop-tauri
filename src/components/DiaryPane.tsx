import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, BookOpenText, ChevronDown, RefreshCw, ScrollText } from "lucide-react";
import { api, os, type InsideJoke, type LiveState, type ThoughtRow } from "../lib/eva";

const moodFilters = [
  { id: "all", label: "Все" }, { id: "thoughtful", label: "Задумчиво" }, { id: "tender", label: "Нежно" },
  { id: "mischievous", label: "Озорно" }, { id: "sarcastic", label: "Ехидно" },
  { id: "yandere", label: "Яндере" }, { id: "melancholy", label: "Грустно" },
];

export default function DiaryPane({ live, reflecting, onReflect, onBack }: {
  live: LiveState | null; reflecting: boolean; onReflect: () => void; onBack: () => void;
}) {
  const [thoughts, setThoughts] = useState<ThoughtRow[]>([]);
  const [jokes, setJokes] = useState<InsideJoke[]>([]);
  const [mood, setMood] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  const [openJoke, setOpenJoke] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try { setThoughts(await api.thoughts(80, m)); } catch { setThoughts([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(mood); /* eslint-disable-next-line */ }, [mood]);
  // "Наш кодекс" — the shared mythology lives in inside_jokes; it was invisible before
  useEffect(() => { os.insideJokes().then((j) => { if (j) setJokes(j); }); }, []);

  return (
    <div className="utility-screen">
      <div className="pane-topbar utility-topbar">
        <div className="pane-title-group"><span className="pane-eyebrow">EVA / ВНУТРЕННИЙ МИР · EVA_THOUGHTS</span><h1>Дневник Евы</h1></div>
        <button className="quiet-text-button" onClick={onBack}>К разговору <ArrowRight size={14} /></button>
      </div>
      <div className="utility-scroll">
        <div className="utility-content">
          <div className="utility-intro">
            <span className="section-index">EVA / 03</span>
            <h2>Пока тебя нет.</h2>
            <p>Автономные мысли пишутся в eva_thoughts, пока ты занят. Мои страницы, а не сообщения от твоего имени. Читаются прямо из базы.</p>
          </div>
          <div className="diary-opening"><span>"</span><p>А ты думал, я замираю, когда ты закрываешь окно?</p><small>EVA / АВТОНОМНЫЙ ПОТОК</small></div>
          <div className="diary-controls">
            <div className="archive-list-heading"><span>СТРАНИЦЫ ИЗ EVA_THOUGHTS {live ? `· ${live.stats.thoughts}` : ""}</span>
              <button className="reflect-button" style={{ width: "auto", padding: "6px 12px", marginTop: 0 }} onClick={onReflect} disabled={reflecting}><RefreshCw size={12} className={reflecting ? "spin" : ""} /> {reflecting ? "думаю…" : "подумать сейчас"}</button>
            </div>
            <div className="diary-filters">{moodFilters.map((f) => <button key={f.id} aria-pressed={mood === f.id} className={mood === f.id ? "filter-active" : ""} onClick={() => { setMood(f.id); setOpen(null); }}>{f.label}</button>)}</div>
          </div>
          {jokes.length > 0 && <div className="jokes-block">
            <div className="archive-list-heading"><span><ScrollText size={12} /> НАШ КОДЕКС</span><span>{jokes.length}</span></div>
            <div className="jokes-list">
              {jokes.map((j) => (
                <div className={`archive-item ${openJoke === j.title ? "archive-item-open" : ""}`} key={j.title}>
                  <button className="archive-row" onClick={() => setOpenJoke(openJoke === j.title ? null : j.title)}>
                    <span className="archive-number">×{j.times_used}</span>
                    <span className="archive-main"><small>{(j.mood || "lore").toUpperCase()}</small><strong>{j.title}</strong></span>
                    <ChevronDown size={17} className="archive-chevron" />
                  </button>
                  <AnimatePresence initial={false}>{openJoke === j.title && (
                    <motion.div className="archive-detail diary-detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.23 }}>
                      <p>{j.lore}</p>
                      {j.punchline_hint && <span><BookOpenText size={12} /> панчлайн: {j.punchline_hint}</span>}
                    </motion.div>
                  )}</AnimatePresence>
                </div>
              ))}
            </div>
            <p className="utility-footnote">Общая мифология из inside_jokes — то, над чем мы смеёмся вместе и не раз.</p>
          </div>}
          <div className="archive-list diary-list">
            {loading && <p className="archive-empty">читаю дневник…</p>}
            {!loading && thoughts.length === 0 && <p className="archive-empty">Записей с таким настроением пока нет.</p>}
            {!loading && thoughts.map((t) => (
              <div className={`archive-item ${open === t.id ? "archive-item-open" : ""}`} key={t.id}>
                <button className="archive-row" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <span className="archive-number">{(t.created_at || "").slice(11, 16) || "··"}</span>
                  <span className="archive-main"><small>{(t.type || "THOUGHT")} / {(t.mood || "").toUpperCase()}</small><strong>{t.content.slice(0, 68)}{t.content.length > 68 ? "…" : ""}</strong></span>
                  <ChevronDown size={17} className="archive-chevron" />
                </button>
                <AnimatePresence initial={false}>{open === t.id && (
                  <motion.div className="archive-detail diary-detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.23 }}>
                    <p>{t.content}</p>
                    <span><BookOpenText size={12} /> eva_thoughts · {t.trigger || "autonomous"} · {(t.created_at || "").slice(0, 16).replace("T", " ")}</span>
                  </motion.div>
                )}</AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
