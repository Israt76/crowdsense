// CrowdSense evaluation. Every number in results/ is produced by this file.
//   node eval/run-eval.js            (20 seeds per scenario, default)
//   SEEDS=50 node eval/run-eval.js
//   SEEDS=5 node eval/run-eval.js     (quick check, ~1/4 of the time)
//   EVAL_WORKERS=1 node eval/run-eval.js  (no worker threads)
// Fully deterministic: same code + same seeds = same numbers.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalize } from '../src/engine/normalize.js';
import { analyzeStance, parseHint } from '../src/engine/stance.js';
import { SemanticGrouper } from '../src/engine/semantics.js';
import { BASELINES, ABLATIONS, EngineSystem } from '../src/engine/baselines.js';
import { SCENARIOS, DECISION_SCENARIOS } from '../src/sim/scenarios.js';
import { runScenario, scoreDecision } from '../src/sim/harness.js';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SEEDS = Number(process.argv.find((arg) => arg.startsWith('--seeds='))?.slice(8) || process.env.SEEDS || 20);
const seeds = Array.from({ length: SEEDS }, (_, i) => 1000 + i);
const pct = (x) => (x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------- stance
function stanceLabel(r) {
  if (r.preference) return r.preference.toUpperCase();
  if (r.opposed.length === 1) return 'AGAINST_' + r.opposed[0].toUpperCase();
  return 'NONE';
}
function keywordStance(text, options) {
  const w = normalize(text).words;
  const hit = options.find((o) => w.includes(o));
  return hit ? hit.toUpperCase() : 'NONE';
}
function evalStance() {
  const data = JSON.parse(readFileSync(join(here, 'data/stance.json'), 'utf8'));
  const hint = parseHint(data.hint);
  const rows = [];
  let ok = 0;
  let okKw = 0;
  let okDir = 0;
  let okDirKw = 0;
  for (const [text, gold] of data.items) {
    const usesHint = /door/.test(text);
    const r = analyzeStance(normalize(text), { options: data.options, hint: usesHint ? hint : null });
    const pred = stanceLabel(r);
    const kw = keywordStance(text, data.options);
    // "direction" accuracy: which option does this message ultimately help?
    const dir = (l) => (l === 'LEFT' || l === 'AGAINST_RIGHT' ? 'L' : l === 'RIGHT' || l === 'AGAINST_LEFT' ? 'R' : 'N');
    if (pred === gold) ok++;
    if (kw === gold) okKw++;
    if (dir(pred) === dir(gold)) okDir++;
    if (dir(kw) === dir(gold)) okDirKw++;
    rows.push({ text, gold, pred, keyword: kw, correct: pred === gold });
  }
  const n = data.items.length;
  return {
    n,
    exactAccuracy: ok / n,
    keywordExactAccuracy: okKw / n,
    directionAccuracy: okDir / n,
    keywordDirectionAccuracy: okDirKw / n,
    failures: rows.filter((r) => !r.correct),
  };
}

// --------------------------------------------------------------- intents
function evalIntents() {
  const data = JSON.parse(readFileSync(join(here, 'data/intents.json'), 'utf8'));
  const labelOf = (key) => (key === 'request:rematch' ? 'rematch' : key === 'confused' ? 'confused' : key === 'hype' ? 'hype' : 'none');
  const out = {};
  for (const [name, enabled] of [['semantic', true], ['keyword', false]]) {
    const g = new SemanticGrouper({ enabled });
    const classes = ['rematch', 'confused', 'hype', 'none'];
    const tp = Object.fromEntries(classes.map((c) => [c, 0]));
    const fp = { ...tp };
    const fn = { ...tp };
    let correct = 0;
    const failures = [];
    for (const [text, gold] of data.items) {
      const pred = labelOf(g.classify(normalize(text)).key);
      if (pred === gold) { correct++; tp[gold]++; } else { fp[pred]++; fn[gold]++; failures.push({ text, gold, pred }); }
    }
    const f1 = {};
    for (const c of classes) {
      const p = tp[c] + fp[c] ? tp[c] / (tp[c] + fp[c]) : 0;
      const r = tp[c] + fn[c] ? tp[c] / (tp[c] + fn[c]) : 0;
      f1[c] = p + r ? (2 * p * r) / (p + r) : 0;
    }
    out[name] = {
      n: data.items.length,
      accuracy: correct / data.items.length,
      macroF1: (f1.rematch + f1.confused + f1.hype) / 3,
      f1,
      failures,
    };
  }
  return out;
}

// ------------------------------------------------------------- decisions
function evalSystem(makeSystem) {
  const perScenario = {};
  let checkpoints = 0;
  let correct = 0;
  let falseVoices = 0;
  let runs = 0;
  const latencies = [];
  let missed = 0;
  for (const name of DECISION_SCENARIOS) {
    const s = { checkpoints: 0, correct: 0, falseVoices: 0, runs: 0, latencies: [] };
    for (const seed of seeds) {
      const sc = SCENARIOS[name](seed);
      const sys = makeSystem(sc.hint);
      const tl = runScenario(sys, sc);
      const r = scoreDecision(sc, tl);
      s.checkpoints += r.checkpoints;
      s.correct += r.correct;
      s.falseVoices += r.falseVoices;
      s.runs++;
      s.latencies.push(...r.latencies);
      missed += r.missed;
    }
    perScenario[name] = { accuracy: s.correct / s.checkpoints, falseVoicesPerRun: s.falseVoices / s.runs, medianLatencyMs: median(s.latencies) };
    checkpoints += s.checkpoints;
    correct += s.correct;
    falseVoices += s.falseVoices;
    runs += s.runs;
    latencies.push(...s.latencies);
  }
  const spam = ['flood_attack', 'bot_swarm'];
  return {
    decisionAccuracy: correct / checkpoints,
    falseVoicesPerRun: falseVoices / runs,
    runsWithFalseVoice: null,
    medianLatencyMs: median(latencies),
    missedVoices: missed,
    spamResistance: spam.reduce((a, n) => a + perScenario[n].accuracy, 0) / spam.length,
    perScenario,
  };
}

function evalSignals(config) {
  const res = { confusionDetected: 0, confusionRuns: 0, resolvedTP: 0, resolvedFP: 0, resolvedFN: 0, resolvedTN: 0, drops: [], requestDetected: 0, requestRuns: 0, detectLatency: [] };
  for (const seed of seeds) {
    for (const name of ['confusion_resolved', 'confusion_persists']) {
      const sc = SCENARIOS[name](seed);
      const sys = new EngineSystem(config, sc.hint);
      let raised = false;
      let resolved = false;
      let firstConfusedTs = sc.messages.find((m) => /giveaway/i.test(m.text))?.ts ?? 0;
      runScenario(sys, sc, {
        onTick: (t, _o, s) => {
          for (const e of s.last.events) {
            if (e.type === 'SIGNAL' && e.key === 'confused' && !raised && t <= 30_000) { raised = true; res.detectLatency.push(t - firstConfusedTs); }
            if (e.type === 'RESOLVED' && e.key === 'confused') { resolved = true; res.drops.push(e.dropPct); }
          }
        },
      });
      res.confusionRuns++;
      if (raised) res.confusionDetected++;
      if (sc.expectResolved && resolved) res.resolvedTP++;
      if (sc.expectResolved && !resolved) res.resolvedFN++;
      if (!sc.expectResolved && resolved) res.resolvedFP++;
      if (!sc.expectResolved && !resolved) res.resolvedTN++;
    }
    const sc = SCENARIOS.rematch_request(seed);
    const sys = new EngineSystem(config, null);
    let got = false;
    runScenario(sys, sc, { onTick: (_t, _o, s) => { for (const e of s.last.events) if (e.type === 'SIGNAL' && e.key === 'request:rematch') got = true; } });
    res.requestRuns++;
    if (got) res.requestDetected++;
  }
  return {
    confusionDetectionRate: res.confusionDetected / res.confusionRuns,
    medianConfusionDetectLatencyMs: median(res.detectLatency),
    resolutionPrecision: res.resolvedTP + res.resolvedFP ? res.resolvedTP / (res.resolvedTP + res.resolvedFP) : null,
    resolutionRecall: res.resolvedTP / (res.resolvedTP + res.resolvedFN),
    falseResolutions: res.resolvedFP,
    resolutionRuns: { truly_resolved: res.resolvedTP + res.resolvedFN, still_confused: res.resolvedFP + res.resolvedTN },
    medianReportedDropPct: median(res.drops),
    requestDetectionRate: res.requestDetected / res.requestRuns,
  };
}

// ------------------------------------------------------------------- run
// Each system (5 ladder rungs + 7 ablation variants) is an independent job.
// Jobs run in parallel worker threads (EVAL_WORKERS, default = CPU count);
// results are identical to a sequential run because every job is seeded.
function runJob(job) {
  if (job.type === 'ladder') {
    const b = BASELINES[job.index];
    return { id: b.id, name: b.name, ...evalSystem(b.make) };
  }
  const a = ABLATIONS[job.index];
  return { id: a.id, name: a.name, ...evalSystem((hint) => new EngineSystem(a.config, hint)), signals: evalSignals(a.config) };
}

const JOBS = [
  ...BASELINES.map((b, index) => ({ type: 'ladder', index, label: b.name })),
  ...ABLATIONS.map((a, index) => ({ type: 'ablation', index, label: a.name })),
];

if (!isMainThread) {
  parentPort.postMessage(runJob(workerData));
} else {
  await main();
}

async function runAll(t0) {
  const workers = Math.max(1, Math.min(Number(process.env.EVAL_WORKERS || availableParallelism()), JOBS.length));
  const out = new Array(JOBS.length);
  let done = 0;
  const log = (i) => process.stderr.write(`[eval] ${++done}/${JOBS.length} ${JOBS[i].label} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
  if (workers === 1) {
    JOBS.forEach((job, i) => { out[i] = runJob(job); log(i); });
    return out;
  }
  let next = 0;
  const pending = new Set();
  await new Promise((resolve, reject) => {
    const launch = () => {
      if (next >= JOBS.length) { if (!pending.size) resolve(); return; }
      const i = next++;
      pending.add(i);
      const w = new Worker(new URL(import.meta.url), { workerData: JOBS[i], argv: process.argv.slice(2) });
      w.once('message', (r) => { out[i] = r; });
      w.once('error', reject);
      w.once('exit', (code) => {
        pending.delete(i);
        if (code !== 0 || !out[i]) return reject(new Error(`job "${JOBS[i].label}" failed (exit ${code})`));
        log(i);
        launch();
      });
    };
    for (let k = 0; k < workers; k++) launch();
  });
  return out;
}

async function main() {
const t0 = Date.now();
const timeoutS = Number(process.env.EVAL_TIMEOUT_S || 900);
const watchdog = setTimeout(() => {
  process.stderr.write(`[eval] stopped: exceeded EVAL_TIMEOUT_S=${timeoutS}s. Try SEEDS=5 or EVAL_WORKERS=1 and report the last job shown above.\n`);
  process.exit(2);
}, timeoutS * 1000);
watchdog.unref();
process.stderr.write(`[eval] ${JOBS.length} systems × ${DECISION_SCENARIOS.length} scenarios × ${SEEDS} seeds\n`);
const stance = evalStance();
const intents = evalIntents();
const all = await runAll(t0);
const ladder = all.slice(0, BASELINES.length);
const ablations = all.slice(BASELINES.length);
const results = {
  generatedBy: 'eval/run-eval.js',
  node: process.version,
  seedsPerScenario: SEEDS,
  seeds: [seeds[0], seeds.at(-1)],
  scenarios: DECISION_SCENARIOS,
  stance,
  intents,
  ladder,
  ablations,
  runtimeMs: Date.now() - t0,
};
mkdirSync(join(root, 'results'), { recursive: true });
writeFileSync(join(root, 'results/eval-results.json'), JSON.stringify(results, null, 2));

// ---------------------------------------------------------------- report
const L = [];
L.push('# CrowdSense — Evaluation Results', '');
L.push(`Generated by \`npm run eval\` (eval/run-eval.js). ${SEEDS} random seeds per scenario (${seeds[0]}–${seeds.at(-1)}), Node ${process.version}.`);
L.push('All chat in these scenarios is **simulated** with hand-written phrase banks (src/sim/phrases.js) — see Limitations in the README.', '');
L.push('## 1. Baseline ladder — what each layer fixes', '');
L.push('| System | Decision accuracy | False Crowd Voices / run | Median detection latency | Spam resistance |');
L.push('|---|---|---|---|---|');
for (const r of ladder) L.push(`| ${r.name} | ${pct(r.decisionAccuracy)} | ${r.falseVoicesPerRun.toFixed(2)} | ${r.medianLatencyMs == null ? '—' : (r.medianLatencyMs / 1000).toFixed(1) + ' s'} | ${pct(r.spamResistance)} |`);
L.push('', '### Accuracy per scenario', '');
L.push('| Scenario | ' + ladder.map((r) => r.id).join(' | ') + ' |');
L.push('|---|' + ladder.map(() => '---').join('|') + '|');
for (const s of DECISION_SCENARIOS) L.push(`| ${s} | ` + ladder.map((r) => pct(r.perScenario[s].accuracy)).join(' | ') + ' |');
L.push('', '## 2. Ablations — remove one component at a time', '');
L.push('| Variant | Decision accuracy | False Crowd Voices / run | Median latency | Spam resistance | Confusion detected | Resolution precision / recall | Request detected |');
L.push('|---|---|---|---|---|---|---|---|');
for (const a of ablations) {
  const s = a.signals;
  L.push(`| ${a.name} | ${pct(a.decisionAccuracy)} | ${a.falseVoicesPerRun.toFixed(2)} | ${a.medianLatencyMs == null ? '—' : (a.medianLatencyMs / 1000).toFixed(1) + ' s'} | ${pct(a.spamResistance)} | ${pct(s.confusionDetectionRate)} | ${pct(s.resolutionPrecision)} / ${pct(s.resolutionRecall)} | ${pct(s.requestDetectionRate)} |`);
}
L.push('', '### Ablation accuracy per scenario', '');
L.push('| Scenario | ' + ablations.map((r) => r.id).join(' | ') + ' |');
L.push('|---|' + ablations.map(() => '---').join('|') + '|');
for (const s of DECISION_SCENARIOS) L.push(`| ${s} | ` + ablations.map((r) => pct(r.perScenario[s].accuracy)).join(' | ') + ' |');
const full = ablations[0].signals;
L.push('', '## 3. Confusion, resolution and requests (full CrowdSense)', '');
L.push(`- Confusion detected (before the streamer answers): ${pct(full.confusionDetectionRate)} of ${seeds.length * 2} runs; median ${(full.medianConfusionDetectLatencyMs / 1000).toFixed(1)} s after the first confused message.`);
L.push(`- RESOLVED precision ${pct(full.resolutionPrecision)}, recall ${pct(full.resolutionRecall)} (${full.resolutionRuns.truly_resolved} runs where confusion really dropped, ${full.resolutionRuns.still_confused} where it continued; false RESOLVED: ${full.falseResolutions}).`);
L.push(`- Median reported drop when RESOLVED: ${full.medianReportedDropPct}% (measured, never hard-coded).`);
L.push(`- REMATCH request detected from varied wording: ${pct(full.requestDetectionRate)} of runs.`);
L.push('', '## 4. Stance and negation (hand-labelled, ' + stance.n + ' messages)', '');
L.push('| Method | Exact label accuracy | "Which option does it help" accuracy |');
L.push('|---|---|---|');
L.push(`| Keyword (any mention = support) | ${pct(stance.keywordExactAccuracy)} | ${pct(stance.keywordDirectionAccuracy)} |`);
L.push(`| CrowdSense stance parser | ${pct(stance.exactAccuracy)} | ${pct(stance.directionAccuracy)} |`);
L.push('', 'Known misses (kept in the test set on purpose):', '');
for (const f of stance.failures) L.push(`- \`${f.text}\` — expected ${f.gold}, got ${f.pred}`);
L.push('', '## 5. Meaning grouping (hand-labelled, ' + intents.semantic.n + ' messages, none in the prototype library)', '');
L.push('| Method | Accuracy | Macro-F1 (rematch / confused / hype) | F1 rematch | F1 confused | F1 hype |');
L.push('|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(intents)) L.push(`| ${k === 'semantic' ? 'Local embedding + prototypes' : 'Keyword lists'} | ${pct(v.accuracy)} | ${pct(v.macroF1)} | ${pct(v.f1.rematch)} | ${pct(v.f1.confused)} | ${pct(v.f1.hype)} |`);
L.push('', 'Misclassified by the embedding grouper:', '');
for (const f of intents.semantic.failures) L.push(`- \`${f.text}\` — expected ${f.gold}, got ${f.pred}`);
L.push('', `_Evaluation runtime: ${(results.runtimeMs / 1000).toFixed(1)} s._`, '');
writeFileSync(join(root, 'results/EVAL.md'), L.join('\n'));
console.log(L.join('\n'));
clearTimeout(watchdog);
}
