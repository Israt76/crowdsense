export function detectFlooders(voters, now, cfg) {
  const out = new Set();
  for (const v of voters.values()) {
    let n = 0;
    for (let i = v.msgTimes.length - 1; i >= 0 && now - v.msgTimes[i] <= cfg.floodWindowMs; i--) n++;
    if (n > cfg.floodMaxMsgs) out.add(v.id);
  }
  return out;
}

export function detectSyncBursts(counted, now, cfg) {
  const flagged = new Map();
  const byOption = new Map();
  for (const c of counted) {
    if (!byOption.has(c.option)) byOption.set(c.option, []);
    byOption.get(c.option).push(c);
  }
  for (const [option, list] of byOption) {
    const byText = new Map();
    for (const c of list) {
      if (!byText.has(c.text)) byText.set(c.text, []);
      byText.get(c.text).push(c);
    }
    for (const [, group] of byText) {
      if (group.length < cfg.syncMinAccounts) continue;
      group.sort((a, b) => a.t - b.t);
      let lo = 0;
      for (let hi = 0; hi < group.length; hi++) {
        while (group[hi].t - group[lo].t > cfg.syncWindowMs) lo++;
        const n = hi - lo + 1;
        if (n < cfg.syncMinAccounts) continue;
        const start = group[lo].t;
        const before = list.filter((c) => c.t < start && start - c.t <= cfg.syncLookbackMs).length;
        const expected = (before / cfg.syncLookbackMs) * cfg.syncWindowMs;
        if (n >= Math.max(cfg.syncMinAccounts, cfg.syncRateFactor * expected)) {
          if (!flagged.has(option)) flagged.set(option, { voters: new Set(), reason: 'synchronized identical messages' });
          for (let k = lo; k <= hi; k++) flagged.get(option).voters.add(group[k].voterId);
        }
      }
    }
    const firsts = list.filter((c) => c.firstMsg === true).sort((a, b) => a.t - b.t);
    if (firsts.length >= cfg.firstBurstMin) {
      let lo = 0;
      for (let hi = 0; hi < firsts.length; hi++) {
        while (firsts[hi].t - firsts[lo].t > cfg.firstBurstWindowMs) lo++;
        const n = hi - lo + 1;
        if (n >= cfg.firstBurstMin && n / list.length >= cfg.firstBurstShare) {
          if (!flagged.has(option)) flagged.set(option, { voters: new Set(), reason: 'burst of first-time chatters' });
          else flagged.get(option).reason += ' + first-time chatters';
          for (let k = lo; k <= hi; k++) flagged.get(option).voters.add(firsts[k].voterId);
        }
      }
    }
  }
  return flagged;
}
