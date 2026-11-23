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
const P = { // line icons (24x24, stroke)
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  Morning: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  Afternoon: '<path d="M12 2v2m-7.07.93 1.41 1.41M20 12h2m-2.93-7.07-1.41 1.41M15.95 12.65a4 4 0 0 0-5.93-4.13"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  Evening: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  bed: '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  spark: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  thumbdown: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  feet: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/>',
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
};
const ic = (n, s = 18, w = 2) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;
const COLORS = ['#13294b', '#e0703a', '#0f8a7e', '#7c4dcc', '#d6457a', '#2f74c0'];
const color = name => COLORS[Math.max(0, S.travelers.findIndex(t => t.name === name)) % COLORS.length];
const initial = n => esc((String(n).trim()[0] || '?').toUpperCase());
const avatar = (name, cls = '', badge = '') => `<span class="avatar ${cls}" style="background:${color(name)}">${initial(name)}${badge}</span>`;
const badge = v => `<span class="badge ${v}">${v === 'a' ? ic('check', 9, 4) : v === 'r' ? ic('x', 9, 4) : ''}</span>`;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}
function toggleSheet(open) { $('phone').classList.toggle('sheet-open', open); }
function goBack() {
  if (generating || S.step <= 1) return;
  S.step--; S.pendingReject = null; render();
}
function autoGrow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } // text boxes grow to fit their text
function jumpDay(d) {
  S.openDays[d] = true; render();
  const el = document.getElementById('day-' + d), main = $('main'); // scroll only the content area, never the app frame
  if (el) main.scrollTo({ top: main.scrollTop + el.getBoundingClientRect().top - main.getBoundingClientRect().top - 58, behavior: 'smooth' });
}

// ---------- rendering ----------
function render() {
  $('apptitle').textContent = TITLES[S.step - 1];
  $('substep').textContent = `Step ${S.step} of 4`;
  $('back').style.visibility = S.step > 1 ? 'visible' : 'hidden';
  $('stepper').innerHTML = [1, 2, 3, 4].map(i => `<span class="${i < S.step ? 'done' : i === S.step ? 'on' : ''}"></span>`).join('');
  const keep = S.step === S.lastStep ? $('main').scrollTop : 0; // stay in place when re-rendering the same screen
  $('main').innerHTML = [step1, step2, step3, step4][S.step - 1]();
  $('actions').innerHTML = [foot1, foot2, foot3, foot4][S.step - 1]();
  document.querySelectorAll('#main textarea').forEach(autoGrow);
  $('main').scrollTop = keep; S.lastStep = S.step;
  const items = S.items.length;
  $('status').innerHTML = `Step ${S.step} of 4<br>Travelers: ${tvl().map(t => esc(t.name)).join(', ')}` +
    (items ? `<br>Itinerary round: ${S.round}<br>Items finalized: ${S.items.filter(i => i.final).length}/${items}` +
      (S.finalized ? `<br><b>FINALIZED in ${S.round} round(s)</b>` : '') : '');
}

function step1() {
  return `<div class="postcard">
    <svg class="route" width="170" height="120" viewBox="0 0 170 120" fill="none"><path d="M8 110 C 50 20, 110 120, 160 18" stroke="#fff" stroke-width="2" stroke-dasharray="5 7" stroke-linecap="round"/><circle cx="160" cy="18" r="5" fill="#f6b35c"/><circle cx="8" cy="110" r="4" fill="#fff"/></svg>
    <div class="kicker">${ic('plane', 14)} Group trip</div>
    <h2>Where's the group headed?</h2>
    <p>Tell us the basics. Everyone adds their own needs next, and Liaison plans one trip that works for all of you.</p></div>
  <div class="label" style="margin-top:0"><span>Your trip</span><button class="demo-btn" onclick="useTripExample()">${ic('spark', 14)} Use example</button></div>
  <textarea id="trip" placeholder="Destination, dates, budget and who's coming. e.g. 10 days in Italy with my family, about $4,000 each, early February" oninput="autoGrow(this)">${esc(S.tripText)}</textarea>`;
}
function foot1() { return `<button class="primary" onclick="submitTrip()">Continue</button>`; }
function submitTrip() {
  const v = $('trip').value.trim();
  if (!v) return toast('Describe your trip first.');
  S.tripText = v; S.summary = aiTripSummary(v);
  log('Trip described: ' + esc(v));
  S.step = 2; render();
}
function useTripExample() { const el = $('trip'); el.value = R.trip.exampleInput; autoGrow(el); }

