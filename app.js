// Liaison prototype. All "AI" output comes from simulated_responses.json.
// Swap the functions marked AI: with real calls later.

let R; // simulated responses
let CFG = { mode: 'simulated', model: '' }; // set from the backend (/api/config); 'real' = itinerary comes from Claude
const S = {
  step: 1, tripText: '', summary: null,
  travelers: [{ name: 'You', email: '', accepted: true, organizer: true, text: '', profile: null, answers: {}, confirmed: false }],
  active: 0, items: [], round: 1, finalized: false,
  pendingReject: null, reasonDraft: '', inviteDraft: '', linkShown: false, guests: 0, logLines: []
};
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tvl = () => S.travelers.filter(t => t.accepted);

function log(msg, cls = '') {
  S.logLines.push(`<div class="${cls}">[${new Date().toLocaleTimeString()}] ${msg}</div>`);
  $('log').innerHTML = S.logLines.join('');
  $('log').scrollTop = 1e9;
  if (CFG.mode === 'real') fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') }) }).catch(() => {});
}

// ---------- AI (simulated) ----------
function aiTripSummary(text) { // AI: Step 1 -> trip summary
  return new RegExp(R.trip.matchPattern, 'i').test(text) ? R.trip.summaryItaly : R.trip.summaryFallback;
}
function aiParseProfile(text) { // AI: free text -> structured profile + ambiguities
  const p = { Diet: [], Allergies: [], Mobility: [], Age: [], Budget: [], Interests: [], Dislikes: [], hard: [] };
  for (const r of R.profile.rules) {
    const m = text.match(new RegExp(r.pattern, 'i'));
    if (!m) continue;
    const v = r.value.replace('{1}', m[1] || '');
    if (!p[r.field].includes(v)) p[r.field].push(v);
    if (r.hard && !p.hard.includes(v)) p.hard.push(v);
  }
  const questions = R.profile.ambiguities.filter(a => a.pattern ? new RegExp(a.pattern, 'i').test(text) : !p[a.missing].length)
    .map(a => a.question);
  return { profile: p, questions };
}
async function aiGenerateItinerary() { // AI: trip + profiles -> full itinerary (REAL via backend when CFG.mode === 'real')
  const fresh = i => ({ ...i, note: '', votes: {}, final: false });
  if (CFG.mode !== 'real') {
    S.check = null; // the safety check only runs with the real AI
    return R.itinerary.days.flatMap(d => d.items.map(i => fresh({ ...i, day: d.day, city: d.city,
      hotel: [1, 4, 7].includes(d.day) ? R.itinerary.hotels[d.city] : '' })));
  }
  const payload = { trip: S.tripText, summary: S.summary, travelers: tvl().map(t => ({
    name: t.name, text: t.text, profile: t.profile.profile,
    clarifications: Object.entries(t.answers).filter(([, a]) => a.trim()).map(([i, a]) => ({ question: t.profile.questions[i], answer: a })) })) };
  const r = await fetch('/api/itinerary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({ error: 'Bad response from backend' }));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  S.check = j.check || null; // Lab 8 fix: result of the safety check step
  if (S.check?.ran) log(`Safety check flagged ${S.check.flagged} item(s)`, S.check.flagged ? 'rej' : 'acc');
  else if (S.check?.error) log('Safety check did not run: ' + esc(S.check.error), 'rej');
  return j.items.map(fresh);
}
function aiRevise(item, reasons) { // AI: resolve rejections with an updated item
  const text = reasons.join(' ').toLowerCase();
  const cat = R.itinerary.reasonCategories.find(c => c.keywords.some(k => text.includes(k)));
  const rep = item.replacements && ((cat && item.replacements[cat.id]) || item.replacements.default);
  const reason = reasons.join('; ');
  const newText = rep || R.itinerary.genericReplacement.replace('{item}', item.text).replace('{reason}', reason);
  return { text: newText, note: R.itinerary.revisionNote.replace('{item}', item.text).replace('{reason}', reason), replacements: null };
}

// ---------- rendering ----------
function render() {
  const labels = ['1 Trip', '2 Invite', '3 Profiles', '4 Itinerary'];
  $('stepper').innerHTML = labels.map((l, i) => `<span class="${S.step === i + 1 ? 'on' : ''}">${l}</span>`).join('');
  $('main').innerHTML = [step1, step2, step3, step4][S.step - 1]();
  const items = S.items.length;
  $('status').innerHTML = `Step ${S.step} of 4<br>Travelers: ${tvl().map(t => t.name).join(', ')}` +
    (items ? `<br>Itinerary round: ${S.round}<br>Items finalized: ${S.items.filter(i => i.final).length}/${items}` +
      (S.finalized ? `<br><b>FINALIZED in ${S.round} round(s)</b>` : '') : '');
}

function step1() {
  return `<h2>Step 1: Describe your trip</h2>
  <p>Tell Liaison about the trip (destination, dates, budget, who's coming). Press Enter to continue.</p>
  <input type="text" id="trip" placeholder="e.g. 10 day trip to Italy with family, budget $4,000, early February" value="${esc(S.tripText)}">
  <div class="row"><button onclick="submitTrip()">Continue</button>
  <button class="sec" onclick="useTripExample()">Use example input</button></div>`;
}
function submitTrip() {
  const v = $('trip').value.trim();
  if (!v) return alert('Please describe your trip first.');
  S.tripText = v; S.summary = aiTripSummary(v);
  log('Trip described: ' + esc(v));
  S.step = 2; render();
}
function useTripExample() { $('trip').value = R.trip.exampleInput; }

function step2() {
  const s = S.summary;
  const rows = S.travelers.map(t => `<li>${esc(t.name)}${t.organizer ? ' (organizer)' : ''} ${t.accepted ? '<span class="ok">accepted</span>' : '<i>invited, pending…</i>'}</li>`).join('');
  return `<h2>Step 2: Trip summary and invitations</h2>
  <div class="card"><p>${esc(s.blurb)}</p><ul>
  <li><b>Destination:</b> ${esc(s.destination)}</li><li><b>Duration:</b> ${esc(s.duration)}</li><li><b>Dates:</b> ${esc(s.dates)}</li>
  <li><b>Budget:</b> ${esc(s.budget)}</li><li><b>Group:</b> ${esc(s.group)}</li></ul></div>
  <h3>Invite others</h3>
  <div class="row"><input type="text" id="inv" style="width:300px" placeholder="email, e.g. dad@example.com" value="${esc(S.inviteDraft)}" oninput="S.inviteDraft=this.value">
  <button onclick="inviteEmail()">Add by email</button>
  <button class="sec" onclick="copyLink()">Copy invite link</button></div>
  ${S.linkShown ? `<div class="card small">Link copied: <code>https://liaison.example/join/ITALY-7Q2X</code><br>
  <button class="sec" onclick="guestOpensLink()">Simulate: someone opens the link and accepts</button></div>` : ''}
  <h3>Travelers</h3><ul>${rows}</ul>
  <div class="row"><button onclick="toStep3()" ${tvl().length > 1 ? '' : 'disabled'}>Continue to traveler profiles</button>
  <span class="small">${tvl().length > 1 ? '' : 'Waiting for at least one invitee to accept. Invitations are auto-accepted a moment after sending.'}</span></div>`;
}
function inviteEmail() {
  const e = S.inviteDraft.trim();
  if (!/^\S+@\S+\.\S+$/.test(e)) return alert('Enter a valid email address.');
  addInvitee(e.split('@')[0].replace(/^./, c => c.toUpperCase()), e); S.inviteDraft = ''; render();
}
function addInvitee(name, email) {
  const t = { name, email, accepted: false, text: '', profile: null, answers: {}, confirmed: false };
  S.travelers.push(t); log(`Invited ${esc(name)}`);
  setTimeout(() => { t.accepted = true; log(`${esc(name)} accepted the invitation`); if (S.step === 2) render(); }, 1200);
}
function copyLink() { S.linkShown = true; navigator.clipboard?.writeText('https://liaison.example/join/ITALY-7Q2X'); log('Invite link copied'); render(); }
function guestOpensLink() { addInvitee('Guest ' + (++S.guests), ''); render(); }
function toStep3() { S.active = 0; S.step = 3; render(); }

function step3() {
  const ts = tvl(), t = ts[S.active];
  const tabs = ts.map((x, i) => `<button class="${i === S.active ? 'active' : ''}" onclick="S.active=${i};render()">${esc(x.name)} ${x.confirmed ? '✓' : ''}</button>`).join('');
  let body = `<p>You are filling in as <b>${esc(t.name)}</b>. Describe interests, age, mobility, diet, allergies, and budget in your own words.</p>
  <textarea id="ptext" placeholder="Tell us about yourself…" oninput="t_text(this.value)">${esc(t.text)}</textarea>
  <div class="row"><button onclick="buildProfile()">Build my profile</button>
  <button class="sec" onclick="fillProfile()">Fill example text</button></div>`;
  if (t.profile) {
    const p = t.profile.profile;
    const fields = ['Age', 'Interests', 'Dislikes', 'Mobility', 'Diet', 'Allergies', 'Budget'].map(f =>
      `<div><b>${f}:</b> ${p[f].length ? p[f].map(v => `<span class="chip ${p.hard.includes(v) ? 'hard' : ''}">${esc(v)}</span>`).join('') : '<i class="small">not specified</i>'}</div>`).join('');
    const qs = t.profile.questions.map((q, i) => `<div class="card"><b>⚠ Needs clarification:</b> ${esc(q)}
      <input type="text" placeholder="Your answer (optional)" value="${esc(t.answers[i] || '')}" oninput="S.travelers.filter(x=>x.accepted)[S.active].answers[${i}]=this.value"></div>`).join('');
    body += `<div class="card"><h3 style="margin-top:0">Structured profile</h3>${fields}
      <p class="small">Red chips are hard constraints the itinerary must respect.</p></div>${qs}
      <button onclick="confirmProfile()" ${t.confirmed ? 'disabled' : ''}>${t.confirmed ? 'Profile confirmed ✓' : 'Confirm profile'}</button>`;
  }
  const all = ts.every(x => x.confirmed);
  return `<h2>Step 3: Traveler profiles</h2>
  <p class="small">Prototype note: use the tabs to act as each traveler.</p><div class="tabs">${tabs}</div>${body}
  <hr><button onclick="generate()" ${all ? '' : 'disabled'}>Generate itinerary</button>
  <span class="small">${all ? '' : 'All travelers must confirm their profiles first.'}</span>`;
}
function t_text(v) { const t = tvl()[S.active]; t.text = v; t.confirmed = false; }
function fillProfile() {
  const t = tvl()[S.active], ex = R.profile.examples;
  t.text = t.organizer ? ex.organizer : (ex[t.name.toLowerCase()] || ex.default); render();
}
function buildProfile() {
  const t = tvl()[S.active];
  if (!t.text.trim()) return alert('Please enter some details first.');
  t.profile = aiParseProfile(t.text); t.answers = {}; t.confirmed = false;
  log(`${esc(t.name)} profile built; hard constraints: ${esc(t.profile.profile.hard.join(', ') || 'none')}` +
    (t.profile.questions.length ? `; ${t.profile.questions.length} ambiguity flag(s)` : ''));
  render();
}
function confirmProfile() {
  const t = tvl()[S.active];
  Object.entries(t.answers).filter(([, a]) => a.trim()).forEach(([i, a]) => log(`${esc(t.name)} clarified "${esc(t.profile.questions[i])}" → ${esc(a)}`));
  t.confirmed = true; log(`${esc(t.name)} confirmed profile`);
  const next = tvl().findIndex(x => !x.confirmed); if (next >= 0) S.active = next;
  render();
}
let generating = false;
async function generate() {
  if (generating) return;
  generating = true; log(CFG.mode === 'real' ? `Asking ${esc(CFG.model)} to generate the itinerary…` : 'Generating simulated itinerary…');
  const btn = document.querySelector('button[onclick="generate()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating… (can take up to a minute)'; }
  try {
    S.items = await aiGenerateItinerary(); S.round = 1; S.active = 0; S.step = 4; S.finalized = false;
    log(`Itinerary generated (round 1, ${CFG.mode === 'real' ? 'real AI: ' + esc(CFG.model) : 'simulated'})`);
  } catch (e) {
    log('ERROR generating itinerary: ' + esc(e.message), 'rej'); alert('Itinerary generation failed:\n' + e.message);
  }
  generating = false; render();
}

function step4() {
  const ts = tvl(), me = ts[S.active];
  const tabs = ts.map((x, i) => `<button class="${i === S.active ? 'active' : ''}" onclick="S.active=${i};S.pendingReject=null;render()">${esc(x.name)}</button>`).join('');
  const hard = [...new Set(ts.flatMap(t => t.profile.profile.hard))];
  let html = `<h2>Step 4: Generated itinerary (round ${S.round})</h2>`;
  if (S.finalized) html += `<div class="card ok">🎉 Everyone accepted. Itinerary finalized after ${S.round} round(s).</div>`;
  else html += `<p class="small">Hard constraints respected: ${hard.map(h => `<span class="chip hard">${esc(h)}</span>`).join('')}</p>
  ${S.check?.ran ? `<div class="card ${S.check.flagged ? 'warnbox' : ''}">${S.check.flagged
      ? `⚠ <b>Safety check flagged ${S.check.flagged} item(s)</b> that may conflict with someone's food or mobility limits. Read the warnings before accepting.`
      : '✓ Safety check found no conflicts. It can still miss things, so check items against your own limits.'}</div>`
    : S.check?.error ? `<div class="card warnbox">⚠ <b>Safety check didn't run</b>, so check every item against your own limits.</div>` : ''}
  <p>Voting as:</p><div class="tabs">${tabs}</div>
  <div class="row"><button class="sec" onclick="acceptAll()">Demo shortcut: ${esc(me.name)} accepts all undecided items</button></div>`;
  let day = 0;
  for (const it of S.items) {
    if (it.day !== day) { day = it.day; html += `<div class="day"><h3>Day ${day}: ${esc(it.city)}${it.hotel ? ` at ${esc(it.hotel)}` : ''}</h3></div>`; }
    const mine = it.votes[me.name];
    const status = ts.map(t => { const v = it.votes[t.name]; return `${esc(t.name)}: ${v ? (v.v === 'a' ? '<span class="acc">✓</span>' : '<span class="rej">✗</span>') : '…'}`; }).join(' · ');
    const ctl = it.final || S.finalized ? '<span class="ok">✓ all</span>' : `
      <button class="sec" ${mine?.v === 'a' ? 'style="background:#cfe9d6"' : ''} onclick="vote('${it.id}','a')">✓</button>
      <button class="sec" ${mine?.v === 'r' ? 'style="background:#f5cfcb"' : ''} onclick="startReject('${it.id}')">✗</button>`;
    html += `<div class="item ${it.final ? 'final' : ''}"><div class="txt"><span class="slot">${it.slot}:</span> ${esc(it.text)}
      ${it.warning ? `<div class="warn">⚠ Check this: ${esc(it.warning)}</div>` : ''}
      ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}<div class="votes">${status}</div>
      ${S.pendingReject === it.id ? `<div class="row"><input type="text" id="why" style="flex:1" placeholder="Why are you rejecting this?" value="${esc(S.reasonDraft)}" oninput="S.reasonDraft=this.value" onkeydown="if(event.key==='Enter')submitReject('${it.id}')">
        <button onclick="submitReject('${it.id}')">Submit</button></div>` : ''}</div><div>${ctl}</div></div>`;
  }
  return html;
}
function item(id) { return S.items.find(i => i.id === id); }
function me() { return tvl()[S.active]; }
function vote(id, v, reason = '') {
  const it = item(id); it.votes[me().name] = { v, reason }; S.pendingReject = null; S.reasonDraft = '';
  log(`${esc(me().name)} ${v === 'a' ? 'ACCEPTED' : 'REJECTED'} "${esc(it.text)}"${reason ? ` — reason: "${esc(reason)}"` : ''}`, v === 'a' ? 'acc' : 'rej');
  checkRound(); render();
}
function startReject(id) { S.pendingReject = id; S.reasonDraft = ''; render(); $('why')?.focus(); }
function submitReject(id) {
  if (!S.reasonDraft.trim()) return alert('Please give a short reason.');
  vote(id, 'r', S.reasonDraft.trim());
}
function acceptAll() {
  S.items.filter(i => !i.final && !i.votes[me().name]).forEach(i => {
    i.votes[me().name] = { v: 'a', reason: '' }; log(`${esc(me().name)} ACCEPTED "${esc(i.text)}"`, 'acc');
  });
  checkRound(); render();
}
function checkRound() {
  const ts = tvl(), open = S.items.filter(i => !i.final);
  if (!open.every(i => ts.every(t => i.votes[t.name]))) return;
  let rejected = 0;
  for (const it of open) {
    const rej = ts.filter(t => it.votes[t.name].v === 'r');
    if (!rej.length) { it.final = true; continue; }
    rejected++;
    const rev = aiRevise(it, rej.map(t => it.votes[t.name].reason));
    log(`AI revised "${esc(it.text)}" → "${esc(rev.text)}"`);
    Object.assign(it, rev, { votes: {}, warning: '' }); // revised text was not checked, so drop the old warning
  }
  if (!rejected) { S.finalized = true; log(`ITINERARY FINALIZED after ${S.round} round(s)`, 'ok'); }
  else { S.round++; log(`Round ${S.round}: ${rejected} revised item(s) need new votes`); }
}

fetch('/api/config').then(r => r.ok ? r.json() : null).catch(() => null).then(c => {
  if (c && !new URLSearchParams(location.search).has('sim')) CFG = c; // add ?sim=1 to the URL to force simulated responses
  return fetch('simulated_responses.json');
}).then(r => r.json()).then(j => {
  R = j; $('mode').textContent = CFG.mode === 'real' ? `itinerary: real AI (${CFG.model}); other steps simulated` : 'prototype: simulated AI';
  render(); log('Prototype ready (' + (CFG.mode === 'real' ? 'real AI itinerary' : 'simulated') + ')'); })
  .catch(() => { $('main').innerHTML = '<b>Could not load the prototype files.</b> Run <code>python3 server.py</code> in this folder and open http://localhost:8000.'; });
