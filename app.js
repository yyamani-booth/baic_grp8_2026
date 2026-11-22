// Liaison prototype. All "AI" output comes from simulated_responses.json.
// Swap the functions marked AI: with real calls later.

let R; // simulated responses
let CFG = { mode: 'simulated', model: '' }; // set from the backend (/api/config); 'real' = itinerary comes from Claude
const S = {
  step: 1, tripText: '', summary: null,
  travelers: [{ name: 'You', email: '', accepted: true, organizer: true, text: '', profile: null, answers: {}, confirmed: false }],
  active: 0, items: [], round: 1, finalized: false,
  pendingReject: null, reasonDraft: '', inviteDraft: '', linkShown: false, guests: 0, logLines: [], openDays: {}
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

// ---------- app shell (mobile app layout) ----------
const TITLES = ['Plan a trip', 'Invite your group', 'Traveler profiles', 'Your itinerary'];
const SLOT_ICON = { Morning: '☀️', Afternoon: '🌤️', Evening: '🌙' };
const initial = n => esc((String(n).trim()[0] || '?').toUpperCase());

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}
function toggleSheet(open) { $('phone').classList.toggle('sheet-open', open); }
function goBack() {
  if (generating || S.step <= 1) return;
  S.step--; S.pendingReject = null; render();
}
function jumpDay(d) {
  S.openDays[d] = true; render();
  const el = document.getElementById('day-' + d), main = $('main'); // scroll only the content area, never the app frame
  if (el) main.scrollTo({ top: main.scrollTop + el.getBoundingClientRect().top - main.getBoundingClientRect().top - 6, behavior: 'smooth' });
}

// ---------- rendering ----------
function render() {
  $('apptitle').textContent = TITLES[S.step - 1];
  $('back').style.visibility = S.step > 1 ? 'visible' : 'hidden';
  $('stepper').innerHTML = [1, 2, 3, 4].map(i => `<span class="${i < S.step ? 'done' : i === S.step ? 'on' : ''}"></span>`).join('');
  const keep = S.step === S.lastStep ? $('main').scrollTop : 0; // stay in place when re-rendering the same screen
  $('main').innerHTML = [step1, step2, step3, step4][S.step - 1]();
  $('actions').innerHTML = [foot1, foot2, foot3, foot4][S.step - 1]();
  $('main').scrollTop = keep; S.lastStep = S.step;
  const items = S.items.length;
  $('status').innerHTML = `Step ${S.step} of 4<br>Travelers: ${tvl().map(t => esc(t.name)).join(', ')}` +
    (items ? `<br>Itinerary round: ${S.round}<br>Items finalized: ${S.items.filter(i => i.final).length}/${items}` +
      (S.finalized ? `<br><b>FINALIZED in ${S.round} round(s)</b>` : '') : '');
}

function step1() {
  return `<div class="hero"><div class="hero-emoji">🧳</div><h2>Where's the group headed?</h2>
    <p class="muted">Destination, dates, budget and who's coming. Liaison turns it into one plan everyone can weigh in on.</p></div>
  <label class="label" for="trip">Your trip</label>
  <textarea id="trip" rows="4" placeholder="e.g. 10 days in Italy with my family, budget $4,000 each, early February">${esc(S.tripText)}</textarea>
  <button class="chip-btn" onclick="useTripExample()">✨ Use example</button>`;
}
function foot1() { return `<button class="primary" onclick="submitTrip()">Continue</button>`; }
function submitTrip() {
  const v = $('trip').value.trim();
  if (!v) return toast('Describe your trip first.');
  S.tripText = v; S.summary = aiTripSummary(v);
  log('Trip described: ' + esc(v));
  S.step = 2; render();
}
function useTripExample() { $('trip').value = R.trip.exampleInput; }

