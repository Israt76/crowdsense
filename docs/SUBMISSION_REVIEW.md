# Reconciled submission review - 2026-11-02

Work was confined to this Git clone. The reviewed directory was not copied over it again.

## Behavior and reconciliation

- Preserved GitHub's UI, live control chat feed with display names, one-viewer-one-voice logic, engine thresholds, meaning model, and existing test/submission.test.js.
- Restored GitHub implementations where the prior bulk copy introduced unrelated formatting, documentation, or presentation changes. Preserved video and Python-cache ignore rules.
- Context updates retain only recent, compatible viewer stances, including sticky stances that scrolled out of the message buffer. Different option sets or explicitly different topics clear prior decision stances. Reordered ordinal aliases cannot silently switch a viewer's vote. Expired stances cannot be revived.
- Fixed the malformed hint-splitting regex in GitHub's stance parser.
- Kept narrow HTTP URL/static-file protections, live-client membership requests and reconnect cancellation, the honest live-check failure on no messages, and environment-file ignore rules.
- Added reproducible evaluation inputs/runner and broad test discovery. Kept Windows quick-evaluation and worker-seed fixes.
- The demo now imports the same deterministic random generator as the scenario suite. This restores its complete intended sequence, including mind change, request, and empty ending, without changing decision thresholds or weakening a test.

## Validation

- Original repository test file preserved unchanged.
- Full discovered suite: **101/101 automated tests passing**, 8 test files: the original 48, reviewed 47, and 6 context regressions. No tests removed or weakened.
- Full evaluation: 12 systems, 11 decision scenarios, 20 seeds per scenario; **99.2% simulated decision accuracy**, **0.01 false voices/run**, **1.5 s median latency**, **100% simulated spam resistance**. Stance **93.3%**, meaning grouping **86.3%**. Reports regenerated in results/.
- Tracked and proposed additional files scanned for secret environment files, populated secret assignments, Twitch/OAuth/API/GitHub/AWS token signatures, and private keys. No secrets found; the README's your_read_only_token is an explicit placeholder. No local .env is present in this clone. The .env.example credential fields are empty.
- Prior real Twitch verification received 4 messages from 3 anonymous-read chatters into the engine; no new real-channel check was required for this reconciliation. Local protocol tests cover live input and server overlay state.

Submission excludes environment secrets, tokens, videos, and temporary Git review artifacts. Secret scanning detects known patterns and configuration assignments; it cannot prove absence of every possible secret.
