import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const html = readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost:8765/',
  resources: undefined,               // don't fetch images
  pretendToBeVisual: true,
});
const w = dom.window;
w.fetch = () => Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve('{"status":"ok"}') });
const test = readFileSync('test.js','utf8');
let out;
try {
  out = w.eval(`(function(){ ${test} })()`);
} catch (e) {
  out = JSON.stringify([{t:'FAIL', n:'HARNESS THREW', d:String(e && e.stack || e)}]);
}
const rows = JSON.parse(out);
let pass=0, fail=0;
for (const r of rows) {
  if (r.t === 'PASS') { pass++; console.log(`  ✓ ${r.n}`); }
  else { fail++; console.log(`  ✗ ${r.n}${r.d ? '   -> ' + r.d : ''}`); }
}
console.log(`\n${pass} passed, ${fail} failed, ${rows.length} total`);
process.exit(fail ? 1 : 0);
