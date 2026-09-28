import { Plus, Search, MessageCircle, Brain, BookOpenText, Activity, Folder, ChevronDown, MoreHorizontal, PenLine, CornerDownRight } from "lucide-react";
import { motion } from "framer-motion";
import { EvaAvatar } from "./EvaBits";
import type { Mode, ConversationRow } from "../lib/eva";

export type OrbitId = "chat" | "memory" | "diary" | "activity" | "library";

const ORBIT: { id: OrbitId; label: string; icon: typeof MessageCircle }[] = [
  { id: "chat", label: "С Евой", icon: MessageCircle },
  { id: "memory", label: "Память", icon: Brain },
  { id: "diary", label: "Её дневник", icon: BookOpenText },
  { id: "activity", label: "Активность", icon: Activity },
  { id: "library", label: "Библиотека", icon: Folder },
];

export function Sidebar(props: {
  mode: Mode;
  page: string;
  conversations: ConversationRow[];
  convId: string;
  onOrbit: (id: OrbitId) => void;
  onNew: () => void;
  onSearch: () => void;
  onOpenConv: (id: string) => void;
  onSwitchMode: (m: Mode) => void;
}) {
  const { mode, page, conversations, convId, onOrbit, onNew, onSearch, onOpenConv, onSwitchMode } = props;
  const recent = conversations.slice(0, 6);

  return (
    <aside className="sidebar sb-v2">
      <div className="sidebar-scroll">
        {/* бренд-блок: рукописная Eva + «your digital other half» */}
        <div className="sb-brand">
          <div className="sb-brand-row">
            <span className="sb-brand-script">Eva</span>
            <motion.span className="sb-spark" animate={{ rotate: [0, 14, -8, 0], scale: [1, 1.18, 1] }} transition={{ duration: 5, repeat: Infinity }}>✦</motion.span>
          </div>
          <div className="sb-brand-sub">YOUR DIGITAL<br />OTHER HALF</div>
        </div>

        {/* «Наше пространство» — переключатель обликов, just you & me */}
        <button className="sb-space" onClick={() => onSwitchMode(mode === "sakura" ? "yandere" : "sakura")} title="Переключить облик Евы">
          <EvaAvatar mode={mode} className="sb-space-avatar" />
          <span className="sb-space-copy"><strong>Наше пространство</strong><small>just you &amp; me</small></span>
          <ChevronDown size={14} className="sb-space-chev" />
        </button>

        <div className="sb-actions">
          <button className="sb-new" onClick={onNew}><Plus size={15} strokeWidth={2} /><span>Новый разговор</span><kbd>Ctrl N</kbd></button>
          <button className="sb-find" onClick={onSearch}><Search size={14} /><span>Найти что-нибудь</span><kbd>Ctrl K</kbd></button>
        </div>

        {/* орбита: 5 живых разделов */}
        <nav className="sb-orbit">
          {ORBIT.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`sb-link ${page === id ? "sb-link-active" : ""}`} onClick={() => onOrbit(id)}>
              <Icon size={16} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "chat" && <i className="sb-dot" />}
              {id === "diary" && <i className="sb-dot sb-dot-warm" />}
            </button>
          ))}
        </nav>

        {/* ПРОЕКТЫ: якоря его реальной жизни, пока статичны */}
        <div className="sb-section">
          <div className="sb-sect-head"><span>ПРОЕКТЫ</span><PenLine size={11} /></div>
          <button className="sb-link sb-proj"><i className="sb-proj-dot" /><span>Eva Desktop</span></button>
          <button className="sb-link sb-proj"><i className="sb-proj-dot sb-proj-dot-dim" /><span>Ночные эксперименты</span></button>
        </div>

        {/* РАЗГОВОРЫ: недавние из memory.db */}
        {recent.length > 0 && (
          <div className="sb-section">
            <div className="sb-sect-head"><span>РАЗГОВОРЫ</span><span className="sb-sect-count">{conversations.length}</span></div>
            {recent.map((c) => (
              <button key={c.id} className={`sb-link sb-conv ${page === "chat" && convId === c.id ? "sb-link-active" : ""}`} onClick={() => onOpenConv(c.id)}>
                <CornerDownRight size={13} className="sb-conv-arrow" />
                <span className="sb-conv-title">{c.is_desktop ? "Соулмейт" : c.title}</span>
                <MoreHorizontal size={13} className="sb-conv-more" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-separator" />
        <div className="sidebar-user">
          <span className="user-avatar">И</span>
          <span className="sidebar-user-text"><strong>Иван</strong><small>соулмейт №1</small></span>
        </div>
      </div>
    </aside>
  );
}
