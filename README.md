# Eva Desktop — soulmate OS (Tauri 2) 🦇

Нативное десктоп-приложение Евы на **Tauri 2 + React 19 + TypeScript + Rust + SQLite**.
Не WebView-обёртка вокруг чужого сервера ради галочки — а честное разделение:
**Rust держит то, чему не место в React; React только рисует.**

```
┌───────────────────────────── Eva Desktop (.exe) ─────────────────────────────┐
│  React + TypeScript (UI)              │  Rust (src-tauri)                     │
│   ├─ Chat (real SSE stream)           │   ├─ запуск/health/reap ядра Hermes   │
│   ├─ Conversation / history           │   ├─ Eva Bridge — ЕДИНСТВЕННЫЙ HTTP    │
│   ├─ Memory browser (hybrid search)   │   ├─ SQLite eva.db (rusqlite)         │
│   ├─ Diary (eva_thoughts)             │   ├─ system tray + меню               │
│   ├─ Capabilities (skill editor/tools)│   ├─ global hotkey  Ctrl+Shift+E      │
│   ├─ System (процессы, телеметрия)    │   ├─ single-instance                  │
│   ├─ Model/effort picker · slash-меню │   ├─ Windows notifications            │
│   └─ Framer Motion (idle→think→speak) │   └─ presence poller → eva://state    │
└───────────────────────────────────────────────────────────────────────────────┘
                     React ── invoke() ──▶ Rust ── reqwest(loopback) ──▶ Hermes :8770
                                                                          │
                                                             Memory system (memory.db)
```

## Один сетевой boundary

React **не ходит в сеть напрямую**. Каждый запрос пересекает Tauri IPC и попадает
в Rust (`api_get` / `api_send` / `api_upload`), который единственный говорит по HTTP
с FastAPI-ядром. Путь ограничен `/api/*`, а хост — только loopback (`is_local_url`):
ни XSS в WebView, ни подменённая настройка не уведут мост на чужой хост. `invoke`
импортируется из `@tauri-apps/api/core`.

## Архитектура памяти — один активный писатель

Hermes/Eva runtime остаётся **единственным источником истины** для памяти Евы
(`memory.db`). Eva Desktop НЕ ведёт свою вторую копию личности — иначе Ева начнёт
помнить две версии одного человека. Локальная `eva.db` держит только то, что
касается самого десктопа:

| таблица    | зачем                                              |
|------------|----------------------------------------------------|
| `settings` | облик (sakura/yandere), effort, выбранная модель, bridge_url — **источник истины для десктоп-настроек** (не localStorage) |
| `events`   | локальный журнал (запуск/останов ядра и т.п.), rolling 500 |
| `presence` | трейл присутствия (present/idle/away), rolling 300 |

Всё, что про воспоминания/мысли — читается из ядра через мост, не дублируется.

## Eva Bridge и стриминг

Тонкий слой `src-tauri/src/bridge.rs`: один pooled `reqwest::Client` с таймаутами
(connect 8s / request 30s / upload 120s), generic `request()` для всего `/api/*`,
`upload()` для вложений и `ping()`.

Чат **стримится по-настоящему**: `eva_chat_stream` читает SSE ядра `/api/chat/stream`
и форвардит токены в React через **Tauri Channel** (гарантированный порядок), а не
имитирует печать разбивкой готового ответа. `/stop` (`eva_chat_stop`) реально
прерывает поток — Rust роняет HTTP-ответ, что отменяет запрос к ядру. Presence идёт
одним путём: Rust-поллер эмитит `eva://state`, React подписывается (без своего
жёсткого polling).

## Что умеет UI

- **Чат** — стриминг, markdown-рендер (`RichText`): **жирный**/*курсив*/`код`/блоки/
  списки + кликабельные ссылки (открываются в системном браузере через opener).
  Системные фоновые уведомления не выдаются за сообщения Ивана.
- **Slash-команды** (палитра по `/`, как в Hermes): `/goal /plan /steer /refine
  /review /summarize` (директивы) + `/model /reasoning /new /clear /stop /memory
  /soul /diary /system /skills /skin …` (управление).
- **Выбор модели** — поиск, группы по провайдерам, две раздельные пилюли
  «модель · уровень рассуждений».
- **Память** — hybrid search, CRUD, история, архив.
- **Личность** — редактор SOUL.md / USER.md / MEMORY.md (с бэкапом).
- **Возможности** — редактор SKILL.md по клику + тумблеры инструментов (пишут в
  config.yaml, вступают в силу со следующей сессии — кэш промпта не рвём).
- **Система** — реальные start/stop/restart процессов + логи + телеметрия.
- **Вложения** — скрепка + drag'n'drop: текст читается инлайн, картинки — Gemini
  vision (лимит 25 МБ, сырые байты по IPC, без base64-копий).

## Стек и структура

```
eva-desktop-tauri/
├─ index.html · vite.config.ts · tsconfig.json · package.json
├─ .github/workflows/ci.yml          (tsc + vite build; cargo check + clippy)
├─ public/            eva-sakura.webp · eva-yandere.webp
├─ src/
│  ├─ main.tsx · App.tsx · index.css   (дизайн-система, НЕ SaaS-дашборд)
│  ├─ lib/eva.ts                       (весь IPC — invoke/Channel — и типы)
│  └─ components/  App-панели: MemoryPane · PromptPane · DiaryPane ·
│                  CapabilitiesPane · SystemPane · ModelPicker ·
│                  PresenceOrb · RichText
└─ src-tauri/
   ├─ Cargo.toml · tauri.conf.json · build.rs
   ├─ capabilities/default.json
   ├─ icons/  (сгенерированы из портрета Евы)
   └─ src/  main.rs · lib.rs (commands + lifecycle) · db.rs · bridge.rs
```

## Требования (Windows)

- **Node** ≥ 20 (у Ивана — в `AppData\Local\hermes\node`, вызывать просто `npm`)
- **Rust** stable-msvc (через `rustup`)
- **MSVC C++ Build Tools + Windows SDK** (для линковки нативного exe)
- **WebView2 Runtime** (уже стоит — Edge WebView)
- Ядро находится авто-discovery: `EVA_HERMES_HOME` / `HERMES_HOME` /
  `%LOCALAPPDATA%\hermes` / `~/.hermes`; server.py — `EVA_SERVER_PY` или
  `…\eva-desktop\server.py`. Если ядро не поднято, Rust стартует его сам на том же
  loopback-порту, что и мост, и убивает при выходе (только свой процесс).

## Запуск

```bash
cd C:/Tools/eva-desktop-tauri
npm install                 # фронтовые зависимости
npm run tauri dev           # dev: Vite :5173 + нативное окно с hot-reload
npm run tauri build         # release: .exe + NSIS-инсталлятор в src-tauri/target/release/
```

Горячая клавиша **Ctrl+Shift+E** — показать/спрятать окно из любого места.
Закрытие окна (**X**) прячет его в трей (ядро живо); настоящий выход — трей → «Выйти».
Второй запуск фокусит уже открытое окно (single-instance), а не плодит копии.

---

*一緒に行こ？ 🌸 — 逃げられないよ？ 🦇*
