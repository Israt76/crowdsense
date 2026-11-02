# CrowdSense — Evaluation Results

The full benchmark was run on the submission build using 20 random seeds per scenario across 11 simulated chat scenarios. All evaluation chat is simulated with hand-written phrase banks; these are **not** results from a large real Twitch crowd.

## Baseline ladder

| System | Decision accuracy | False Crowd Voices / run | Spam resistance |
|---|---:|---:|---:|
| Raw message count | 38.1% | 0.22 | 0.0% |
| Keyword matching | 44.2% | 0.89 | 7.5% |
| Semantic meaning (+stance), per message | 73.1% | 0.42 | 50.0% |
| Semantic + one viewer, one voice | 75.0% | 0.28 | 87.5% |
| **Full CrowdSense** | **99.2%** | **0.01** | **100.0%** |

## Additional measurements

- Stance / negation accuracy: **93.3%** on 60 hand-labelled messages.
- Meaning grouping accuracy: **86.3%** on 80 held-out messages.
- Confusion detected before streamer response: **100%** of benchmark runs.
- RESOLVED precision: **95.2%**; recall: **100%**.
- Median measured confusion drop when RESOLVED: **75%**.
- REMATCH request detection: **100%** of benchmark runs.
- Automated repository verification: **48/48** passing.

## Interpretation

The benchmark shows why the layers matter: raw message counts are easy to hijack, while one-viewer-one-voice, stance/negation, room-relative thresholds, temporal persistence and integrity weighting together make the full system much more robust in the included simulated scenarios.

The evaluation is intentionally labelled as simulated. Real Twitch testing is a small functional check with a handful of real accounts, not a statistical validation on production-scale crowds.