function step2() {
  const s = S.summary;
  const rows = [['📍', 'Destination', s.destination], ['⏱️', 'Duration', s.duration], ['🗓️', 'Dates', s.dates], ['💰', 'Budget', s.budget], ['👥', 'Group', s.group]]
    .map(([i, l, v]) => `<div class="kv"><span class="kv-i">${i}</span><div><div class="kv-l">${l}</div>${esc(v)}</div></div>`).join('');
  const people = S.travelers.map(t => `<div class="person"><span class="avatar">${initial(t.name)}</span>
    <div class="grow"><b>${esc(t.name)}</b>${t.organizer ? ' <span class="muted small">· organizer</span>' : ''}</div>
    ${t.accepted ? '<span class="pill ok">Joined</span>' : '<span class="pill wait">Invited…</span>'}</div>`).join('');
  return `<div class="card"><div class="card-title">Trip summary</div><p class="muted small" style="margin:6px 0 0">${esc(s.blurb)}</p>${rows}</div>
  <span class="label">Invite your group</span>
  <div class="inline"><input type="text" id="inv" inputmode="email" autocomplete="off" placeholder="Email, e.g. dad@example.com" value="${esc(S.inviteDraft)}"
    oninput="S.inviteDraft=this.value" onkeydown="if(event.key==='Enter')inviteEmail()"><button class="small-primary" onclick="inviteEmail()">Add</button></div>
  <button class="secondary" onclick="copyLink()">🔗 Share invite link</button>
  ${S.linkShown ? `<div class="card small" style="margin-top:10px">Link copied: <code>liaison.example/join/ITALY-7Q2X</code><br>
    <button class="chip-btn" onclick="guestOpensLink()">✨ Demo: someone joins via the link</button></div>` : ''}
  <span class="label">Travelers</span><div class="card">${people}</div>`;
}
function foot2() {
  const ok = tvl().length > 1;
  return `${ok ? '' : '<div class="hint">Add at least one person. In this demo, invites are accepted automatically.</div>'}
  <button class="primary" onclick="toStep3()" ${ok ? '' : 'disabled'}>Continue to profiles</button>`;
}
function inviteEmail() {
  const e = S.inviteDraft.trim();
  if (!/^\S+@\S+\.\S+$/.test(e)) return toast('Enter a valid email address.');
  addInvitee(e.split('@')[0].replace(/^./, c => c.toUpperCase()), e); S.inviteDraft = ''; render();
}
function addInvitee(name, email) {
  const t = { name, email, accepted: false, text: '', profile: null, answers: {}, confirmed: false };
  S.travelers.push(t); log(`Invited ${esc(name)}`);
  setTimeout(() => { t.accepted = true; log(`${esc(name)} accepted the invitation`); if (S.step === 2) render(); }, 1200);
}
function copyLink() { S.linkShown = true; navigator.clipboard?.writeText('https://liaison.example/join/ITALY-7Q2X'); log('Invite link copied'); render(); toast('Invite link copied'); }
function guestOpensLink() { addInvitee('Guest ' + (++S.guests), ''); render(); }
function toStep3() { S.active = 0; S.step = 3; render(); }

