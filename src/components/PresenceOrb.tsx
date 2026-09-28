import { motion } from "framer-motion";
import type { PresenceState } from "../lib/eva";

// Eva's living state orb: idle → thinking → speaking, plus away.
const MAP: Record<PresenceState, { label: string; color: string; pulse: number }> = {
  present: { label: "рядом", color: "var(--accent)", pulse: 2.6 },
  idle: { label: "тихо наблюдает", color: "#9b8ba0", pulse: 4.5 },
  away: { label: "ждёт тебя", color: "#6f6379", pulse: 6 },
  thinking: { label: "думает", color: "var(--lavender)", pulse: 1.1 },
  speaking: { label: "говорит", color: "var(--accent-bright)", pulse: 0.8 },
};

export default function PresenceOrb({ state, compact = false, label }: { state: PresenceState; compact?: boolean; label?: string }) {
  const cfg = MAP[state] ?? MAP.present;
  const shown = label ?? cfg.label;
  return (
    <span className={`presence-orb ${compact ? "presence-orb-compact" : ""}`} title={cfg.label}>
      <motion.span
        className="presence-orb-core"
        style={{ background: cfg.color, boxShadow: `0 0 12px ${cfg.color}` }}
        animate={{ scale: [1, 1.28, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: cfg.pulse, repeat: Infinity, ease: "easeInOut" }}
      />
      {!compact && <span className="presence-orb-label">{shown}</span>}
    </span>
  );
}
