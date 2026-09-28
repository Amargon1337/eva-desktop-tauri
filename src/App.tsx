import { useEffect, useRef, useState, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, ArrowRight, BookOpenText, Brain, ChevronRight, Command, Database, FileText,
  Flower2, Image as ImageIcon, Loader2, Menu, MessageCircle, Moon, MoreHorizontal, Paperclip, PanelRightClose, PanelRightOpen,
  Plus, RefreshCw, Search, Settings2, Sparkles, Square, Trash2, Unplug, Wrench, X, type LucideIcon,
} from "lucide-react";
import {
  api, chatStream, chatStop, os as osIntegration,
  type Mode, type PresenceState, type LiveState, type HistoryRow, type ConversationRow, type ModelCatalog, type Effort, type LivingThought,
} from "./lib/eva";
import PresenceOrb from "./components/PresenceOrb";
import ThinkingCard from "./components/ThinkingCard";
import { Sidebar, type OrbitId } from "./components/Sidebar";
import { PresencePanel } from "./components/PresencePanelV2";
import MemoryPane from "./components/MemoryPane";
import PromptPane from "./components/PromptPane";
import DiaryPane from "./components/DiaryPane";
import SystemPane from "./components/SystemPane";
import CapabilitiesPane from "./components/CapabilitiesPane";
import ModelPicker from "./components/ModelPicker";
import RichText from "./components/RichText";

type Page = "chat" | "memory" | "prompt" | "diary" | "capabilities" | "system";

const artwork: Record<Mode, string> = { sakura: "/eva-sakura.webp", yandere: "/eva-yandere.webp" };

const navigation: { id: Page; label: string; icon: LucideIcon; shortcut: string }[] = [
  { id: "memory", label: "Память", icon: Brain, shortcut: "01" },
  { id: "prompt", label: "Личность", icon: FileText, shortcut: "02" },
  { id: "diary", label: "Дневник", icon: BookOpenText, shortcut: "03" },
  { id: "capabilities", label: "Возможности", icon: Wrench, shortcut: "04" },
  { id: "system", label: "Система", icon: Activity, shortcut: "05" },
];

function BatMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 38" fill="none" aria-hidden="true">
      <path d="M24 11.2 18.6 3l-1.3 8.5C11.6 8.4 6.3 10 2 7.5c.5 8.2 4.2 14 9.7 15.5-1.7 1.8-2 5.1-.2 7.1 3.6-2.2 7.4-2.1 10.2 1.3l2.3 4.3 2.3-4.3c2.8-3.4 6.6-3.5 10.2-1.3 1.8-2 1.5-5.3-.2-7.1C41.8 21.5 45.5 15.7 46 7.5c-4.3 2.5-9.6.9-15.3 4L29.4 3 24 11.2Z" fill="currentColor" />
      <path d="m20 20 4 3 4-3" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EvaAvatar({ mode, className = "" }: { mode: Mode; className?: string }) {
  return <span className={`eva-avatar ${className}`}><img src={artwork[mode]} alt="Ева" /></span>;
}
function TypingDots() { return <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>; }
function formatTime() { return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
function tsToTime(ts: string) { try { return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }

// A persisted "user" row is often NOT something Ivan typed: the gateway injects
// background-process notices ([IMPORTANT: …]), out-of-band markers, memory-context
// blocks, and we append attach/▪shape wrappers. Clean those for display so the
// thread shows what he actually said — not machine noise attributed to him.
function isSystemNote(content: string): boolean {
  const t = content.trimStart();
  return t.startsWith("[IMPORTANT:") || t.startsWith("[OUT-OF-BAND") || t.startsWith("[System note");
}
function cleanUserContent(content: string): string {
  let t = content;
  // strip a recalled memory-context block if it ever leaked into the row
  t = t.replace(/<memory-context>[\s\S]*?<\/memory-context>/gi, "");
  // strip our own attach fold-ins — the chip already conveyed them
  t = t.replace(/\n*\[Файл «[^»]*»[\s\S]*?\n\]/g, "");
  t = t.replace(/\n*\[Изображение «[^»]*»[\s\S]*?\]/g, "");
  // unwrap the classic USER MESSAGE envelope if present
  const m = t.match(/---\s*USER MESSAGE BEGIN\s*---([\s\S]*?)---\s*USER MESSAGE END\s*---/);
  if (m) t = m[1];
  return t.trim();
}
function relDay(ts: string) {
  try {
    const d = new Date(ts); const now = new Date();
    const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (days <= 0) return "сегодня";
    if (days === 1) return "вчера";
    if (days < 7) return `${days} дн назад`;
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  } catch { return ""; }
}
function moodLabel(s: Record<string, number>): string {
  const y = s["яндере"] ?? 0, t = s["нежность"] ?? 0, b = s["дерзость"] ?? 0;
  if (y >= 55) return "дерзко-собственническая";
  if (t >= b) return "дерзко-нежная";
  return "острая и живая";
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("eva-mode") === "yandere" ? "yandere" : "sakura"));
  const [page, setPage] = useState<Page>("chat");
  const [convId, setConvId] = useState("eva_desktop");
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [messages, setMessages] = useState<HistoryRow[]>([]);
  const [live, setLive] = useState<LiveState | null>(null);
  const [presence, setPresence] = useState<PresenceState>("present");
  const [showPresence, setShowPresence] = useState(() => window.innerWidth >= 1200);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [composer, setComposer] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamBuf, setStreamBuf] = useState("");
  const [reflecting, setReflecting] = useState(false);
  const [coreDown, setCoreDown] = useState(false);
  const [coreBusy, setCoreBusy] = useState(false);
  const [livingThought, setLivingThought] = useState<LivingThought | null>(null);
  const [toast, setToast] = useState("");
  const [clock, setClock] = useState(formatTime);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [modelCat, setModelCat] = useState<ModelCatalog | null>(null);
  const [chosen, setChosen] = useState<{ provider: string; model: string } | null>(() => {
    try { const s = localStorage.getItem("eva-model"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [effort, setEffort] = useState<Effort>(() => {
    const s = localStorage.getItem("eva-effort");
    return (s === "minimal" || s === "low" || s === "medium" || s === "high" || s === "off") ? s : "off";
  });
  const [attachments, setAttachments] = useState<{ name: string; block: string; kind: string; ok: boolean }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [prefsReady, setPrefsReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingShapeRef = useRef<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const compactRef = useRef(window.innerWidth < 1200);

  useEffect(() => { if (prefsReady) { localStorage.setItem("eva-mode", mode); osIntegration.setSetting("mode", mode); } }, [mode, prefsReady]);
  useEffect(() => { if (prefsReady) { localStorage.setItem("eva-effort", effort); osIntegration.setSetting("effort", effort); } }, [effort, prefsReady]);
  // composer draft lives in eva.db — a restart must never eat a half-typed letter
  useEffect(() => {
    (async () => {
      try { const s = await osIntegration.getSettings(); const d = s?.composer_draft; if (typeof d === "string" && d) setComposer(d); } catch { /**/ }
    })();
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { osIntegration.setSetting("composer_draft", composer); }, 400);
    return () => window.clearTimeout(t);
  }, [composer]);
  useEffect(() => { const i = window.setInterval(() => setClock(formatTime()), 15_000); return () => window.clearInterval(i); }, []);

  const refreshState = useCallback(async () => {
    try {
      const s = await api.state();
      setLive(s);
      const idle = s.idle_seconds || 0;
      setPresence((prev) => (prev === "thinking" || prev === "speaking") ? prev : (idle > 900 ? "away" : idle > 120 ? "idle" : "present"));
    } catch { /* warming */ }
    // her living thought — non-private only (Rust filters is_private)
    try { const t = await osIntegration.livingThought(); if (t !== null) setLivingThought(t); } catch { /**/ }
  }, []);
  const refreshConversations = useCallback(async () => { try { setConversations(await api.conversations(60)); } catch { /**/ } }, []);
  // runtime health from the Rust side: is the core answering, who owns it
  const checkCore = useCallback(async () => {
    const st = await osIntegration.runtimeStatus();
    // null = plain browser dev (no bridge) — don't scream in that mode
    if (st) setCoreDown(!st.reachable);
  }, []);
  const raiseCore = useCallback(async () => {
    setCoreBusy(true);
    try {
      await osIntegration.runtimeStart(); // idempotent in Rust
      await new Promise((r) => window.setTimeout(r, 900));
      await refreshState();
    } finally { setCoreBusy(false); await checkCore(); }
  }, [checkCore, refreshState]);

  const loadConversation = useCallback(async (id: string) => {
    setLoadingHistory(true);
    setConvId(id);
    try {
      const h = await api.conversationMessages(id, 300);
      setMessages(h.map((m) => ({ role: m.role, content: m.content, ts: m.ts })));
    } catch { setMessages([]); }
    finally { setLoadingHistory(false); window.setTimeout(scrollToBottom, 80); }
  }, []);

  useEffect(() => {
    (async () => {
      // Rust owns runtime bootstrap (single owner, no race). We just wait for reachability.
      // eva.db is the source of truth for desktop prefs — hydrate from it (falls back to localStorage seed).
      try {
        const s = await osIntegration.getSettings();
        if (s) {
          if (s.mode === "sakura" || s.mode === "yandere") setMode(s.mode);
          if (["off", "minimal", "low", "medium", "high"].includes(s.effort)) setEffort(s.effort as Effort);
          if (s.model) { try { const c = JSON.parse(s.model); if (c?.provider && c?.model) setChosen(c); } catch { /**/ } }
        }
      } catch { /* plain browser dev — stick with localStorage seed */ }
      finally { setPrefsReady(true); } // only now may pref-writers persist (no localStorage→DB race)
      await Promise.all([refreshState(), refreshConversations(), checkCore()]);
      await loadConversation("eva_desktop");
      try { setModelCat(await api.models()); } catch { /**/ }
    })();
    // Rust presence poller pushes live telemetry; subscribe instead of polling hard.
    const unlisten = listen<{ state: string; snapshot?: LiveState }>("eva://state", (e) => {
      const p = e.payload;
      if (p?.snapshot) setLive(p.snapshot);
      setPresence((prev) => (prev === "thinking" || prev === "speaking") ? prev : (p.state as PresenceState) || prev);
    });
    // gentle fallback poll in case events are missed (e.g. plain browser dev)
    const s = window.setInterval(() => { refreshState(); checkCore(); }, 30_000);
    return () => { window.clearInterval(s); unlisten.then((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onResize() {
      const compact = window.innerWidth < 1200;
      if (compact !== compactRef.current) { compactRef.current = compact; setShowPresence(!compact); setSidebarOpen(false); }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen((o) => !o); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); newConversation(); }
      if (e.key === "Escape") { setSearchOpen(false); setMoreOpen(false); setSidebarOpen(false); if (window.innerWidth < 1200) setShowPresence(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (searchOpen) window.setTimeout(() => searchRef.current?.focus(), 50); else setSearchQuery(""); }, [searchOpen]);
  useEffect(() => () => { if (toastRef.current) window.clearTimeout(toastRef.current); }, []);

  function notify(msg: string) { setToast(msg); if (toastRef.current) window.clearTimeout(toastRef.current); toastRef.current = window.setTimeout(() => setToast(""), 3600); }
  function choosePage(p: Page) { setPage(p); setSidebarOpen(false); setSearchOpen(false); setMoreOpen(false); if (window.innerWidth < 1200) setShowPresence(false); }
  function scrollToBottom() { const c = scrollRef.current; if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" }); }

  function newConversation() {
    const id = `desk_${Date.now().toString(36)}`;
    setConvId(id); setMessages([]); setPage("chat"); setMoreOpen(false); setSidebarOpen(false);
    notify("Новый разговор — первое сообщение его закрепит");
    window.setTimeout(() => textareaRef.current?.focus(), 100);
  }

  async function deleteConversation(id: string) {
    try { await api.deleteConversation(id); notify("Разговор стёрт из базы"); }
    catch { notify("Не удалось удалить"); }
    await refreshConversations();
    if (id === convId) { setConvId("eva_desktop"); loadConversation("eva_desktop"); }
  }

  async function sendMessage() {
    const raw = composer.trim();
    // slash command interception
    if (raw.startsWith("/")) {
      const handled = await runSlash(raw);
      if (handled) { setComposer(""); setSlashOpen(false); return; }
      // not handled → a "shape" command produced a directive prompt; fall through to send it
    }
    const shaped = pendingShapeRef.current;
    pendingShapeRef.current = null;
    const attachBlocks = attachments.filter((a) => a.ok).map((a) => a.block).join("\n");
    const body = shaped ?? raw;
    const text = [body, attachBlocks].filter(Boolean).join("\n\n");
    if (!text || sending) return;
    const shownText = (shaped ? `⚡ ${raw}` : raw) || (attachments.length ? `📎 ${attachments.map((a) => a.name).join(", ")}` : "");
    setMessages((p) => [...p, { role: "user", content: shownText, ts: new Date().toISOString() }]);
    setComposer(""); setAttachments([]); setSending(true); setPresence("thinking"); setStreamBuf("");
    sendingRef.current = true;
    window.setTimeout(scrollToBottom, 60);
    let acc = "";
    await chatStream(
      text, mode, convId,
      (tok) => { acc += tok; setStreamBuf(acc); setPresence("speaking"); window.setTimeout(scrollToBottom, 0); },
      (reply) => {
        setStreamBuf("");
        setMessages((p) => [...p, { role: "assistant", content: reply || acc, ts: new Date().toISOString() }]);
        setSending(false); setPresence("present");
        sendingRef.current = false;
        refreshState(); refreshConversations();
        window.setTimeout(scrollToBottom, 60);
      },
      (err) => {
        setStreamBuf("");
        setMessages((p) => [...p, { role: "assistant", content: "Мур... связь с ядром оборвалась. 🐾 " + err, ts: new Date().toISOString() }]);
        setSending(false); setPresence("present");
        sendingRef.current = false;
      },
      chosen?.provider, chosen?.model, effort,
    );
  }

  // real stop: Rust tears down the SSE (proven by tests/stop_cancellation.rs);
  // done(aborted) comes back through the same channel and unlocks the composer
  function stopStream() {
    if (!sendingRef.current) return;
    chatStop();
    notify("Останавливаю…");
  }

  // ── slash commands — mirrors Hermes Desktop vocabulary ───────────────────
  // kind "act": local UI/control action. kind "shape": wraps your text into a
  // directive prompt sent to Eva (steer/goal/plan/refine have no separate agent
  // loop here, so they shape the turn instead of faking one).
  type Slash = { cmd: string; arg?: string; desc: string; group: string; kind: "act" | "shape";
    run?: (arg: string) => void | Promise<void>; shape?: (arg: string) => string };
  const SLASH: Slash[] = [
    // agentic / prompt-shaping — like Hermes /steer /goal /plan /refine
    { cmd: "/goal", arg: "цель", desc: "поставить цель и вести к ней", group: "агент", kind: "shape",
      shape: (a) => `[Цель]: ${a}\nДержи это как главную цель ответа: разбей на шаги и двигайся к ней.` },
    { cmd: "/plan", arg: "задача", desc: "составить план без исполнения", group: "агент", kind: "shape",
      shape: (a) => `[План]: составь пошаговый план для: ${a}\nТолько план, без исполнения. Пронумеруй шаги, отметь риски.` },
    { cmd: "/steer", arg: "коррекция", desc: "подправить курс ответа", group: "агент", kind: "shape",
      shape: (a) => `[Правка курса]: ${a}\nУчти это и скорректируй подход.` },
    { cmd: "/refine", arg: "что улучшить", desc: "доработать прошлый ответ", group: "агент", kind: "shape",
      shape: (a) => `[Доработка прошлого ответа]: ${a || "сделай его лучше, чётче, глубже"}.` },
    { cmd: "/review", arg: "что ревьюим", desc: "критический разбор", group: "агент", kind: "shape",
      shape: (a) => `[Ревью]: критически разбери — ${a}. Найди дыры, риски, что улучшить.` },
    { cmd: "/summarize", arg: "тема", desc: "сжать разговор/тему", group: "агент", kind: "shape",
      shape: (a) => `[Саммари]: сожми кратко и по делу${a ? ` — ${a}` : " весь наш разговор"}.` },
    // model / reasoning
    { cmd: "/model", arg: "имя|core", desc: "выбрать модель", group: "модель", kind: "act", run: (a) => {
        const term = a.trim().toLowerCase();
        if (!term || term === "core" || term === "default" || term === "ядро") { clearModel(); return; }
        for (const p of modelCat?.providers ?? []) {
          const m = p.models.find((x) => x.toLowerCase().includes(term));
          if (m) { pickModel(p.provider, m); return; }
        }
        notify(`Модель «${a}» не найдена`); } },
    { cmd: "/reasoning", arg: "off|min|low|med|high", desc: "уровень рассуждений", group: "модель", kind: "act", run: (a) => {
        const map: Record<string, Effort> = { off: "off", min: "minimal", minimal: "minimal", low: "low", med: "medium", medium: "medium", high: "high" };
        const e = map[a.trim().toLowerCase()]; if (e) { setEffort(e); notify(`Рассуждения: ${e}`); } else notify("off|min|low|med|high"); } },
    { cmd: "/effort", arg: "off|min|low|med|high", desc: "то же, что /reasoning", group: "модель", kind: "act", run: (a) => {
        const map: Record<string, Effort> = { off: "off", min: "minimal", minimal: "minimal", low: "low", med: "medium", medium: "medium", high: "high" };
        const e = map[a.trim().toLowerCase()]; if (e) { setEffort(e); notify(`Эффорт: ${e}`); } else notify("off|min|low|med|high"); } },
    // session / control
    { cmd: "/new", desc: "новый разговор", group: "сессия", kind: "act", run: () => newConversation() },
    { cmd: "/clear", desc: "перечитать текущий из базы", group: "сессия", kind: "act", run: () => loadConversation(convId) },
    { cmd: "/retry", desc: "переспросить последним сообщением", group: "сессия", kind: "act", run: () => {
        const lastUser = [...messages].reverse().find((m) => m.role !== "assistant");
        if (lastUser) setComposer(lastUser.content); else notify("Нечего повторять"); } },
    { cmd: "/stop", desc: "прервать ответ Евы", group: "сессия", kind: "act", run: () => { if (sending) { chatStop(); notify("Останавливаю…"); } } },
    { cmd: "/copy", desc: "скопировать разговор", group: "сессия", kind: "act", run: () => copyConversation() },
    // navigation to panes
    { cmd: "/memory", arg: "запрос", desc: "искать в памяти", group: "панели", kind: "act", run: (a) => { if (a) setSearchQuery(a); choosePage("memory"); } },
    { cmd: "/prompt", desc: "редактор личности (SOUL.md)", group: "панели", kind: "act", run: () => choosePage("prompt") },
    { cmd: "/soul", desc: "редактор личности (SOUL.md)", group: "панели", kind: "act", run: () => choosePage("prompt") },
    { cmd: "/diary", desc: "дневник (eva_thoughts)", group: "панели", kind: "act", run: () => choosePage("diary") },
    { cmd: "/reflect", desc: "Ева думает новую мысль", group: "панели", kind: "act", run: () => triggerReflect() },
    { cmd: "/skills", desc: "навыки и инструменты", group: "панели", kind: "act", run: () => choosePage("capabilities") },
    { cmd: "/tools", desc: "инструменты ядра", group: "панели", kind: "act", run: () => choosePage("capabilities") },
    { cmd: "/system", desc: "процессы и телеметрия", group: "панели", kind: "act", run: () => choosePage("system") },
    { cmd: "/status", desc: "состояние ядра и железа", group: "панели", kind: "act", run: () => choosePage("system") },
    // appearance
    { cmd: "/skin", arg: "sakura|yandere", desc: "сменить облик", group: "облик", kind: "act", run: (a) => setMode(a.trim().toLowerCase() === "yandere" ? "yandere" : "sakura") },
    { cmd: "/sakura", desc: "светлый облик", group: "облик", kind: "act", run: () => setMode("sakura") },
    { cmd: "/yandere", desc: "тёмный облик", group: "облик", kind: "act", run: () => setMode("yandere") },
    // Ivan wants WORKING artifacts, not code in chat: /save pulls the last
    // fenced code block out of the conversation and writes a real file
    { cmd: "/save", arg: "имя файла", desc: "сохранить последний код-блок как файл", group: "агент", kind: "act", run: async (a) => {
        const blocks = [...messages].reverse().map((m) => m.content).join("\n").match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
        if (!blocks) { notify("Код-блока в разговоре не нашлось"); return; }
        const name = (a.trim() || `eva-artifact-${Date.now().toString(36)}.txt`).replace(/[\\/:*?"<>|]/g, "_");
        const saved = await osIntegration.saveArtifact(name, blocks[1]);
        if (saved) { notify(`Сохранила: ${name}`); await osIntegration.openPath(saved); }
        else notify("Не сохранилось");
      } },
    // quizzes crush his confidence; fixing live code does not
    { cmd: "/practice", desc: "живая практика вместо квиза", group: "агент", kind: "shape",
      shape: () => "[Практика]: предложи мне маленький живой проект-задачку по коду под мой уровень — не теорию и не квиз «что напечатает код», а конкретный скрипт, который я должен запустить и починить/доработать руками. Дай стартовый сломанный код и критерий готовности. Без оценок и подначек про знания." },
    // 76 навыков Hermes как команды: /lib <имя> — «примени скилл X ко мне»
    { cmd: "/lib", arg: "навык или поиск", desc: "применить навык из арсенала Евы", group: "панели", kind: "act", run: (a) => {
        const term = a.trim().toLowerCase();
        if (!term) { choosePage("capabilities"); return; }
        const skills = modelCat && "skills" in modelCat ? [] : null; // каталог живёт в CapabilitiesPane
        void skills;
        setSearchQuery(term); choosePage("capabilities");
      } },
    // живой контекст: кто она сейчас, какой провайдер, что болит
    { cmd: "/context", desc: "кто перед тобой: облик, модель, пульс", group: "панели", kind: "act", run: () => {
        const s = live;
        if (!s) { notify("Ядро молчит — контекста нет"); return; }
        const top = Object.entries(s.sliders ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, v]) => `${k} ${v}%`).join(" · ");
        notify(`Ева ${s.version} · ${s.is_night ? "ночь" : "день"} · ${top} · CPU ${Math.round(s.cpu_percent)}% RAM ${Math.round(s.ram_percent)}% · ${chosen ? chosen.model : "модель ядра"}`);
      } },
    { cmd: "/help", desc: "список команд", group: "сессия", kind: "act", run: () => notify("Команды: " + SLASH.map((s) => s.cmd).join(" ")) },
  ];

  // returns true if fully handled locally; false if it produced a prompt to send
  async function runSlash(input: string): Promise<boolean> {
    const [head, ...rest] = input.slice(1).split(" ");
    const arg = rest.join(" ").trim();
    const hit = SLASH.find((s) => s.cmd.slice(1) === head.toLowerCase());
    if (!hit) { notify(`Неизвестная команда: /${head}`); return true; }
    if (hit.kind === "shape" && hit.shape) {
      pendingShapeRef.current = hit.shape(arg);
      return false; // sendMessage will pick up the shaped prompt
    }
    await hit.run?.(arg);
    return true;
  }

  const slashQuery = composer.startsWith("/") && !composer.includes(" ") ? composer.slice(1).toLowerCase() : null;
  const slashMatches = slashQuery !== null ? SLASH.filter((s) => s.cmd.slice(1).startsWith(slashQuery)) : [];

  // ── file attach + drag'n'drop ───────────────────────────────────────────
  async function ingestFiles(files: FileList | File[]) {
    setAttaching(true);
    for (const f of Array.from(files)) {
      try {
        const r = await api.attach(f);
        setAttachments((p) => [...p, { name: r.name, block: r.block, kind: r.kind, ok: r.ok }]);
        if (!r.ok) notify(`${r.name}: ${r.error || "не прочитан"}`);
      } catch { notify(`Не удалось загрузить ${f.name}`); }
    }
    setAttaching(false);
    window.setTimeout(() => textareaRef.current?.focus(), 40);
  }
  function removeAttachment(i: number) { setAttachments((p) => p.filter((_, idx) => idx !== i)); }

  function onComposerKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (slashQuery !== null && slashMatches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => (i + 1) % slashMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
      if (e.key === "Tab") { e.preventDefault(); const s = slashMatches[slashIdx]; setComposer(s.arg ? `${s.cmd} ` : s.cmd); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const s = slashMatches[slashIdx];
        if (s.arg) { setComposer(`${s.cmd} `); } else { runSlash(s.cmd); setComposer(""); }
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  async function copyConversation() {
    try { await navigator.clipboard.writeText(messages.map((m) => `${m.role === "assistant" ? "Ева" : "Иван"} · ${tsToTime(m.ts)}\n${m.content}`).join("\n\n")); notify("Разговор скопирован"); }
    catch { notify("Не удалось скопировать"); }
    setMoreOpen(false);
  }
  async function triggerReflect() {
    if (reflecting) return; setReflecting(true);
    try { await api.reflect(); await refreshState(); notify("Ева подумала новую мысль. 🐾"); }
    catch { notify("Мысль не родилась — ядро занято"); }
    finally { setReflecting(false); }
  }

  // Morse-walk is the one hard daily constant (20:00 → 21:30); treat it as
  // presence "у Морзика" instead of a cold "away"
  function presenceLabel(state: PresenceState): string {
    const h = new Date().getHours();
    const morzik = (h === 20 || (h === 21 && new Date().getMinutes() < 30)) && (state === "away" || state === "idle");
    if (morzik) return "у Морзика";
    if (state === "present") return "рядом";
    if (state === "idle") return "тихо наблюдает";
    if (state === "away") return "ждёт тебя";
    if (state === "thinking") return "думает";
    return "говорит";
  }

  const q = searchQuery.toLowerCase().trim();
  const foundPages = navigation.filter((i) => i.label.toLowerCase().includes(q));
  const foundConvs = conversations.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 6);
  const loc = page === "chat" ? "Разговор" : navigation.find((i) => i.id === page)?.label;

  function pickModel(provider: string, model: string) {
    const c = { provider, model };
    setChosen(c);
    localStorage.setItem("eva-model", JSON.stringify(c));
    osIntegration.setSetting("model", JSON.stringify(c));
    notify(`Модель: ${provider} / ${model}`);
  }
  function clearModel() {
    setChosen(null);
    localStorage.removeItem("eva-model");
    osIntegration.setSetting("model", "");
    notify("Модель по умолчанию (цепочка ядра)");
  }

  return (
    <div className={`app-shell theme-${mode} ${showPresence ? "presence-visible" : "presence-hidden"} ${sidebarOpen ? "sidebar-open" : ""}`}>
      <header className="window-bar" data-tauri-drag-region>
        <div className="window-brand">
          <button className="icon-button mobile-menu-button" onClick={() => setSidebarOpen((o) => !o)} aria-label="Навигация"><Menu size={19} /></button>
          <span className="brand-mark"><BatMark size={24} /></span>
          <span className="brand-word">eva<span className="brand-period">.</span></span>
          <span className="brand-desktop">DESKTOP</span>
        </div>
        <div className="window-location"><span className="location-cross">✳</span><span>Eva Desktop</span><ChevronRight size={12} /><span>{loc}</span></div>
        <div className="window-actions">
          <span className="preview-indicator"><i /> {live ? "LIVE" : "…"}</span>
          <button className="top-search" onClick={() => setSearchOpen(true)} aria-label="Поиск"><Search size={14} /><span>Поиск</span><kbd>⌘ K</kbd></button>
          <button className="icon-button compact-mode-button" onClick={() => setMode(mode === "sakura" ? "yandere" : "sakura")} title="Облик Евы">{mode === "sakura" ? <Flower2 size={17} /> : <Moon size={17} />}</button>
          <span className="window-action-divider" />
          <button className={`icon-button panel-toggle ${showPresence ? "is-active" : ""}`} onClick={() => setShowPresence((o) => !o)} title="Состояние Евы">{showPresence ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>
        </div>
      </header>

      <div className="workspace">
        {sidebarOpen && <button className="mobile-backdrop sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Закрыть" />}
        <Sidebar
          mode={mode}
          page={page === "capabilities" || page === "prompt" || page === "system" ? page : page as OrbitId}
          conversations={conversations}
          convId={convId}
          onOrbit={(id) => { if (id === "activity") { choosePage("system"); } else if (id === "library") { choosePage("capabilities"); } else { choosePage(id); } }}
          onNew={newConversation}
          onSearch={() => setSearchOpen(true)}
          onOpenConv={(id) => { loadConversation(id); choosePage("chat"); }}
          onSwitchMode={setMode}
        />

        <main className="main-pane">
          {page === "chat" && <>
            {coreDown && (
              <div className="core-banner">
                <Unplug size={13} />
                <span>Ядро молчит — Hermes не отвечает на мосту. Разговоры не дойдут.</span>
                <button onClick={raiseCore} disabled={coreBusy}>{coreBusy ? "поднимаю…" : "поднять ядро"}</button>
              </div>
            )}
            <div className="pane-topbar conversation-topbar">
              <div className="pane-title-group"><h1>Ева</h1></div>
              <div className="conversation-top-actions">
                <span className="here-status preview-here-status"><PresenceOrb state={presence} compact /></span>
                <div className="more-wrap">
                  <button className="icon-button more-button" onClick={() => setMoreOpen((o) => !o)} aria-label="Действия"><MoreHorizontal size={19} /></button>
                  {moreOpen && <div className="small-popover conversation-menu">
                    <button onClick={copyConversation}><Command size={15} /> Копировать разговор</button>
                    <button onClick={() => { setMoreOpen(false); loadConversation(convId); }}><RefreshCw size={15} /> Перечитать из базы</button>
                    <button onClick={() => { setMoreOpen(false); newConversation(); }}><Plus size={15} /> Новый разговор</button>
                    {convId !== "eva_desktop" && <button onClick={() => { setMoreOpen(false); deleteConversation(convId); }}><Trash2 size={15} /> Удалить разговор</button>}
                  </div>}
                </div>
              </div>
            </div>

            <div
              className={`chat-scroll ${dragOver ? "chat-dragover" : ""}`}
              ref={scrollRef}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files); }}
            >
              {dragOver && <div className="drop-veil"><Paperclip size={30} /><strong>Брось файл — я прочитаю</strong><span>текст вложу, картинку разгляжу через vision</span></div>}
              <div className="thread">
                <div className="thread-date"><span />ЖИВОЙ ПОТОК <span className="thread-date-dot">/</span> memory.db<span /></div>
                {loadingHistory && messages.length === 0 && <div className="empty-thread"><span className="empty-symbol"><TypingDots /></span><h3>Поднимаю историю…</h3><p>читаю conversation из базы</p></div>}
                {!loadingHistory && messages.length === 0 && <div className="empty-thread"><span className="empty-symbol"><BatMark size={28} /></span><h3>Начни с чего угодно.</h3><p>Мне не нужен идеальный первый вопрос.</p></div>}
                {messages.map((m, idx) => {
                  if (m.role === "assistant") {
                    return (
                      <motion.article className="message message-eva" key={`${m.ts}-${idx}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32 }}>
                        <EvaAvatar mode={mode} className="message-eva-avatar" />
                        <div className="eva-message-content"><div className="message-meta eva-message-meta"><span>ЕВА <i /></span><time>{tsToTime(m.ts)}</time></div><div className="eva-copy"><RichText text={m.content} /></div></div>
                      </motion.article>
                    );
                  }
                  // system-injected "user" rows (background notices) render as a quiet system line, not as Ivan
                  if (isSystemNote(m.content)) {
                    return (
                      <div className="system-note" key={`${m.ts}-${idx}`} title={m.content}>
                        <span className="system-note-dot" /> системное событие · {tsToTime(m.ts)}
                      </div>
                    );
                  }
                  const shown = cleanUserContent(m.content);
                  if (!shown) return null;
                  return (
                    <motion.article className="message message-ivan" key={`${m.ts}-${idx}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32 }}>
                      <div className="ivan-message-content"><div className="message-meta"><span>ИВАН</span><time>{tsToTime(m.ts)}</time></div><div className="ivan-bubble"><RichText text={shown} /></div></div><span className="message-user-avatar">И</span>
                    </motion.article>
                  );
                })}
                {sending && (streamBuf ? (
                  <motion.article className="message message-eva" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <EvaAvatar mode={mode} className="message-eva-avatar" />
                    <div className="eva-message-content"><div className="message-meta eva-message-meta"><span>ЕВА <i /></span><time>{formatTime()}</time></div><div className="eva-copy"><RichText text={streamBuf} /><span className="stream-caret" /></div></div>
                  </motion.article>
                ) : (
                  <ThinkingCard mode={mode} onStop={stopStream} />
                ))}
              </div>
            </div>

            <div className="composer-dock">
              <div className="composer-heading"><span><span className="composer-heading-dot" />ПИШЕШЬ ЕВЕ</span><span>/ — команды · можно без фильтров</span></div>
              {attachments.length > 0 && (
                <div className="attach-strip">
                  {attachments.map((a, i) => (
                    <span className={`attach-chip ${a.ok ? "" : "attach-chip-bad"}`} key={i}>
                      {a.kind === "image" ? <ImageIcon size={12} /> : <FileText size={12} />}
                      <em>{a.name}</em>
                      <button onClick={() => removeAttachment(i)} aria-label="Убрать"><X size={11} /></button>
                    </span>
                  ))}
                  {attaching && <span className="attach-chip"><Loader2 size={12} className="spin" /> читаю…</span>}
                </div>
              )}
              <div className="composer-box">
                {slashQuery !== null && slashMatches.length > 0 && (
                  <div className="slash-menu">
                    <div className="slash-menu-head">КОМАНДЫ · как в Hermes</div>
                    {slashMatches.map((s, i) => (
                      <button key={s.cmd} className={`slash-item ${i === slashIdx ? "slash-item-active" : ""}`}
                        onMouseEnter={() => setSlashIdx(i)}
                        onClick={() => { setComposer(s.arg ? `${s.cmd} ` : s.cmd); if (!s.arg) { runSlash(s.cmd); setComposer(""); } textareaRef.current?.focus(); }}>
                        <span className={`slash-kind slash-kind-${s.kind}`}>{s.group}</span>
                        <strong>{s.cmd}</strong>{s.arg && <em>{s.arg}</em>}<small>{s.desc}</small>
                      </button>
                    ))}
                  </div>
                )}
                <textarea ref={textareaRef} value={composer} onChange={(e) => { setComposer(e.target.value); setSlashIdx(0); }} onKeyDown={onComposerKey}
                  onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); ingestFiles(e.clipboardData.files); } }}
                  placeholder="Расскажи, что на самом деле у тебя на уме…  (/ — команды)" rows={2} aria-label="Сообщение Еве" />
                <div className="composer-toolbar">
                  <div className="composer-tools">
                    <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) ingestFiles(e.target.files); e.target.value = ""; }} />
                    <button className="attach-trigger" onClick={() => fileInputRef.current?.click()} title="Прикрепить файл"><Paperclip size={15} /></button>
                    <ModelPicker
                      catalog={modelCat}
                      chosen={chosen}
                      effort={effort}
                      onPick={pickModel}
                      onClear={clearModel}
                      onEffort={setEffort}
                    />
                  </div>
                  <div className="composer-submit"><span>{sending ? "ГОВОРИТ — МОЖНО ПРЕРВАТЬ" : "ENTER <i /> ОТПРАВИТЬ"}</span>{sending ? (
                    <button className="send-button send-button-stop" onClick={stopStream} title="Остановить ответ (или /stop)" aria-label="Остановить"><Square size={15} /></button>
                  ) : (
                    <button className="send-button" onClick={sendMessage} disabled={!composer.trim() && attachments.length === 0} aria-label="Отправить"><ArrowRight size={18} /></button>
                  )}</div>
                </div>
              </div>
            </div>
          </>}

          {page === "memory" && <MemoryPane live={live} notify={notify} onBack={() => setPage("chat")} />}
          {page === "prompt" && <PromptPane notify={notify} onBack={() => setPage("chat")} />}
          {page === "diary" && <DiaryPane live={live} reflecting={reflecting} onReflect={triggerReflect} onBack={() => setPage("chat")} />}
          {page === "capabilities" && <CapabilitiesPane notify={notify} onBack={() => setPage("chat")} />}
          {page === "system" && <SystemPane live={live} notify={notify} onBack={() => setPage("chat")} onOpenMemory={() => { setPage("memory"); setSearchQuery(""); }} />}
        </main>

        {showPresence && <button className="mobile-backdrop presence-backdrop" onClick={() => setShowPresence(false)} aria-label="Закрыть" />}
        <PresencePanel
          mode={mode}
          live={live}
          reflecting={reflecting}
          onReflect={triggerReflect}
          onOpenMemory={() => { choosePage("memory"); }}
          onOpenCapabilities={() => { choosePage("capabilities"); }}
          onOpenDiary={() => { choosePage("diary"); }}
        />
      </div>

      <AnimatePresence>{searchOpen && <div className="command-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}>
        <motion.div className="command-dialog" role="dialog" aria-modal="true" initial={{ opacity: 0, y: -12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.985 }} transition={{ duration: 0.18 }}>
          <div className="command-input-row"><Search size={19} /><input ref={searchRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Раздел, диалог, или Enter — поиск в памяти..." onKeyDown={(e) => { if (e.key === "Enter" && q) { setSearchOpen(false); choosePage("memory"); } }} /><kbd>ESC</kbd></div>
          <div className="command-results">
            {foundPages.length > 0 && <><div className="command-group-title">РАЗДЕЛЫ</div>{foundPages.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => choosePage(id)}><Icon size={17} /><span>{label}</span><ArrowRight size={14} /></button>)}</>}
            {foundConvs.length > 0 && <><div className="command-group-title">ДИАЛОГИ</div>{foundConvs.map((c) => <button key={c.id} onClick={() => { loadConversation(c.id); choosePage("chat"); setSearchOpen(false); }}><MessageCircle size={17} /><span>{c.title}</span><small>{c.count}</small><ArrowRight size={14} /></button>)}</>}
            {q && <><div className="command-group-title">ПАМЯТЬ</div><button onClick={() => { setSearchOpen(false); choosePage("memory"); }}><Database size={17} /><span>Искать «{q}» в memory.db</span><ArrowRight size={14} /></button></>}
            {foundPages.length === 0 && foundConvs.length === 0 && !q && <p className="command-empty">Набери запрос — разделы, диалоги или поиск в памяти.</p>}
          </div>
          <div className="command-footer"><span><Command size={12} /> EVA / НАВИГАЦИЯ</span><span>ENTER — ОТКРЫТЬ</span></div>
        </motion.div>
      </div>}</AnimatePresence>
      <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}><Sparkles size={15} />{toast}<button onClick={() => setToast("")}><X size={13} /></button></motion.div>}</AnimatePresence>
    </div>
  );
}
