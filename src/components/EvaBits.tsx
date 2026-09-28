import type { Mode } from "../lib/eva";

// Общий визуальный словарь Евы: каноничный арт и летучая мышь 🦇 (SOUL.md §10).
export const artwork: Record<Mode, string> = { sakura: "/eva-sakura.webp", yandere: "/eva-yandere.webp" };

export function BatMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 38" fill="none" aria-hidden="true">
      <path d="M24 11.2 18.6 3l-1.3 8.5C11.6 8.4 6.3 10 2 7.5c.5 8.2 4.2 14 9.7 15.5-1.7 1.8-2 5.1-.2 7.1 3.6-2.2 7.4-2.1 10.2 1.3l2.3 4.3 2.3-4.3c2.8-3.4 6.6-3.5 10.2-1.3 1.8-2 1.5-5.3-.2-7.1C41.8 21.5 45.5 15.7 46 7.5c-4.3 2.5-9.6.9-15.3 4L29.4 3 24 11.2Z" fill="currentColor" />
      <path d="m20 20 4 3 4-3" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EvaAvatar({ mode, className = "" }: { mode: Mode; className?: string }) {
  return <span className={`eva-avatar ${className}`}><img src={artwork[mode]} alt="Ева" /></span>;
}