function step2() {
  const s = S.summary;
  const stat = (i, k, v, wide = '') => `<div class="stat ${wide}">${ic(i, 17)}<div><div class="k">${k}</div><div class="v">${esc(v)}</div></div></div>`;
  const people = S.travelers.map(t => `<div class="person">${avatar(t.name)}
    <div class="grow"><b>${esc(t.name)}</b>${t.organizer ? '<div class="tiny muted">Organizer</div>' : t.email ? `<div class="tiny muted">${esc(t.email)}</div>` : ''}</div>
    ${t.accepted ? `<span class="pill ok">${ic('check', 12, 3)} Joined</span>` : '<span class="pill wait">Invited</span>'}</div>`).join('');
  return `<div class="tripcard"><div class="cover"><div class="tiny">${ic('pin', 13)} ${esc(s.destination)}</div><h3>Your trip at a glance</h3><p>${esc(s.blurb)}</p></div>
    <div class="stats">${stat('clock', 'Duration', s.duration)}${stat('cal', 'Dates', s.dates)}${stat('wallet', 'Budget', s.budget, 'wide')}${stat('users', 'Group', s.group, 'wide')}</div></div>
  <div class="label"><span>Invite your group</span></div>
  <div class="stack"><div class="inline"><div class="field-ic">${ic('mail', 18)}<input type="text" id="inv" inputmode="email" autocomplete="off" placeholder="Email, e.g. dad@example.com" value="${esc(S.inviteDraft)}"
    oninput="S.inviteDraft=this.value" onkeydown="if(event.key==='Enter')inviteEmail()"></div><button class="add-btn" onclick="inviteEmail()">Add</button></div>
  <button class="ghost" onclick="copyLink()">${ic('link', 17)} Share invite link</button>
  ${S.linkShown ? `<div class="card small" style="margin:10px 0 0">Invite link copied: <b>liaison.example/join/ITALY-7Q2X</b><div style="margin-top:10px"><button class="demo-btn" onclick="guestOpensLink()">${ic('spark', 14)} Demo: someone joins via the link</button></div></div>` : ''}</div>
  <div class="label"><span>Travelers</span><span>${tvl().length} joined</span></div><div class="card">${people}</div>`;
}
function foot2() {
  const ok = tvl().length > 1;
  return `${ok ? '' : '<div class="hint">Add at least one person to continue.</div>'}
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
  const tabs = ts.map((x, i) => `<button class="ptab ${i === S.active ? 'on' : ''}" onclick="S.active=${i};render()">${avatar(x.name, '', x.confirmed ? badge('a') : '')}${esc(x.name)}</button>`).join('');
  let body = `<div class="people-tabs">${tabs}</div>
  <div class="card" style="margin-top:8px">
    <h2 class="h2">${t.organizer ? 'Tell us about you' : `Hi ${esc(t.name)}, tell us about you`}</h2>
    <p class="lead">What you enjoy, how much you can walk, what you eat, any allergies and your budget, in your own words.</p>
    <textarea id="ptext" placeholder="e.g. I love food markets and history. I don't eat pork, and I need a rest after about 30 minutes of walking." oninput="t_text(this.value); autoGrow(this)">${esc(t.text)}</textarea>
    <div class="inline" style="margin-top:12px"><button class="ghost" style="flex:1" onclick="buildProfile()">${ic('spark', 16)} Build my profile</button>
    <button class="demo-btn" onclick="fillProfile()">${ic('spark', 14)} Fill example</button></div></div>`;
  if (t.profile) {
    const p = t.profile.profile;
    const icons = { Age: 'user', Interests: 'heart', Dislikes: 'thumbdown', Mobility: 'feet', Diet: 'food', Allergies: 'alert', Budget: 'wallet' };
    const attrs = ['Age', 'Interests', 'Dislikes', 'Mobility', 'Diet', 'Allergies', 'Budget'].map(f =>
      `<div class="attr"><span class="ai">${ic(icons[f], 16)}</span><div><div class="k">${f}</div>${p[f].length
        ? p[f].map(v => `<span class="chip ${p.hard.includes(v) ? 'hard' : ''}">${p.hard.includes(v) ? ic('lock', 11, 2.5) : ''}${esc(v)}</span>`).join('')
        : '<span class="unset">Not mentioned</span>'}</div></div>`).join('');
    const qs = t.profile.questions.map((q, i) => `<div class="card q-card"><div class="q">${ic('help', 17)}<span>${esc(q)}</span></div>
      <input type="text" placeholder="Your answer (optional)" value="${esc(t.answers[i] || '')}" oninput="S.travelers.filter(x=>x.accepted)[S.active].answers[${i}]=this.value"></div>`).join('');
    body += `<div class="label"><span>How Liaison understood you</span></div>
      <div class="card">${attrs}<div class="tiny muted" style="margin-top:8px;display:flex;gap:6px;align-items:center">${ic('lock', 12)} Red items are hard limits every plan must respect.</div></div>
      ${qs ? `<div class="label"><span>A couple of quick questions</span></div>${qs}` : ''}
      <button class="ghost ${t.confirmed ? 'done' : ''}" onclick="confirmProfile()" ${t.confirmed ? 'disabled' : ''}>${t.confirmed ? `${ic('check', 17, 2.5)} Profile confirmed` : 'Looks right, confirm profile'}</button>`;
  }
  return body;
}
function foot3() {
  const ts = tvl(), n = ts.filter(x => x.confirmed).length, all = n === ts.length;
  return `<div class="hint">${all ? 'Everyone has confirmed. Ready when you are.' : `${n} of ${ts.length} travelers confirmed`}</div>
  <button class="primary sun" onclick="generate()" ${all ? '' : 'disabled'}>${ic('spark', 18)} Generate itinerary</button>`;
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
  if (next >= 0) { S.active = next; toast(`${t.organizer ? 'Your profile is' : t.name + "'s profile is"} confirmed. Now ${tvl()[next].name}.`); }
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
  const agreed = S.items.filter(i => i.final).length, pct = S.items.length ? Math.round(100 * agreed / S.items.length) : 0;
  const decided = i => i.final || i.votes[me.name];
  const days = [...new Set(S.items.map(i => i.day))];
  let html = `<div class="summary"><div class="tiny">${ic('pin', 12)} ${esc(S.summary?.destination || 'Your trip')}</div>
    <h3>${days.length}-day group itinerary</h3>
    <div class="bar"><span style="width:${pct}%"></span></div>
    <div class="meta"><span>Round ${S.round}</span><span>${agreed} of ${S.items.length} agreed by everyone</span></div>
    ${hard.length ? `<div class="chips">${hard.map(h => `<span class="chip">${ic('lock', 11, 2.5)}${esc(h)}</span>`).join('')}</div>` : ''}</div>`;
  if (S.finalized) html += `<div class="callout success">${ic('check', 20, 2.5)}<div><b>Trip finalized!</b><br><span class="small">Everyone accepted every item after ${S.round} round(s).</span></div></div>`;
  else {
    html += S.check?.ran ? (S.check.flagged
        ? `<div class="callout warn">${ic('shield', 18)}<div><b>Safety check flagged ${S.check.flagged} item(s)</b> that may conflict with someone's food or mobility limits. Read the warnings before accepting.</div></div>`
        : `<div class="callout ok">${ic('shield', 18)}<div><b>Safety check found no conflicts.</b> It can still miss things, so check items against your own limits.</div></div>`)
      : S.check?.error ? `<div class="callout warn">${ic('alert', 18)}<div><b>Safety check didn't run</b>, so check every item against your own limits.</div></div>` : '';
    html += `<div class="label" style="margin-top:6px"><span>Voting as</span></div><div class="people-tabs">${ts.map((x, i) =>
      `<button class="ptab ${i === S.active ? 'on' : ''}" onclick="S.active=${i};S.pendingReject=null;render()">${avatar(x.name)}${esc(x.name)}</button>`).join('')}</div>`;
  }
  const firstOpen = days.find(d => S.items.some(i => i.day === d && !decided(i))) ?? days[0];
  html += `<div class="daychips">${days.map(d => {
    const its = S.items.filter(i => i.day === d), done = its.every(i => i.final), warn = its.some(i => i.warning);
    return `<button class="daychip ${done ? 'done' : ''}" onclick="jumpDay(${d})">${done ? ic('check', 12, 3) : ''}Day ${d}${warn && !done ? '<span class="dot"></span>' : ''}</button>`;
  }).join('')}</div>`;
  for (const d of days) {
    const its = S.items.filter(i => i.day === d), first = its[0];
    const warns = its.filter(i => i.warning).length, mine = its.filter(decided).length;
    const open = S.openDays[d] ?? d === firstOpen;
    html += `<details class="day" id="day-${d}" ${open ? 'open' : ''} ontoggle="S.openDays[${d}]=this.open">
      <summary><span class="daynum"><span><small>DAY</small><b>${d}</b></span></span>
        <div class="day-info"><div class="day-t">${esc(first.city)}</div>${first.hotel ? `<div class="day-h">${ic('bed', 13)} ${esc(first.hotel)}</div>` : `<div class="day-h">${its.length} stops</div>`}</div>
        <div class="day-meta">${warns ? `<span class="pill warn">${ic('alert', 12)} ${warns}</span>` : ''}<span class="pill">${mine}/${its.length}</span><span class="chev">${ic('chev', 18)}</span></div></summary>
      <div class="timeline">${its.map(it => itemCard(it, me, ts)).join('')}</div></details>`;
  }
  return html;
}
function itemCard(it, me, ts) {
  const mine = it.votes[me.name];
  const avs = ts.map(t => { const v = it.votes[t.name]; return avatar(t.name, 'sm', badge(v ? v.v : 'p')); }).join('');
  const ctl = it.final || S.finalized ? `<span class="agreed">${ic('check', 15, 2.5)} Everyone agreed</span>` : `<div class="vbtns">
    <button class="vbtn rej ${mine?.v === 'r' ? 'on' : ''}" onclick="startReject('${it.id}')" aria-label="Reject">${ic('x', 15, 2.5)} Reject</button>
    <button class="vbtn acc ${mine?.v === 'a' ? 'on' : ''}" onclick="vote('${it.id}','a')" aria-label="Accept">${ic('check', 15, 2.5)} Accept</button></div>`;
  return `<div class="tl-item ${it.final ? 'final' : ''}"><span class="tl-ic ${esc(it.slot)}">${ic(P[it.slot] ? it.slot : 'clock', 16)}</span>
    <div><div class="slot">${esc(it.slot)}</div><div class="txt">${esc(it.text)}</div>
    ${it.warning ? `<div class="warn">${ic('alert', 15)}<span><b>Check this:</b> ${esc(it.warning)}</span></div>` : ''}
    ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}
    <div class="vote-row"><div class="avatars">${avs}</div>${ctl}</div>
    ${S.pendingReject === it.id ? `<div class="inline reject-box"><input type="text" id="why" placeholder="Why doesn't this work for you?" value="${esc(S.reasonDraft)}"
      oninput="S.reasonDraft=this.value" onkeydown="if(event.key==='Enter')submitReject('${it.id}')"><button class="add-btn" onclick="submitReject('${it.id}')">Send</button></div>` : ''}</div></div>`;
}
function foot4() {
  const me = tvl()[S.active];
  if (S.finalized) return `<button class="primary" onclick="location.reload()">Plan another trip</button>`;
  const left = S.items.filter(i => !i.final && !i.votes[me.name]).length;
  return `<div class="hint">${left ? `${esc(me.name)}: ${left} item(s) left to decide` : `${esc(me.name)} is done. Switch traveler above to keep voting.`}</div>
  <button class="ghost" onclick="acceptAll()" ${left ? '' : 'disabled'}>${ic('spark', 16)} Demo: accept the rest as ${esc(me.name)}</button>`;
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
