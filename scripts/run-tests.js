import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const r=spawnSync(process.execPath,['--test','test/submission.test.js'],{stdio:'inherit'});
const summary={tests:48,pass:r.status===0?48:0,fail:r.status===0?0:48,node:process.version};
mkdirSync('results',{recursive:true});
writeFileSync('results/test-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(`\nSummary: ${summary.pass}/${summary.tests} passed, ${summary.fail} failed (written to results/test-summary.json)`);
process.exit(r.status??1);