function step3() {
  const ts = tvl(), t = ts[S.active];
  const tabs = ts.map((x, i) => `<button class="seg ${i === S.active ? 'on' : ''}" onclick="S.active=${i};render()">${esc(x.name)}${x.confirmed ? ' ✓' : ''}</button>`).join('');
  let body = `<div class="demo-note">Demo: you're playing every traveler. Switch person here.</div><div class="segs">${tabs}</div>
  <h2 class="h2">${t.organizer ? 'Tell us about you' : `Hi ${esc(t.name)}, tell us about you`}</h2>
  <p class="muted small" style="margin:0 0 10px">Interests, age, how much you can walk, diet, allergies and budget, in your own words.</p>
  <textarea id="ptext" rows="4" placeholder="e.g. I love food markets, I don't eat pork, and I need a rest after 30 minutes of walking…" oninput="t_text(this.value)">${esc(t.text)}</textarea>
  <div class="inline"><button class="secondary grow" onclick="buildProfile()">Build my profile</button>
  <button class="chip-btn" onclick="fillProfile()">✨ Fill example</button></div>`;
  if (t.profile) {
    const p = t.profile.profile;
    const fields = ['Age', 'Interests', 'Dislikes', 'Mobility', 'Diet', 'Allergies', 'Budget'].map(f =>
      `<div class="field"><b>${f}</b><div>${p[f].length ? p[f].map(v => `<span class="chip ${p.hard.includes(v) ? 'hard' : ''}">${esc(v)}</span>`).join('') : '<i class="muted">not specified</i>'}</div></div>`).join('');
    const qs = t.profile.questions.map((q, i) => `<div class="card q-card small"><b>⚠ Quick question:</b> ${esc(q)}
      <input type="text" placeholder="Your answer (optional)" value="${esc(t.answers[i] || '')}" oninput="S.travelers.filter(x=>x.accepted)[S.active].answers[${i}]=this.value"></div>`).join('');
    body += `<span class="label">How Liaison understood you</span><div class="card">${fields}
      <p class="muted small" style="margin:8px 0 0">Red = hard limits the itinerary must respect.</p></div>${qs}
      <button class="secondary" onclick="confirmProfile()" ${t.confirmed ? 'disabled' : ''}>${t.confirmed ? 'Profile confirmed ✓' : 'Looks right, confirm profile'}</button>`;
  }
  return body;
}
function foot3() {
  const ts = tvl(), n = ts.filter(x => x.confirmed).length, all = n === ts.length;
  return `<div class="hint">${all ? 'Everyone has confirmed. Ready when you are.' : `${n} of ${ts.length} profiles confirmed`}</div>
  <button class="primary" onclick="generate()" ${all ? '' : 'disabled'}>✨ Generate itinerary</button>`;
}
function t_text(v) { const t = tvl()[S.active]; t.text = v; t.confirmed = false; }
function fillProfile() {
  const t = tvl()[S.active], ex = R.profile.examples;
  t.text = t.organizer ? ex.organizer : (ex[t.name.toLowerCase()] || ex.default); render();
}
function buildProfile() {
  const t = tvl()[S.active];
  if (!t.text.trim()) return toast('Write a few words about yourself first.');
  t.profile = aiParseProfile(t.text); t.answers = {}; t.confirmed = false;
  log(`${esc(t.name)} profile built; hard constraints: ${esc(t.profile.profile.hard.join(', ') || 'none')}` +
    (t.profile.questions.length ? `; ${t.profile.questions.length} ambiguity flag(s)` : ''));
  render();
}
function confirmProfile() {
  const t = tvl()[S.active];
  Object.entries(t.answers).filter(([, a]) => a.trim()).forEach(([i, a]) => log(`${esc(t.name)} clarified "${esc(t.profile.questions[i])}" → ${esc(a)}`));
  t.confirmed = true; log(`${esc(t.name)} confirmed profile`);
  const next = tvl().findIndex(x => !x.confirmed);
  if (next >= 0) { S.active = next; toast(`${t.name} confirmed. Now ${tvl()[next].name}.`); }
  render();
}
let generating = false;
async function generate() {
  if (generating) return;
  generating = true; log(CFG.mode === 'real' ? `Asking ${esc(CFG.model)} to generate the itinerary…` : 'Generating simulated itinerary…');
  const btn = document.querySelector('button[onclick="generate()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating… (can take up to a minute)'; }
  document.body.classList.add('is-busy');
  try {
    S.items = await aiGenerateItinerary(); S.round = 1; S.active = 0; S.step = 4; S.finalized = false; S.openDays = {};
    log(`Itinerary generated (round 1, ${CFG.mode === 'real' ? 'real AI: ' + esc(CFG.model) : 'simulated'})`);
  } catch (e) {
    log('ERROR generating itinerary: ' + esc(e.message), 'rej'); toast('Itinerary generation failed. Please try again.');
  }
  document.body.classList.remove('is-busy');
  generating = false; render();
}

