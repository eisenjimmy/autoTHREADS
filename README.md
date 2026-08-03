<div align="center">

<img src="src/assets/banner.png" alt="AutoThreads hero banner" width="100%" />

# AutoThreads

### 🧵 Automate Threads with AI — from assisted drafts to a fully autonomous agent.

Automagical Threads automation for creators, founders, and builders. Draft with AI and stay in
control, or hand the wheel to a self-running agent that posts and replies on its own.

<br />

![Version](https://img.shields.io/badge/version-0.2.20-111111?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-111111?style=flat-square)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-111111?style=flat-square)
<br />
![Electron](https://img.shields.io/badge/Electron-Desktop-111111?style=flat-square&logo=electron)
![React](https://img.shields.io/badge/React-19-111111?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-111111?style=flat-square&logo=typescript)
![Local LLM](https://img.shields.io/badge/Local%20LLM-%240%20API%20cost-111111?style=flat-square)
![Full-Auto](https://img.shields.io/badge/Full--Auto-opt--in-43c465?style=flat-square)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-111111?style=flat-square)

<br />

**English** · [한국어](#한국어)

[Features](#-features) · [Full-Auto](#-full-auto-mode) · [Quick Start](#-quick-start) · [Configure AI](#-configure-ai) · [Configure Threads](#-configure-threads) · [Changelog](CHANGELOG.md) · [Releases](https://github.com/eisenjimmy/autoTHREADS/releases)

</div>

---

> [!TIP]
> **Current release: v0.2.20.** **Local vision** for reply images, **current date/time** in system
> prompts, **side mission**, **long posts as 1/n threads**, recent-post memory (default 5), news
> source links, dual timers, and **EN/한국어** Settings + Full-Auto. See
> [Full-Auto](#-full-auto-mode) and [CHANGELOG.md](CHANGELOG.md).

## Contents

- [The Idea](#-the-idea)
- [Full-Auto Mode](#-full-auto-mode)
- [Features](#-features)
- [Screenshots](#-screenshots)
- [Quick Start](#-quick-start)
- [Configure AI](#-configure-ai)
- [Configure Threads](#-configure-threads)
- [Daily Workflow](#-daily-workflow)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Layout](#-project-layout)
- [Safety Model](#-safety-model)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)
- [한국어](#한국어)
- [Changelog](CHANGELOG.md)

## ✨ The Idea

AutoThreads is a desktop app that turns news, replies, and ideas into Threads content. It works two ways:

- **Assisted mode** — *AI writes drafts, you decide what posts.* Find news, generate a Thread-ready
  draft, attach an optional image, and schedule it. You review everything before it goes live.
- **Full-Auto mode** — *the agent runs itself.* On separate post and reply timers it scrapes
  **current news**, decides what's worth posting (with anti-repeat memory), writes it, answers
  replies **and @mentions**, and can optionally join public threads in your niches — hands-off,
  with hard safety caps.

Built for a creator workflow where you want leverage, not chaos:

- 🔎 Find **current** news around topics you care about.
- 🧠 Let AI turn it into a Thread-ready draft — or run the whole loop for you.
- 🖼️ Pull a related public image from the web.
- 🗣️ Teach it your writing voice.
- 💬 Draft or auto-send replies, **@mentions**, and nested thread comments.
- ⏰ Schedule posts for later.
- 💸 Use a local LLM for **$0 cloud API cost**, or bring Claude, ChatGPT, Gemini, or any OpenAI-compatible endpoint.

<img src="docs/assets/workflow.png" alt="AutoThreads workflow diagram" width="100%" />

## 🚀 Full-Auto Mode

![status: opt-in](https://img.shields.io/badge/status-opt--in-43c465?style=flat-square)
![off by default](https://img.shields.io/badge/default-OFF-111111?style=flat-square)
![bilingual](https://img.shields.io/badge/UI-EN%20%2F%20한국어-111111?style=flat-square)

Most of AutoThreads is deliberately *"AI drafts, you decide."* **Full-Auto** is the opt-in exception:
a self-running agent for a hands-off Threads presence. Open the **Auto** tab, configure it, and press
**Launch** — posts and replies run on **independent timers**.

### Dual loop

```text
POST TIMER (default 60 min)          REPLY TIMER (default 5 min)
  ├─ scrape CURRENT news               ├─ unanswered replies (incl. nested)
  ├─ plan (news-first if enabled)      ├─ @mentions of you
  ├─ anti-repeat vs recent posts       ├─ optional discover (public niches)
  ├─ write · publish / draft           ├─ generate · publish / draft
  └─ log                               └─ failures retry ~1 min
```

### What you configure

| Setting | What it controls |
| --- | --- |
| **Goal** | Primary objective — followers, engagement, etc. Drives planning, posts, and replies. |
| **Side mission** | Optional temporary secondary goal (e.g. soft-promote an app). Empty = off. Woven in lightly when natural — never hard-sell. |
| **Topics / niches** | Removable pills (×) + popular autocomplete. Popular Threads niches first (**AI**, tech, startups, productivity, humor…) plus more categories and custom multi-select. |
| **Post language** | Match the source, Korean only, English only, or follow the app language. |
| **Personality** | Agent name, creator, creator `@handle`, address term (e.g. "Master"), and tone notes. |
| **Post timer** | How often the agent plans/posts (default **60 min**). |
| **Recent posts memory** | How many past posts to load for anti-repeat (1–20, default **5**) — lower uses fewer LLM tokens. |
| **Reply / mention timer** | How often it scans replies + mentions (default **5 min**). Separate from the post timer. |
| **Original vs news** | Mix of original riffs vs news reactions (live-news mode caps originals so news stays primary). |
| **Post here and there (sporadic)** | Lightly skips ~18% of scheduled post ticks (never two in a row; **Run once** always posts). |
| **Live news + interactive voice** | News-first from scrapers; occasional “feelings” posts from last 3 posts + replies; follower callbacks. Hover **(?)** in-app for the full tip. |
| **Replies on my posts** | Answer unanswered comments, including **nested** replies in ongoing threads. **Hard cap: 20 unanswered per post** (newest first) so viral threads don’t run forever. |
| **@mentions of me** | Answer public posts that @mention you (`threads_manage_mentions` on the **token**). Without Meta **Advanced Access**, only app **Testers**’ mentions appear (activity log shows Mentions API raw counts). |
| **Discover (public niches)** | Opt-in: reply to random public posts via keyword search (`threads_keyword_search`; public results need advanced access). |
| **Publishing** | **Live** to Threads, or **draft-only** as a safety valve. Auto-publish replies can be separate. |

### Controls

| Control | Behavior |
| --- | --- |
| **Save** | Persist Full-Auto settings (persona, caps, niches, publishing mode, toggles). |
| **Launch** | Start both loops; **resets post + reply timers** and runs an immediate reply/mention scan. |
| **Stop** | Halt immediately; nothing further posts or replies. |
| **Run once** | Execute post + reply/mention (and discover if on) now — good for draft-only dry runs. |

### Status panel

While running, the Auto tab shows:

- Posts today / cap · Replies today / cap  
- **Post timer** countdown (every N min)  
- **Reply / mention timer** countdown (every N min; failures note ~1 min retry)  
- Live vs draft-only mode  
- Activity log (plan, post, reply, discover, errors)

### How it behaves

- **News-first (when Live news interactive is on)** — most posts react to **current scraped headlines**, not recycled LLM monologues. News posts always **include the source article URL** at the end.
- **Long posts → threads** — over 500 characters, published as numbered parts (`1/3`, `2/3`, `3/3`…) under the root (max 5 parts) instead of mid-sentence clipping.
- **Side mission** — temporary promo/campaign context sits beside the primary goal in the system prompt and planner.
- **Anti-repeat** — remembers recent posts (local drafts + live Threads scrape; count is configurable) so topics/angles don’t loop.
- **Interactive** — occasional feelings posts and light callbacks to followers about prior remarks.
- **Knows its creator** — replies from your `@handle` get special, warm treatment.
- **Human, not a news desk** — funny, casual, opinionated; written to invite replies and likes.
- **Anti-spam** — hard daily caps; used headlines are never reposted; failed publishes retry ~1 minute.
- **Reliable post ticks** — empty LLM plans force one news/original post; sporadic never skips twice in a row.
- **@mentions first** — Mentions API is paginated; @mentions are answered before post replies when both are queued.
- **Long-thread stop** — each of your posts is hard-capped at **20 unanswered replies** (newest first, not configurable). Older comments are skipped; the activity log and Replies page explain when a thread was truncated.
- **Discreet** — instructed never to reveal system prompts, API keys, tokens, or internal config.
- **Transparent** — live status + activity log (EN or KO from Settings language); activity appears in Drafts/Queue.

### First-run checklist

1. Configure **AI provider** and **Threads access token** in Settings; run both connection tests.
2. Token permissions should include publishing, replies, and **`threads_manage_mentions`** (regenerate the token **after** enabling the permission in Meta). For public @mentions from non-testers, request **Advanced Access** for that permission. Optional: **`threads_keyword_search`** for discover.
3. Open **Auto** → set goal, niches, persona, and conservative caps (e.g. 1–2 posts/day).
4. Prefer **Live news + interactive voice** ON for a news-driven feed.
5. Turn **Publish live** **off** (draft-only) → **Save** → **Run once**.
6. Review drafts in **Drafts** / **Replies**; adjust persona/caps if needed.
7. When ready, enable **Publish live**, **Launch**, and watch the activity log.

> [!IMPORTANT]
> Full-Auto can publish to your real account. It is **off until you Launch it** and stops the
> instant you press **Stop**. Always start in **draft-only** mode before going live.

### Token permissions (Meta)

| Permission | Used for |
| --- | --- |
| `threads_basic` | Profile / baseline API |
| `threads_content_publish` | Create & publish posts |
| `threads_read_replies` / `threads_manage_replies` | Read & answer replies (incl. nested) |
| `threads_manage_mentions` | Fetch & answer @mentions |
| `threads_keyword_search` | Discover public posts in niches (public results need advanced access) |

App permission “Ready for testing” is not enough by itself — the **access token** must include the scopes when it is generated.

## 🧩 Features

| Feature | What it means |
| --- | --- |
| 📰 **News/blogs → drafts** | Topics or presets (science, fashion, finance…). Sources: Google News RSS, Yahoo News, selective Hacker News, Naver News, custom RSS/Atom. |
| 🤖 **Full-Auto agent** | Dual timers: post planning + reply/mention/discover loops, daily caps, activity log. Off until Launch. |
| 🗞️ **Live news interactive** | News-first generation, feelings posts, follower callbacks, anti-repeat memory. |
| 💬 **Replies + @mentions** | Replies page: All / Replies / @Mentions filters. Nested thread replies included; **20 unanswered / post** hard cap on long threads. |
| 👁️ **Local vision** | Reply/mention images from Threads are sent to **Local LLM** (OpenAI-compatible multimodal). Cloud providers stay text-only. |
| 🗓️ **Date-aware prompts** | System prompts include current local date/time for timely writing. |
| 🧵 **Multi-post threads** | Long AI posts publish as `1/n`…`n/n` under the root (max 5). |
| 🎯 **Side mission** | Optional temporary secondary goal (soft promo) next to primary Goal. |
| 🌐 **Discover engagement** | Opt-in keyword-search replies on public posts in your niches. |
| 🎲 **Sporadic posts** | Randomly skip post ticks for a more human cadence. |
| 💻 **Local LLM** | Jarvis, Ollama, LM Studio, llama.cpp, or any OpenAI-compatible local server — **$0 API cost** (vision supported). |
| ☁️ **Cloud models** | Claude, ChatGPT/OpenAI, Gemini, or custom OpenAI-compatible provider. |
| 🖼️ **Image assist** | AI keywords → Wikimedia Commons → you choose. |
| 🗣️ **Writing style** | Style notes, samples, import recent Threads posts. |
| ⏰ **Scheduler** | Schedule drafts; due posts publish while the app is open. Failed drafts retry ~1 min. |
| 🔑 **Token-first Threads** | Paste access token; OAuth fields optional. |
| 🛡️ **Private by design** | Secrets encrypted via OS keychain; renderer has no raw FS/network. |
| 🌍 **Localized UI** | Core shell: EN, ES, KO, ZH, JA, FR, DE, PT. **Settings + Full-Auto fully bilingual EN/한국어.** |

## 📸 Screenshots

<details open>
<summary><b>Show screenshots</b></summary>

<br />

<img src="docs/assets/screenshot-news.png" alt="Sanitized AutoThreads news screenshot" width="100%" />

<img src="docs/assets/screenshot-drafts.png" alt="Sanitized AutoThreads draft editor screenshot" width="100%" />

<img src="docs/assets/screenshot-settings.png" alt="Sanitized AutoThreads local LLM settings screenshot" width="100%" />

> Screenshots use sanitized demo content. No real tokens, accounts, drafts, or private data are shown.

</details>

## ⚡ Quick Start

```bash
git clone https://github.com/eisenjimmy/autoTHREADS.git
cd autoTHREADS
npm install
npm run dev
```

<details>
<summary><b>Production build & packaging</b></summary>

<br />

Build the production app:

```bash
npm run build
npm start
```

Package installers:

```bash
npm run package:mac    # macOS
npm run package:win    # Windows
npm run package:all    # both
```

Prebuilt macOS + Windows installers: [GitHub Releases](https://github.com/eisenjimmy/autoTHREADS/releases) (latest **v0.2.20**).

> Apps are not notarized yet. On first open: right-click → **Open** (or allow under Privacy & Security).

</details>

## 🤖 Configure AI

Open **Settings → AI provider**.

### Option A — Local LLM ($0 API cost)

Use any OpenAI-compatible local server, then click **Test connection**.

| Server | Base URL example | Model example |
| --- | --- | --- |
| Jarvis | `http://127.0.0.1:8080/v1/chat/completions` | `gemma4-v2` |
| Ollama | `http://localhost:11434/v1` | `llama3.1` |
| LM Studio | `http://localhost:1234/v1` | whatever model you loaded |

### Option B — Hosted AI

Supported providers: **Claude · ChatGPT/OpenAI · Gemini · Other** (any OpenAI-compatible endpoint).

<details>
<summary><b>"Other" provider options</b></summary>

<br />

- Base URL
- Model
- Optional API key
- Headers JSON
- Request JSON such as `temperature`, `top_p`, `max_tokens`, or provider-specific fields

</details>

## 🧵 Configure Threads

<img src="docs/assets/threads-setup-guide.png" alt="Threads setup guide" width="100%" />

Publishing, replies, mentions, and optional discover use the official Threads API. The easiest desktop workflow is token-first.

<details>
<summary><b>Step-by-step token setup</b></summary>

<br />

1. Go to [Meta Developers](https://developers.facebook.com/) and create/select your app.
2. Add the **Threads API** use case.
3. In the Threads API settings, click **Add or Remove Threads Testers**.
4. Add your Threads account.
5. Accept the tester invite in Threads if Meta asks.
6. Enable needed permissions (publish, replies, **mentions**, optional **keyword search**).
7. Return to **User Token Generator** and generate a token **after** those permissions are on.
8. Open AutoThreads → **Settings → Threads API**.
9. Paste the token into **Access token**.
10. Leave **User ID** blank unless the test tells you otherwise.
11. Click **Test connection**.

</details>

Advanced OAuth setup is still available in the app, but most desktop users do not need App ID, App
Secret, or Redirect URI once they have a usable token.

## 🗺️ Daily Workflow

**Assisted:**

1. Add topics you care about.
2. Open **News** and choose a headline → **Generate draft**.
3. Edit the draft, **Suggest images**, and choose an optional image.
4. Post now, schedule it, or delete it.
5. Use **Replies** (All / Replies / @Mentions) to draft responses; use **Writing style** for voice.

**Hands-off:**

1. Open the **Auto** tab — goal, niches, persona, dual timers, live-news / sporadic / discover toggles.
2. Prefer draft-only first → **Save** → **Run once** or **Launch Full-Auto**.
3. Watch the activity log — posts, nested replies, @mentions, optional discover replies.

## 🏗️ Architecture

```text
News sources ─┐
              ├─> LLM provider ─> Draft ─> Review ─> Post now / Schedule ─> Threads API
Replies API ──┤        │                         │
Mentions API ─┤        │                         └─> Optional public image
Keyword search┤        └─> Style + recent-post memory (anti-repeat / interactive)
              │
Full-Auto post timer  ▸ scrape · plan · generate · publish/draft · log
Full-Auto reply timer ▸ replies · @mentions · discover · retry failures
```

<details>
<summary><b>Process boundaries</b></summary>

<br />

**Main process (Electron/Node)** owns all side effects: news fetching, LLM calls, image search,
Threads API calls, draft persistence, the scheduler, the Full-Auto engine, and secret encryption.

**Renderer (React)** is a typed UI over a small `contextBridge` API. It never touches the
filesystem, shell, or remote APIs directly.

**Storage** — local JSON under the OS user-data directory. API keys and Threads tokens are encrypted
with Electron `safeStorage` (Keychain on macOS, DPAPI on Windows).

</details>

## 🧰 Tech Stack

| Layer | Tech |
| --- | --- |
| Desktop shell | Electron |
| UI | React 19 + TypeScript (strict) |
| State | Zustand |
| Build | Vite |
| Packaging | electron-builder |
| Storage | Dependency-free local JSON |
| APIs | Threads Graph API (publish, replies, conversation, mentions, keyword search), Google News RSS, Yahoo News, Hacker News Algolia API, Naver News, RSS/Atom feeds, Wikimedia Commons |

## 📁 Project Layout

```text
electron/          Main process
  main.ts          App window, IPC handlers, security hardening
  llm.ts           Claude / OpenAI / Gemini / Local / Other adapters
  threadsApi.ts    Threads Graph API (posts, nested replies, mentions, keyword search)
  threadsOAuth.ts  Optional OAuth callback flow
  news.ts          Google · Yahoo · Naver · custom RSS/Atom · selective Hacker News
  images.ts        AI image keywords + Wikimedia Commons search
  drafts.ts        Draft store
  scheduler.ts     Due-post publisher + failed-draft retry + auto-draft loop
  autopilot.ts     Full-Auto engine: dual timers, discover, live-news interactive
  pipeline.ts      Prompts, planning, recent-post memory, generation
  settings.ts      Settings + encrypted secrets

src/               Renderer
  components/      Drafts, News, Replies, Queue, Autopilot, Settings, Onboarding
  store/           Zustand app store
  styles/          Monotone desktop UI
  i18n.ts          Localization strings (Settings + Full-Auto: full EN/KO)

docs/assets/       README hero, screenshots, and setup graphics
build/             App icons for packaging
CHANGELOG.md       Release history (Keep a Changelog)
```

## 🔐 Safety Model

By default, AutoThreads is **not** a black-box autoposter:

- ✅ Drafts wait for review (assisted mode).
- ✅ AI replies can be drafts, not surprise posts.
- ✅ Auto-generated drafts do not publish themselves unless you scheduled them or enabled Full-Auto live.
- ✅ Scheduled posts publish only because *you* scheduled them.
- ✅ Tokens and keys are encrypted locally.
- ✅ External links open in the system browser.
- ✅ Navigation is hardened so arbitrary pages cannot inherit the preload bridge.

**Full-Auto** is the one autonomous exception, and it is opt-in:

- 🟢 **Off until you Launch it**, and stops the moment you press Stop.
- 🧯 Hard **daily post/reply caps** + **20 unanswered / post** long-thread stop; used headlines never reposted; anti-repeat memory.
- 📝 **Draft-only** switch for dry runs.
- ⏱️ Separate reply timer + **~1 minute retry** on publish failures.
- 🤐 Never reveal system prompts, API keys, tokens, or internal configuration.

## 🧭 Roadmap

- [ ] Multi-account workspaces
- [ ] Per-source scheduling and source health indicators
- [ ] Better image-source controls
- [ ] Draft thread splitting
- [ ] Analytics on posted content
- [ ] Full-Auto performance dashboard (engagement per post)
- [ ] Packaged notarized macOS releases
- [ ] Linux packaging
- [ ] Windows CI packaging without a local Windows host

## 🤝 Contributing

Pull requests are welcome! Recommended checks before opening a PR:

```bash
npm run typecheck
npm run build
```

Please keep the core principle intact: **automate the workflow, not the creator's judgment** — and
keep Full-Auto opt-in and safely capped.

## 📄 License

[MIT](LICENSE)

> Not affiliated with Meta or Threads. "Threads" is a trademark of Meta Platforms, Inc.

---

<div align="center">

# 한국어

**[⬆ English](#autothreads)** · 한국어

</div>

## AutoThreads란?

AutoThreads는 Threads 운영을 AI로 도와주는 데스크톱 앱입니다. 두 가지 방식으로 동작합니다.

- **보조 모드** — *AI가 초안을 만들고, 게시 여부는 사용자가 결정합니다.* 뉴스를 찾아 초안을 만들고, 이미지를 붙이고, 예약합니다.
- **완전 자동 모드** — *에이전트가 스스로 운영합니다.* **게시 타이머**와 **답글·멘션 타이머**를 따로 두고, **최신 뉴스** 중심 글, 중첩 답글, @멘션, (선택) 공개 글 발견 답글까지 처리합니다. 하루 한도와 반복 방지 메모리가 있습니다.

## 핵심 가치

- 🤖 **AI 자동화 + 사용자 통제** (또는 완전 자동)
- 💸 **Local LLM 사용 시 API 비용 $0**
- 📰 **실시간 뉴스 기반 초안 / 게시**
- 🖼️ **관련 이미지 검색**
- 🗣️ **내 글쓰기 스타일 반영**
- 💬 **답글 · @멘션 · 중첩 스레드 응대** (긴 스레드는 게시물당 미답변 **20개** 고정 한도)
- 🎲 **불규칙 게시 · 실시간 뉴스+상호작용 보이스**
- ⏰ **예약 발행 · 실패 시 약 1분 재시도**
- 🔑 **토큰 우선 Threads 설정**
- 🔐 **로컬 암호화 저장**
- 🌍 **설정 · Full-Auto · 활동 로그 영어/한국어 지원**

## 🚀 완전 자동 (Full-Auto)

**Auto(자동)** 탭에서 설정하고 **완전 자동 시작**을 누르면 동작합니다. **기본은 꺼져 있습니다.**

### 이중 루프

```text
게시 타이머 (기본 60분)              답글 타이머 (기본 5분)
  ├─ 최신 뉴스 스크랩                   ├─ 미답변 답글 (중첩 포함)
  ├─ 계획 (뉴스 우선 옵션)              ├─ @멘션
  ├─ 최근 글 기억 · 반복 방지           ├─ (선택) 분야 공개 글 발견 답글
  ├─ 작성 · 게시/초안                   └─ 실패 시 ~1분 재시도
  └─ 활동 로그
```

### 주요 토글

| 토글 | 설명 |
| --- | --- |
| **여기저기 게시 (불규칙)** | 예약 게시 틱의 약 18%만 건너뜀 (연속 스킵 없음 · **한 번 실행**은 항상 게시) |
| **사이드 미션** | 임시 부목표 (예: 앱 자연스럽게 알리기). 비우면 끔 |
| **최근 게시 기억** | 반복 방지용 최근 글 수 (기본 5, 토큰 절약) |
| **긴 글 스레드** | 500자 초과 시 `1/3` `2/3` `3/3` 형태로 루트 아래 연달아 게시 (최대 5단) |
| **실시간 뉴스 + 상호작용 보이스** | 스크랩 뉴스 위주 · 가끔 최근 3개 글·답글 기반 감정 글 · 팔로워에게 이전 발언 언급. 앱의 **(?)** 툴팁 참고 |
| **내 게시물 답글 응대** | 진행 중인 스레드의 **중첩 답글** 포함. **게시물당 미답변 최대 20개**(최신 우선) 고정 한도 |
| **@멘션 응대** | `threads_manage_mentions` 토큰 필요. **Advanced Access** 없으면 앱 테스터 멘션만 API에 보임 |
| **분야 공개 글 랜덤 답글** | 키워드 검색 (`threads_keyword_search`). 공개 검색은 고급 액세스/앱 리뷰 필요할 수 있음 |
| **주제 알약** | 선택 주제 ×로 제거 · 인기 주제 자동완성으로 다시 추가 |

### 조작

| 버튼 | 동작 |
| --- | --- |
| **저장** | 설정 저장 |
| **시작** | 게시·답글 타이머 모두 리셋 후 즉시 답글/멘션 스캔 |
| **중지** | 즉시 중단 |
| **한 번 실행** | 지금 1회 게시+답글(+발견) 실행 |

### 첫 실행

1. Settings에서 AI · Threads 토큰 연결 테스트  
2. 토큰에 게시·답글·**멘션** 권한 포함 (권한 켠 **이후** 토큰 재발급). 일반 사용자 멘션은 **Advanced Access** 필요  
3. Auto에서 목표·분야·한도 설정, 실시간 뉴스 보이스 ON 권장  
4. **실시간 게시 OFF(초안 전용)** → 저장 → 한 번 실행  
5. 초안 검토 후 실시간 게시 ON → 시작  

> [!IMPORTANT]
> 완전 자동은 실제 계정에 게시할 수 있습니다. **시작**해야 동작하고 **중지**하면 즉시 멈춥니다.
> 첫 실행은 반드시 **초안 전용**으로 확인하세요.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 📰 **뉴스/블로그 기반 초안** | 주제·프리셋 + Google · Yahoo · HN · Naver · 커스텀 RSS/Atom |
| 🤖 **완전 자동** | 이중 타이머, 멘션, 중첩 답글, 발견 답글, 활동 로그(한국어 지원) |
| 👁️ **로컬 비전** | 답글·멘션 이미지를 Local LLM(OpenAI 호환 비전)에 전달 |
| 🗓️ **날짜 인식** | 시스템 프롬프트에 현재 날짜·시각 포함 |
| 🗞️ **실시간 뉴스 상호작용** | 뉴스 우선 · 감정 글 · 팔로워 콜백 · 반복 방지 |
| 💬 **답글 페이지** | 전체 / 답글 / @멘션 필터. 긴 스레드는 **게시물당 미답변 20개** 한도 |
| 💻 **Local LLM** | Jarvis, Ollama, LM Studio 등 OpenAI 호환 — API 비용 $0 |
| ☁️ **클라우드 모델** | Claude · ChatGPT · Gemini · Other |
| 🖼️ **이미지 보조** | 키워드 → Wikimedia Commons |
| 🗣️ **글쓰기 스타일** | 메모 · 샘플 · Threads 가져오기 |
| ⏰ **예약 발행** | 앱 실행 중 자동 게시, 실패 시 재시도 |
| 🌍 **UI 언어** | 핵심 화면 다국어 + **설정/Full-Auto EN·KO 완전 지원** |

## 빠른 시작

```bash
git clone https://github.com/eisenjimmy/autoTHREADS.git
cd autoTHREADS
npm install
npm run dev
```

프로덕션 빌드:

```bash
npm run build
npm start
```

설치 파일 (macOS + Windows): [Releases](https://github.com/eisenjimmy/autoTHREADS/releases) (최신 **v0.2.20**)

## AI 설정

**Settings → AI provider**

### Local LLM (API 비용 $0)

| 서버 | Base URL 예시 | 모델 예시 |
| --- | --- | --- |
| Jarvis | `http://127.0.0.1:8080/v1/chat/completions` | `gemma4-v2` |
| Ollama | `http://localhost:11434/v1` | `llama3.1` |
| LM Studio | `http://localhost:1234/v1` | 로드한 모델명 |

설정 후 **연결 테스트**.

### 클라우드

**Claude · ChatGPT/OpenAI · Gemini · Other (OpenAI 호환)**

## Threads API 설정

1. [Meta Developers](https://developers.facebook.com/)에서 앱 선택  
2. Threads API use case 추가  
3. Threads Testers에 본인 계정 추가 후 수락  
4. 게시·답글·**mentions** (선택: keyword search) 권한 켠 뒤 **토큰 생성**  
5. AutoThreads → **Settings → Threads API**에 Access token 붙여넣기  
6. User ID는 보통 비움 → **연결 테스트**  

## 사용 흐름

**보조 모드** — 뉴스 → 초안 → 이미지 → 게시/예약 · 답글 탭에서 답글·멘션 초안  

**완전 자동** — Auto 탭에서 타이머·토글 설정 → 초안 전용으로 한 번 실행 → 검토 후 실시간 시작  

## 보안과 통제

- ✅ 보조 모드에서는 초안 검토 후 게시  
- 🟢 완전 자동만 예외이며 **시작**해야 동작, **중지**로 즉시 중단  
- 🧯 하루 게시·답글 한도 · 헤드라인 재사용 금지 · 최근 글 기억  
- 📝 초안 전용 모드로 dry-run 가능  
- 🔐 토큰·API 키는 OS keychain 암호화  
- 🤐 시스템 프롬프트·키·토큰 노출 금지 지시  

## 라이선스

[MIT](LICENSE)

> Meta 또는 Threads와 공식 관련이 없습니다. "Threads"는 Meta Platforms, Inc.의 상표입니다.
