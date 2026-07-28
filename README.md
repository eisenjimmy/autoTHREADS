<div align="center">

<img src="src/assets/banner.png" alt="AutoThreads hero banner" width="100%" />

# AutoThreads

### 🧵 Automate Threads with AI — from assisted drafts to a fully autonomous agent.

Automagical Threads automation for creators, founders, and builders. Draft with AI and stay in
control, or hand the wheel to a self-running agent that posts and replies on its own.

<br />

![Version](https://img.shields.io/badge/version-0.2.8-111111?style=flat-square)
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
> **New in v0.2.0 — Full-Auto mode.** An opt-in autonomous agent that decides whether and what to
> post, writes modern human-sounding Threads posts across your niches, and replies in context —
> under hard daily caps so it never spams. See [Full-Auto](#-full-auto-mode) and
> [CHANGELOG.md](CHANGELOG.md).

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
- **Full-Auto mode** — *the agent runs itself.* On an interval it scrapes news, decides what's worth
  posting, writes it, and answers replies — hands-off, with hard safety caps.

Built for a creator workflow where you want leverage, not chaos:

- 🔎 Find news around topics you care about.
- 🧠 Let AI turn it into a Thread-ready draft — or run the whole loop for you.
- 🖼️ Pull a related public image from the web.
- 🗣️ Teach it your writing voice.
- 💬 Draft or auto-send replies.
- ⏰ Schedule posts for later.
- 💸 Use a local LLM for **$0 cloud API cost**, or bring Claude, ChatGPT, Gemini, or any OpenAI-compatible endpoint.

<img src="docs/assets/workflow.png" alt="AutoThreads workflow diagram" width="100%" />

## 🚀 Full-Auto Mode

![status: opt-in](https://img.shields.io/badge/status-opt--in-43c465?style=flat-square)
![off by default](https://img.shields.io/badge/default-OFF-111111?style=flat-square)
![bilingual](https://img.shields.io/badge/UI-EN%20%2F%20한국어-111111?style=flat-square)

Most of AutoThreads is deliberately *"AI drafts, you decide."* **Full-Auto** is the opt-in exception:
a self-running agent for a hands-off Threads presence. Open the **Auto** tab, configure it, and press
**Launch** — then it thinks on its own every interval.

### Loop

```text
every N minutes
  ├─ scrape news     Google · Yahoo · Naver · Hacker News · custom RSS/Atom
  ├─ LLM decides     post? how many? news vs original?   (respects daily caps)
  ├─ write posts     casual, human, engagement-first voice
  ├─ scan replies    answer unanswered replies in context (can read linked pages)
  └─ log activity    then sleep until the next tick
```

### What you configure

| Setting | What it controls |
| --- | --- |
| **Goal** | What the agent optimizes for — followers, comments, likes. Drives every decision. |
| **Topics / niches** | Popular Threads niches first (**AI**, tech, startups, productivity, humor…) plus more categories and custom multi-select. Posts use that niche’s native voice. |
| **Post language** | Match the source, Korean only, English only, or follow the app language. |
| **Personality** | Agent name, creator, creator `@handle`, address term (e.g. "Master"), and tone notes. |
| **Cadence & caps** | Think-interval, max posts per run, **max posts per day**, original-vs-news mix. |
| **Replies & mentions** | Auto-reply vs draft for replies on your posts **and** @mentions of you, with per-run and per-day caps. Mentions need `threads_manage_mentions`. |
| **Publishing** | **Live** to Threads, or **draft-only** as a safety valve. |

### Controls

| Control | Behavior |
| --- | --- |
| **Save** | Persist Full-Auto settings (persona, caps, niches, publishing mode). |
| **Launch** | Start the interval loop. Status shows running + next-run countdown. |
| **Stop** | Halt immediately; nothing further posts or replies. |
| **Run once** | Execute a single tick now (useful for dry runs with draft-only on). |

### How it behaves

- **Knows its creator** — replies from your `@handle` get special, warm treatment.
- **Human, not a news desk** — funny, casual, opinionated; written to invite replies and likes.
- **Anti-spam** — hard daily caps; used headlines are never reposted.
- **Discreet** — instructed never to reveal system prompts, API keys, tokens, or internal config.
- **Transparent** — live status (posts/replies today, next run) plus an activity log; published posts surface in Drafts/Queue and link out to Threads when live.

### First-run checklist

1. Configure **AI provider** and **Threads access token** in Settings; run both connection tests.
2. Open **Auto** → set goal, niches, persona, and conservative caps (e.g. 1–2 posts/day).
3. Turn **Publish live** **off** (draft-only) → **Save** → **Run once**.
4. Review drafts in the **Drafts** tab; adjust persona/caps if needed.
5. When ready, enable **Publish live**, **Launch**, and watch the activity log.

> [!IMPORTANT]
> Full-Auto can publish to your real account. It is **off until you Launch it** and stops the
> instant you press **Stop**. Always start in **draft-only** mode before going live.

## 🧩 Features

| Feature | What it means |
| --- | --- |
| 📰 **News/blogs → drafts** | Pick topics or presets (science, fashion, lifestyle, finance, travel, food…). Sources: Google News RSS, Yahoo News, selective Hacker News, Naver News, and custom RSS/Atom feeds. |
| 🤖 **Full-Auto agent** | Autonomous decide → post → reply loop across your niches, with daily caps. Off by default; you Launch it. |
| 💻 **Local LLM support** | Run with Jarvis, Ollama, LM Studio, llama.cpp, or any OpenAI-compatible local server for **$0 API cost**. |
| ☁️ **Cloud model support** | Use Claude, ChatGPT/OpenAI, Gemini, or a custom OpenAI-compatible provider. |
| 🖼️ **Image assist** | AI suggests keywords, AutoThreads searches Wikimedia Commons, and you choose an optional public image. |
| 🗣️ **Your writing style** | Add style notes, paste sample posts, or import recent Threads posts to teach it your voice. |
| 💬 **Reply drafts** | Pull unanswered replies and generate response drafts (or let Full-Auto send them). |
| ⏰ **Scheduler** | Schedule approved drafts. Scheduled posts publish automatically while the app is open. |
| 🔑 **Token-first Threads setup** | Paste a Threads access token. OAuth app credentials are optional advanced setup. |
| 🛡️ **Private by design** | Secrets are encrypted with the OS keychain. The renderer gets no direct filesystem/network access. |
| 🌍 **Localized UI** | EN, ES, KO, ZH, JA, FR, DE, PT for core workflows; Full-Auto is fully bilingual EN/한국어. |

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

Publishing and reply management use the official Threads API. The easiest desktop workflow is token-first.

<details>
<summary><b>Step-by-step token setup</b></summary>

<br />

1. Go to [Meta Developers](https://developers.facebook.com/) and create/select your app.
2. Add the **Threads API** use case.
3. In the Threads API settings, click **Add or Remove Threads Testers**.
4. Add your Threads account.
5. Accept the tester invite in Threads if Meta asks.
6. Return to **User Token Generator**.
7. Generate a token.
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
5. Use **Replies** to draft responses; use **Writing style** to keep drafts sounding like you.

**Hands-off:**

1. Open the **Auto** tab and set your goal, niches, persona, and caps.
2. Press **Launch Full-Auto** (or start in draft-only to preview).
3. Watch the activity log — the agent posts and replies on its own.

## 🏗️ Architecture

```text
News sources ─┐
              ├─> LLM provider ─> Draft ─> Review ─> Post now / Schedule ─> Threads API
Replies API ──┘        │                         │
                       │                         └─> Optional public image
                       └─> Your style notes + samples

Full-Auto ▸ decide (LLM) ─> generate ─> publish/draft ─> reply ─> log   (own interval + daily caps)
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
| APIs | Threads Graph API, Google News RSS, Yahoo News, Hacker News Algolia API, Naver News, RSS/Atom feeds, Wikimedia Commons |

## 📁 Project Layout

```text
electron/          Main process
  main.ts          App window, IPC handlers, security hardening
  llm.ts           Claude / OpenAI / Gemini / Local / Other adapters
  threadsApi.ts    Threads Graph API client
  threadsOAuth.ts  Optional OAuth callback flow
  news.ts          Google · Yahoo · Naver · custom RSS/Atom · selective Hacker News aggregation
  images.ts        AI image keywords + Wikimedia Commons search
  drafts.ts        Draft store
  scheduler.ts     Due-post publisher + auto-draft loop
  autopilot.ts     Full-Auto engine: autonomous decide/post/reply loop with daily caps
  settings.ts      Settings + encrypted secrets

src/               Renderer
  components/      Drafts, News, Replies, Queue, Autopilot, Settings, Onboarding
  store/           Zustand app store
  styles/          Monotone desktop UI
  i18n.ts          Localization strings

docs/assets/       README hero, screenshots, and setup graphics
build/             App icons for packaging
```

## 🔐 Safety Model

By default, AutoThreads is **not** a black-box autoposter:

- ✅ Drafts wait for review.
- ✅ AI replies are drafts, not surprise posts.
- ✅ Auto-generated drafts do not publish themselves.
- ✅ Scheduled posts publish only because *you* scheduled them.
- ✅ Tokens and keys are encrypted locally.
- ✅ External links open in the system browser.
- ✅ Navigation is hardened so arbitrary pages cannot inherit the preload bridge.

**Full-Auto** is the one autonomous exception, and it is opt-in:

- 🟢 **Off until you Launch it**, and stops the moment you press Stop.
- 🧯 Hard **daily post/reply caps** prevent spamming; used headlines are never reposted.
- 📝 A **draft-only** switch lets the agent decide everything while still holding posts for review.
- 🤐 The agent is instructed to never reveal system prompts, API keys, tokens, or internal configuration.

## 🧭 Roadmap

- [ ] Multi-account workspaces
- [ ] Per-source scheduling and source health indicators
- [ ] Better image-source controls
- [ ] Draft thread splitting
- [ ] Analytics on posted content
- [ ] Full-Auto performance dashboard (engagement per post)
- [ ] Packaged notarized macOS releases
- [ ] Linux packaging

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
- **완전 자동 모드** — *에이전트가 스스로 운영합니다.* 주기마다 뉴스를 수집해 게시 여부를 판단하고, 글을 쓰고, 답글까지 처리합니다. 하루 한도로 안전하게 제한됩니다.

## 핵심 가치

- 🤖 **AI 자동화 + 사용자 통제** (또는 완전 자동)
- 💸 **Local LLM 사용 시 API 비용 $0**
- 📰 **뉴스 기반 초안 생성**
- 🖼️ **관련 이미지 검색**
- 🗣️ **내 글쓰기 스타일 반영**
- 💬 **답글 초안 / 자동 응대**
- ⏰ **예약 발행**
- 🔑 **토큰 우선 Threads 설정**
- 🔐 **로컬 암호화 저장**

## 🚀 완전 자동 (Full-Auto)

AutoThreads의 기본 철학은 "AI가 초안을 만들고 사용자가 결정한다"입니다. **완전 자동(Full-Auto)** 은
이를 선택적으로 해제하는 모드로, 손이 거의 필요 없는 Threads 운영을 위한 기능입니다.
**Auto(자동)** 탭에서 설정하고 **완전 자동 시작**을 누르면 주기마다 스스로 판단합니다.

### 루프

```text
N분마다
  ├─ 뉴스 수집    Google · Yahoo · Naver · Hacker News · 커스텀 RSS/Atom
  ├─ LLM 판단     게시할까? 몇 개? 뉴스 vs 오리지널   (하루 한도 준수)
  ├─ 글 작성      사람 같고 캐주얼하게, 참여 유도
  ├─ 답글 처리    미답변 답글에 문맥 맞춰 응대 (링크된 페이지도 읽음)
  └─ 활동 기록    다음 주기까지 대기
```

### 설정 항목

| 설정 | 설명 |
| --- | --- |
| **목표** | 팔로워·댓글·좋아요 등 에이전트가 최적화할 목표. 모든 판단의 기준. |
| **주제 / 분야** | Threads 인기 분야 우선 (**AI**, 기술, 스타트업, 생산성, 유머…) + 기타 프리셋·직접 추가. 선택한 분야 톤으로 작성. |
| **게시 언어** | 원문 언어 따르기 / 한국어만 / 영어만 / 앱 언어 따르기. |
| **페르소나** | 에이전트 이름, 제작자, 제작자 `@핸들`, 호칭(예: "Master"), 톤 메모. |
| **주기 & 한도** | 실행 주기, 실행당 최대 게시, **하루 최대 게시**, 오리지널 vs 뉴스 비율. |
| **답글** | 자동 응대 vs 초안 작성, 실행당·하루 한도. |
| **게시 방식** | Threads **실시간 게시** 또는 안전장치 **초안 전용**. |

### 조작

| 버튼 | 동작 |
| --- | --- |
| **저장** | Full-Auto 설정(페르소나·한도·분야·게시 방식)을 저장합니다. |
| **시작** | 주기 루프를 시작합니다. 상태 패널에 실행 중·다음 실행 시각이 표시됩니다. |
| **중지** | 즉시 중단합니다. 이후 게시·답글이 나가지 않습니다. |
| **한 번 실행** | 지금 1회만 돌립니다 (초안 전용 dry-run에 유용). |

### 첫 실행 체크리스트

1. Settings에서 **AI provider**와 **Threads 액세스 토큰**을 설정하고 연결 테스트를 통과합니다.
2. **Auto**에서 목표·분야·페르소나·보수적인 한도(예: 하루 1–2개)를 설정합니다.
3. **실시간 게시**를 끄고 (**초안 전용**) → **저장** → **한 번 실행**.
4. **Drafts**에서 초안을 검토하고 페르소나/한도를 조정합니다.
5. 준비되면 **실시간 게시**를 켜고 **시작**, 활동 로그를 확인합니다.

> [!IMPORTANT]
> 완전 자동은 실제 계정에 게시할 수 있습니다. 기본은 꺼져 있으며 **시작**해야 동작하고 **중지**하면
> 즉시 멈춥니다. 첫 실행은 반드시 **초안 전용**으로 판단 로그를 확인하세요.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 📰 **뉴스/블로그 기반 초안** | 관심 주제나 프리셋을 선택하고 Google · Yahoo · Hacker News · Naver · 커스텀 RSS/Atom 피드를 켜고 끌 수 있습니다. |
| 🤖 **완전 자동 에이전트** | 분야별 자율 판단 → 게시 → 답글 루프, 하루 한도 포함. 기본은 꺼짐, 직접 시작. |
| 💻 **Local LLM 지원** | Jarvis, Ollama, LM Studio, llama.cpp 같은 로컬 OpenAI 호환 서버. API 비용 없이 실행. |
| ☁️ **Claude / ChatGPT / Gemini 지원** | 클라우드 모델은 API 키를 넣고 사용. |
| 🔧 **Other Provider** | OpenAI 호환 커스텀 엔드포인트, 헤더 JSON, 요청 JSON 설정. |
| 🖼️ **관련 이미지 검색** | AI가 키워드를 만들고 앱이 이미지를 가져오며, 선택한 이미지만 게시에 포함. |
| 🗣️ **글쓰기 스타일 학습** | 스타일 메모·샘플 글·최근 Threads 글로 내 목소리를 학습. |
| 💬 **답글 초안** | 미답변 댓글을 가져와 AI 답글 초안 생성 (완전 자동 시 자동 발행). |
| ⏰ **예약 발행** | 검토한 초안을 원하는 시간에 예약. |

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

## AI 설정

앱에서 **Settings → AI provider**를 엽니다.

### Local LLM (API 비용 $0)

| 서버 | Base URL 예시 | 모델 예시 |
| --- | --- | --- |
| Jarvis | `http://127.0.0.1:8080/v1/chat/completions` | `gemma4-v2` |
| Ollama | `http://localhost:11434/v1` | `llama3.1` |
| LM Studio | `http://localhost:1234/v1` | 로드한 모델명 |

설정 후 **Test connection**을 누르면 됩니다.

### 클라우드 모델

지원 모델: **Claude · ChatGPT/OpenAI · Gemini · Other (OpenAI 호환 엔드포인트)**

## Threads API 설정

가장 쉬운 방식은 Access Token을 직접 넣는 것입니다.

1. [Meta Developers](https://developers.facebook.com/)에서 앱을 생성/선택합니다.
2. **Threads API** use case를 추가합니다.
3. Threads API 설정에서 **Add or Remove Threads Testers**를 누릅니다.
4. 본인의 Threads 계정을 tester로 추가합니다.
5. Threads에서 초대 수락이 필요하면 수락합니다.
6. **User Token Generator**로 돌아가 토큰을 생성합니다.
7. AutoThreads → **Settings → Threads API**로 이동합니다.
8. **Access token**에 토큰을 붙여넣고 (**User ID**는 보통 비워둠) **Test connection**을 누릅니다.

OAuth 설정은 고급 옵션으로 남아 있지만, 데스크톱 사용자는 토큰 방식이 가장 간단합니다.

## 사용 흐름

**보조 모드**

1. 관심 주제를 추가합니다.
2. **News**에서 뉴스를 고르고 **Generate draft**를 누릅니다.
3. 초안을 수정하고 **Suggest images**로 이미지를 고릅니다.
4. 바로 게시하거나 예약하거나 삭제합니다.
5. **Replies**에서 답글을 만들고, **Writing style**로 내 스타일을 유지합니다.

**완전 자동**

1. **Auto(자동)** 탭에서 목표·분야·페르소나·한도를 설정합니다.
2. **완전 자동 시작**을 누릅니다 (미리보기는 초안 전용 모드).
3. 활동 로그를 보며 에이전트가 알아서 게시·답글하는 것을 확인합니다.

## 보안과 통제

- ✅ 기본적으로 AI는 초안만 만들고 자동 게시하지 않습니다.
- ✅ 예약한 글만 예약 시간에 게시됩니다.
- 🟢 **완전 자동** 모드만 예외이며 직접 "시작"해야 동작하고 언제든 중지할 수 있습니다. 하루 게시·답글 한도로 도배를 방지하고, 초안 전용 모드로 판단만 시킬 수도 있습니다.
- 🤐 에이전트는 시스템 프롬프트·API 키·토큰·내부 설정을 절대 노출하지 않도록 지시받습니다.
- 🔐 토큰과 API 키는 OS keychain 기반으로 암호화됩니다.
- 🚫 렌더러는 직접 파일시스템이나 외부 API에 접근하지 않습니다.
- 🔗 모든 외부 링크는 시스템 브라우저에서 열립니다.

## 라이선스

[MIT](LICENSE)

> Meta 또는 Threads와 공식 관련이 없습니다. "Threads"는 Meta Platforms, Inc.의 상표입니다.
