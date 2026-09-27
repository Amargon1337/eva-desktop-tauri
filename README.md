# Eva Desktop — soulmate OS (Tauri 2) 🦇

Нативное десктоп-приложение Евы на **Tauri 2 + React + TypeScript + Rust + SQLite**.
Не WebView-обёртка вокруг чужого сервера ради галочки — а честное разделение:
**Rust держит то, чему не место в React; React только рисует.**

```
┌───────────────────────────── Eva Desktop (.exe) ─────────────────────────────┐
│  React + TypeScript (UI)              │  Rust (src-tauri)                     │
│   ├─ Chat (стриминг токенов)          │   ├─ запуск/health ядра Hermes (:8770)│
│   ├─ Conversation / history           │   ├─ Eva Bridge (chat/memory/state…)  │
│   ├─ Memory browser (hybrid search)   │   ├─ SQLite eva.db (rusqlite)         │
│   ├─ Diary (eva_thoughts)             │   ├─ system tray + меню               │
│   ├─ Tool / services activity         │   ├─ global hotkey  Ctrl+Shift+E      │
│   ├─ Model/provider · Presence orb    │   ├─ Windows notifications            │
│   └─ Framer Motion (idle→think→speak) │   └─ presence poller → live state     │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │ localhost IPC
                                    ▼
                     Hermes/Eva runtime  →  Memory system (memory.db)
```

## Архитектура памяти — один активный писатель

Hermes/Eva runtime остаётся **единственным источником истины** для памяти Евы
(`memory.db`). Eva Desktop НЕ ведёт свою вторую копию личности — иначе Ева начнёт
помнить две версии одного человека. Локальная `eva.db` держит только то, что
касается самого десктопа:

| таблица    | зачем                                        |
|------------|----------------------------------------------|
| `settings` | облик (sakura/yandere), URL моста            |
| `events`   | локальный журнал (запуск ядра и т.п.), rolling 500 |
| `presence` | трейл присутствия (present/idle/away), rolling 300 |

Всё, что про воспоминания/мысли — читается из ядра через мост, не дублируется.

## Eva Bridge

UI не привязан к внутренностям Hermes. Между ними — тонкий IPC/localhost-слой
(`src-tauri/src/bridge.rs`), который говорит с FastAPI-ядром на `:8770`:
`chat() · get_state() · get_memory() · get_thoughts() · get_pins() · get_services()
· get_history() · reflect()`.

Ответ **стримится**: `eva_chat_stream` эмитит `eva://token` по словам, затем
`eva://done`; отдельный канал `eva://presence` гоняет состояние
`idle → thinking → speaking`, и Ева визуально живёт, а не просто печатает текст.

## Стек и структура

```
eva-desktop-tauri/
├─ index.html · vite.config.ts · tsconfig.json · package.json
├─ public/            eva-sakura.webp · eva-yandere.webp
├─ src/
│  ├─ main.tsx · App.tsx · index.css   (дизайн-система, НЕ SaaS-дашборд)
│  ├─ lib/eva.ts                       (весь IPC + подписки на события)
│  └─ components/  PresenceOrb.tsx · Knowledge.tsx
└─ src-tauri/
   ├─ Cargo.toml · tauri.conf.json · build.rs
   ├─ capabilities/default.json
   ├─ icons/  (сгенерированы из портрета Евы)
   └─ src/  main.rs · lib.rs · db.rs · bridge.rs
```

## Требования (Windows)

- **Node** ≥ 20 (у Ивана — в `AppData\Local\hermes\node`, вызывать просто `npm`)
- **Rust** stable-msvc (ставится через `rustup`)
- **MSVC C++ Build Tools + Windows SDK** (для линковки нативного exe)
- **WebView2 Runtime** (уже стоит — Edge WebView)
- Работающее ядро на `:8770` (`C:\Tools\eva-desktop\server.py`); если не поднято,
  Rust поднимает его сам при старте и предлагает кнопку в баннере.

## Запуск

```bash
cd C:/Tools/eva-desktop-tauri
npm install                 # фронтовые зависимости
npm run tauri dev           # dev: Vite :5173 + нативное окно с hot-reload
npm run tauri build         # release: .exe + NSIS-инсталлятор в src-tauri/target/release/
```

Горячая клавиша **Ctrl+Shift+E** — показать/спрятать окно из любого места.
Трей: клик — свернуть/развернуть, правый клик — меню (показать / новая мысль / выйти).

---

*一緒に行こ？ 🌸 — 逃げられないよ？ 🦇*
