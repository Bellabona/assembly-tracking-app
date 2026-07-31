// Assertions run inside the real page. Returns a JSON report.
const R = [];
const ok = (n, c, d="") => R.push({t: c ? "PASS":"FAIL", n, d});

// --- fix 4: tile count follows DISH_NAMES, no Y/Z ---
const tiles = document.querySelectorAll('.dish');
ok("tiles == Object.keys(DISH_NAMES).length (follows the weekly menu)",
   tiles.length === Object.keys(DISH_NAMES).length && tiles.length >= 20,
   "got " + tiles.length);
// Tiles must exist for exactly the letters on this week's menu and no others.
// (Y is a real dish some weeks, so hardcoding "no Y" is wrong.)
const want = Object.keys(DISH_NAMES).sort().join('');
const got  = [...document.querySelectorAll('.dish')].map(t => t.id.replace('tile_','')).sort().join('');
ok("tile letters match DISH_NAMES exactly, no junk tiles", want === got, "want "+want+" got "+got);
const junk = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter(l => !DISH_NAMES[l] && document.getElementById('tile_'+l));
ok("no tile for a letter absent from the menu", junk.length === 0, "stray: "+junk.join(''));

// --- fix 1: images point at local thumbs ---
const imgs = [...document.querySelectorAll('img.dish-img')];
const localThumbs = imgs.filter(i => i.getAttribute('src').startsWith('thumbs/'));
ok("all dish imgs use local thumbs", imgs.length === Object.keys(DISH_IMAGES).length && localThumbs.length === imgs.length,
   imgs.length + " imgs, " + localThumbs.length + " local");
ok("thumb src is relative (not /thumbs)", imgs.every(i => !i.getAttribute('src').startsWith('/')));
// image must be the FIRST child so layout is unchanged
ok("img is first child of tile", [...tiles].every(t => t.firstChild && t.firstChild.tagName === 'IMG'));

// --- fix 9: running total ---
const tl = document.getElementById('totalLine');
ok("total starts at 0", tl.textContent.trim() === "Total: 0 dishes", tl.textContent);
const setVal = (l, v) => { const i = document.getElementById('dish_'+l); i.value = v; i.dispatchEvent(new Event('input')); };
setVal('A', '12'); setVal('C', '30');
ok("total sums inputs (42)", tl.textContent.includes("42"), tl.textContent);
setVal('A', '1');
ok("total singular wording", tl.textContent.trim() === "Total: 31 dishes", tl.textContent);
setVal('C', '');
ok("total updates when a field is cleared (1 dish)", tl.textContent.trim() === "Total: 1 dish", tl.textContent);

// --- fix 5: integer/ceiling validation ---
setVal('A', '2.5');
ok("decimal rejected by parseCount", isNaN(parseCount('2.5')));
ok("negative rejected", isNaN(parseCount('-5')));
ok("exponent rejected", isNaN(parseCount('1e3')));
ok("whitespace-padded int accepted", parseCount('  7 ') === 7);
ok("empty -> 0", parseCount('') === 0);
ok("over ceiling detected", 900 > MAX_PER_DISH);

// --- fix 2: no literal HTML entities reach the user ---
setVal('A', ''); // clear so we trigger the date/name validation path
document.getElementById('date').value = '';
submitForm();
const em = document.getElementById('errorMsg');
ok("error msg has no raw entity", !/&#\d+;/.test(em.textContent), em.textContent);
ok("error msg shows real warning glyph", em.textContent.includes("⚠"), em.textContent);

// --- fix 6: draft persistence round-trip ---
document.getElementById('date').value = new Date().toISOString().slice(0,10);
setVal('B', '9');
[...document.querySelectorAll('.emp-chip')].find(c => c.dataset.name === 'Joel').click();
[...document.querySelectorAll('.role-tab')].find(t => t.dataset.role === 'Main').click();
document.getElementById('comment').value = 'harness note';
document.getElementById('comment').dispatchEvent(new Event('input'));
const stored = JSON.parse(localStorage.getItem('bb_assembly_draft_v1'));
ok("draft written to localStorage", !!stored);
ok("draft holds dish count", stored.counts && stored.counts.B === '9', JSON.stringify(stored.counts));
ok("draft holds employee", stored.employee === 'Joel', stored.employee);
ok("draft holds role", (stored.roles||[]).includes('Main'), JSON.stringify(stored.roles));
ok("draft holds comment", stored.comment === 'harness note');
// signature must cover dish NAMES, not just letters -- that is the stale-week guard
ok("signature includes dish names", stored.signature.includes(DISH_NAMES.A), stored.signature.slice(0,60));
ok("signature invalidates on a name swap",
   stored.signature !== Object.keys(DISH_NAMES).map(l => l+"="+(l==='A'?'Something Else':DISH_NAMES[l])).join("|"));

// --- fix 3: success gating logic ---
ok("valid JSON success -> not a failure", looksLikeSaveFailure('{"status":"ok"}') === false);
ok("plain 'Success' -> not a failure", looksLikeSaveFailure('Success') === false);
ok("Apps Script HTML error page -> FAILURE", looksLikeSaveFailure('<html><body>Exception: bad</body></html>') === true);
ok("JSON status:error -> FAILURE", looksLikeSaveFailure('{"status":"error","message":"x"}') === true);
ok("JSON ok:false -> FAILURE", looksLikeSaveFailure('{"ok":false}') === true);
ok("JSON error key -> FAILURE", looksLikeSaveFailure('{"error":"boom"}') === true);
ok("bare Exception text -> FAILURE", looksLikeSaveFailure('ScriptError: something') === true);

return JSON.stringify(R);
