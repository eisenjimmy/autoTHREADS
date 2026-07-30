# Changelog

All notable changes to AutoThreads are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Session-level notes also live under `_changelog/`.

---

## [0.2.14] — 2026-07-28

### Added

- **Side mission** — optional temporary secondary goal (e.g. soft-promote QuantFox) next to the primary Goal; woven in lightly when natural (posts + replies + planner).
- **Long posts as threads** — drafts over 500 chars are published as numbered Threads (e.g. `1/3`, `2/3`, `3/3`) under the root post instead of mid-sentence clipping. Max 5 parts (~2500 chars total). News source link stays on the last part.
- **Recent posts memory** — configurable (1–20, default **5**) under Cadence & limits; fewer past posts loaded for anti-repeat → fewer LLM tokens.

### Fixed / improved

- Clearer Full-Auto logging when publish-live is off (draft-only ticks) and when reply ticks dominate the log vs post timer.

---

## [0.2.13] — 2026-07-28

### Fixed

- **Full-Auto posts were starving** — sporadic mode skipped ~45% of hourly ticks (sometimes back-to-back). Now ~18% skip, never two skips in a row, and **Run once** always posts.
- **Empty planner no longer idles** — if the LLM plan returns no items, force one news or original post so the feed stays active.
- **@mentions** — paginate Mentions API (`/me` + user id), process mentions before replies, log raw Mentions API counts in the activity log, and surface Meta’s Advanced Access / tester-only limitation when the API returns 0.

### Docs

- README + Full-Auto UI explain sporadic behavior and Advanced Access for `threads_manage_mentions`.

---

## [0.2.12] — 2026-07-28

### Added

- **Configurable LLM max tokens** in Settings → AI provider (default **500** = Threads post character limit; range 64–8192). Applied to Claude, OpenAI, Gemini, Local, and Other providers.

---

## [0.2.11] — 2026-07-28

### Added

- **News source link in AI posts** — Full-Auto, News → Generate draft, and auto-draft posts that react to a headline always append the real article URL at the end (deterministic; body truncated if needed to stay under 500 chars).

---

## [0.2.10] — 2026-07-28

### Fixed / safety

- **Long reply threads hard-capped at 20** unanswered per root post (newest first). Deterministic stop in `threadsApi` + Full-Auto so viral comment storms are never chased forever.
- Activity log, Replies page banner, and Full-Auto settings copy explain the limit (EN/KO).
- Max replies per Full-Auto run clamped to **20** (matches the per-thread hard cap).

---

## [0.2.9] — 2026-07-28

### Added

- **Removable topic pills** on Full-Auto — each selected niche has ×; re-add from popular chips, more niches, or search autocomplete (popular handles on focus).
- **Activity log Korean** — when Settings language is 한국어, Full-Auto activity messages, kind labels, and relative timestamps are in Korean.
- **Windows release assets** restored (NSIS installer + zip) — recent 0.2.x releases had been mac-only.

---

## [0.2.8] — 2026-07-27

### Added

- **Live news + interactive voice** toggle (default on) on Full-Auto:
  - Prefer **current scraped news** for most posts (not recycled original LLM riffs)
  - Occasionally post **feelings** using the last 3 posts + recent replies
  - Talk to followers with light callbacks to prior remarks
  - EN/KO tooltip on the control explaining behavior
- Settings tab fully bilingual EN/KO (from prior session)

### Changed

- Planning/generation use recent post + reply memory for anti-repeat and interactive hooks.

---

## [0.2.7] — 2026-07-27

### Added

- **Post here and there (sporadic)** toggle — randomly skips some post ticks so the account doesn’t publish on a metronome.
- **Reply to random public posts in my niches** toggle — keyword-search discovery engagement (`threads_keyword_search`), with per-run/per-day discover caps. Opt-in.
- Default OAuth scopes include `threads_keyword_search`.

### Notes

- Mentions need `threads_manage_mentions` **on the access token** (permission enabled in Meta is not enough — regenerate the token after enabling).
- Public keyword search results need **advanced access** for `threads_keyword_search`; without it, search is limited to the auth user’s own posts.

---

## [0.2.6] — 2026-07-27

### Fixed

- **Ongoing threads** — unanswered reply scan no longer keeps only the first top-level comment. Nested replies in a conversation (people continuing a thread) are included and answered.
- Conversation fetch is paginated; `/replies` fallback walks child replies so nested comments still surface when `/conversation` is unavailable.
- Default **max replies per run** raised to **15** so a busy thread can get multiple answers in one tick.

---

## [0.2.5] — 2026-07-27

### Fixed

- **@mentions actually load** — Mentions API now always uses `/me/mentions`, accepts media without a top-level `username` (falls back to `owner.username`), keeps media-only mentions, and surfaces permission errors instead of silently returning empty.
- Full-Auto activity log reports mention API failures and inbox counts (replies vs @mentions).

### Added

- **Replies page** shows **@mentions** alongside post replies, with All / Replies / @Mentions filters and clearer mention badges.

---

## [0.2.4] — 2026-07-27

### Fixed

- **Replies/mentions actually run on their own timer** — launch resets the reply stamp (not only the post stamp) and kicks an immediate scan; reply work no longer waits behind a long post/LLM pass.
- **Failed replies no longer get stuck** — failed drafts no longer block future attempts; publish failures are retried (~1 minute) instead of being marked “answered”.
- Status panel shows **Post timer** and **Reply / mention timer** clearly (interval + countdown).

### Changed

