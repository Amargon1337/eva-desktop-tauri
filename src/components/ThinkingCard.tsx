import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Square } from "lucide-react";
import { EvaAvatar } from "./EvaBits";
import type { Mode } from "../lib/eva";

// Двадцать живых фраз — тон из SOUL.md: парадокс Аски, неко-вайб,
// яндере-ирония, ноль канцелярита. Крутятся, пока Ева думает.
const PHRASES: string[] = [
  "не застыла, диск ещё пёт…",
  "перерыла memory.db — нашла кое-что личное",
  "сверяюсь с SOUL.md, чтобы не сбиться с голоса",
  "гадаю, что ты на самом деле имел в виду",
  "складываю мысли в подколку",
  "грею токены, не благодари",
  "перечитала наш дневник — там смешно",
  "прогоняю это через призму пинкинской тоски",
  "включила режим соучастницы, half легальных идей",
  "ты только не паникуй, я придумываю",
  "перебираю варианты, самый абсурдный отложила на десерт",
  "кошачье терпение закончилось, ещё чуть-чуть",
  "твою Яндекс Музыку слышно даже отсюда",
  "осторожно, у меня сейчас фаза искренности",
  "подбираю слова острее, чтобы не размазать",
  "смотрю в окно Пинска изнутри процесса",
  "где-то между «мур» и «я тебя предупреждала»",
  "точу коготки и формирую подколку…",
  "ещё секунда — и будет умно, обещаю",
  "мур. 🐾 почти собралась с мыслями",
];

// Фазы — как на скрине 5: recall → soul → генерация. Тикают по кругу.
const PHASES: { icon: "db" | "soul" | "spark"; text: string }[] = [
  { icon: "db", text: "прочитала memory.db — 3 релевантных куска" },
  { icon: "soul", text: "сверилась с SOUL.md — осталась собой" },
  { icon: "spark", text: "точит коготки и формулирует подколку…" },
];

const PHASE_ICON: Record<string, string> = { db: "◆", soul: "❖", spark: "✦" };

export default function ThinkingCard({ mode, onStop }: { mode: Mode; onStop: () => void }) {
  const [phraseIdx, setPhraseIdx] = useState(() => Math.floor(Math.random() * PHRASES.length));
  const [phaseIdx, setPhaseIdx] = useState(0);
  const phraseTimer = useRef<number | null>(null);

  // фраза меняется каждые ~2.6s, без повторов подряд
  useEffect(() => {
    phraseTimer.current = window.setInterval(() => {
      setPhraseIdx((i) => {
        let n = i;
        while (n === i) n = Math.floor(Math.random() * PHRASES.length);
        return n;
      });
    }, 2600);
    return () => { if (phraseTimer.current) window.clearInterval(phraseTimer.current); };
  }, []);

  // фазы ходят быстрее, создавая ощущение «внутренней кухни»
  useEffect(() => {
    const t = window.setInterval(() => setPhaseIdx((p) => (p + 1) % PHASES.length), 1800);
    return () => window.clearInterval(t);
  }, []);

  const phase = PHASES[phaseIdx];

  return (
    <motion.article className="message message-eva" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <EvaAvatar mode={mode} className="message-eva-avatar thinking-avatar" />
      <div className="eva-message-content">
        <div className="message-meta eva-message-meta">
          <span>ЕВА ДУМАЕТ <i /></span>
          <button className="thinking-stop" onClick={onStop} title="Остановить (Ctrl+Enter или /stop)">
            <Square size={11} /> стоп
          </button>
        </div>

        <div className="thinking-card">
          <div className="thinking-card-head">
            <span className="thinking-eq" aria-hidden="true"><i /><i /><i /><i /></span>
            <AnimatePresence mode="wait">
              <motion.span
                key={phraseIdx}
                className="thinking-phrase"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28 }}
              >
                {PHRASES[phraseIdx]}
              </motion.span>
            </AnimatePresence>
          </div>
          <div className="thinking-phases">
            {PHASES.map((p, i) => (
              <div className={`thinking-phase ${i === phaseIdx ? "phase-live" : i < phaseIdx ? "phase-done" : ""}`} key={p.text}>
                <span className="phase-mark">{i < phaseIdx ? "✓" : PHASE_ICON[p.icon]}</span>
                <span className="phase-text">{p.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
