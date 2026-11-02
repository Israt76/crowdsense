# CrowdSense — When Chat Speaks Together, Streamers Hear It

CrowdSense turns messy, naturally written Twitch chat into one collective **Crowd Voice** a streamer can act on — no commands and no manually created polls.

**People, not messages. One viewer, one voice. A crowd is relative to the room.**

## What it does

CrowdSense groups natural wording, detects stance and negation, deduplicates by viewer, applies room-relative thresholds and temporal stability, and surfaces only meaningful crowd moments:

- **CROWD VOICE FORMING…**
- **THE CROWD — GO LEFT**
- **CHAT IS DIVIDED**
- **CHAT NEEDS HELP**
- **CHAT WANTS: REMATCH**
- **CHAT JUST EXPLODED**
- **✓ YOU WERE HEARD**
- **RESOLVED — confusion ↓ X%**

A viewer who repeats the same choice many times still counts once. Phrases such as `left`, `go left`, `left looks safer`, and `right is a trap` can all support LEFT.

## Quick start

Requires **Node.js 22+**. The project has zero npm package dependencies.

```bash
npm run demo
# open http://127.0.0.1:7070/

npm test
```

Current verified test result: **101/101 automated tests passing**.

## Live Twitch setup

Copy `.env.example` to `.env` and set:

```text
TWITCH_CHANNEL=yourchannel
TWITCH_USERNAME=yourusername
TWITCH_OAUTH_TOKEN=your_read_only_token
```

Then:

```bash
npm run live:check
npm start
```

Open `http://127.0.0.1:7070/`. In live mode the control view shows **Chat (live from Twitch)**. The viewer-facing overlay is available at `/overlay` and the streamer panel at `/panel`.

Credentials remain server-side and `.env` is git-ignored.

## Architecture

```text
Twitch / replay / lab / demo
          ↓
      normalize
          ↓
 meaning grouping + stance / negation
          ↓
 one viewer, one voice
          ↓
 adaptive room threshold + time decay
          ↓
 integrity weighting + persistence
          ↓
 Crowd Voice state machine
          ↓
 overlay + streamer panel + HEARD/RESOLVED loop
```

The same deterministic `CrowdSense` engine processes live Twitch chat, replay logs, the typing lab and the offline demo.

## Evaluation

The benchmark report is included in `results/EVAL.md`. Validated simulated evaluation results:

| System | Decision accuracy |
|---|---:|
| Raw message count | 38.1% |
| Keyword matching | 44.2% |
| Semantic per-message | 73.1% |
| Semantic + one viewer, one voice | 75.0% |
| **Full CrowdSense** | **99.2%** |

Additional results:

- False Crowd Voices: **0.01/run**
- Spam resistance: **100%**
- Stance accuracy: **93.3%**
- Meaning grouping accuracy: **86.3%**
- Median measured confusion drop when resolved: **75%**
- Automated tests: **101/101 automated tests passing**

These evaluation scenarios are simulated and reproducible; they are not outcomes from a large real Twitch crowd. Real Twitch testing to date is a functional check with a handful of real accounts.

The original repository test file remains unchanged. `npm test` discovers every test file, including that suite, the reviewed tests, and six context regressions: **101/101 automated tests passing**. Run `npm run eval` to regenerate the full 20-seed report; `npm run eval:quick` uses five seeds. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

## Final Codex audit

OpenAI Codex was used for the final submission audit. In the verified local audit, Codex inspected the project, ran the automated tests and evaluation, checked the Twitch path and credential handling, and fixed submission-critical issues involving debug logging, reconnect shutdown, capability checks, Windows evaluation behavior, worker-seed consistency, and HTTP request handling.

The final audit reproduced the **99.2% simulated decision accuracy** and completed with **101/101 automated tests passing**. The local Twitch check confirmed messages reached the engine. Credentials must remain in local environment configuration and must never be committed or included in submission archives. No `.env` file is included in this clone.

## Important design choices

- **One viewer, one voice:** repeated messages from one account do not multiply influence.
- **Meaning + stance:** CrowdSense distinguishes support, opposition, negation and questions.
- **Temporal stability:** a Crowd Voice must persist rather than appearing from a short burst.
- **Adaptive thresholds:** the number of agreeing viewers required scales with active room size.
- **Integrity weighting:** flooding or suspicious synchronized bursts reduce confidence instead of silently banning people.
- **Context hint:** an optional hint such as `fork: left door / right door` can map phrases like “first door.” A matching hint preserves recent relevant live stances; a different choice starts fresh.
- **Transparent output:** the streamer can inspect aggregate reasons without exposing user IDs.

## Repository map

- `src/engine/` — CrowdSense core
- `src/live/` — Twitch reader and privacy helpers
- `src/sim/` — seeded demo/replay/evaluation scenarios
- `public/` — overlay, control view, streamer panel, lab
- `test/` — automated tests
- `results/` — benchmark report and machine-readable metrics
- `results/` — generated evaluation and test summaries
- `scripts/` — live check, test runner and capture helpers
- `docs/DEMO.md` — demo walkthrough

## Privacy and limits

- OAuth credentials stay in local environment variables.
- The live control view retains Twitch display names for functional verification; overlay state and explanations are aggregate-only. Stable numeric Twitch IDs remain server-side for deduplication.
- English-only rule-based stance can miss sarcasm and unusual phrasing.
- The included semantic representation is local and deterministic, not a neural sentence encoder.
- Manipulation resistance is partial; sophisticated coordinated behavior can still evade heuristics.

## Tagline

**When chat speaks together, streamers hear it.**