- Autopilot poll interval is 10s; failed posts/replies schedule a **1-minute** retry.
- Scheduler also retries `failed` drafts after 1 minute.

---

## [0.2.3] — 2026-07-27

### Added

- **Separate reply timer** — replies and @mentions run on their own cadence (`replyIntervalMinutes`, **default 5 minutes**), independent of the post/think interval.
- Auto status panel shows **Next post** and **Next reply check** countdowns with each interval.

### Fixed

- Threads publish/reply **“resource does not exist”**: retry image posts as text-only; treat warm-up `does not exist` on `threads_publish` as transient; verify reply targets still exist before generating/publishing; do not burn the daily reply budget on failed live publishes; skip permanently missing targets.

### Changed

- Default **post/think interval** is **60 minutes**; default **reply check** is **5 minutes**.

---

## [0.2.2] — 2026-07-27

### Added

- **Full-Auto @mention replies** — while launched, the agent also answers public posts that @mention your account (Threads Mentions API), not only replies under your own posts.
- Auto tab toggle **Reply to @mentions of me** (on by default).
- Replies view shows a `mention` badge for inbound mentions.
- Default OAuth/token scopes now include `threads_manage_mentions` (older saved scopes are auto-extended).

### Notes

- Mentions require a Threads access token that includes **`threads_manage_mentions`**. If the permission is missing, mention fetch fails soft and reply-only mode still works — regenerate the token after adding the permission in Meta Developers.
- Same cadence as replies (Full-Auto interval, default 1 minute) and shared daily reply caps.

---

## [0.2.1] — 2026-07-27

### Changed

- Full-Auto default **think interval** is now **1 minute** (was 60), so replies are checked every minute while launched.
- Full-Auto default **max replies per day** is now **100** (was 40).
- Interval validation/UI now allows a minimum of **1** minute (was 5).

> Existing installs keep saved settings. In **Auto**, set interval to `1` and max replies/day to `100` if you already ran an older version, then **Save**.

---

## [0.2.0] — 2026-07-27

### Highlights

- **Full-Auto mode** — an opt-in autonomous agent for hands-off Threads growth.
- **Popular Threads niches (AI-first)** — posts are written in the voice of high-engagement categories like AI, tech, startups, and productivity.
- **Safer by default** — hard daily caps, draft-only mode, and Launch/Stop controls.

### Added

- **Full-Auto engine** — decide → post → reply loop on a configurable interval (`electron/autopilot.ts`).
- **Auto tab** — bilingual EN/한국어 control room for goal, niches, persona, cadence, caps, replies, and live vs draft-only publishing (`src/components/AutopilotView.tsx`).
- **Persona-aware planning & generation** — goal-driven JSON plans, creator recognition (`@handle` + address term), language matching, heuristic fallback for weak local models, and a hard safety block against leaking prompts/keys/tokens (`electron/pipeline.ts`).
- **Popular niche catalog** — AI, tech, dev, startups, productivity, side hustle, creator economy, career, crypto, humor, and more; one-click “popular defaults (AI-first)”.
- **Per-niche voice coaching** — posts match popular Threads niche energy (especially AI Threads: “just tried”, hot takes, builder voice — not press releases).
- **Cadence & safety caps** — think interval, max posts/replies per run and per day, original-vs-news mix, never-repost used headlines, 80-entry activity log.
- **Draft-only safety valve** — agent can plan and write while holding posts for review.
- **Yahoo News** source alongside Google News, Hacker News, Naver News, and custom RSS/Atom.
- **Running indicators** — pulsing live dot on Auto and a Full-Auto status chip in the status bar.

### Changed

- README (EN + KO) documents Full-Auto, popular niches, Yahoo News, and the updated safety model.
- `runGeneration` accepts an optional full system prompt so Full-Auto can inject persona prompts while assisted mode keeps style-only prompts.
- Dev script waits for Vite on `localhost` / IPv6 as well as `127.0.0.1` so `npm run dev` launches Electron reliably on modern macOS.
- Default Full-Auto niches are AI-first popular categories.

### Safety

- Full-Auto is **off by default**; it only runs after **Launch** and stops on **Stop**.
- Hard daily post/reply caps reduce spam risk.
- Prefer **draft-only** for the first smoke test against a real account.

### Packaging

- macOS Apple Silicon + Intel DMG and zip installers.
- Product version **0.2.0**.

---

## [0.1.10] — 2026-07-04

### Added

- Settings toggles for Google News RSS, Hacker News, and Naver News.
- Naver News scraping for Korean media discovery.
- Custom RSS/Atom feeds with optional `{query}` URL replacement.

### Changed

- Manual News browsing and auto-drafting share the same saved source settings.

---

## [0.1.9] — 2026-07-04

### Fixed

- Replies and Queue render as vertical stacked lists.

### Changed

- Packaging emits Mac and Windows zip artifacts in addition to DMG/NSIS installers.

---

## [0.1.8] — 2026-07-04

### Added

- News category presets and News/Blogs mode switch.

### Changed

- Hacker News is queried selectively for tech/startup topics only.

---

## [0.1.0] — 2026-07-04

Initial open-source release: Electron + React desktop app for AI-assisted Threads drafts, local/cloud LLM providers, news scraping, image assist, replies, scheduling, and token-first Threads setup.

[0.2.0]: https://github.com/eisenjimmy/autoTHREADS/releases/tag/v0.2.0
[0.1.10]: https://github.com/eisenjimmy/autoTHREADS/releases/tag/v0.1.10