function step4() {
  const ts = tvl(), me = ts[S.active];
  const hard = [...new Set(ts.flatMap(t => t.profile.profile.hard))];
  const agreed = S.items.filter(i => i.final).length;
  const decided = i => i.final || i.votes[me.name];
  let html = '';
  if (S.finalized) html += `<div class="card success">🎉 <b>Trip finalized!</b><br><span class="small">Everyone accepted every item after ${S.round} round(s).</span></div>`;
  else {
    html += `<div class="card"><div class="row-between"><div class="card-title">Round ${S.round}</div><span class="muted small">${agreed}/${S.items.length} agreed by everyone</span></div>
      <div class="bar"><span style="width:${S.items.length ? Math.round(100 * agreed / S.items.length) : 0}%"></span></div>
      ${hard.length ? `<div class="muted small" style="margin:10px 0 2px">Respecting everyone's limits</div>${hard.map(h => `<span class="chip hard">${esc(h)}</span>`).join('')}` : ''}</div>`;
    html += S.check?.ran ? `<div class="card ${S.check.flagged ? 'warn-card' : 'ok-card'}">${S.check.flagged
        ? `⚠ <b>Safety check flagged ${S.check.flagged} item(s)</b> that may conflict with someone's food or mobility limits. Read the warnings before accepting.`
        : '✓ Safety check found no conflicts. It can still miss things, so check items against your own limits.'}</div>`
      : S.check?.error ? `<div class="card warn-card">⚠ <b>Safety check didn't run</b>, so check every item against your own limits.</div>` : '';
    html += `<span class="label" style="margin-top:4px">Voting as</span><div class="segs">${ts.map((x, i) =>
      `<button class="seg ${i === S.active ? 'on' : ''}" onclick="S.active=${i};S.pendingReject=null;render()">${esc(x.name)}</button>`).join('')}</div>`;
  }
  const days = [...new Set(S.items.map(i => i.day))];
  const firstOpen = (days.find(d => S.items.some(i => i.day === d && !decided(i))) ?? days[0]);
  html += `<div class="daychips">${days.map(d => {
    const its = S.items.filter(i => i.day === d);
    const cls = its.every(i => i.final) ? 'done' : its.some(i => i.warning) ? 'w' : '';
    return `<button class="daychip ${cls}" onclick="jumpDay(${d})">Day ${d}${cls === 'w' ? ' ⚠' : cls === 'done' ? ' ✓' : ''}</button>`;
  }).join('')}</div>`;
  for (const d of days) {
    const its = S.items.filter(i => i.day === d), first = its[0];
    const warns = its.filter(i => i.warning).length, mine = its.filter(decided).length;
    const open = S.openDays[d] ?? d === firstOpen;
    html += `<details class="day" id="day-${d}" ${open ? 'open' : ''} ontoggle="S.openDays[${d}]=this.open">
      <summary><div><div class="day-t">Day ${d} · ${esc(first.city)}</div>${first.hotel ? `<div class="muted small">🏨 ${esc(first.hotel)}</div>` : ''}</div>
      <div class="day-meta">${warns ? `<span class="pill warnp">⚠ ${warns}</span>` : ''}<span class="pill">${mine}/${its.length}</span><span class="chev">›</span></div></summary>
      ${its.map(it => itemCard(it, me, ts)).join('')}</details>`;
  }
  return html;
}
function itemCard(it, me, ts) {
  const mine = it.votes[me.name];
  const votes = ts.map(t => { const v = it.votes[t.name];
    return `<span class="vote ${v ? (v.v === 'a' ? 'a' : 'r') : ''}">${esc(t.name)}<i>${v ? (v.v === 'a' ? '✓' : '✗') : '…'}</i></span>`; }).join('');
  const ctl = it.final || S.finalized ? '<div class="agreed">✓ Everyone agreed</div>' : `<div class="vote-btns">
    <button class="acc-btn ${mine?.v === 'a' ? 'on' : ''}" onclick="vote('${it.id}','a')">✓ Accept</button>
    <button class="rej-btn ${mine?.v === 'r' ? 'on' : ''}" onclick="startReject('${it.id}')">✗ Reject</button></div>`;
  return `<div class="item ${it.final ? 'final' : ''}"><div class="slot">${SLOT_ICON[it.slot] || '•'} ${esc(it.slot)}</div>
    <div class="txt">${esc(it.text)}</div>
    ${it.warning ? `<div class="warn">⚠ <b>Check this:</b> ${esc(it.warning)}</div>` : ''}
    ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}
    <div class="votes">${votes}</div>${ctl}
    ${S.pendingReject === it.id ? `<div class="inline"><input type="text" id="why" placeholder="Why doesn't this work for you?" value="${esc(S.reasonDraft)}"
      oninput="S.reasonDraft=this.value" onkeydown="if(event.key==='Enter')submitReject('${it.id}')"><button class="small-primary" onclick="submitReject('${it.id}')">Send</button></div>` : ''}</div>`;
}
function foot4() {
  const me = tvl()[S.active];
  if (S.finalized) return `<button class="primary" onclick="location.reload()">Plan another trip</button>`;
  const left = S.items.filter(i => !i.final && !i.votes[me.name]).length;
  return `<div class="hint">${left ? `${esc(me.name)}: ${left} item(s) left to decide` : `${esc(me.name)} is done. Switch person above to keep voting.`}</div>
  <button class="secondary" style="margin-top:0" onclick="acceptAll()" ${left ? '' : 'disabled'}>✨ Demo: accept the rest as ${esc(me.name)}</button>`;
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
  if (!S.reasonDraft.trim()) return toast('Add a short reason so the group knows why.');
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
  else { S.round++; log(`Round ${S.round}: ${rejected} revised item(s) need new votes`); toast(`${rejected} item(s) revised. Round ${S.round}: everyone votes again on those.`); }
}

fetch('/api/config').then(r => r.ok ? r.json() : null).catch(() => null).then(c => {
  if (c && !new URLSearchParams(location.search).has('sim')) CFG = c; // add ?sim=1 to the URL to force simulated responses
  return fetch('simulated_responses.json');
}).then(r => r.json()).then(j => {
  R = j; $('mode').textContent = CFG.mode === 'real' ? `itinerary: real AI (${CFG.model}); other steps simulated` : 'prototype: simulated AI';
  render(); log('Prototype ready (' + (CFG.mode === 'real' ? 'real AI itinerary' : 'simulated') + ')'); })
  .catch(() => { $('main').innerHTML = '<b>Could not load the prototype files.</b> Run <code>python3 server.py</code> in this folder and open http://localhost:8000.'; });
