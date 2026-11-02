// Nexora client — a small hash-routed SPA over the /api JSON endpoints.
import { BRAND_ICONS } from './brand-icons.js';

const $app = document.getElementById('app');

const state = {
  user: null,
  workspace: null,
  platforms: {},
  aiEnabled: false,
  brands: [],
  brandId: null,
  pendingCount: 0,
};

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    state.user = null;
    renderAuth();
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span aria-hidden="true">${isError ? '⚠️' : '✓'}</span><span>${esc(msg)}</span>`;
  el.className = `show ${isError ? 'err' : 'ok'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A short burst of colourful confetti from an element (or the screen centre). */
function celebrate(from) {
  if (reducedMotion()) return;
  const r = from?.getBoundingClientRect?.() || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  const colours = ['#0b7a75', '#e8664f', '#13213c', '#14958e'];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.background = colours[i % colours.length];
    document.body.append(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 140;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 60;
    p.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${x0 + dx}px, ${y0 + dy + 160}px) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => p.remove();
  }
}


/** Run an async action from a button: disables it and toasts errors. */
async function act(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

const fmtDateTime = (d) => d ? new Date(d).toLocaleString(undefined,
  { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const toLocalInput = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const STATUS_LABEL = { draft: 'Draft', pending: 'Awaiting approval', scheduled: 'Scheduled', published: 'Published', failed: 'Failed' };
const status = (s) => `<span class="status ${s}">${STATUS_LABEL[s] || s}</span>`;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const can = {
  edit: () => state.user && state.user.role !== 'viewer',
  admin: () => state.user && ['owner', 'admin'].includes(state.user.role),
  approve: () => state.user && state.user.can_approve,
};

const brand = () => state.brands.find((b) => b.id === state.brandId) || state.brands[0];
const channelById = (id) => state.brands.flatMap((b) => b.channels).find((c) => c.id === id);
const channelLabel = (c) => `${state.platforms[c.platform]?.label || c.platform} · @${c.handle}`;

/**
 * A network's official logo (from simple-icons), drawn in its brand colour and unaltered.
 * LinkedIn isn't in simple-icons (removed at LinkedIn's request), so it gets a text badge
 * in LinkedIn blue. Returns '' for keys that aren't networks.
 */
function netLogo(key, size = 20) {
  const icon = BRAND_ICONS[key];
  if (icon) {
    return `<svg class="net-logo" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${esc(icon.title)}"><path fill="${icon.hex}" d="${icon.path}"/></svg>`;
  }
  if (key === 'linkedin') return `<span class="net-logo li-badge" style="--s:${size}px" role="img" aria-label="LinkedIn">in</span>`;
  return '';
}
/** Channel chip: logo + "Network · @handle". */
const channelChip = (c) => `${netLogo(c.platform, 14)}${esc(channelLabel(c))}`;

/** Nexora mark: a teal tile with an N and a coral dot. */
const logo = () => `<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="10" fill="#0b7a75"/>
  <path d="M10 24V10l14 14V10" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="26.5" cy="7.5" r="3.5" fill="#e8664f"/></svg>`;

// ---------- boot ----------

async function boot() {
  const me = await api('/me');
  if (!me.user) return renderAuth();
  Object.assign(state, {
    user: me.user, workspace: me.workspace, platforms: me.platforms, aiEnabled: me.ai_enabled,
  });
  await loadBrands();
  route();
}

async function loadBrands() {
  state.brands = await api('/brands');
  const saved = Number(localStorage.getItem('cadence.brand'));
  state.brandId = state.brands.some((b) => b.id === saved) ? saved : state.brands[0]?.id;
}

/** Refresh sidebar and bell counts: posts awaiting approval, upcoming scheduled posts. */
async function refreshPendingCount() {
  try {
    const open = await api('/posts?status=pending,scheduled');
    const now = new Date();
    state.counts = {
      pending: open.filter((p) => p.status === 'pending').length,
      upcoming: open.filter((p) => p.status === 'scheduled' && new Date(p.scheduled_at) > now).length,
    };
    document.querySelectorAll('[data-count-key]').forEach((el) => { if (el.dataset.countKey) el.outerHTML = navCount(el.dataset.countKey); });
    const bell = document.querySelector('[data-bell]');
    if (bell) bell.textContent = state.counts.pending || '';
  } catch { /* non-critical */ }
}

// ---------- auth ----------

const ICON = {
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  team: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.1 6.1C3.5 7.9 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>',
};

/** Features shown on the sign-in page: only things Nexora actually does today. */
const AUTH_FEATURES = [
  ['✍️', 'Write', 'AI drafts in your own voice', 'var(--pink)'],
  ['✅', 'Approve', 'Compliance sign-off built in', 'var(--green)'],
  ['🗓️', 'Schedule', 'Calendar and posting queues', 'var(--violet)'],
  ['🎬', 'Upload', 'Phone video, checked per network', 'var(--orange)'],
  ['📈', 'Track', 'Output by week and network', 'var(--sky)'],
  ['👥', 'Team', 'Roles for officers and reviewers', 'var(--teal)'],
];

// Networks around the hub on the sign-in walkthrough (logos via netLogo).
const NETWORK_BADGES = ['instagram', 'facebook', 'x', 'linkedin', 'youtube', 'tiktok', 'threads', 'pinterest'];

/** The animated walkthrough: [tab label, title, caption, scene HTML]. Illustrations are drawn in HTML/CSS. */
const TOUR = [
  ['Connect', 'Set up your channels once',
    'Add each brand\'s accounts across eight networks. Character limits and format checks follow every post.',
    `<div class="sc-connect">
       <div class="hub">${NETWORK_BADGES.map((key, i) => `<span class="node" style="--i:${i}">${netLogo(key, 22)}<i>✓</i></span>`).join('')}
         <span class="core">${logo()}</span></div>
       <div class="sc-side"><div class="big">8<small>/8</small></div><div class="muted">networks ready to plan</div>
         <ul><li>🔒 One workspace per team or branch</li><li>🏷️ One brand per officer or office</li><li>📏 Limits checked as you type</li></ul></div>
     </div>`],
  ['Upload', 'Drop in a phone video',
    'MP4 or MOV straight from your phone. Nexora reads the shape and length and flags what each network needs.',
    `<div class="sc-upload">
       <div class="file"><div class="ficon">🎬</div><div class="grow"><strong>open-house-tour.mov</strong>
         <div class="muted small">0:24 · 9:16 · 48 MB</div><div class="pbar"><div></div></div></div></div>
       <div class="tags fade-in"><span class="tag ok">✓ Instagram</span><span class="tag ok">✓ TikTok</span><span class="tag ok">✓ YouTube</span>
         <span class="tag ok">✓ Facebook</span><span class="tag warn">! LinkedIn: vertical may be cropped</span></div>
     </div>`],
  ['Write', 'Let AI draft the caption',
    'Give a one-line brief. Get several distinct drafts in your brand voice, sized for the network.',
    `<div class="sc-write">
       <div class="brief">✨ <span class="type">Rates dipped this week. What it means for first-time buyers</span></div>
       <div class="d d1">Rates eased this week. If you've been waiting to buy your first home, let's run the numbers together.</div>
       <div class="d d2">Good news for first-time buyers: lower rates can mean a lower monthly payment. Questions? I'm one message away.</div>
       <div class="d d3">Thinking about your first home? This week's dip could change your budget. Here's how. 👇</div>
     </div>`],
  ['Approve', 'Get compliance sign-off',
    'Posts from officers go to a reviewer first. Every approval is recorded, and any later edit goes back for review.',
    `<div class="sc-approve">
       <div class="post"><div class="who"><span class="av">A</span><div><strong>Arjun · Loan Officer</strong><div class="muted small">Instagram · Thu 9:00 AM</div></div>
         <span class="pill p1">Awaiting approval</span><span class="pill p2">Approved ✓</span></div>
         <p>Rates eased this week. If you've been waiting to buy your first home, let's run the numbers together.</p></div>
       <div class="reviewer fade-in"><span class="av av2">M</span> Meera (Compliance) approved this post</div>
     </div>`],
  ['Schedule', 'Drop it on the calendar',
    'Use a weekly queue or pick a time. Drag posts between days to reschedule.',
    `<div class="sc-schedule">
       ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<div class="col"><span>${d}</span>
         ${i === 0 ? '<b class="chip-ev c1">9:00 Market update</b>' : ''}${i === 2 ? '<b class="chip-ev c2">3:00 Client win</b>' : ''}
         ${i === 4 ? '<b class="chip-ev c3">9:00 Q&amp;A video</b>' : ''}</div>`).join('')}
       <b class="chip-ev mover">9:00 Rate update</b>
     </div>`],
  ['Track', 'See what went out',
    'Weekly output, posts by network and the most active writers, for each brand.',
    `<div class="sc-track">
       <div class="tiles"><div><b>24</b><span>Published</span></div><div><b>6</b><span>Scheduled</span></div><div><b>2</b><span>Awaiting</span></div></div>
       <div class="mini-cols">${[30, 45, 38, 60, 52, 75, 68, 90].map((h, i) => `<i style="--h:${h}%;--d:${i * 60}ms"></i>`).join('')}</div>
     </div>`],
];

let tourTimer = null;
const stopTour = () => { clearInterval(tourTimer); tourTimer = null; };

function renderAuth(mode = 'login') {
  stopTour();
  const login = mode === 'login';
  $app.innerHTML = `
    <div class="login">
      <section class="login-hero">
        <div class="logo">${logo()} Nexora</div>
        <p class="eyebrow">Built for loan officers</p>
        <h1 class="headline">Post with confidence.<br><span class="grad-text">Stay compliant.</span></h1>
        <p class="lede">Turn a quick phone video into an approved, scheduled post on every network,
          with your compliance team's sign-off built into the workflow.</p>
        <div class="feature-grid">${AUTH_FEATURES.map(([icon, t, d, c]) => `
          <div class="feature" style="--c:${c}"><span class="fi" aria-hidden="true">${icon}</span><strong>${t}</strong><span>${d}</span></div>`).join('')}
        </div>
      </section>

      <section class="login-tour" aria-label="How Nexora works">
        <div class="tour-window">
          <div class="tour-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="addr">🔒 Nexora</span><span class="count" id="tour-count">1 / ${TOUR.length}</span></div>
          <div class="tour-stage">${TOUR.map(([, , , html], i) => `<div class="scene ${i === 0 ? 'active' : ''}" data-scene="${i}" aria-hidden="${i !== 0}">${html}</div>`).join('')}</div>
        </div>
        <div class="tour-text">
          <div class="grow"><p class="eyebrow" id="tour-step">Step 1</p><h2 id="tour-title">${TOUR[0][1]}</h2>
            <p class="muted" id="tour-caption">${TOUR[0][2]}</p></div>
          <button type="button" class="round" id="tour-toggle" aria-label="Pause walkthrough">${ICON.pause}</button>
        </div>
        <div class="tour-tabs" role="tablist">${TOUR.map(([label], i) => `
          <button type="button" role="tab" class="${i === 0 ? 'on' : ''}" data-step="${i}" aria-selected="${i === 0}"><span class="seg"><i></i></span>${label}</button>`).join('')}
        </div>
      </section>

      <section class="login-side">
        <form class="login-card" id="auth-form" novalidate>
          <div class="card-logo">${logo()}<span>Nexora</span></div>
          <h2>${login ? 'Welcome back' : 'Create your workspace'}</h2>
          <p class="muted">${login ? 'Sign in to your account to continue' : 'You\'ll be the owner. Invite your team next.'}</p>
          ${login ? '' : `
            <label class="ifield"><span class="sr">Workspace name</span>${ICON.team}
              <input name="workspace" required maxlength="80" placeholder="Workspace name (e.g. Riverside Branch)"></label>
            <label class="ifield"><span class="sr">Your name</span>${ICON.user}
              <input name="display_name" maxlength="80" autocomplete="name" placeholder="Your name"></label>`}
          <label class="ifield"><span class="sr">Username</span>${ICON.user}
            <input name="username" required autocomplete="username" placeholder="Username" autofocus></label>
          <label class="ifield"><span class="sr">Password</span>${ICON.lock}
            <input name="password" type="password" required placeholder="Password"
              autocomplete="${login ? 'current-password' : 'new-password'}" ${login ? '' : 'minlength="8"'}>
            <button type="button" class="peek" id="peek" aria-label="Show password" aria-pressed="false">${ICON.eye}</button></label>
          ${login ? `<div class="row between">
            <label class="check"><input type="checkbox" name="remember" checked> Keep me logged in</label>
            <button type="button" class="link" id="forgot">Forgot password?</button></div>
            <div class="note small" id="forgot-note" hidden>Password reset by email isn't available yet. Ask your workspace owner for help,
              or your Nexora administrator if you're the owner.</div>` : ''}
          <div class="error" id="auth-error" role="alert"></div>
          <button class="primary big">${login ? 'Log in' : 'Create workspace'} ${ICON.arrow}</button>
          <p class="switch muted small">${login ? 'New to Nexora?' : 'Already have an account?'}
            <button type="button" class="link" data-mode="${login ? 'register' : 'login'}">${login ? 'Create a workspace' : 'Sign in'}</button></p>
        </form>
      </section>
    </div>`;

  $app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => renderAuth(b.dataset.mode));
  const form = document.getElementById('auth-form');
  const pw = form.elements.namedItem('password');
  document.getElementById('peek').onclick = (e) => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    e.currentTarget.innerHTML = show ? ICON.eyeOff : ICON.eye;
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    e.currentTarget.setAttribute('aria-pressed', String(show));
  };
  document.getElementById('forgot')?.addEventListener('click', () => {
    const n = document.getElementById('forgot-note');
    n.hidden = !n.hidden;
  });
  startTour();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('auth-error');
    const missing = [...form.querySelectorAll('input[required]')].find((i) => !i.value.trim());
    if (missing) { err.textContent = `Enter your ${missing.placeholder.split(' (')[0].toLowerCase()}`; missing.focus(); return; }
    const body = Object.fromEntries(new FormData(form));
    if (login) body.remember = form.elements.namedItem('remember').checked;
    else body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const btn = form.querySelector('button.primary');
    btn.disabled = true;
    try {
      await api(login ? '/auth/login' : '/auth/register', { method: 'POST', body });
      stopTour();
      // replaceState avoids a hashchange (and a re-route) before the user has loaded.
      if (!location.hash) history.replaceState(null, '', '#/home');
      await boot();
    } catch (error) {
      err.textContent = error.message;
      form.classList.remove('shake');
      void form.offsetWidth; // restart the animation
      form.classList.add('shake');
    } finally {
      btn.disabled = false;
    }
  };
}

/** Auto-advancing walkthrough with pause/play and clickable steps. */
function startTour() {
  const STEP_MS = 5500;
  let step = 0;
  let playing = !reducedMotion();
  const tabs = [...document.querySelectorAll('.tour-tabs [data-step]')];
  const scenes = [...document.querySelectorAll('.scene')];
  const toggle = document.getElementById('tour-toggle');
  const show = (i) => {
    step = (i + TOUR.length) % TOUR.length;
    scenes.forEach((s, j) => { s.classList.toggle('active', j === step); s.setAttribute('aria-hidden', String(j !== step)); });
    tabs.forEach((t, j) => {
      t.classList.toggle('on', j === step);
      t.classList.toggle('done', j < step);
      t.setAttribute('aria-selected', String(j === step));
    });
    document.getElementById('tour-count').textContent = `${step + 1} / ${TOUR.length}`;
    document.getElementById('tour-step').textContent = `Step ${step + 1}`;
    document.getElementById('tour-title').textContent = TOUR[step][1];
    document.getElementById('tour-caption').textContent = TOUR[step][2];
    restart();
  };
  const restart = () => {
    clearInterval(tourTimer);
    document.querySelector('.login-tour')?.classList.toggle('paused', !playing);
    if (playing) tourTimer = setInterval(() => show(step + 1), STEP_MS);
  };
  tabs.forEach((t) => t.onclick = () => show(Number(t.dataset.step)));
  toggle.onclick = () => {
    playing = !playing;
    toggle.innerHTML = playing ? ICON.pause : ICON.play;
    toggle.setAttribute('aria-label', playing ? 'Pause walkthrough' : 'Play walkthrough');
    restart();
  };
  if (!playing) { toggle.innerHTML = ICON.play; toggle.setAttribute('aria-label', 'Play walkthrough'); }
  show(0);
}

// ---------- shell ----------

/** Line icons (24px grid, stroke = currentColor). */
const SVG = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const NAV_ICON = {
  home: SVG('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
  calendar: SVG('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  posts: SVG('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'),
  queue: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  media: SVG('<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10l5-3v10l-5-3"/>'),
  analytics: SVG('<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>'),
  brands: SVG('<path d="M3 12l9-9h7v7l-9 9z"/><circle cx="15.5" cy="8.5" r="1.5"/>'),
  team: SVG('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.8.7 3 2.6 3.5 5.5"/>'),
  settings: SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  writing: SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  loans: SVG('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>'),
  setup: SVG('<path d="M9 7V3M15 7V3"/><rect x="6" y="7" width="12" height="6" rx="2"/><path d="M12 13v3a4 4 0 0 1-4 4"/>'),
  links: SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  library: SVG('<path d="M4 4h5v16H4zM10 4h4v16h-4z"/><path d="M15.5 5.2l3.9-1 3.6 15.4-3.9 1z"/>'),
  reports: SVG('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 17v-3M12 17v-6M15 17v-4"/>'),
  search: SVG('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  bell: SVG('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  logout: SVG('<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
  plus: SVG('<path d="M12 5v14M5 12h14"/>'),
  chevron: SVG('<path d="M6 9l6 6 6-6"/>'),
  download: SVG('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
};

// [route, label, section, count key]
const NAV = [
  ['home', 'Home', 'Workspace'],
  ['calendar', 'Calendar', 'Workspace', 'upcoming'],
  ['posts', 'Posts', 'Workspace', 'pending'],
  ['writing', 'Content writing', 'Workspace'],
  ['queue', 'Queue', 'Workspace'],
  ['media', 'Media', 'Workspace'],
  ['library', 'Library', 'Workspace'],
  ['analytics', 'Analytics', 'Workspace'],
  ['reports', 'Reports', 'Workspace'],
  ['links', 'Link in bio', 'Workspace'],
  ['loans', 'Loan reminders', 'Workspace', null, () => state.workspace?.loans_enabled],
  ['brands', 'Brands & channels', 'Account'],
  ['team', 'Team', 'Account'],
  ['setup', 'Setup', 'Account'],
  ['settings', 'Settings', 'Account'],
];

// Initials from letter-led words only, so "Priya (Owner)" gives "P", not "P(".
const initials = (name = '?') => (name.match(/\p{L}[\p{L}'-]*/gu) || []).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const navCount = (key) => {
  const n = state.counts?.[key];
  return key && n ? `<span class="count ${key === 'pending' ? 'hot' : ''}" data-count-key="${key}">${n}</span>` : `<span data-count-key="${key || ''}"></span>`;
};

/**
 * Render the app frame around a page.
 * @param {string} active  nav key
 * @param {string} title
 * @param {string} actions  HTML for the page-head actions
 * @param {string} content  page HTML
 * @param {{eyebrow?: string, subtitle?: string, hero?: string}} [opts]
 */
function shell(active, title, actions, content, opts = {}) {
  const b = brand();
  const navItems = NAV.filter((n) => !n[4] || n[4]());
  const sections = [...new Set(navItems.map((n) => n[2]))];
  $app.innerHTML = `
    <div class="shell" id="shell">
      <header class="topbar">
        <button class="menu-btn icon-btn" id="menu" aria-label="Menu">☰</button>
        <a class="logo" href="#/home">${logo()}<span>Nexora</span></a>
        <button class="search" id="open-search" aria-label="Search (Ctrl K)">${NAV_ICON.search}
          <span class="grow">Search posts or pages…</span><span class="kbd">Ctrl K</span></button>
        <div class="top-actions">
          ${can.edit() ? `<button class="primary new-post" id="new-post" title="New post (N)">${NAV_ICON.plus}<span>New post</span></button>` : ''}
          <div class="menu-wrap">
            <button class="icon-btn" id="bell" aria-label="Notifications" aria-haspopup="true">${NAV_ICON.bell}
              <span class="bell-count" data-bell>${state.counts?.pending ? state.counts.pending : ''}</span></button>
            <div class="dropdown" id="bell-menu" hidden></div>
          </div>
          <div class="menu-wrap">
            <button class="user-btn" id="user-btn" aria-haspopup="true">
              <span class="avatar">${esc(initials(state.user.display_name))}</span>
              <span class="who"><strong>${esc(state.user.display_name)}</strong><small>${esc(state.user.role)}</small></span>${NAV_ICON.chevron}</button>
            <div class="dropdown" id="user-menu" hidden>
              <div class="dd-head"><strong>${esc(state.user.display_name)}</strong><span class="muted small">${esc(state.workspace.name)}</span></div>
              <a href="#/settings">${NAV_ICON.settings} Settings</a>
              <a href="#/team">${NAV_ICON.team} Team</a>
              <button type="button" data-logout>${NAV_ICON.logout} Sign out</button>
            </div>
          </div>
          <button class="ghost-btn" data-logout>${NAV_ICON.logout}<span>Log out</span></button>
        </div>
      </header>
      <aside class="side">
        <label class="brand-switch"><span class="side-label">Brand</span>
          <span class="brand-pick"><span class="dot" style="background:${esc(b?.color)}"></span>
          <select id="brand-select">${state.brands.map((x) =>
            `<option value="${x.id}" ${x.id === b?.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></span>
        </label>
        ${sections.map((s) => `<div class="side-label">${s}</div>
          <nav class="nav">${navItems.filter((n) => n[2] === s).map(([k, label, , countKey]) => `
            <a href="#/${k}" class="${k === active ? 'on' : ''}">${NAV_ICON[k]}<span class="grow">${label}</span>${navCount(countKey)}</a>`).join('')}
          </nav>`).join('')}
        <div class="side-foot small">Press <span class="kbd">N</span> for a new post · <span class="kbd">Ctrl K</span> to search</div>
      </aside>
      <main>
        <div class="page-head ${opts.hero ? 'with-hero' : ''}">
          <div class="titles">
            ${opts.eyebrow ? `<p class="eyebrow">${esc(opts.eyebrow)}</p>` : ''}
            <h1>${esc(title)}</h1>
            ${opts.subtitle ? `<p class="subtitle">${esc(opts.subtitle)}</p>` : ''}
          </div>
          ${opts.hero || ''}
          <div class="actions">${actions || ''}</div>
        </div>
        <div id="view">${content}</div>
      </main>
    </div>`;

  document.getElementById('brand-select').onchange = (e) => {
    state.brandId = Number(e.target.value);
    try { localStorage.setItem('cadence.brand', state.brandId); } catch { /* storage unavailable */ }
    route();
  };
  document.querySelectorAll('[data-logout]').forEach((btn) => btn.onclick = async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    state.user = null;
    renderAuth();
  });
  document.getElementById('new-post')?.addEventListener('click', () => { location.hash = '#/compose'; });
  document.getElementById('menu').onclick = () => document.getElementById('shell').classList.toggle('nav-open');
  document.getElementById('open-search').onclick = openPalette;
  bindDropdown('user-btn', 'user-menu');
  bindDropdown('bell', 'bell-menu', fillBellMenu);
}

/** Toggle a dropdown. Outside clicks and Escape close it (one global listener below). */
function bindDropdown(buttonId, menuId, onOpen) {
  const btn = document.getElementById(buttonId);
  const menu = document.getElementById(menuId);
  btn.onclick = (e) => {
    e.stopPropagation();
    const opening = menu.hidden;
    closeDropdowns();
    menu.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
    if (opening) onOpen?.(menu);
  };
}
function closeDropdowns(except) {
  document.querySelectorAll('.dropdown').forEach((d) => { if (d !== except) d.hidden = true; });
  document.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}
document.addEventListener('click', (e) => closeDropdowns(e.target.closest?.('.dropdown')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDropdowns(); });

async function fillBellMenu(menu) {
  menu.innerHTML = '<div class="dd-head"><strong>Notifications</strong></div><div class="muted small dd-pad">Loading…</div>';
  const [pending, failed] = await Promise.all([api('/posts?status=pending'), api('/posts?status=failed')]);
  const items = [
    ...failed.map((p) => ({ p, label: 'Failed to publish', cls: 'failed' })),
    ...pending.map((p) => ({ p, label: can.approve() ? 'Needs your approval' : 'Awaiting approval', cls: 'pending' })),
  ].slice(0, 6);
  menu.innerHTML = `<div class="dd-head"><strong>Notifications</strong><span class="muted small">${items.length ? `${pending.length + failed.length} open` : ''}</span></div>
    ${items.length ? items.map(({ p, label, cls }) => `<a href="#/compose/${p.id}" class="note-item"><span class="nd ${cls}"></span>
      <span class="grow"><strong>${label}</strong><span class="muted small clip">${esc(p.content.slice(0, 60)) || 'Untitled'}</span></span></a>`).join('')
    : '<div class="muted small dd-pad">You\'re all caught up.</div>'}
    <a href="#/posts" class="dd-foot">View all posts</a>`;
}

// ---------- search (Ctrl K) ----------

async function openPalette() {
  if (document.getElementById('palette')) return;
  const wrap = document.createElement('div');
  wrap.id = 'palette';
  wrap.innerHTML = `<div class="pal-box" role="dialog" aria-label="Search">
    <label class="pal-input">${NAV_ICON.search}<input id="pal-q" placeholder="Search posts or jump to a page…" autocomplete="off"><span class="kbd">Esc</span></label>
    <div class="pal-list" id="pal-list" role="listbox"></div></div>`;
  document.body.append(wrap);
  const q = document.getElementById('pal-q');
  const list = document.getElementById('pal-list');
  const close = () => wrap.remove();
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  q.focus();

  const pages = NAV.filter((n) => !n[4] || n[4]()).map(([k, label]) => ({ type: 'Page', label, href: `#/${k}`, icon: NAV_ICON[k] }));
  if (can.edit()) pages.unshift({ type: 'Action', label: 'New post', href: '#/compose', icon: NAV_ICON.plus });
  let posts = [];
  api('/posts').then((p) => { posts = p; render(); }).catch(() => {});
  let sel = 0;
  let results = [];
  const render = () => {
    const term = q.value.trim().toLowerCase();
    const pageHits = pages.filter((p) => !term || p.label.toLowerCase().includes(term));
    const postHits = term ? posts.filter((p) => p.content.toLowerCase().includes(term)).slice(0, 8)
      .map((p) => ({ type: STATUS_LABEL[p.status], label: p.content.slice(0, 80) || 'Untitled', href: `#/compose/${p.id}`, icon: NAV_ICON.posts, status: p.status })) : [];
    results = [...pageHits, ...postHits];
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.innerHTML = results.length ? results.map((r, i) => `<a href="${r.href}" class="pal-item ${i === sel ? 'sel' : ''}" role="option" aria-selected="${i === sel}">
      ${r.icon}<span class="grow clip">${esc(r.label)}</span><span class="pal-type ${r.status || ''}">${esc(r.type)}</span></a>`).join('')
      : '<div class="muted small dd-pad">No matches.</div>';
    list.querySelectorAll('.pal-item').forEach((a) => a.onclick = close);
  };
  q.oninput = () => { sel = 0; render(); };
  q.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && results[sel]) { location.hash = results[sel].href; close(); }
  };
  render();
}

// ---------- router ----------

const views = {};

function route() {
  if (!state.user) return renderAuth();
  const [, name = 'home', arg] = location.hash.replace(/^#/, '').split('/');
  const view = views[name] || views.home;
  Promise.resolve(view(arg)).catch((err) => toast(err.message, true));
  refreshPendingCount();
}
window.addEventListener('hashchange', route);

// Keyboard: N starts a new post, Ctrl/Cmd+K or / opens search (when not typing).
window.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === '/') { e.preventDefault(); openPalette(); } else if (e.key.toLowerCase() === 'n' && can.edit()) location.hash = '#/compose';
});

// ---------- home dashboard ----------

let homeRange = 30;
const DAY = 86400_000;

/** Daily counts of `dates` over the last `days` days (oldest first). */
function dailyCounts(dates, days, end = new Date()) {
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  const out = new Array(days).fill(0);
  for (const d of dates) {
    const i = Math.floor((new Date(d) - start) / DAY);
    if (i >= 0 && i < days) out[i] += 1;
  }
  return out;
}

/** Small area sparkline as inline SVG. */
function sparkline(values, colour) {
  const w = 240;
  const h = 48;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 4 - (v / max) * (h - 10)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const flat = values.every((v) => v === 0);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    ${flat ? `<path d="M0,${h - 4} H${w}" stroke="${colour}" stroke-dasharray="4 6" opacity=".45"/>` : `
    <path d="${line} L${w},${h} L0,${h} Z" fill="${colour}" opacity=".10" stroke="none"/>
    <path d="${line}" stroke="${colour}"/>`}</svg>`;
}

/** "+40%", "New", "−20%" or "No change" comparing two periods. */
function delta(now, before) {
  if (!before && !now) return { text: 'No change', cls: 'flat' };
  if (!before) return { text: 'New', cls: 'up' };
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: '0%', cls: 'flat' };
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, cls: pct > 0 ? 'up' : 'down' };
}

const relDuration = (ms) => {
  const m = Math.round(Math.abs(ms) / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m % 60}m`;
};

const HOME_HERO = `<div class="hero-art" aria-hidden="true">
  <svg viewBox="0 0 260 150">
    <path d="M10 120 C 60 120, 70 70, 120 78" stroke="var(--violet)" stroke-width="2" fill="none" stroke-dasharray="4 5" opacity=".5"/>
    <g class="float-a"><rect x="110" y="30" width="110" height="80" rx="16" fill="var(--violet)"/>
      <rect x="110" y="30" width="110" height="22" rx="16" fill="var(--ink)"/><rect x="110" y="44" width="110" height="8" fill="var(--ink)"/>
      <circle cx="132" cy="41" r="3" fill="var(--amber)"/><circle cx="142" cy="41" r="3" fill="#fff" opacity=".6"/>
      <rect x="124" y="64" width="20" height="14" rx="4" fill="#fff" opacity=".9"/><rect x="152" y="64" width="20" height="14" rx="4" fill="#fff" opacity=".35"/>
      <rect x="180" y="64" width="20" height="14" rx="4" fill="var(--amber)"/><rect x="124" y="86" width="20" height="14" rx="4" fill="#fff" opacity=".35"/>
      <rect x="152" y="86" width="20" height="14" rx="4" fill="#fff" opacity=".9"/></g>
    <g class="float-b"><rect x="196" y="6" width="46" height="46" rx="12" fill="#fff" stroke="var(--border)"/>
      <path d="M212 21 l12 8 -12 8z" fill="var(--violet)"/></g>
    <g class="float-c"><circle cx="104" cy="112" r="15" fill="var(--amber)"/><path d="M97 112 l5 5 9 -10" stroke="var(--ink)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
  </svg></div>`;

views.home = async () => {
  const b = brand();
  const posts = await api(`/posts?brand_id=${b.id}`);
  const now = new Date();
  const from = new Date(now - homeRange * DAY);
  const prevFrom = new Date(now - 2 * homeRange * DAY);
  const inRange = (d, a, z) => d && new Date(d) >= a && new Date(d) < z;

  const created = posts.filter((p) => inRange(p.created_at, from, now));
  const createdPrev = posts.filter((p) => inRange(p.created_at, prevFrom, from));
  const published = posts.filter((p) => p.status === 'published' && inRange(p.published_at, from, now));
  const publishedPrev = posts.filter((p) => p.status === 'published' && inRange(p.published_at, prevFrom, from));
  const pending = posts.filter((p) => p.status === 'pending');
  const scheduled = posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduled_at) > now);
  const drafts = posts.filter((p) => p.status === 'draft' || p.status === 'failed');

  const stats = [
    { key: 'created', icon: NAV_ICON.posts, n: created.length, label: 'Created', sub: 'Posts written', colour: 'var(--violet)',
      d: delta(created.length, createdPrev.length), series: dailyCounts(created.map((p) => p.created_at), homeRange) },
    { key: 'pending', icon: NAV_ICON.bell, n: pending.length, label: 'Awaiting approval', sub: 'Waiting for a reviewer', colour: 'var(--amber)',
      d: null, series: dailyCounts(pending.map((p) => p.updated_at), homeRange) },
    { key: 'scheduled', icon: NAV_ICON.calendar, n: scheduled.length, label: 'Scheduled', sub: 'Lined up to go out', colour: 'var(--violet)',
      d: null, series: dailyCounts(scheduled.map((p) => p.updated_at), homeRange) },
    { key: 'published', icon: NAV_ICON.home, n: published.length, label: 'Published', sub: 'Sent to your networks', colour: 'var(--ink)',
      d: delta(published.length, publishedPrev.length), series: dailyCounts(published.map((p) => p.published_at), homeRange) },
  ];

  const columns = [
    { key: 'draft', title: 'Drafts & failed', items: drafts, colour: 'var(--s-draft)', empty: 'No drafts. Start one with N.' },
    { key: 'pending', title: 'Awaiting approval', items: pending, colour: 'var(--amber)', empty: 'Nothing waiting for review.' },
    { key: 'scheduled', title: 'Scheduled', items: [...scheduled].sort((x, y) => new Date(x.scheduled_at) - new Date(y.scheduled_at)), colour: 'var(--violet)', empty: 'Nothing scheduled yet.' },
    { key: 'published', title: 'Published', items: published, colour: 'var(--ink)', empty: `Nothing published in the last ${homeRange} days.` },
  ];

  const card = (p) => {
    const due = p.scheduled_at && new Date(p.scheduled_at);
    const overdue = due && ['pending', 'scheduled'].includes(p.status) && due < now - 120_000;
    const m = p.media?.[0];
    return `<article class="pipe-card" data-open="${p.id}" tabindex="0">
      ${m ? `<div class="pc-media">${m.kind === 'video'
        ? `<video src="${esc(m.url)}#t=0.1" preload="metadata" muted playsinline></video><span class="pc-play">▶</span>`
        : `<img src="${esc(m.url)}" alt="" loading="lazy">`}</div>` : ''}
      <p class="pc-text">${esc(p.content) || '<em class="muted">Untitled draft</em>'}</p>
      <div class="pc-meta">${status(p.status)}<span class="muted small">by ${esc(p.author_name || 'former member')}</span></div>
      ${due ? `<div class="pc-due small">${NAV_ICON.calendar}${p.status === 'published' ? 'Published' : 'Due'} ${fmtDateTime(p.published_at || due)}</div>` : ''}
      ${overdue ? `<div class="pc-overdue small">⚠ Overdue by ${relDuration(now - due)}</div>` : ''}
      ${p.status === 'failed' ? `<div class="pc-overdue small">⚠ ${esc(p.review_note || 'Publishing failed')}</div>` : ''}
      <div class="pc-actions">
        ${p.status === 'pending' && can.approve() && !overdue ? `<button class="sm approve" data-approve="${p.id}">✓ Approve</button>` : ''}
        <button class="sm" data-open-btn="${p.id}">Open</button>
      </div>
    </article>`;
  };

  shell('home', 'Home', `
    <label class="range">${NAV_ICON.calendar}<select id="range" aria-label="Date range">
      ${[7, 30, 90].map((d) => `<option value="${d}" ${d === homeRange ? 'selected' : ''}>Last ${d} days</option>`).join('')}</select></label>
    <button id="export">${NAV_ICON.download} Export</button>
    ${can.edit() ? `<button class="primary" id="upload-media">${NAV_ICON.plus} Upload media</button>` : ''}`,
  `<div class="stat-grid">${stats.map((s) => `
      <div class="stat-card" style="--c:${s.colour}">
        <div class="stat-top"><span class="stat-icon">${s.icon}</span>
          ${s.d ? `<span class="stat-delta ${s.d.cls}"><strong>${s.d.cls === 'down' ? '↓' : s.d.cls === 'up' ? '↑' : '→'} ${s.d.text}</strong><small>vs previous ${homeRange} days</small></span>`
            : '<span class="stat-delta flat"><strong>Right now</strong><small>current total</small></span>'}</div>
        <div class="stat-n" data-count="${s.n}">${s.n}</div>
        <div class="stat-label">${s.label}</div><div class="muted small">${s.sub}</div>
        ${sparkline(s.series, s.colour)}
      </div>`).join('')}
    </div>
    <div class="pipeline">${columns.map((c) => `
      <section class="pipe-col" style="--c:${c.colour}">
        <header><span class="pipe-dot"></span><h2>${c.title}</h2><span class="pipe-count">${c.items.length}</span></header>
        <div class="pipe-list">${c.items.slice(0, 6).map(card).join('') || `<div class="pipe-empty">${c.empty}</div>`}</div>
        ${c.items.length > 6 ? `<a class="pipe-more" href="#/posts" data-filter="${c.key}">View all ${c.items.length}</a>` : ''}
      </section>`).join('')}
    </div>`,
  { eyebrow: 'Dashboard', subtitle: `What your team is creating, reviewing and publishing for ${b.name}`, hero: HOME_HERO });

  animateCharts();
  document.getElementById('range').onchange = (e) => { homeRange = Number(e.target.value); route(); };
  document.getElementById('upload-media')?.addEventListener('click', () => { location.hash = '#/media'; });
  document.querySelectorAll('[data-filter]').forEach((a) => a.onclick = () => { postFilter = a.dataset.filter; });
  const view = document.getElementById('view');
  view.addEventListener('click', (e) => {
    const approve = e.target.closest('[data-approve]');
    if (approve) {
      e.stopPropagation();
      act(approve, async () => {
        await api(`/posts/${approve.dataset.approve}/approve`, { method: 'POST', body: {} });
        toast('Approved and scheduled');
        celebrate(approve);
        route();
      });
      return;
    }
    const open = e.target.closest('[data-open-btn], [data-open]');
    if (open) location.hash = `#/compose/${open.dataset.openBtn || open.dataset.open}`;
  });
  view.addEventListener('keydown', (e) => {
    const c = e.target.closest('[data-open]');
    if (c && e.key === 'Enter') location.hash = `#/compose/${c.dataset.open}`;
  });
  document.getElementById('export').onclick = () => {
    const rows = posts.filter((p) => inRange(p.created_at, from, now) || inRange(p.scheduled_at, from, new Date(now.getTime() + 365 * DAY))
      || inRange(p.published_at, from, now));
    const csv = [['id', 'status', 'content', 'channels', 'scheduled_at', 'published_at', 'author', 'created_at'],
      ...rows.map((p) => [p.id, p.status, p.content, p.channel_ids.map((id) => channelById(id)).filter(Boolean).map(channelLabel).join('; '),
        p.scheduled_at || '', p.published_at || '', p.author_name || '', p.created_at])]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `cadence-${b.name.replace(/\W+/g, '-').toLowerCase()}-last-${homeRange}-days.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${rows.length} posts`);
  };
};

// ---------- calendar ----------

let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calView = (() => { try { return localStorage.getItem('cadence.calView') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } })();

const CAL_HERO = `<div class="hero-art" aria-hidden="true">
  <svg viewBox="0 0 260 150">
    <path d="M6 128 C 50 128, 70 88, 112 92" stroke="var(--violet)" stroke-width="2" fill="none" stroke-dasharray="4 5" opacity=".5"/>
    <circle cx="112" cy="92" r="4" fill="var(--violet)"/>
    <g class="float-a"><rect x="112" y="26" width="108" height="84" rx="18" fill="var(--violet)"/>
      <rect x="112" y="26" width="108" height="30" rx="18" fill="#fff" opacity=".14"/>
      <circle cx="166" cy="68" r="21" fill="#fff" opacity=".18"/>
      <rect x="155" y="58" width="22" height="20" rx="4" fill="none" stroke="#fff" stroke-width="2.4"/>
      <path d="M155 64h22M160 54v6M172 54v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g>
    <g class="float-b"><rect x="200" y="4" width="44" height="44" rx="12" fill="#fff" stroke="var(--border)"/>
      <rect x="211" y="15" width="22" height="20" rx="4" fill="none" stroke="var(--ink)" stroke-width="2"/>
      <circle cx="217" cy="21" r="2.4" fill="var(--amber)"/><path d="M212 33l7-7 5 5 3-3 6 5" stroke="var(--ink)" stroke-width="2" fill="none"/></g>
    <g class="float-c"><rect x="176" y="102" width="64" height="34" rx="10" fill="#fff" stroke="var(--border)"/>
      <rect x="188" y="121" width="7" height="8" rx="2" fill="var(--violet-2)"/><rect x="199" y="115" width="7" height="14" rx="2" fill="var(--violet)"/>
      <rect x="210" y="110" width="7" height="19" rx="2" fill="var(--ink)"/><rect x="221" y="118" width="7" height="11" rx="2" fill="var(--amber)"/></g>
    <g class="float-a"><rect x="90" y="8" width="38" height="20" rx="10" fill="var(--amber)"/><circle cx="118" cy="18" r="6" fill="#fff"/></g>
  </svg></div>`;


/**
 * Can this post be dragged to another day? Scheduled and failed posts can. Pending ones
 * only for non-approvers: rescheduling through the schedule call would approve it otherwise.
 */
const movable = (p) => can.edit() && p.scheduled_at &&
  (p.status === 'scheduled' || p.status === 'failed' || (p.status === 'pending' && !can.approve()));

views.calendar = async () => {
  const b = brand();
  const first = new Date(calMonth);
  const monthEnd = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start Monday
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  const all = await api(`/posts?brand_id=${b.id}`);
  const now = new Date();
  const when = (p) => new Date(p.scheduled_at || p.published_at);
  const dated = all.filter((p) => p.scheduled_at || p.published_at);
  const posts = dated.filter((p) => when(p) >= start && when(p) < end);
  const inMonth = dated.filter((p) => when(p) >= first && when(p) < monthEnd);

  // Stat chips: past due is brand-wide; the rest count this month.
  const pastDue = all.filter((p) => ['pending', 'scheduled'].includes(p.status) && new Date(p.scheduled_at) < now - 120_000);
  const chips = [
    ['Past due', pastDue.length, 'var(--danger)'],
    ['Awaiting approval', inMonth.filter((p) => p.status === 'pending').length, 'var(--amber)'],
    ['Scheduled', inMonth.filter((p) => p.status === 'scheduled').length, 'var(--violet)'],
    ['Published', inMonth.filter((p) => p.status === 'published').length, 'var(--ink)'],
  ];

  const byDay = {};
  for (const p of posts) (byDay[ymd(when(p))] ||= []).push(p);
  for (const k in byDay) byDay[k].sort((x, y) => when(x) - when(y));

  const today = ymd(now);
  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const k = ymd(d);
    const items = byDay[k] || [];
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    cells += `<div class="day ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''} ${weekend ? 'weekend' : ''}" data-day="${k}">
      <div class="top"><div class="num">${d.getDate()}</div>${can.edit() ? '<span class="add-hint" aria-hidden="true">＋</span>' : ''}</div>
      ${items.slice(0, 3).map((p) => `<div class="ev ${p.status}" data-post="${p.id}" tabindex="0" title="${esc(STATUS_LABEL[p.status])} · ${esc(p.content)}"
        ${movable(p) ? 'draggable="true"' : ''}><time>${fmtTime(when(p))}</time>${esc(p.content.slice(0, 40)) || '<em>Untitled</em>'}</div>`).join('')}
      ${items.length > 3 ? `<div class="more">+${items.length - 3} more</div>` : ''}
    </div>`;
  }

  // List view: this month's posts grouped by day.
  const listDays = Object.keys(byDay).filter((k) => k >= ymd(first) && k < ymd(monthEnd)).sort();
  const listHtml = listDays.length ? listDays.map((k) => {
    const d = new Date(`${k}T12:00`);
    return `<section class="cal-list-day ${k === today ? 'is-today' : ''}">
      <header><span class="cld-num">${d.getDate()}</span><span><strong>${d.toLocaleDateString(undefined, { weekday: 'long' })}</strong>
        <span class="muted small">${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span></span></header>
      ${byDay[k].map((p) => `<button type="button" class="cal-list-item s-${p.status}" data-post="${p.id}">
        <time>${fmtTime(when(p))}</time><span class="grow clip">${esc(p.content) || '<em>Untitled</em>'}</span>
        <span class="cli-ch muted small">${p.channel_ids.map((id) => channelById(id)).filter(Boolean).map((c) => esc(state.platforms[c.platform]?.label || c.platform)).join(' · ')}</span>
        ${status(p.status)}</button>`).join('')}
    </section>`;
  }).join('') : `<div class="pipe-empty">Nothing planned for ${first.toLocaleDateString(undefined, { month: 'long' })} yet.${can.edit() ? ' Switch to Grid and click a day to start.' : ''}</div>`;

  // Publishing status panel.
  const upcoming = all.filter((p) => p.status === 'scheduled' && new Date(p.scheduled_at) >= now - 120_000)
    .sort((x, y) => new Date(x.scheduled_at) - new Date(y.scheduled_at)).slice(0, 4);
  const attention = [...all.filter((p) => p.status === 'failed'), ...pastDue].slice(0, 4);
  const waiting = all.filter((p) => p.status === 'pending' && new Date(p.scheduled_at) >= now - 120_000).slice(0, 3);
  const recent = all.filter((p) => p.status === 'published').sort((x, y) => new Date(y.published_at) - new Date(x.published_at)).slice(0, 3);
  const panelItem = (p, note, cls) => `<a href="#/compose/${p.id}" class="ps-item"><span class="nd ${cls}"></span>
    <span class="grow"><span class="clip ps-text">${esc(p.content) || 'Untitled'}</span><span class="muted small">${note}</span></span></a>`;
  const section = (title, items) => items.length ? `<div class="ps-sec"><h3>${title}</h3>${items.join('')}</div>` : '';
  const panelBody = [
    section('Needs attention', attention.map((p) => panelItem(p,
      p.status === 'failed' ? esc(p.review_note || 'Publishing failed') : `Past due by ${relDuration(now - new Date(p.scheduled_at))}`, 'failed'))),
    section('Next up', upcoming.map((p) => {
      const ms = new Date(p.scheduled_at) - now;
      return panelItem(p, ms > 0 ? `In ${relDuration(ms)} · ${fmtDateTime(p.scheduled_at)}` : 'Publishing now…', 'scheduled');
    })),
    section('Awaiting approval', waiting.map((p) => panelItem(p, `Requested for ${fmtDateTime(p.scheduled_at)}`, 'pending'))),
    section('Recently published', recent.map((p) => panelItem(p, fmtDateTime(p.published_at), 'published'))),
  ].join('');

  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const isList = calView === 'list';
  shell('calendar', 'Content calendar', `
    ${can.edit() ? `<button id="cal-new">${NAV_ICON.posts} New post</button>
    <button id="cal-upload">${NAV_ICON.media} Upload media</button>` : ''}`,
  `<div class="chip-stats">${chips.map(([l, n, c]) => `<div class="chip-stat" style="--c:${c}">
      <span class="n" data-count="${n}">${n}</span><span class="l">${l}</span></div>`).join('')}</div>
    <div class="cal-layout">
      <div class="cal-main">
        <div class="cal-toolbar">
          <button class="icon-btn" id="prev" aria-label="Previous month">‹</button>
          <h2 class="cal-month">${monthName}</h2>
          <button class="icon-btn" id="next" aria-label="Next month">›</button>
          <button id="today">Today</button>
          <div class="seg-toggle" role="tablist" aria-label="View">
            <button type="button" role="tab" data-view="grid" class="${isList ? '' : 'on'}" aria-selected="${!isList}">${NAV_ICON.calendar} Grid</button>
            <button type="button" role="tab" data-view="list" class="${isList ? 'on' : ''}" aria-selected="${isList}">${SVG('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>')} List</button>
          </div>
        </div>
        ${isList ? `<div class="cal-list">${listHtml}</div>` : `<div class="cal">${cells}</div>
        <div class="legend">
          <span style="--c:var(--s-scheduled)">Scheduled</span><span style="--c:var(--s-pending)">Awaiting approval</span>
          <span style="--c:var(--s-published)">Published</span><span style="--c:var(--s-failed)">Failed</span>
          <span class="grow" style="text-align:right">${can.edit() ? 'Click a day to draft · drag a post to move it' : 'Times in your local time'}</span>
        </div>`}
      </div>
      <aside class="card pub-status">
        <h2 class="ps-title">${SVG('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>')} Publishing status</h2>
        ${panelBody || '<p class="muted ps-empty">Nothing publishing right now.</p>'}
        <p class="muted small ps-foot">Due posts go out within about 15 seconds of their time.</p>
      </aside>
    </div>`,
  { eyebrow: 'Planning', subtitle: `Schedule posts and see everything going out in ${first.toLocaleDateString(undefined, { month: 'long' })} for ${b.name}`, hero: CAL_HERO });

  animateCharts();
  document.querySelectorAll('[data-view]').forEach((btn) => btn.onclick = () => {
    calView = btn.dataset.view;
    try { localStorage.setItem('cadence.calView', calView); } catch { /* storage unavailable */ }
    route();
  });
  document.getElementById('cal-new')?.addEventListener('click', () => { location.hash = '#/compose'; });
  document.getElementById('cal-upload')?.addEventListener('click', () => { location.hash = '#/media'; });
  const shift = (n) => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1); route(); };
  document.getElementById('prev').onclick = () => shift(-1);
  document.getElementById('next').onclick = () => shift(1);
  document.getElementById('today').onclick = () => { calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); route(); };

  if (isList) {
    document.querySelectorAll('.cal-list [data-post]').forEach((r) => r.onclick = () => { location.hash = `#/compose/${r.dataset.post}`; });
    return;
  }

  const byId = Object.fromEntries(posts.map((p) => [p.id, p]));
  const cal = document.querySelector('.cal');
  cal.addEventListener('dragstart', (e) => {
    const ev = e.target.closest('[data-post]');
    if (!ev) return;
    e.dataTransfer.setData('text/plain', ev.dataset.post);
    e.dataTransfer.effectAllowed = 'move';
    ev.classList.add('dragging');
  });
  cal.addEventListener('dragend', (e) => e.target.closest?.('[data-post]')?.classList.remove('dragging'));
  cal.addEventListener('dragover', (e) => {
    const day = e.target.closest('[data-day]');
    if (!day) return;
    e.preventDefault();
    cal.querySelectorAll('.drop-target').forEach((x) => x !== day && x.classList.remove('drop-target'));
    day.classList.add('drop-target');
  });
  cal.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !cal.contains(e.relatedTarget)) cal.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  });
  cal.addEventListener('drop', (e) => {
    e.preventDefault();
    const day = e.target.closest('[data-day]');
    cal.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    const p = byId[Number(e.dataTransfer.getData('text/plain'))];
    if (!day || !p) return;
    const old = new Date(p.scheduled_at);
    if (ymd(old) === day.dataset.day) return;
    const target = new Date(`${day.dataset.day}T${String(old.getHours()).padStart(2, '0')}:${String(old.getMinutes()).padStart(2, '0')}`);
    act(null, async () => {
      const moved = await api(`/posts/${p.id}/schedule`, { method: 'POST', body: { scheduled_at: target.toISOString() } });
      toast(moved.status === 'pending' ? `Moved to ${fmtDateTime(target)} · sent for approval` : `Moved to ${fmtDateTime(target)}`);
      route();
    });
  });
  cal.onclick = (e) => {
    const ev = e.target.closest('[data-post]');
    if (ev) { location.hash = `#/compose/${ev.dataset.post}`; return; }
    const day = e.target.closest('[data-day]');
    if (day && can.edit()) location.hash = `#/compose/new?day=${day.dataset.day}`;
  };
};

// ---------- posts ----------

let postFilter = 'all';

views.posts = async () => {
  const filters = [['all', 'All'], ['draft', 'Drafts'], ['pending', 'Awaiting approval'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['failed', 'Failed']];
  const q = postFilter === 'all' ? '' : `&status=${postFilter}`;
  const posts = await api(`/posts?brand_id=${brand().id}${q}`);
  shell('posts', 'Posts', '', `
    <div class="filters">${filters.map(([k, l]) => `<button class="sm ${k === postFilter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    ${posts.length ? `<div class="list two">${posts.map(postRow).join('')}</div>` : `<div class="card empty">No posts here yet.</div>`}`);
  document.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { postFilter = b.dataset.f; route(); });
  document.querySelectorAll('[data-post]').forEach((r) => r.onclick = () => { location.hash = `#/compose/${r.dataset.post}`; });
};

function postRow(p) {
  const when = p.published_at ? `Published ${fmtDateTime(p.published_at)}`
    : p.scheduled_at ? `${p.status === 'pending' ? 'Requested for' : 'Goes out'} ${fmtDateTime(p.scheduled_at)}`
    : `Edited ${fmtDateTime(p.updated_at)}`;
  return `<div class="card post-row ${p.status}" data-post="${p.id}">
    <div class="body">${esc(p.content) || '<em class="muted">Empty draft</em>'}</div>
    <div>${status(p.status)}</div>
    <div class="meta">
      <span>${when}</span>
      ${p.channel_ids.map((id) => channelById(id)).filter(Boolean).map((c) => `<span class="chip">${channelChip(c)}</span>`).join('')}
      ${p.author_name ? `<span>· by ${esc(p.author_name)}</span>` : ''}
    </div>
  </div>`;
}

// ---------- media helpers ----------

const fmtBytes = (n) => n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const fmtDuration = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const mediaMeta = (m) => [m.kind === 'video' ? `Video ${fmtDuration(m.duration_ms || 0)}` : 'Image',
  m.aspect, m.width && `${m.width}×${m.height}`, m.bytes && fmtBytes(m.bytes)].filter(Boolean).join(' · ');

function mediaThumb(m) {
  return m.kind === 'video'
    ? `<video class="thumb" src="${esc(m.url)}#t=0.1" preload="metadata" muted playsinline aria-label="${esc(m.filename)}"></video>`
    : `<img class="thumb" src="${esc(m.url)}" alt="${esc(m.filename)}" loading="lazy">`;
}

/** Readiness chips; `only` limits them to the given platforms (e.g. a post's channels). */
function readinessTags(m, only) {
  if (!m.readiness) return '';
  const keys = (only?.length ? only : Object.keys(m.readiness));
  return keys.map((k) => {
    const r = m.readiness[k];
    const label = state.platforms[k]?.label || k;
    return `<span class="tag ${r.ok ? 'ok' : 'warn'}" title="${esc(r.ok ? `Fits ${label}` : `${label}: ${r.note}`)}">${r.ok ? '✓' : '!'} ${esc(label)}</span>`;
  }).join('');
}

const MIME_BY_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const ACCEPT = 'video/mp4,video/quicktime,.mov,.mp4,image/jpeg,image/png,image/webp';

/** PUT the file to the signed URL with progress (fetch has no upload progress). */
function putWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve()
      : reject(new Error((() => { try { return JSON.parse(xhr.responseText).error; } catch { return ''; } })() || `Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload interrupted — retry'));
    xhr.send(file);
  });
}

/** Upload one file: register it, send the bytes, then ask the server to check it. */
async function uploadFile(file, onProgress) {
  const mime = file.type || MIME_BY_EXT[file.name.split('.').pop().toLowerCase()] || '';
  const { media, upload } = await api('/media', { method: 'POST', body: { filename: file.name, mime, bytes: file.size } });
  await putWithProgress(upload.url, file, onProgress);
  return api(`/media/${media.id}/complete`, { method: 'POST', body: {} });
}

const dropZone = () => `<label class="dropzone">
  <input type="file" accept="${ACCEPT}" multiple hidden>
  <strong>Drop videos or images here</strong>
  <span class="muted small">or click to choose · MP4/MOV up to 500 MB and 10 min · JPG/PNG/WebP up to 10 MB</span>
</label>`;

/** Wire the drop zone inside `root`; shows progress rows in `list`, calls onDone per file. */
function bindDropZone(root, list, onDone) {
  const zone = root.querySelector('.dropzone');
  const input = zone.querySelector('input');
  const start = (files) => {
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'upload-row small';
      row.innerHTML = `<span class="clip grow">${esc(file.name)}</span><span class="state muted">0%</span>
        <div class="progress"><div></div></div>`;
      list.prepend(row);
      const bar = row.querySelector('.progress div');
      const label = row.querySelector('.state');
      uploadFile(file, (f) => { bar.style.width = `${Math.round(f * 100)}%`; label.textContent = f < 1 ? `${Math.round(f * 100)}%` : 'Checking…'; })
        .then((m) => { label.textContent = 'Ready'; row.classList.add('done'); onDone(m); })
        .catch((err) => { label.textContent = err.message; row.classList.add('failed'); });
    }
  };
  input.onchange = () => { start([...input.files]); input.value = ''; };
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
  zone.ondragleave = () => zone.classList.remove('over');
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('over'); start([...e.dataTransfer.files]); };
}

// ---------- media library ----------

views.media = async () => {
  const items = await api('/media');
  shell('media', 'Media', '', `
    <div class="stack">
      ${can.edit() ? `<div class="card stack" id="uploader">${dropZone()}<div id="uploads" class="stack" style="gap:6px"></div></div>` : ''}
      ${items.length ? `<div class="media-grid">${items.map((m) => `
        <div class="card media-card">
          ${m.kind === 'video' ? `<video class="thumb" src="${esc(m.url)}#t=0.1" preload="metadata" controls playsinline></video>` : mediaThumb(m)}
          <div class="stack" style="gap:6px;padding:10px 12px 12px">
            <div class="clip" title="${esc(m.filename)}"><strong>${esc(m.filename || `Media #${m.id}`)}</strong></div>
            <div class="muted small">${mediaMeta(m)}</div>
            <div class="tags">${readinessTags(m)}</div>
            ${can.edit() ? `<div><button class="sm danger ghost" data-del-media="${m.id}">Delete</button></div>` : ''}
          </div>
        </div>`).join('')}</div>`
      : `<div class="card empty">No media yet.${can.edit() ? ' Drop a video or image above.' : ''}</div>`}
      <p class="muted small">✓ fits the network · ! may need attention (hover for details). Guidance only; it never blocks scheduling.</p>
    </div>`);

  if (!can.edit()) return;
  bindDropZone(document.getElementById('uploader'), document.getElementById('uploads'), () => {
    clearTimeout(views.media.t);
    views.media.t = setTimeout(route, 800); // refresh the grid once a batch settles
  });
  document.querySelectorAll('[data-del-media]').forEach((btn) => btn.onclick = () => act(btn, async () => {
    if (!await confirmDialog('Delete media?', 'This media will be deleted. This cannot be undone.')) return;
    const r = await api(`/media/${btn.dataset.delMedia}`, { method: 'DELETE', body: {} });
    toast(r.result === 'archived' ? 'Removed from the library (kept for published posts)' : 'Media deleted');
    route();
  }));
};

// ---------- composer ----------

views.compose = async (arg = '') => {
  const [idPart, query = ''] = arg.split('?');
  const params = new URLSearchParams(query);
  let post = null;
  if (idPart && idPart !== 'new') {
    try {
      post = await api(`/posts/${Number(idPart)}`);
    } catch {
      toast('Post not found', true);
      location.hash = '#/posts';
      return;
    }
    state.brandId = post.brand_id;
  }
  const b = brand();
  const editable = can.edit() && (!post || post.status !== 'published');
  const selected = new Set(post ? post.channel_ids : b.channels.map((c) => c.id));
  const day = params.get('day');
  const defaultWhen = post?.scheduled_at ? new Date(post.scheduled_at)
    : day ? new Date(`${day}T10:00`) : new Date(Date.now() + 3600_000);
  if (!post?.scheduled_at && defaultWhen < new Date()) defaultWhen.setTime(Date.now() + 3600_000);

  const title = post ? `Post #${post.id}` : 'New post';
  shell('posts', title, post ? status(post.status) : '', `
    <div class="grid-2">
      <div class="stack">
        ${post?.review_note ? `<div class="note"><strong>${post.status === 'failed' ? 'Publishing failed' : 'Reviewer note'}:</strong> ${esc(post.review_note)}</div>` : ''}
        ${post?.status === 'pending' ? `<div class="note">Awaiting approval for ${fmtDateTime(post.scheduled_at)}.</div>` : ''}
        <div class="card stack">
          <div>
            <h2>Channels</h2>
            ${b.channels.length ? `<div class="channels">${b.channels.map((c) => `
              <label class="channel-opt ${selected.has(c.id) ? 'on' : ''}">
                <input type="checkbox" value="${c.id}" ${selected.has(c.id) ? 'checked' : ''} ${editable ? '' : 'disabled'}>
                ${channelChip(c)}</label>`).join('')}</div>`
            : `<p class="muted">This brand has no channels yet. ${can.admin() ? '<a href="#/brands">Add one</a>.' : 'Ask an admin to add one.'}</p>`}
          </div>
          <label class="field"><span>Post</span>
            <textarea id="content" maxlength="10000" placeholder="What do you want to share?" ${editable ? '' : 'readonly'}>${esc(post?.content || '')}</textarea>
          </label>
          <div class="limits" id="limits"></div>
          <div class="stack" style="gap:8px">
            <div class="row"><strong class="grow">Media</strong>
              ${editable ? `<button type="button" id="add-media" class="sm">+ Add media</button>` : ''}</div>
            <div id="attached" class="media-strip"></div>
            <div id="picker" hidden></div>
          </div>
        </div>
        ${editable ? `
        <div class="card stack">
          <h2>Publish</h2>
          <div class="row">
            <button id="save">Save draft</button>
            <button id="to-library" type="button" title="Keep this text as a reusable library item">Save to library</button>
            <button id="queue" class="primary">Add to queue</button>
          </div>
          <div class="row">
            <input type="datetime-local" id="when" value="${toLocalInput(defaultWhen)}" style="max-width:240px">
            <button id="schedule">Schedule for this time</button>
          </div>
          ${state.workspace.require_approval && !can.approve() ? `<p class="muted small">Approval is on: scheduled posts go to an approver first.</p>` : ''}
          <div class="row">
            ${post && ['scheduled', 'pending', 'failed'].includes(post.status) ? `<button id="unschedule" class="sm">Move back to drafts</button>` : ''}
            ${post?.status === 'pending' && can.approve() ? `<button id="approve" class="sm primary">Approve</button><button id="reject" class="sm">Send back</button>` : ''}
            ${post ? `<button id="delete" class="sm danger ghost">Delete</button>` : ''}
          </div>
        </div>` : ''}
      </div>
      <div class="stack">
        ${editable ? aiPanel(b) : ''}
        <div class="card">
          <h2>Preview</h2>
          <div class="preview">
            <div class="who"><div class="avatar" style="background:${esc(b.color)}">${esc(b.name[0] || '?')}</div>${esc(b.name)}</div>
            <div class="text" id="preview-text"></div>
            <div id="preview-media"></div>
          </div>
        </div>
        ${post ? `<p class="muted small">Created by ${esc(post.author_name || 'a former member')} · last edited ${fmtDateTime(post.updated_at)}
          ${post.approver_name ? ` · approved by ${esc(post.approver_name)}` : ''}</p>` : ''}
      </div>
    </div>`);

  const $content = document.getElementById('content');
  const chosen = () => [...document.querySelectorAll('.channel-opt input:checked')].map((i) => Number(i.value));
  let attached = [...(post?.media || [])];
  const chosenPlatforms = () => [...new Set(chosen().map((id) => channelById(id)?.platform).filter(Boolean))];

  const renderAttached = () => {
    const platforms = chosenPlatforms();
    document.getElementById('attached').innerHTML = attached.length ? attached.map((m) => `
      <div class="media-chip">
        ${mediaThumb(m)}
        <div class="small grow">
          <div class="clip">${esc(m.filename || m.kind)}</div>
          <div class="muted">${mediaMeta(m)}</div>
          <div class="tags">${readinessTags(m, platforms)}</div>
        </div>
        ${editable ? `<button type="button" class="ghost sm" data-detach="${m.id}" aria-label="Remove">×</button>` : ''}
      </div>`).join('') : '<span class="muted small">No media. Instagram posts need an image or video.</span>';
    document.querySelectorAll('[data-detach]').forEach((btn) => btn.onclick = () => {
      attached = attached.filter((m) => m.id !== Number(btn.dataset.detach));
      updateLimits();
    });
    const video = attached.find((m) => m.kind === 'video');
    document.getElementById('preview-media').innerHTML = video
      ? `<video src="${esc(video.url)}" controls playsinline preload="metadata"></video>`
      : `<div class="preview-images">${attached.map((m) => `<img src="${esc(m.url)}" alt="">`).join('')}</div>`;
  };

  const updateLimits = () => {
    const len = [...$content.value].length;
    const platforms = chosenPlatforms();
    document.getElementById('limits').innerHTML = platforms.length
      ? platforms.map((p) => { const lim = state.platforms[p].limit; return `<span class="chip ${len > lim ? 'over' : ''}">${state.platforms[p].label} ${len}/${lim}</span>`; }).join('')
      : `<span class="muted">${len} characters</span>`;
    document.getElementById('preview-text').innerHTML = esc($content.value) || '<span class="muted">Your post will appear here.</span>';
    renderAttached();
  };
  $content.oninput = updateLimits;

  document.getElementById('add-media')?.addEventListener('click', async () => {
    const picker = document.getElementById('picker');
    if (!picker.hidden) { picker.hidden = true; return; }
    picker.hidden = false;
    const attach = (m) => {
      const next = m.kind === 'video' ? [m] : [...attached.filter((x) => x.kind === 'image'), m];
      if (next.length > 10) { toast('A post can have up to 10 images', true); return; }
      if (m.kind === 'video' && attached.length) toast('A post can have one video, or images — replaced with the video');
      if (m.kind === 'image' && attached.some((x) => x.kind === 'video')) toast('Replaced the video with this image');
      attached = next.filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
      picker.hidden = true;
      updateLimits();
    };
    const library = await api('/media');
    picker.innerHTML = `<div class="card stack" style="padding:12px">
      ${dropZone()}
      <div id="picker-uploads" class="stack" style="gap:6px"></div>
      <div class="media-grid compact">${library.map((m) => `
        <button type="button" class="media-pick" data-pick="${m.id}" title="${esc(m.filename)}">
          ${mediaThumb(m)}<span class="small muted">${mediaMeta(m)}</span></button>`).join('') || '<span class="muted small">Your library is empty.</span>'}
      </div></div>`;
    picker.querySelectorAll('[data-pick]').forEach((btn) => btn.onclick = () =>
      attach(library.find((m) => m.id === Number(btn.dataset.pick))));
    bindDropZone(picker, document.getElementById('picker-uploads'), (m) => attach(m));
  });
  document.querySelectorAll('.channel-opt input').forEach((i) => i.onchange = () => {
    i.closest('.channel-opt').classList.toggle('on', i.checked);
    updateLimits();
  });
  updateLimits();

  if (!editable) return;

  /** Create or update the post with what's on screen; returns the saved post. */
  const save = async () => {
    const body = { content: $content.value, media_ids: attached.map((m) => m.id), channel_ids: chosen() };
    post = post
      ? await api(`/posts/${post.id}`, { method: 'PATCH', body })
      : await api('/posts', { method: 'POST', body: { ...body, brand_id: b.id } });
    return post;
  };
  /** Toast, optionally celebrate from the clicked button, then re-render this post. */
  const done = (msg, from) => {
    toast(msg);
    if (from) celebrate(from);
    location.hash = `#/compose/${post.id}`;
    route();
  };
  const scheduledMsg = (p) => p.status === 'pending'
    ? `Sent for approval · ${fmtDateTime(p.scheduled_at)}` : `Scheduled for ${fmtDateTime(p.scheduled_at)}`;

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = () => act(el, () => fn(el)); };
  on('save', async () => { await save(); done('Draft saved'); });
  on('to-library', async () => {
    if (!$content.value.trim()) throw new Error('Write the post first');
    await libraryDialog(null, { body: $content.value, media_id: attached[0]?.id || null, title: '' });
  });
  on('queue', async (el) => {
    await save();
    post = await api(`/posts/${post.id}/queue`, { method: 'POST', body: {} });
    done(scheduledMsg(post), el);
  });
  on('schedule', async (el) => {
    const when = document.getElementById('when').value;
    if (!when) throw new Error('Pick a date and time');
    await save();
    post = await api(`/posts/${post.id}/schedule`, { method: 'POST', body: { scheduled_at: new Date(when).toISOString() } });
    done(scheduledMsg(post), el);
  });
  on('unschedule', async () => { post = await api(`/posts/${post.id}/unschedule`, { method: 'POST', body: {} }); done('Moved back to drafts'); });
  on('approve', async (el) => { post = await api(`/posts/${post.id}/approve`, { method: 'POST', body: {} }); done('Approved and scheduled', el); });
  on('reject', async () => {
    const note = prompt('What should change? (optional)');
    if (note === null) return;
    post = await api(`/posts/${post.id}/reject`, { method: 'POST', body: { note } });
    done('Sent back to the author');
  });
  on('delete', async () => {
    if (!await confirmDialog('Delete post?', 'This post will be deleted. This cannot be undone.')) return;
    await api(`/posts/${post.id}`, { method: 'DELETE', body: {} });
    toast('Post deleted');
    location.hash = '#/posts';
  });

  bindAiPanel(b, (text) => { $content.value = text; updateLimits(); $content.focus(); });
};

function aiPanel(b) {
  if (!state.aiEnabled) {
    return `<div class="card ai-card"><h2>✨ AI drafts</h2><p class="muted small">AI is off for this workspace. ${can.admin()
      ? '<a href="#/setup">Choose an AI provider in Setup</a> to draft posts.' : 'Ask an admin to choose an AI provider in Setup.'}</p></div>`;
  }
  const platforms = [...new Set(b.channels.map((c) => c.platform))];
  const options = (platforms.length ? platforms : Object.keys(state.platforms));
  return `<div class="card stack ai-card">
    <h2>✨ AI drafts</h2>
    <label class="field"><span>What's the post about?</span>
      <textarea id="ai-brief" style="min-height:80px" maxlength="2000" placeholder="Announce our new autumn menu, launching Friday"></textarea></label>
    <div class="row">
      <select id="ai-platform" class="grow">${options.map((p) => `<option value="${p}">${state.platforms[p].label}</option>`).join('')}</select>
      <select id="ai-tone" class="grow">
        <option value="">Brand voice</option><option>Friendly</option><option>Professional</option>
        <option>Playful</option><option>Bold</option><option>Informative</option>
      </select>
      <select id="ai-count" style="width:auto"><option>2</option><option selected>3</option><option>4</option></select>
    </div>
    <button id="ai-go" class="primary" style="justify-content:center">Write drafts</button>
    <div class="drafts" id="ai-out"></div>
  </div>`;
}

function bindAiPanel(b, use) {
  const go = document.getElementById('ai-go');
  if (!go) return;
  go.onclick = () => act(go, async () => {
    const out = document.getElementById('ai-out');
    go.textContent = 'Writing…';
    try {
      const { drafts } = await api('/ai/drafts', {
        method: 'POST',
        body: {
          brand_id: b.id,
          brief: document.getElementById('ai-brief').value,
          platform: document.getElementById('ai-platform').value,
          tone: document.getElementById('ai-tone').value,
          count: Number(document.getElementById('ai-count').value),
        },
      });
      out.innerHTML = drafts.map((d, i) => `<div class="ai-draft">${esc(d)}
        <div class="row"><button class="sm" data-use="${i}">Use this</button><span class="muted small">${[...d].length} chars</span></div></div>`).join('');
      out.querySelectorAll('[data-use]').forEach((btn) => btn.onclick = () => use(drafts[Number(btn.dataset.use)]));
    } finally {
      go.textContent = 'Write drafts';
    }
  });
}

// ---------- queue ----------

views.queue = async () => {
  const b = brand();
  const [slots, upcoming] = await Promise.all([
    api(`/brands/${b.id}/slots`),
    api(`/posts?brand_id=${b.id}&status=scheduled,pending&from=${new Date().toISOString()}`),
  ]);
  upcoming.sort((x, y) => new Date(x.scheduled_at) - new Date(y.scheduled_at));
  const order = [1, 2, 3, 4, 5, 6, 0];
  shell('queue', 'Queue', '', `
    <div class="two-col">
      <div class="card stack">
        <div><h2>Posting schedule for ${esc(b.name)}</h2>
          <p class="muted small" style="margin:0">“Add to queue” puts a post in the next free slot. Times are in ${esc(state.workspace.timezone)}.</p></div>
        <div class="week-rows">${order.map((wd) => {
          const daySlots = slots.filter((s) => s.weekday === wd);
          return `<div class="day-row"><h3>${WEEKDAYS[wd]}</h3><div class="day-slots">
            ${daySlots.map((s) => `<div class="slot">${s.time}
              ${can.edit() ? `<button data-del="${s.id}" aria-label="Remove ${WEEKDAYS[wd]} ${s.time}">×</button>` : ''}</div>`).join('')
              || '<span class="muted small">No slots</span>'}</div></div>`;
        }).join('')}</div>
        ${can.edit() ? `<div class="row">
          <select id="slot-day" style="width:auto">${order.map((wd) => `<option value="${wd}">${WEEKDAYS[wd]}</option>`).join('')}</select>
          <input type="time" id="slot-time" value="12:00" style="width:auto">
          <button id="slot-add">Add slot</button>
          <button id="slot-all" class="ghost sm">Add to every weekday</button>
        </div>` : ''}
      </div>
      <div class="card stack panel-scroll">
        <div class="row"><h2 class="grow" style="margin:0">Coming up</h2><span class="pipe-count" style="--c:var(--violet)">${upcoming.length}</span></div>
        ${upcoming.length ? `<div class="list">${upcoming.map(postRow).join('')}</div>` : `<div class="pipe-empty">Nothing scheduled yet. Queue a post from the composer.</div>`}
      </div>
    </div>`);

  const saveSlots = (next) => act(null, async () => {
    await api(`/brands/${b.id}/slots`, { method: 'PUT', body: { slots: next } });
    route();
  });
  const plain = slots.map(({ weekday, time }) => ({ weekday, time }));
  document.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () =>
    saveSlots(slots.filter((s) => s.id !== Number(btn.dataset.del)).map(({ weekday, time }) => ({ weekday, time }))));
  const time = () => document.getElementById('slot-time').value;
  document.getElementById('slot-add')?.addEventListener('click', () =>
    saveSlots([...plain, { weekday: Number(document.getElementById('slot-day').value), time: time() }]));
  document.getElementById('slot-all')?.addEventListener('click', () =>
    saveSlots([...plain, ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, time: time() }))]));
  document.querySelectorAll('[data-post]').forEach((r) => r.onclick = () => { location.hash = `#/compose/${r.dataset.post}`; });
};

// ---------- analytics ----------

views.analytics = async () => {
  const b = brand();
  const a = await api(`/analytics?brand_id=${b.id}`);
  const s = a.by_status;
  const tiles = [['Published', s.published], ['Scheduled', s.scheduled], ['Awaiting approval', s.pending], ['Drafts', s.draft], ['Failed', s.failed]];
  const maxP = Math.max(1, ...a.by_platform.map((r) => r.count));
  const maxA = Math.max(1, ...a.authors.map((r) => r.count));
  const maxS = Math.max(1, ...tiles.map(([, n]) => n || 0));

  // Fill in the last 12 weeks so quiet weeks show as zero.
  const weeks = [];
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const counts = Object.fromEntries(a.weekly.map((w) => [w.week, w.count])); // week = UTC Monday, YYYY-MM-DD
  for (let i = 11; i >= 0; i--) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() - 7 * i);
    weeks.push({ d, n: counts[d.toISOString().slice(0, 10)] || 0 });
  }
  const maxW = Math.max(1, ...weeks.map((w) => w.n));

  shell('analytics', `Analytics · ${b.name}`, '', `
    <div class="stack">
      <div class="grid-tiles">${tiles.map(([l, n], i) => `<div class="card tile c${i + 1}"><div class="muted small">${l}</div>
        <div class="n" data-count="${n || 0}">${n || 0}</div></div>`).join('')}</div>
      <div class="two-col">
        <div class="card">
          <h2>Published per week</h2>
          <div class="cols">${weeks.map((w) => `<div class="c" title="${w.n} posts, week of ${w.d.toLocaleDateString()}">
            <span>${w.n || ''}</span><div class="b" data-h="${(w.n / maxW) * 100}" style="height:0"></div>
            <span>${w.d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>`).join('')}</div>
        </div>
        <div class="card"><h2>Posts by status</h2>
          <div class="bars">${tiles.map(([l, n]) => `<div class="bar"><span>${l}</span>
            <div class="track"><div class="fill" data-w="${((n || 0) / maxS) * 100}" style="width:0"></div></div><span>${n || 0}</span></div>`).join('')}</div>
        </div>
      </div>
      <div class="two-col">
        <div class="card"><h2>Published by network</h2>
          ${a.by_platform.length ? `<div class="bars">${a.by_platform.map((r) => `<div class="bar"><span>${esc(state.platforms[r.platform]?.label || r.platform)}</span>
            <div class="track"><div class="fill" data-w="${(r.count / maxP) * 100}" style="width:0"></div></div><span>${r.count}</span></div>`).join('')}</div>`
          : '<p class="muted">Nothing published yet.</p>'}
        </div>
        <div class="card"><h2>Most active writers</h2>
          ${a.authors.length ? `<div class="bars">${a.authors.map((r) => `<div class="bar"><span>${esc(r.name)}</span>
            <div class="track"><div class="fill" data-w="${(r.count / maxA) * 100}" style="width:0"></div></div><span>${r.count}</span></div>`).join('')}</div>`
          : '<p class="muted">No posts yet.</p>'}
        </div>
      </div>
      <p class="muted small">Engagement metrics (likes, reach) arrive once real network connections are added.</p>
    </div>`);
  animateCharts();
};

/** Grow bars and count tile numbers up after render (instant with reduced motion). */
function animateCharts() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
    document.querySelectorAll('[data-h]').forEach((el) => { el.style.height = `${el.dataset.h}%`; });
  }));
  if (reducedMotion()) return;
  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      el.textContent = String(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ---------- content writing ----------

/** Starter briefs for loan officers. */
const WRITING_STARTERS = [
  ['📉', 'Rate update', 'Rates moved this week. Explain in plain words what it means for buyers and for homeowners thinking about refinancing.'],
  ['🏡', 'First-time buyer tip', 'One practical tip for first-time buyers getting ready to apply for a home loan.'],
  ['🎉', 'Client win', 'Celebrate a family who just got the keys to their first home (no names or personal details).'],
  ['📝', 'Pre-approval explained', 'What pre-approval is, why it helps when making an offer, and how long it takes.'],
  ['📍', 'Local market', 'A short update on the local housing market this month and what buyers should watch.'],
  ['💬', 'Myth buster', 'Bust a common myth about down payments and explain the options that exist.'],
  ['📅', 'Event invite', 'Invite people to a free homebuyer Q&A session next Thursday evening.'],
  ['⭐', 'Ask for referrals', 'Thank past clients warmly and invite them to refer friends who are thinking of buying.'],
];
let writingResults = [];

views.writing = async () => {
  const b = brand();
  const brandPlatforms = [...new Set(b.channels.map((c) => c.platform))];
  const chosen = new Set(brandPlatforms.length ? brandPlatforms.slice(0, 3) : ['linkedin', 'facebook']);
  const ai = state.aiEnabled;
  shell('writing', 'Content writing', '', `
    <div class="two-col">
      <form class="card stack" id="wr-form">
        <h2 style="margin:0">${SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>')} Brief</h2>
        ${ai ? '' : `<div class="note small">AI is off for this workspace. ${can.admin() ? '<a href="#/setup">Choose an AI provider in Setup</a>.' : 'Ask an admin to choose an AI provider in Setup.'}
          You can still write below and check every network's limit.</div>`}
        <div><span class="field-label">Start from an idea</span>
          <div class="starters">${WRITING_STARTERS.map(([ic, t], i) => `<button type="button" class="starter" data-starter="${i}"><span aria-hidden="true">${ic}</span>${esc(t)}</button>`).join('')}</div></div>
        <label class="field"><span>What should the post say?</span>
          <textarea name="brief" maxlength="2000" style="min-height:110px" placeholder="e.g. Rates dipped this week. What it means for first-time buyers."></textarea></label>
        <div><span class="field-label">Networks</span>
          <div class="channels">${Object.entries(state.platforms).map(([k, p]) => `<label class="channel-opt ${chosen.has(k) ? 'on' : ''}">
            <input type="checkbox" name="net" value="${k}" ${chosen.has(k) ? 'checked' : ''}> ${netLogo(k, 16)}${esc(p.label)}</label>`).join('')}</div></div>
        <div class="two-col" style="gap:12px">
          <label class="field"><span>Tone</span><select name="tone"><option value="">${esc(b.name)}'s voice</option>
            ${['Friendly', 'Professional', 'Reassuring', 'Upbeat', 'Educational'].map((t) => `<option>${t}</option>`).join('')}</select></label>
          <label class="field"><span>Drafts per network</span><select name="count"><option>1</option><option selected>2</option><option>3</option></select></label>
        </div>
        <div class="row">
          <div class="seg-toggle" role="radiogroup" aria-label="Length">${['short', 'medium', 'long'].map((l) => `<button type="button" data-len="${l}" class="${l === 'medium' ? 'on' : ''}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div>
          <label class="check"><input type="checkbox" name="emoji" checked> Emoji</label>
          <label class="check"><input type="checkbox" name="hashtags"> Hashtags</label>
        </div>
        <div class="row"><button class="primary" ${ai && can.edit() ? '' : 'disabled'}>✨ Write drafts</button>
          <span class="muted small">Uses ${esc(b.name)}'s brand voice.</span></div>
      </form>
      <div class="stack" id="wr-results"></div>
    </div>`,
  { eyebrow: 'Create', subtitle: `Turn one idea into ready-to-post captions for every network, in ${b.name}'s voice` });

  const form = document.getElementById('wr-form');
  const f = form.elements;
  let length = 'medium';
  const out = document.getElementById('wr-results');
  const nets = () => [...form.querySelectorAll('[name="net"]:checked')].map((i) => i.value);
  const channelsFor = (platform) => b.channels.filter((c) => c.platform === platform).map((c) => c.id);

  const counter = (text, platforms) => platforms.map((p) => {
    const lim = state.platforms[p].limit;
    const n = [...text].length;
    return `<span class="chip ${n > lim ? 'over' : ''}">${esc(state.platforms[p].label)} ${n}/${lim}</span>`;
  }).join('');

  const renderResults = () => {
    const mine = `<div class="card stack" id="wr-own"><h2 style="margin:0">Write your own</h2>
      <textarea id="wr-own-text" style="min-height:110px" maxlength="10000" placeholder="Type or paste a caption to check it against every network's limit."></textarea>
      <div class="limits" id="wr-own-count"></div>
      ${can.edit() ? '<div><button class="sm" id="wr-own-save">Save as draft post</button></div>' : ''}</div>`;
    out.innerHTML = (writingResults.length ? writingResults.map((r) => `<div class="card stack wr-net">
      <div class="row"><h2 class="grow" style="margin:0">${esc(state.platforms[r.platform].label)}</h2>
        <span class="muted small">${r.error ? '' : `${r.drafts.length} draft${r.drafts.length === 1 ? '' : 's'}`}</span></div>
      ${r.error ? `<div class="pc-overdue small">⚠ ${esc(r.error)}</div>` : r.drafts.map((d, i) => `<div class="ai-draft" data-p="${r.platform}" data-i="${i}">${esc(d)}
        <div class="row"><span class="limits">${counter(d, [r.platform])}</span><span class="grow"></span>
          <button type="button" class="sm" data-copy>Copy</button>${can.edit() ? '<button type="button" class="sm primary" data-use>Use in a post</button>' : ''}</div></div>`).join('')}
    </div>`).join('') : `<div class="card wr-empty"><div class="wr-empty-art" aria-hidden="true">✍️</div>
      <h2 style="margin:0">Your drafts appear here</h2><p class="muted" style="margin:0">Pick an idea or write a brief, choose networks, then “Write drafts”.</p></div>`) + mine;

    out.querySelectorAll('[data-copy]').forEach((btn) => btn.onclick = async () => {
      const card = btn.closest('[data-p]');
      const r = writingResults.find((x) => x.platform === card.dataset.p);
      try { await navigator.clipboard.writeText(r.drafts[Number(card.dataset.i)]); toast('Copied'); } catch { toast('Copy failed: select the text instead', true); }
    });
    out.querySelectorAll('[data-use]').forEach((btn) => btn.onclick = () => act(btn, async () => {
      const card = btn.closest('[data-p]');
      const text = writingResults.find((x) => x.platform === card.dataset.p).drafts[Number(card.dataset.i)];
      const p = await api('/posts', { method: 'POST', body: { brand_id: b.id, content: text, channel_ids: channelsFor(card.dataset.p) } });
      toast('Draft post created');
      location.hash = `#/compose/${p.id}`;
    }));
    const own = document.getElementById('wr-own-text');
    const ownCount = () => { document.getElementById('wr-own-count').innerHTML = counter(own.value, nets().length ? nets() : Object.keys(state.platforms)); };
    own.oninput = ownCount;
    ownCount();
    document.getElementById('wr-own-save')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      if (!own.value.trim()) throw new Error('Write something first');
      const p = await api('/posts', { method: 'POST', body: { brand_id: b.id, content: own.value, channel_ids: nets().flatMap(channelsFor) } });
      toast('Draft post created');
      location.hash = `#/compose/${p.id}`;
    }));
  };
  renderResults();

  form.querySelectorAll('[data-starter]').forEach((btn) => btn.onclick = () => {
    f.namedItem('brief').value = WRITING_STARTERS[Number(btn.dataset.starter)][2];
    form.querySelectorAll('.starter').forEach((s) => s.classList.toggle('on', s === btn));
    f.namedItem('brief').focus();
  });
  form.querySelectorAll('[data-len]').forEach((btn) => btn.onclick = () => {
    length = btn.dataset.len;
    form.querySelectorAll('[data-len]').forEach((x) => x.classList.toggle('on', x === btn));
  });
  form.querySelectorAll('[name="net"]').forEach((i) => i.onchange = () => {
    i.closest('.channel-opt').classList.toggle('on', i.checked);
    document.getElementById('wr-own-text')?.dispatchEvent(new Event('input'));
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    const btn = form.querySelector('button.primary');
    act(btn, async () => {
      const brief = f.namedItem('brief').value.trim();
      if (!brief) throw new Error('Write a brief or pick an idea first');
      const platforms = nets();
      if (!platforms.length) throw new Error('Choose at least one network');
      btn.textContent = 'Writing…';
      writingResults = platforms.map((platform) => ({ platform, drafts: [], loading: true }));
      out.innerHTML = '<div class="card wr-empty"><div class="wr-empty-art spin" aria-hidden="true">✨</div><p class="muted" style="margin:0">Writing drafts for each network…</p></div>';
      try {
        writingResults = await Promise.all(platforms.map(async (platform) => {
          try {
            const { drafts } = await api('/ai/drafts', { method: 'POST', body: {
              brand_id: b.id, brief, platform, tone: f.namedItem('tone').value, count: Number(f.namedItem('count').value),
              length, emoji: f.namedItem('emoji').checked, hashtags: f.namedItem('hashtags').checked,
            } });
            return { platform, drafts };
          } catch (err) {
            return { platform, drafts: [], error: err.message };
          }
        }));
        renderResults();
      } finally {
        btn.textContent = '✨ Write drafts';
      }
    });
  };
};

// ---------- dialogs ----------

/**
 * Show a modal form. `onSubmit(form)` may throw to show an error; resolve to close.
 * Uses the native <dialog>, so focus trapping and Esc work out of the box.
 * `submitClass` is 'danger' for destructive actions (red text, per the design system).
 */
function openDialog(title, bodyHtml, onSubmit, submitLabel = 'Save', submitClass = 'primary') {
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg';
  dlg.innerHTML = `<form method="dialog" class="stack" novalidate>
    <div class="row"><h2 class="grow" style="margin:0">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    ${bodyHtml}
    <div class="error" role="alert"></div>
    <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="${submitClass}" value="ok">${esc(submitLabel)}</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const close = () => { if (dlg.open) dlg.close(); dlg.remove(); };
  dlg.querySelectorAll('[data-close]').forEach((b) => b.onclick = close);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove()));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[value="ok"]');
    btn.disabled = true;
    try {
      await onSubmit(form);
      close();
    } catch (err) {
      form.querySelector('.error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  dlg.showModal();
  dlg.querySelector('input, textarea, select')?.focus();
  return dlg;
}

/**
 * In-app replacement for window.confirm() on destructive actions.
 * Resolves true on the danger action button; false on Cancel, ✕ or Esc.
 */
function confirmDialog(title, message, actionLabel = 'Delete') {
  return new Promise((resolve) => {
    const dlg = openDialog(title, `<p style="margin:0">${esc(message)}</p>`, async () => resolve(true), actionLabel, 'danger');
    dlg.querySelector('button[value="ok"]').focus();
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
    dlg.addEventListener('cancel', () => resolve(false));
    dlg.addEventListener('close', () => resolve(false));
  });
}

// ---------- loan reminders ----------

const LOAN_TABS = [
  ['overview', 'Overview', SVG('<path d="M3 12a9 9 0 1 1 18 0"/><path d="M12 12l4-3"/>')],
  ['customers', 'Customers', NAV_ICON.team],
  ['groups', 'Groups', SVG('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>')],
  ['send', 'Send message', SVG('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>')],
  ['rules', 'Reminder rules', NAV_ICON.queue],
  ['log', 'Message log', SVG('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>')],
];
const CHANNEL_LABEL = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };
const MSG_STATUS = { simulated: 'Logged (not delivered)', sent: 'Sent', failed: 'Failed', skipped: 'Skipped' };
const fmtMoney = (n) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.workspace.currency || 'INR', maximumFractionDigits: 2 }).format(n || 0); } catch { return String(n); }
};
const fmtDay = (s) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dueLabel = (days) => (days < 0 ? `Overdue ${-days}d` : days === 0 ? 'Due today' : `In ${days}d`);

function customerForm(c = {}, groups = []) {
  return `
    <label class="field"><span>Name</span><input name="name" required maxlength="120" value="${esc(c.name || '')}"></label>
    <div class="two-col" style="gap:12px">
      <label class="field"><span>Mobile</span><input name="phone" maxlength="24" placeholder="+91 98765 43210" value="${esc(c.phone || '')}"></label>
      <label class="field"><span>Email</span><input name="email" type="email" maxlength="160" value="${esc(c.email || '')}"></label>
    </div>
    <label class="field"><span>Group</span><select name="group_id"><option value="">No group</option>
      ${groups.map((g) => `<option value="${g.id}" ${g.id === c.group_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
    <fieldset class="consents"><legend>Has agreed to receive reminders by</legend>
      ${['sms', 'whatsapp', 'email'].map((ch) => `<label class="check"><input type="checkbox" name="consent_${ch}" ${c[`consent_${ch}`] ? 'checked' : ''}> ${CHANNEL_LABEL[ch]}</label>`).join('')}
    </fieldset>
    <label class="field"><span>Notes</span><textarea name="notes" style="min-height:60px" maxlength="2000">${esc(c.notes || '')}</textarea></label>`;
}
const customerBody = (form) => {
  const f = form.elements;
  return {
    name: f.namedItem('name').value, phone: f.namedItem('phone').value, email: f.namedItem('email').value,
    group_id: f.namedItem('group_id').value || null, notes: f.namedItem('notes').value,
    consent_sms: f.namedItem('consent_sms').checked, consent_whatsapp: f.namedItem('consent_whatsapp').checked,
    consent_email: f.namedItem('consent_email').checked,
  };
};

async function addCustomerDialog() {
  const groups = await api('/loans/groups');
  openDialog('Add customer', customerForm({}, groups), async (form) => {
    const c = await api('/loans/customers', { method: 'POST', body: customerBody(form) });
    toast(`${c.name} added`);
    location.hash = `#/loans/customer-${c.id}`;
  }, 'Add customer');
}

views.loans = async (arg = 'overview') => {
  const [tab, sub] = String(arg || 'overview').split(/[?]/)[0].split('-');
  const editor = can.edit();
  const head = (activeTab, content) => shell('loans', 'Loan reminders', editor ? `
      <button id="ln-add">${NAV_ICON.plus} Customer</button>
      <button class="primary" id="ln-send">${LOAN_TABS[3][2]} Send message</button>` : '',
  `<div class="seg-toggle ln-tabs" role="tablist" aria-label="Loan reminders">${LOAN_TABS.map(([k, l, ic]) => `
      <button type="button" role="tab" data-ltab="${k}" class="${k === activeTab ? 'on' : ''}" aria-selected="${k === activeTab}">${ic}${l}</button>`).join('')}</div>
    ${content}`,
  { eyebrow: 'Customers', subtitle: 'Customers, loans, due-date reminders and messages by SMS, WhatsApp and email' });
  const wire = () => {
    document.querySelectorAll('[data-ltab]').forEach((b) => b.onclick = () => { location.hash = `#/loans/${b.dataset.ltab}`; });
    document.getElementById('ln-add')?.addEventListener('click', addCustomerDialog);
    document.getElementById('ln-send')?.addEventListener('click', () => { location.hash = '#/loans/send'; });
  };

  if (!state.workspace.loans_enabled) {
    shell('loans', 'Loan reminders', '', `<div class="card empty-card stack">
      <h2>Loan reminders are off for this workspace</h2>
      <p class="muted">Keep customers, their loans and instalment schedules here, and send due-date reminders by SMS, WhatsApp or email.</p>
      ${can.admin() ? '<div><button class="primary" id="ln-enable">Turn on loan reminders</button></div>' : '<p class="muted small">Ask an admin to turn them on in Settings.</p>'}</div>`,
    { eyebrow: 'Customers' });
    document.getElementById('ln-enable')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      state.workspace = { ...state.workspace, ...(await api('/workspace', { method: 'PATCH', body: { loans_enabled: true } })) };
      toast('Loan reminders turned on');
      route();
    }));
    return;
  }

  if (tab === 'customer') return loanCustomerView(Number(sub), head, wire);

  if (tab === 'overview') {
    const [o, log] = await Promise.all([api('/loans/overview'), api('/loans/messages')]);
    const c = o.counts;
    const off = ['sms', 'whatsapp', 'email'].filter((k) => !o.channels[k]);
    head('overview', `
      <div class="chip-stats">${[
        ['Customers', c.customers, 'var(--ink)'], ['Active loans', c.active_loans, 'var(--violet)'],
        ['Due in 7 days', c.due_7, 'var(--amber)'], [`Overdue · ${fmtMoney(c.overdue_amount)}`, c.overdue_count, 'var(--danger)'],
        ['Sent (30 days)', c.sent_30, 'var(--violet)'],
      ].map(([l, n, col]) => `<div class="chip-stat" style="--c:${col}"><span class="n" data-count="${n}">${n}</span><span class="l">${esc(l)}</span></div>`).join('')}</div>
      <div class="card ln-banner ${o.rules.enabled ? 'on' : ''}">
        <div class="row"><strong>${o.rules.enabled ? `✓ Automatic reminders are on (${CHANNEL_LABEL[o.rules.channel]}).` : '⚠ Automatic reminders are off.'}</strong>
          <span class="muted">${o.rules.enabled ? 'Reminders go out on the days set in Reminder rules.' : 'Turn them on and choose the days in Reminder rules.'}</span></div>
        <div class="row" style="margin-top:10px">${off.map((k) => `<span class="pill-muted">${CHANNEL_LABEL[k]} not set up</span>`).join('')}
          <a href="#/loans/rules" class="small strong-link">${NAV_ICON.queue} Reminder rules</a></div>
        ${off.length ? '<p class="muted small" style="margin:10px 0 0">No messaging provider is connected yet, so messages are recorded in the log but not delivered.</p>' : ''}
      </div>
      <div class="two-col">
        <div class="card stack">
          <div class="row"><h2 class="grow" style="margin:0">${NAV_ICON.calendar} Overdue and due in the next 7 days</h2><span class="pipe-count" style="--c:var(--amber)">${o.upcoming.length}</span></div>
          ${o.upcoming.length ? `<div class="ln-due">${o.upcoming.map((u) => `
            <div class="ln-due-row ${u.days < 0 ? 'late' : u.days === 0 ? 'today' : ''}">
              <a href="#/loans/customer-${u.customer_id}" class="grow"><strong>${esc(u.name)}</strong>
                <span class="muted small">${esc(u.reference || 'Loan')} · ${fmtDay(u.due_date)}${u.opted_out_at ? ' · opted out' : ''}</span></a>
              <span class="ln-amt">${fmtMoney(u.amount)}</span><span class="ln-when">${dueLabel(u.days)}</span>
              ${editor ? `<button class="sm" data-pay="${u.id}">✓ Paid</button>` : ''}
            </div>`).join('')}</div>` : '<div class="pipe-empty">✓ Nothing overdue or due this week.</div>'}
        </div>
        <div class="card stack">
          <div class="row"><h2 class="grow" style="margin:0">Recent messages</h2><a href="#/loans/log" class="small">View log</a></div>
          ${log.length ? log.slice(0, 7).map((m) => `<div class="ln-msg"><span class="nd ${m.status === 'skipped' ? 'pending' : m.status === 'failed' ? 'failed' : 'scheduled'}"></span>
            <span class="grow"><strong>${esc(m.customer_name || 'Former customer')}</strong> <span class="muted small">· ${CHANNEL_LABEL[m.channel]} · ${esc(m.kind)}</span>
            <span class="muted small clip">${esc(m.status === 'skipped' ? m.reason : m.body)}</span></span>
            <span class="muted small">${fmtDateTime(m.created_at)}</span></div>`).join('') : '<div class="pipe-empty">No messages yet.</div>'}
        </div>
      </div>`);
    wire();
    animateCharts();
    document.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => act(b, async () => {
      await api(`/loans/installments/${b.dataset.pay}/pay`, { method: 'POST', body: {} });
      toast('Marked as paid');
      route();
    }));
    return;
  }

  if (tab === 'customers') {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const [groups, list] = await Promise.all([api('/loans/groups'), api(`/loans/customers?${q.toString()}`)]);
    head('customers', `<div class="card stack">
      <div class="row"><input id="ln-q" placeholder="Search name, phone or email" value="${esc(q.get('q') || '')}" style="max-width:320px">
        <select id="ln-g" style="width:auto"><option value="">All groups</option>${groups.map((g) => `<option value="${g.id}" ${String(g.id) === q.get('group_id') ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
        <span class="grow"></span><span class="muted small">${list.length} customer${list.length === 1 ? '' : 's'}</span></div>
      ${list.length ? `<div class="table-wrap"><table class="ln-table"><thead><tr><th>Customer</th><th>Group</th><th>Loans</th><th>Next due</th><th>Overdue</th><th>Reach by</th></tr></thead>
        <tbody>${list.map((c) => `<tr data-cust="${c.id}" tabindex="0">
          <td><strong>${esc(c.name)}</strong><div class="muted small">${esc(c.phone || c.email || '—')}</div></td>
          <td>${esc(c.group_name || '—')}</td><td>${c.active_loans}</td><td>${fmtDay(c.next_due)}</td>
          <td class="${c.overdue_amount ? 'late-amt' : 'muted'}">${c.overdue_amount ? fmtMoney(c.overdue_amount) : '—'}</td>
          <td>${c.opted_out_at ? '<span class="pill-muted danger">Opted out</span>' : ['sms', 'whatsapp', 'email'].filter((ch) => c[`consent_${ch}`]).map((ch) => `<span class="pill-muted">${CHANNEL_LABEL[ch]}</span>`).join(' ') || '<span class="muted small">No consent</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
      : `<div class="pipe-empty">No customers yet.${editor ? ' Use “+ Customer” to add one.' : ''}</div>`}</div>`);
    wire();
    const apply = () => {
      const p = new URLSearchParams();
      const qv = document.getElementById('ln-q').value.trim();
      const gv = document.getElementById('ln-g').value;
      if (qv) p.set('q', qv);
      if (gv) p.set('group_id', gv);
      location.hash = `#/loans/customers${p.toString() ? `?${p}` : ''}`;
    };
    document.getElementById('ln-q').onkeydown = (e) => { if (e.key === 'Enter') apply(); };
    document.getElementById('ln-g').onchange = apply;
    document.querySelectorAll('[data-cust]').forEach((r) => {
      const go = () => { location.hash = `#/loans/customer-${r.dataset.cust}`; };
      r.onclick = go;
      r.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
    return;
  }

  if (tab === 'groups') {
    const groups = await api('/loans/groups');
    head('groups', `<div class="two-col">
      <div class="card stack"><h2 style="margin:0">Groups</h2>
        ${groups.length ? groups.map((g) => `<div class="ln-group" data-group="${g.id}">
          <span class="ln-gicon">${esc(initials(g.name))}</span>
          <span class="grow"><strong>${esc(g.name)}</strong><span class="muted small"> · ${g.members} member${g.members === 1 ? '' : 's'}</span></span>
          <a class="sm-link" href="#/loans/customers?group_id=${g.id}">View</a>
          ${editor ? `<button class="sm" data-rename>Rename</button><button class="sm danger ghost" data-del>Delete</button>` : ''}
        </div>`).join('') : '<div class="pipe-empty">No groups yet.</div>'}
      </div>
      ${editor ? `<form class="card stack" id="ln-gform"><h2 style="margin:0">New group</h2>
        <p class="muted small" style="margin:0">Groups let you message a set of customers at once, such as a branch or a lending circle.</p>
        <input name="name" placeholder="Group name" maxlength="80" required aria-label="Group name">
        <div><button class="primary">Create group</button></div></form>` : ''}
    </div>`);
    wire();
    const form = document.getElementById('ln-gform');
    if (form) form.onsubmit = (e) => { e.preventDefault(); act(form.querySelector('button'), async () => {
      await api('/loans/groups', { method: 'POST', body: { name: form.elements.namedItem('name').value } });
      toast('Group created');
      route();
    }); };
    document.querySelectorAll('[data-group]').forEach((row) => {
      const id = row.dataset.group;
      row.querySelector('[data-rename]')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
        const name = prompt('New group name', row.querySelector('strong').textContent);
        if (!name) return;
        await api(`/loans/groups/${id}`, { method: 'PATCH', body: { name } });
        route();
      }));
      row.querySelector('[data-del]')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
        if (!await confirmDialog('Delete group?', 'Its customers stay, without a group.')) return;
        await api(`/loans/groups/${id}`, { method: 'DELETE', body: {} });
        route();
      }));
    });
    return;
  }

  if (tab === 'send') {
    const [groups, customers] = await Promise.all([api('/loans/groups'), api('/loans/customers')]);
    head('send', `<div class="two-col">
      <form class="card stack" id="ln-send-form">
        <h2 style="margin:0">Compose</h2>
        <div class="seg-toggle" role="radiogroup" aria-label="Send to">
          <button type="button" class="on" data-aud="group">A group</button><button type="button" data-aud="pick">Choose customers</button></div>
        <label class="field" id="aud-group"><span>Group</span><select name="group_id">${groups.map((g) => `<option value="${g.id}">${esc(g.name)} (${g.members})</option>`).join('') || '<option value="">No groups yet</option>'}</select></label>
        <div id="aud-pick" hidden class="ln-pick">${customers.map((c) => `<label class="check"><input type="checkbox" value="${c.id}" ${c.opted_out_at ? 'disabled' : ''}>
          ${esc(c.name)} <span class="muted small">${c.opted_out_at ? 'opted out' : esc(c.group_name || '')}</span></label>`).join('') || '<span class="muted small">No customers yet.</span>'}</div>
        <label class="field"><span>Channel</span><select name="channel">${Object.entries(CHANNEL_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Message</span><textarea name="body" maxlength="1000" style="min-height:120px" placeholder="Hi {name}, …"></textarea></label>
        <div class="row small"><span class="muted">Insert:</span>${['{name}', '{due_date}', '{amount}', '{company}'].map((t) => `<button type="button" class="sm" data-ins="${t}">${t}</button>`).join('')}
          <span class="grow"></span><span class="muted" id="ln-count">0 chars</span></div>
        ${editor ? '<div><button class="primary">Send</button></div>' : ''}
      </form>
      <div class="card stack"><h2 style="margin:0">Preview</h2>
        <div class="ln-phone"><div class="ln-bubble" id="ln-preview">Your message will appear here.</div></div>
        <ul class="muted small ln-notes">
          <li><strong>{amount}</strong> is the customer's overdue total; <strong>{due_date}</strong> is their next due date.</li>
          <li>SMS and WhatsApp messages get “Reply STOP to opt out.” added automatically.</li>
          <li>Customers who opted out, or haven't agreed to this channel, are skipped and shown in the log.</li>
          <li>No messaging provider is connected yet: messages are logged, not delivered.</li>
        </ul></div>
    </div>`);
    wire();
    const form = document.getElementById('ln-send-form');
    const f = form.elements;
    let aud = 'group';
    form.querySelectorAll('[data-aud]').forEach((b) => b.onclick = () => {
      aud = b.dataset.aud;
      form.querySelectorAll('[data-aud]').forEach((x) => x.classList.toggle('on', x === b));
      document.getElementById('aud-group').hidden = aud !== 'group';
      document.getElementById('aud-pick').hidden = aud !== 'pick';
      preview();
    });
    const sample = () => {
      if (aud === 'pick') {
        const id = Number(form.querySelector('#aud-pick input:checked')?.value);
        return customers.find((c) => c.id === id) || customers[0];
      }
      return customers.find((c) => String(c.group_id) === f.namedItem('group_id').value) || customers[0];
    };
    const preview = () => {
      const c = sample();
      const body = f.namedItem('body').value;
      const text = body.replace(/\{(\w+)\}/g, (m, k) => ({
        name: c?.name.split(/\s+/)[0] || 'Asha', company: state.workspace.name,
        due_date: c?.next_due ? fmtDay(c.next_due) : '', amount: c?.overdue_amount ? fmtMoney(c.overdue_amount) : '',
      })[k] ?? m);
      const footer = f.namedItem('channel').value !== 'email' && body && !/\bSTOP\b/.test(body) ? ' Reply STOP to opt out.' : '';
      document.getElementById('ln-preview').textContent = (text + footer) || 'Your message will appear here.';
      const n = [...(text + footer)].length;
      document.getElementById('ln-count').textContent = f.namedItem('channel').value === 'sms' ? `${n} chars · ${Math.max(1, Math.ceil(n / 153))} SMS` : `${n} chars`;
    };
    form.oninput = preview;
    form.onchange = preview;
    form.querySelectorAll('[data-ins]').forEach((b) => b.onclick = () => {
      const ta = f.namedItem('body');
      const at = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, at) + b.dataset.ins + ta.value.slice(ta.selectionEnd ?? at);
      ta.focus();
      preview();
    });
    form.onsubmit = (e) => { e.preventDefault(); act(form.querySelector('button.primary'), async () => {
      const body = { channel: f.namedItem('channel').value, body: f.namedItem('body').value };
      if (aud === 'group') body.group_id = f.namedItem('group_id').value;
      else body.customer_ids = [...form.querySelectorAll('#aud-pick input:checked')].map((i) => Number(i.value));
      const r = await api('/loans/send', { method: 'POST', body });
      toast(`${r.recipients} recipient${r.recipients === 1 ? '' : 's'}: ${r.simulated + r.sent} logged, ${r.skipped} skipped`);
      location.hash = '#/loans/log';
    }); };
    return;
  }

  if (tab === 'rules') {
    const r = await api('/loans/rules');
    const admin = can.admin();
    const dis = admin ? '' : 'disabled';
    head('rules', `<form class="two-col" id="ln-rules">
      <div class="card stack">
        <label class="switch-row"><input type="checkbox" name="enabled" ${r.enabled ? 'checked' : ''} ${dis}><span><strong>Send reminders automatically</strong>
          <span class="muted small">Checked every 10 minutes. Each reminder is sent once.</span></span></label>
        <fieldset class="consents" ${dis}><legend>Remind before the due date</legend>
          ${[14, 7, 5, 3, 2, 1].map((d) => `<label class="check"><input type="checkbox" name="before" value="${d}" ${r.days_before.includes(d) ? 'checked' : ''}> ${d} day${d === 1 ? '' : 's'}</label>`).join('')}</fieldset>
        <label class="check"><input type="checkbox" name="on_due_day" ${r.on_due_day ? 'checked' : ''} ${dis}> On the due date</label>
        <label class="field"><span>While overdue, remind every</span><select name="overdue_every" ${dis}>
          ${[0, 1, 2, 3, 5, 7, 14].map((d) => `<option value="${d}" ${d === r.overdue_every ? 'selected' : ''}>${d ? `${d} day${d === 1 ? '' : 's'}` : 'Never'}</option>`).join('')}</select></label>
        <label class="field"><span>Send by</span><select name="channel" ${dis}>${Object.entries(CHANNEL_LABEL).map(([k, l]) => `<option value="${k}" ${k === r.channel ? 'selected' : ''}>${l}${r.channels[k] ? '' : ' (not set up)'}</option>`).join('')}</select></label>
        ${admin ? `<div class="row"><button class="primary">Save rules</button><button type="button" id="ln-run">Run now</button></div>` : '<p class="muted small">Only admins can change reminder rules.</p>'}
      </div>
      <div class="card stack"><h2 style="margin:0">Messages</h2>
        <p class="muted small" style="margin:0">Placeholders: {name} · {amount} · {due_date} · {loan} · {company}</p>
        ${[['template_before', 'Before the due date'], ['template_due', 'On the due date'], ['template_overdue', 'Overdue']].map(([k, l]) => `
          <label class="field"><span>${l}</span><textarea name="${k}" maxlength="600" style="min-height:80px" ${dis}>${esc(r[k])}</textarea></label>`).join('')}
      </div>
    </form>`);
    wire();
    const form = document.getElementById('ln-rules');
    form.onsubmit = (e) => { e.preventDefault(); act(form.querySelector('button.primary'), async () => {
      const f = form.elements;
      await api('/loans/rules', { method: 'PUT', body: {
        enabled: f.namedItem('enabled').checked, on_due_day: f.namedItem('on_due_day').checked,
        days_before: [...form.querySelectorAll('[name="before"]:checked')].map((i) => Number(i.value)),
        overdue_every: Number(f.namedItem('overdue_every').value), channel: f.namedItem('channel').value,
        template_before: f.namedItem('template_before').value, template_due: f.namedItem('template_due').value,
        template_overdue: f.namedItem('template_overdue').value,
      } });
      toast('Reminder rules saved');
      route();
    }); };
    document.getElementById('ln-run')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      const { created } = await api('/loans/rules/run', { method: 'POST', body: {} });
      toast(created ? `${created} reminder${created === 1 ? '' : 's'} created` : 'No reminders due right now');
    }));
    return;
  }

  // log
  const filter = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || '';
  const log = await api(`/loans/messages${filter ? `?status=${filter}` : ''}`);
  head('log', `<div class="card stack">
    <div class="filters" style="margin:0">${[['', 'All'], ['simulated', 'Logged'], ['sent', 'Sent'], ['skipped', 'Skipped'], ['failed', 'Failed']].map(([k, l]) =>
      `<button class="sm ${k === filter ? 'on' : ''}" data-lf="${k}">${l}</button>`).join('')}</div>
    ${log.length ? `<div class="table-wrap"><table class="ln-table"><thead><tr><th>When</th><th>Customer</th><th>Channel</th><th>Type</th><th>Status</th><th>Message</th></tr></thead>
      <tbody>${log.map((m) => `<tr>
        <td class="nowrap small">${fmtDateTime(m.created_at)}</td>
        <td>${m.customer_id ? `<a href="#/loans/customer-${m.customer_id}">${esc(m.customer_name)}</a>` : '<span class="muted">Former customer</span>'}</td>
        <td>${CHANNEL_LABEL[m.channel]}</td><td class="muted">${esc(m.kind === 'manual' ? `Manual · ${m.sent_by_name || ''}` : `Auto · ${m.kind}`)}</td>
        <td><span class="msg-st ${m.status}">${MSG_STATUS[m.status]}</span>${m.reason && m.status !== 'simulated' ? `<div class="muted small">${esc(m.reason)}</div>` : ''}</td>
        <td class="ln-body">${esc(m.body)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="pipe-empty">No messages yet.</div>'}</div>`);
  wire();
  document.querySelectorAll('[data-lf]').forEach((b) => b.onclick = () => { location.hash = `#/loans/log${b.dataset.lf ? `?status=${b.dataset.lf}` : ''}`; });
};

async function loanCustomerView(id, head, wire) {
  const [c, groups] = await Promise.all([api(`/loans/customers/${id}`), api('/loans/groups')]);
  const editor = can.edit();
  const today = new Date().toISOString().slice(0, 10);
  head('customers', `<div><a href="#/loans/customers" class="small strong-link">← All customers</a></div>
    <div class="two-col" style="margin-top:12px">
      <div class="stack">
        <div class="card stack">
          <div class="row"><span class="ln-gicon big">${esc(initials(c.name))}</span>
            <div class="grow"><h2 style="margin:0">${esc(c.name)}</h2><span class="muted small">${esc([c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details')}${c.group_name ? ` · ${esc(c.group_name)}` : ''}</span></div>
            ${c.opted_out_at ? '<span class="pill-muted danger">Opted out</span>' : ''}</div>
          <div class="row">${['sms', 'whatsapp', 'email'].map((ch) => `<span class="pill-muted ${c[`consent_${ch}`] ? 'ok' : ''}">${c[`consent_${ch}`] ? '✓' : '✕'} ${CHANNEL_LABEL[ch]}</span>`).join('')}</div>
          ${c.notes ? `<p class="muted" style="margin:0;white-space:pre-wrap">${esc(c.notes)}</p>` : ''}
          ${editor ? `<div class="row"><button class="sm" id="cu-edit">Edit</button>
            <button class="sm" id="cu-opt">${c.opted_out_at ? 'Undo opt-out' : 'Mark opted out'}</button>
            <button class="sm" id="cu-msg">Message</button><span class="grow"></span><button class="sm danger ghost" id="cu-del">Delete</button></div>` : ''}
        </div>
        <div class="card stack"><h2 style="margin:0">Messages</h2>
          ${c.messages.length ? c.messages.map((m) => `<div class="ln-msg"><span class="nd ${m.status === 'skipped' ? 'pending' : 'scheduled'}"></span>
            <span class="grow"><span class="muted small">${CHANNEL_LABEL[m.channel]} · ${esc(m.kind)} · ${MSG_STATUS[m.status]}</span><span class="small">${esc(m.status === 'skipped' ? m.reason : m.body)}</span></span>
            <span class="muted small">${fmtDateTime(m.created_at)}</span></div>`).join('') : '<div class="pipe-empty">No messages yet.</div>'}
        </div>
      </div>
      <div class="stack">
        ${c.loans.map((l) => {
          const paid = l.installments.filter((i) => i.paid_at).length;
          return `<div class="card stack">
          <div class="row"><h2 class="grow" style="margin:0">${esc(l.reference || `Loan #${l.id}`)}</h2><span class="status ${l.status === 'active' ? 'scheduled' : 'published'}">${l.status}</span></div>
          <div class="muted small">${fmtMoney(l.principal)} · ${l.installments.length} ${l.frequency} instalments of ${fmtMoney(l.installment_amount)} · ${paid}/${l.installments.length} paid</div>
          <div class="pbar"><div style="width:${(paid / l.installments.length) * 100}%"></div></div>
          <div class="ln-inst">${l.installments.map((i) => `<div class="ln-inst-row ${i.paid_at ? 'paid' : i.due_date < today ? 'late' : ''}">
            <span class="muted small">#${i.seq}</span><span class="grow">${fmtDay(i.due_date)}</span><span>${fmtMoney(i.amount)}</span>
            ${editor ? `<button class="sm" data-pay="${i.id}" data-paid="${i.paid_at ? 1 : 0}">${i.paid_at ? '✓ Paid' : 'Mark paid'}</button>` : `<span class="small">${i.paid_at ? '✓ Paid' : ''}</span>`}</div>`).join('')}</div>
          ${editor ? `<div class="row"><button class="sm danger ghost" data-del-loan="${l.id}">Delete loan</button></div>` : ''}
        </div>`;
        }).join('') || '<div class="card pipe-empty">No loans yet.</div>'}
        ${editor ? `<form class="card stack" id="cu-loan"><h2 style="margin:0">Add a loan</h2>
          <div class="two-col" style="gap:12px">
            <label class="field"><span>Reference</span><input name="reference" maxlength="60" placeholder="e.g. L-2026-014"></label>
            <label class="field"><span>Amount (${esc(state.workspace.currency)})</span><input name="principal" type="number" min="1" step="0.01" required></label>
            <label class="field"><span>Instalments</span><input name="installments" type="number" min="1" max="360" value="12" required></label>
            <label class="field"><span>Every</span><select name="frequency"><option value="monthly">Month</option><option value="weekly">Week</option></select></label>
            <label class="field"><span>First due date</span><input name="first_due" type="date" required value="${today}"></label>
            <label class="field"><span>Instalment amount (optional)</span><input name="installment_amount" type="number" min="0.01" step="0.01" placeholder="Amount ÷ instalments"></label>
          </div>
          <div><button class="primary">Add loan</button></div></form>` : ''}
      </div>
    </div>`);
  wire();
  if (!editor) return;
  document.getElementById('cu-edit').onclick = () => openDialog('Edit customer', customerForm(c, groups), async (form) => {
    await api(`/loans/customers/${c.id}`, { method: 'PATCH', body: customerBody(form) });
    toast('Customer saved');
    route();
  });
  document.getElementById('cu-opt').onclick = (e) => act(e.currentTarget, async () => {
    await api(`/loans/customers/${c.id}/opt-out`, { method: 'POST', body: { opted_out: !c.opted_out_at } });
    toast(c.opted_out_at ? 'Opt-out removed' : 'Marked as opted out: no more messages');
    route();
  });
  document.getElementById('cu-msg').onclick = () => openDialog(`Message ${c.name}`, `
    <label class="field"><span>Channel</span><select name="channel">${Object.entries(CHANNEL_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <label class="field"><span>Message</span><textarea name="body" maxlength="1000" required style="min-height:100px">Hi {name}, </textarea></label>`, async (form) => {
    const r = await api('/loans/send', { method: 'POST', body: { customer_ids: [c.id], channel: form.elements.namedItem('channel').value, body: form.elements.namedItem('body').value } });
    toast(r.skipped ? 'Skipped: see the log for why' : 'Message logged');
    route();
  }, 'Send');
  document.getElementById('cu-del').onclick = (e) => act(e.currentTarget, async () => {
    if (!await confirmDialog(`Delete ${c.name}?`, `${c.name} and all their loans will be deleted. This cannot be undone.`)) return;
    await api(`/loans/customers/${c.id}`, { method: 'DELETE', body: {} });
    location.hash = '#/loans/customers';
  });
  document.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => act(b, async () => {
    await api(`/loans/installments/${b.dataset.pay}/pay`, { method: 'POST', body: { paid: b.dataset.paid !== '1' } });
    route();
  }));
  document.querySelectorAll('[data-del-loan]').forEach((b) => b.onclick = () => act(b, async () => {
    if (!await confirmDialog('Delete loan?', 'This loan and its repayment schedule will be deleted.')) return;
    await api(`/loans/loans/${b.dataset.delLoan}`, { method: 'DELETE', body: {} });
    route();
  }));
  const lf = document.getElementById('cu-loan');
  lf.onsubmit = (e) => { e.preventDefault(); act(lf.querySelector('button'), async () => {
    const f = lf.elements;
    await api(`/loans/customers/${c.id}/loans`, { method: 'POST', body: {
      reference: f.namedItem('reference').value, principal: Number(f.namedItem('principal').value),
      installments: Number(f.namedItem('installments').value), frequency: f.namedItem('frequency').value,
      first_due: f.namedItem('first_due').value,
      ...(f.namedItem('installment_amount').value ? { installment_amount: Number(f.namedItem('installment_amount').value) } : {}),
    } });
    toast('Loan added with its schedule');
    route();
  }); };
}

// ---------- setup: connections ----------

const SETUP_ICON = {
  sms: SVG('<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-6.2A8 8 0 1 1 21 12z"/>'),
  whatsapp: SVG('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  email: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
};
const SUPPORT_LABEL = { image: 'images', video: 'video', text: 'text', carousel: 'carousels', link: 'links', templates: 'templates', html: 'HTML' };

// ---------- setup: AI provider ----------

function aiSetupHtml(ai) {
  const admin = can.admin();
  const active = ai.providers.find((p) => p.key === ai.active_provider);
  const state = ai.source === 'workspace'
    ? `<div class="ai-state on">✓ Using <strong>${esc(active.label)}</strong> (${esc(ai.active_model)}) with your workspace's own key.</div>`
    : ai.source === 'platform'
      ? `<div class="ai-state">Using the platform's AI for now. Choose a provider to use your own key and limits.</div>`
      : `<div class="ai-state off">AI is off. Choose a provider and save its key to turn on AI drafts and Content writing.</div>`;
  return `<section class="card stack ai-setup" id="ai-setup">
    <h2 class="ai-setup-title">${SVG('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>')} AI provider for your workspace</h2>
    <p class="muted small" style="margin:0">Used for AI drafts in the composer and Content writing, by everyone in this workspace.
      Keys are stored encrypted and never shown again.</p>
    ${state}
    <div class="ai-prov-grid" role="radiogroup" aria-label="AI provider">${ai.providers.map((p) => `
      <button type="button" role="radio" class="ai-prov" data-prov="${p.key}" aria-checked="false" ${admin ? '' : 'disabled'}>
        <span class="row"><strong class="grow">${esc(p.label)}</strong><span class="pill-muted ${p.badge === 'Paid' ? '' : 'ok'}">${esc(p.badge)}</span></span>
        <span class="muted small">${esc(p.description)}</span>
        <span class="small ai-prov-status">${p.configured ? `Key saved ${esc(p.hint)}` : 'No key yet'}${ai.selected === p.key ? ' · <strong>Selected</strong>' : ''}</span>
      </button>`).join('')}
    </div>
    ${admin ? `<div id="ai-form" class="stack"></div>` : '<p class="muted small" style="margin:0">Only admins can change the AI provider.</p>'}
  </section>`;
}

function bindAiSetup(ai) {
  if (!can.admin()) return;
  let pick = ai.selected || ai.providers.find((p) => p.configured)?.key || 'anthropic';
  const form = document.getElementById('ai-form');
  const renderForm = () => {
    const p = ai.providers.find((x) => x.key === pick);
    document.querySelectorAll('[data-prov]').forEach((b) => {
      b.classList.toggle('on', b.dataset.prov === pick);
      b.setAttribute('aria-checked', String(b.dataset.prov === pick));
    });
    form.innerHTML = `
      <div class="two-col" style="gap:14px;align-items:end">
        <label class="field"><span class="row"><span class="grow">API key</span>
          <a href="${esc(p.key_url)}" target="_blank" rel="noopener noreferrer" class="small strong-link">Get a key ↗</a></span>
          <input id="ai-key" type="password" autocomplete="off" spellcheck="false" maxlength="300"
            placeholder="${p.configured ? `Saved (${esc(p.hint)}): leave blank to keep` : `${esc(p.key_prefix)}…`}"></label>
        <div class="ai-model-auto">${SVG('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>')}
          <span>Model is chosen automatically${p.configured && p.model ? `: <strong>${esc(p.model)}</strong>` : '. Nexora checks which models your key can use and picks the best one that answers.'}</span></div>
      </div>
      <div class="row"><button type="button" id="ai-test">${SVG('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>')} Test connection</button>
        <span id="ai-test-out" class="small" role="status"></span></div>
      <div class="row"><button type="button" class="primary" id="ai-save">${SVG('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>')} Save &amp; connect</button>
        <span class="grow"></span>
        ${ai.selected ? '<button type="button" class="sm ghost" id="ai-off">Stop using a workspace provider</button>' : ''}
        ${p.configured ? `<button type="button" class="sm danger ghost" id="ai-remove">Remove ${esc(p.label)} key</button>` : ''}</div>`;

    const key = () => document.getElementById('ai-key').value.trim();
    const out = document.getElementById('ai-test-out');
    const working = (msg) => { out.className = 'small muted'; out.textContent = msg; };
    const failed = (err) => { out.className = 'small err-text'; out.textContent = `✕ ${err.message}`; };
    document.getElementById('ai-test').onclick = (e) => {
      working('Checking your key and finding a model…');
      act(e.currentTarget, async () => {
        try {
          const r = await api('/ai/test', { method: 'POST', body: { provider: pick, api_key: key() } });
          out.className = 'small ok-text';
          out.textContent = `✓ Connected · ${r.model} · ${(r.ms / 1000).toFixed(1)} s`;
        } catch (err) { failed(err); }
      });
    };
    document.getElementById('ai-save').onclick = (e) => {
      working('Checking your key and finding a model…');
      act(e.currentTarget, async () => {
        try {
          const r = await api('/ai/settings', { method: 'PUT', body: { provider: pick, api_key: key() } });
          state.aiEnabled = (await api('/me')).ai_enabled;
          toast(`Connected to ${p.label} · ${r.detected.model}`);
          route();
        } catch (err) { failed(err); }
      });
    };
    document.getElementById('ai-off')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      await api('/ai/settings/unselect', { method: 'POST', body: {} });
      state.aiEnabled = (await api('/me')).ai_enabled;
      toast('Stopped using a workspace AI provider');
      route();
    }));
    document.getElementById('ai-remove')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      if (!await confirmDialog(`Remove ${p.label} key?`, `The saved ${p.label} key will be removed from this workspace.`, 'Remove key')) return;
      await api(`/ai/settings/${pick}`, { method: 'DELETE', body: {} });
      state.aiEnabled = (await api('/me')).ai_enabled;
      toast(`${p.label} key removed`);
      route();
    }));
  };
  document.querySelectorAll('[data-prov]').forEach((b) => b.onclick = () => { pick = b.dataset.prov; renderForm(); });
  renderForm();
}

views.setup = async () => {
  const [data, aiSettings] = await Promise.all([api('/integrations'), api('/ai/settings')]);
  const admin = can.admin();
  const card = (kind, it) => `
    <article class="setup-card ${it.configured ? 'saved' : ''}" data-kind="${kind}" data-key="${it.key}">
      <div class="setup-top">
        <span class="setup-icon">${netLogo(it.key, 28) || SETUP_ICON[it.key]}</span>
        <div class="grow"><h3>${esc(it.label)}</h3><span class="muted small">Supports ${it.supports.map((s) => SUPPORT_LABEL[s] || s).join(', ')}</span></div>
        <div class="setup-pills"><span class="pill-muted ${it.configured ? 'ok' : ''}">${it.configured ? 'Details saved' : 'Not connected'}</span>
          <span class="pill-muted amber">Not available yet</span></div>
      </div>
      <p class="setup-note small">${NAV_ICON.settings}<span>${it.configured
        ? `Details saved${it.hint ? ` (${esc(it.hint)})` : ''}${it.updated_by ? ` by ${esc(it.updated_by)}` : ''} on ${fmtDateTime(it.updated_at)}. ${kind === 'social' ? 'Connecting' : 'Delivery'} isn't available yet.`
        : `Not set up yet. ${admin ? 'Add your own app’s details to get ready.' : 'Ask an admin to add the app’s details.'}`}</span></p>
      <div class="setup-actions">
        <button data-act="details" ${admin ? '' : 'disabled title="Only admins can add details"'}>${NAV_ICON.plus} ${it.configured ? 'Edit details' : 'Add details'}</button>
        <button class="primary" data-act="connect" ${admin ? '' : 'disabled'}>${SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>')} Connect</button>
        <button data-act="guide">${NAV_ICON.posts} Guide</button>
      </div>
    </article>`;

  shell('setup', 'Setup', '', `
    ${aiSetupHtml(aiSettings)}
    <div class="card ln-banner setup-banner">
      <div class="row"><strong>Publishing and message delivery are still being built.</strong>
        <span class="muted">You can save each app's details now, so everything is ready to connect once they are.</span></div>
      ${data.encryption_ready ? '' : '<p class="pc-overdue small" style="margin:10px 0 0">⚠ Saving details needs TOKEN_ENCRYPTION_KEY in .env (see .env.example).</p>'}
    </div>
    <section class="setup-section"><h2>${NAV_ICON.media} Social networks <span class="muted small">Where posts are published</span></h2>
      <div class="setup-grid">${data.social.map((it) => card('social', it)).join('')}</div></section>
    <section class="setup-section"><h2>${SETUP_ICON.sms} Messaging channels <span class="muted small">Used by Loan reminders for due-date reminders and messages to customers</span></h2>
      <div class="setup-grid">${data.messaging.map((it) => card('messaging', it)).join('')}</div></section>`,
  { eyebrow: 'Account', subtitle: 'Connect your social networks and the channels that send customer messages' });

  bindAiSetup(aiSettings);
  const find = (el) => {
    const c = el.closest('[data-kind]');
    return { kind: c.dataset.kind, it: data[c.dataset.kind].find((x) => x.key === c.dataset.key) };
  };
  document.querySelectorAll('[data-act="details"]').forEach((btn) => btn.onclick = () => {
    const { kind, it } = find(btn);
    openDialog(`${it.label}: app details`, `
      <p class="muted small" style="margin:0">Stored encrypted. Secrets are never shown again${it.configured ? '. Leave a secret blank to keep the saved one' : ''}.</p>
      ${it.fields.map((f) => f.name === 'provider'
        ? `<label class="field"><span>${esc(f.label)}</span><select name="provider">${it.providers.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>`
        : `<label class="field"><span>${esc(f.label)}</span><input name="${f.name}" ${f.secret ? 'type="password" autocomplete="new-password"' : 'autocomplete="off"'}
            ${f.secret && it.configured ? 'placeholder="Saved: leave blank to keep"' : ''} maxlength="500"></label>`).join('')}
      ${it.configured ? '<label class="check small"><input type="checkbox" name="remove"> Remove the saved details instead</label>' : ''}`, async (form) => {
      const f = form.elements;
      if (f.namedItem('remove')?.checked) {
        await api(`/integrations/${kind}/${it.key}`, { method: 'DELETE', body: {} });
        toast(`${it.label} details removed`);
      } else {
        const body = Object.fromEntries(it.fields.map((x) => [x.name, f.namedItem(x.name).value]));
        await api(`/integrations/${kind}/${it.key}`, { method: 'PUT', body });
        toast(`${it.label} details saved`);
      }
      route();
    });
  });
  document.querySelectorAll('[data-act="connect"]').forEach((btn) => btn.onclick = () => act(btn, async () => {
    const { kind, it } = find(btn);
    try {
      await api(`/integrations/${kind}/${it.key}/connect`, { method: 'POST', body: {} });
    } catch (err) {
      openDialog(`Connect ${it.label}`, `<p style="margin:0">${esc(err.message)}</p>
        <p class="muted small" style="margin:0">Next steps: follow the Guide to create and get approval for your ${esc(it.label)} app, then save its details here.</p>`,
      async () => {}, 'OK');
    }
  }));
  document.querySelectorAll('[data-act="guide"]').forEach((btn) => btn.onclick = () => {
    const { it } = find(btn);
    openDialog(`Set up ${it.label}`, `
      <ol class="setup-steps">${it.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${it.portal ? `<a class="strong-link" href="${esc(it.portal)}" target="_blank" rel="noopener noreferrer">Open the ${esc(it.label)} developer site ↗</a>` : ''}`,
    async () => {}, 'Done');
  });
};

// ---------- link in bio & tracked links ----------

const LINKS_HERO = `<div class="hero-art" aria-hidden="true">
  <svg viewBox="0 0 260 150">
    <path d="M6 130 C 50 130, 74 92, 114 96" stroke="var(--violet)" stroke-width="2" fill="none" stroke-dasharray="4 5" opacity=".5"/>
    <circle cx="114" cy="96" r="4" fill="var(--violet)"/>
    <g class="float-a"><rect x="114" y="28" width="104" height="84" rx="18" fill="var(--violet)"/>
      <rect x="114" y="28" width="104" height="30" rx="18" fill="#fff" opacity=".14"/>
      <circle cx="166" cy="70" r="22" fill="#fff" opacity=".18"/>
      <circle cx="166" cy="70" r="12" fill="none" stroke="#fff" stroke-width="2.4"/>
      <path d="M154 70h24M166 58c4 4 4 20 0 24M166 58c-4 4-4 20 0 24" stroke="#fff" stroke-width="2" fill="none"/></g>
    <g class="float-b"><rect x="198" y="6" width="44" height="44" rx="12" fill="#fff" stroke="var(--border)"/>
      <path d="M214 30l12-12M216 21h10v10" stroke="var(--ink)" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
    <g class="float-c"><rect x="176" y="104" width="64" height="34" rx="10" fill="#fff" stroke="var(--border)"/>
      <rect x="188" y="121" width="7" height="8" rx="2" fill="var(--violet-2)"/><rect x="199" y="115" width="7" height="14" rx="2" fill="var(--violet)"/>
      <rect x="210" y="110" width="7" height="19" rx="2" fill="var(--ink)"/><rect x="221" y="118" width="7" height="11" rx="2" fill="var(--amber)"/></g>
    <g class="float-a"><rect x="90" y="8" width="38" height="20" rx="10" fill="var(--amber)"/><circle cx="118" cy="18" r="6" fill="#fff"/></g>
  </svg></div>`;

const UTM_SOURCES = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube', 'whatsapp', 'email', 'sms', 'qr'];
const UTM_MEDIUMS = ['social', 'bio', 'email', 'sms', 'paid', 'print'];

/** Bare addresses like example.com/menu get https:// so people needn't type it. */
const withScheme = (u) => (!u.trim() || /^[a-z][\w+.-]*:/i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);

async function copyText(text, what = 'Link') {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Copy failed: select the text instead', true); }
}

/** Daily click columns for the last 30 days (zeros filled in). */
function clicksChart(daily) {
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push({ key: ymd(d), d });
  }
  const counts = Object.fromEntries(daily.map((x) => [x.day, x.clicks]));
  const vals = days.map((x) => counts[x.key] || 0);
  const max = Math.max(1, ...vals);
  return `<div class="click-chart" role="img" aria-label="${vals.reduce((a, b) => a + b, 0)} clicks in 30 days">
    ${days.map((x, i) => `<div class="cc-col" title="${vals[i]} click${vals[i] === 1 ? '' : 's'} · ${x.d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}">
      <div class="cc-bar" data-h="${(vals[i] / max) * 100}" style="height:0"></div></div>`).join('')}
  </div>
  <div class="cc-axis small muted">${[0, 7, 14, 21, 29].map((i) => `<span>${days[i].d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>`).join('')}</div>`;
}

views.links = async () => {
  const b = brand();
  const editor = can.edit();
  const [bio, shortLinks] = await Promise.all([api(`/bio?brand_id=${b.id}`), api(`/links?brand_id=${b.id}`)]);
  const page = bio.page;
  const base = `${location.origin}/b/`;
  const shortBase = `${location.host}/b/`;
  const links = page ? page.links.map(({ label, url, clicks }) => ({ label, url, clicks })) : [{ label: '', url: '' }];
  const total = bio.daily.reduce((n, d) => n + d.clicks, 0);
  const dis = editor ? '' : 'disabled';

  shell('links', 'Link in bio & tracked links', '', `
    <div class="two-col">
      <form class="card stack" id="bio-form" novalidate>
        <h2 class="lnk-title">${SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>')} Your link-in-bio page</h2>
        <div class="bio-status">${page
          ? `<span class="pill-muted ok">Live</span><a href="/b/${esc(page.slug)}" target="_blank" rel="noopener" class="clip strong-link">${esc(base + page.slug)} ↗</a>
             <button type="button" class="sm" id="bio-copy">Copy</button>`
          : '<span class="muted small">Not published yet. Save to create your page.</span>'}</div>
        <label class="field"><span>Page address</span>
          <span class="prefixed"><span class="prefix">${esc(shortBase)}</span><input name="slug" maxlength="40" required value="${esc(page?.slug || bio.suggested_slug)}" ${dis} aria-label="Page address"></span></label>
        <div class="two-col" style="gap:12px">
          <label class="field"><span>Title</span><input name="title" maxlength="80" placeholder="${esc(b.name)}" value="${esc(page?.title || '')}" ${dis}></label>
          <label class="field"><span>Accent colour</span><input type="color" name="accent" value="${esc(page?.accent || b.color || '#0b7a75')}" ${dis} class="wide-color"></label>
        </div>
        <label class="field"><span class="row"><span class="grow">Short bio</span><span class="muted small" id="bio-count"></span></span>
          <textarea name="bio" maxlength="300" style="min-height:76px" placeholder="One or two lines about who you are and what you offer." ${dis}>${esc(page?.bio || '')}</textarea></label>
        <div><span class="field-label">Links</span><div id="bio-links" class="stack" style="gap:8px"></div></div>
        ${editor ? `<div class="row"><button type="button" id="bio-add">${NAV_ICON.plus} Add link</button>
          <label class="check small"><input type="checkbox" name="show_posts" ${page?.show_posts === false ? '' : 'checked'}> Show my latest published posts as a grid</label></div>
          <div class="row"><button class="primary">${SVG('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>')} Save page</button></div>` : ''}
      </form>
      <div class="stack">
        <div class="card stack">
          <h2 class="lnk-title">${SVG('<path d="M4 20V4M4 20h16"/><path d="M7 15l4-4 3 3 5-6"/>')} Clicks (30 days)</h2>
          ${clicksChart(bio.daily)}
          <div class="row"><strong class="cc-total">${total}</strong><span class="muted">click${total === 1 ? '' : 's'} on your bio buttons and tracked links</span></div>
          ${page?.links.length ? `<div class="bars">${page.links.map((l) => `<div class="bar"><span class="clip">${esc(l.label)}</span>
            <div class="track"><div class="fill" data-w="${(l.clicks / Math.max(1, ...page.links.map((x) => x.clicks))) * 100}" style="width:0"></div></div><span>${l.clicks}</span></div>`).join('')}</div>` : ''}
        </div>
        <div class="card stack"><h2 class="lnk-title">${NAV_ICON.media} Preview</h2>
          <div class="phone"><div class="phone-screen" id="bio-preview"></div></div></div>
      </div>
    </div>
    <section class="card stack" style="margin-top:20px">
      <h2 class="lnk-title">${SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>')} Tracked links (UTM)
        <span class="muted small" style="font-weight:500">Short links that tag where visitors came from, so your website analytics can tell</span></h2>
      ${editor ? `<form class="utm-form" id="utm-form" novalidate>
        <label class="field utm-url"><span>Destination</span><input name="url" placeholder="https://yourwebsite.com/apply" required></label>
        <label class="field"><span>Label</span><input name="label" maxlength="80" placeholder="November webinar"></label>
        <label class="field"><span>Source</span><input name="utm_source" list="utm-sources" maxlength="60" placeholder="instagram"></label>
        <label class="field"><span>Medium</span><input name="utm_medium" list="utm-mediums" maxlength="60" placeholder="social"></label>
        <label class="field"><span>Campaign</span><input name="utm_campaign" maxlength="60" placeholder="nov-webinar"></label>
        <button class="primary">${NAV_ICON.plus} Create link</button>
        <datalist id="utm-sources">${UTM_SOURCES.map((s) => `<option value="${s}">`).join('')}</datalist>
        <datalist id="utm-mediums">${UTM_MEDIUMS.map((s) => `<option value="${s}">`).join('')}</datalist>
      </form>` : ''}
      ${shortLinks.length ? `<div class="table-wrap"><table class="ln-table"><thead><tr><th>Link</th><th>Short link</th><th>Tags</th><th>Clicks</th><th>Created</th><th></th></tr></thead>
        <tbody>${shortLinks.map((s) => `<tr>
          <td><strong>${esc(s.label || 'Untitled')}</strong><div class="muted small clip" style="max-width:280px">${esc(s.url)}</div></td>
          <td class="nowrap"><code>${esc(location.host)}/l/${esc(s.code)}</code> <button class="sm" data-copy-short="${esc(s.code)}">Copy</button></td>
          <td>${['utm_source', 'utm_medium', 'utm_campaign'].filter((k) => s[k]).map((k) => `<span class="pill-muted">${esc(s[k])}</span>`).join(' ') || '<span class="muted small">—</span>'}</td>
          <td><strong>${s.clicks}</strong> <span class="muted small">(${s.clicks_7d} this week)</span></td>
          <td class="small muted nowrap">${fmtDateTime(s.created_at)}</td>
          <td>${editor ? `<button class="sm danger ghost" data-del-short="${s.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="pipe-empty">No tracked links yet. Create one above and use it in your posts, emails or a QR code.</div>'}
    </section>`,
  { eyebrow: 'Growth', subtitle: `Your public link page and click-tracked links for ${b.name}`, hero: LINKS_HERO });

  animateCharts();
  const form = document.getElementById('bio-form');
  const f = form.elements;
  const linksBox = document.getElementById('bio-links');
  const preview = () => {
    const title = f.namedItem('title').value.trim() || b.name;
    const accent = f.namedItem('accent').value;
    document.getElementById('bio-count').textContent = `${[...f.namedItem('bio').value].length}/300`;
    document.getElementById('bio-preview').innerHTML = `
      <div class="pv" style="--a:${esc(accent)}">
        <div class="pv-av">${esc((title[0] || '?').toUpperCase())}</div>
        <div class="pv-title">${esc(title)}</div>
        ${f.namedItem('bio').value.trim() ? `<div class="pv-bio">${esc(f.namedItem('bio').value.trim())}</div>` : ''}
        ${links.filter((l) => l.label.trim()).map((l) => `<div class="pv-btn">${esc(l.label)}</div>`).join('') || '<div class="pv-empty">Your link buttons appear here</div>'}
        ${f.namedItem('show_posts')?.checked ?? true ? '<div class="pv-grid"><span></span><span></span><span></span><span></span></div>' : ''}
      </div>`;
  };
  const renderLinks = () => {
    linksBox.innerHTML = links.map((l, i) => `<div class="bio-link-row">
      <input placeholder="Button text" maxlength="80" value="${esc(l.label)}" data-i="${i}" data-k="label" ${dis} aria-label="Button text ${i + 1}">
      <input placeholder="https://…" maxlength="2000" value="${esc(l.url)}" data-i="${i}" data-k="url" ${dis} aria-label="Link ${i + 1} address">
      ${editor ? `<span class="bl-actions"><button type="button" class="icon-btn sm-icon" data-move="${i}" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn sm-icon" data-move="${i}" data-dir="1" aria-label="Move down" ${i === links.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn sm-icon" data-remove="${i}" aria-label="Remove link">✕</button></span>` : ''}
    </div>`).join('') || '<span class="muted small">No links yet.</span>';
    linksBox.querySelectorAll('input').forEach((inp) => inp.oninput = () => { links[Number(inp.dataset.i)][inp.dataset.k] = inp.value; preview(); });
    linksBox.querySelectorAll('[data-move]').forEach((btn) => btn.onclick = () => {
      const i = Number(btn.dataset.move);
      const j = i + Number(btn.dataset.dir);
      [links[i], links[j]] = [links[j], links[i]];
      renderLinks();
      preview();
    });
    linksBox.querySelectorAll('[data-remove]').forEach((btn) => btn.onclick = () => { links.splice(Number(btn.dataset.remove), 1); renderLinks(); preview(); });
  };
  renderLinks();
  preview();
  form.oninput = preview;
  document.getElementById('bio-add')?.addEventListener('click', () => {
    if (links.length >= 20) { toast('A page can have up to 20 links', true); return; }
    links.push({ label: '', url: '' });
    renderLinks();
    linksBox.querySelector(`[data-i="${links.length - 1}"]`)?.focus();
  });
  document.getElementById('bio-copy')?.addEventListener('click', () => copyText(base + page.slug, 'Page link'));
  form.onsubmit = (e) => {
    e.preventDefault();
    act(form.querySelector('button.primary'), async () => {
      const r = await api('/bio', { method: 'PUT', body: {
        brand_id: b.id, slug: f.namedItem('slug').value.trim().toLowerCase(), title: f.namedItem('title').value,
        bio: f.namedItem('bio').value, accent: f.namedItem('accent').value, show_posts: f.namedItem('show_posts').checked,
        links: links.map(({ label, url }) => ({ label, url: withScheme(url) })),
      } });
      toast(`Page saved: ${base}${r.slug}`);
      route();
    });
  };

  const uf = document.getElementById('utm-form');
  if (uf) uf.onsubmit = (e) => {
    e.preventDefault();
    act(uf.querySelector('button.primary'), async () => {
      const body = Object.fromEntries(new FormData(uf));
      body.url = withScheme(body.url);
      const s = await api('/links', { method: 'POST', body: { ...body, brand_id: b.id } });
      await copyText(`${location.origin}/l/${s.code}`, 'Short link created and');
      route();
    });
  };
  document.querySelectorAll('[data-copy-short]').forEach((btn) => btn.onclick = () => copyText(`${location.origin}/l/${btn.dataset.copyShort}`, 'Short link'));
  document.querySelectorAll('[data-del-short]').forEach((btn) => btn.onclick = () => act(btn, async () => {
    if (!await confirmDialog('Delete link?', 'It will stop working anywhere it has been shared.')) return;
    await api(`/links/${btn.dataset.delShort}`, { method: 'DELETE', body: {} });
    toast('Link deleted');
    route();
  }));
};

// ---------- content library ----------

/** Start a new draft post for the current brand from a library item, then open it. */
async function useLibraryItem(id) {
  const b = brand();
  const seed = await api(`/library/${id}/use`, { method: 'POST', body: {} });
  const p = await api('/posts', { method: 'POST', body: {
    brand_id: b.id, content: seed.body, media_ids: seed.media_ids, channel_ids: b.channels.map((c) => c.id),
  } });
  toast('Draft created from the library');
  location.hash = `#/compose/${p.id}`;
}

/** Add-or-edit dialog for a library item; `seed` pre-fills a new one (e.g. from the composer). */
async function libraryDialog(item, seed = {}) {
  const [{ categories }, media] = await Promise.all([api('/library'), api('/media')]);
  const v = item || { title: '', body: '', category: 'Educational', tags: [], brand_id: null, media_id: null, ...seed };
  const cats = categories.length ? categories : ['Educational', 'Promotional', 'Seasonal', 'Testimonial', 'Market update', 'Event', 'Other'];
  openDialog(item ? 'Edit library item' : 'Add to library', `
    <label class="field"><span>Title</span><input name="title" maxlength="120" required value="${esc(v.title)}" placeholder="First-time buyer tip"></label>
    <label class="field"><span>Post text</span><textarea name="body" maxlength="10000" required style="min-height:140px">${esc(v.body)}</textarea></label>
    <div class="two-col" style="gap:12px">
      <label class="field"><span>Category</span><select name="category">${cats.map((c) => `<option ${c === v.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field"><span>Available to</span><select name="brand_id"><option value="">All brands</option>
        ${state.brands.map((x) => `<option value="${x.id}" ${x.id === v.brand_id ? 'selected' : ''}>${esc(x.name)} only</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Tags <span class="muted small">(comma separated)</span></span><input name="tags" value="${esc(v.tags.join(', '))}" placeholder="rates, refinance"></label>
    <label class="field"><span>Media <span class="muted small">(optional, from your media library)</span></span><select name="media_id"><option value="">None</option>
      ${media.map((m) => `<option value="${m.id}" ${m.id === v.media_id ? 'selected' : ''}>${m.kind === 'video' ? '🎬' : '🖼️'} ${esc(m.filename || `Media #${m.id}`)}</option>`).join('')}</select></label>
    ${item?.approved && !can.approve() ? '<p class="muted small">Changing the text or media removes the pre-approved mark until an approver checks it again.</p>' : ''}`,
  async (form) => {
    const f = Object.fromEntries(new FormData(form));
    const body = { ...f, brand_id: f.brand_id ? Number(f.brand_id) : null, media_id: f.media_id ? Number(f.media_id) : null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) };
    await api(item ? `/library/${item.id}` : '/library', { method: item ? 'PUT' : 'POST', body });
    toast(item ? 'Library item updated' : 'Added to the library');
    if (location.hash.startsWith('#/library')) route();
  }, item ? 'Save' : 'Add to library');
}

views.library = async () => {
  const b = brand();
  const { categories, items } = await api(`/library?brand_id=${b.id}`);
  const ui = state.libraryUi ||= { q: '', cat: '', approved: false };
  const editor = can.edit();

  shell('library', 'Content library', editor ? `<button class="primary" id="lib-add">${NAV_ICON.plus} Add to library</button>` : '', `
    <div class="lib-layout">
      <aside class="card stack lib-filters">
        <label class="field"><span>Search</span><input id="lib-q" type="search" placeholder="Title, text or tag" value="${esc(ui.q)}"></label>
        <div><span class="field-label">Category</span>
          <div class="lib-cats">${['', ...categories].map((c) => `<button type="button" class="lib-cat ${ui.cat === c ? 'on' : ''}" data-cat="${esc(c)}">
            <span class="grow">${esc(c || 'All')}</span><span class="muted small">${c ? items.filter((i) => i.category === c).length : items.length}</span></button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" id="lib-approved" ${ui.approved ? 'checked' : ''}> Pre-approved only</label>
        <div class="lib-stats">
          <div><strong>${items.length}</strong><span class="muted small">items</span></div>
          <div><strong>${items.filter((i) => i.approved).length}</strong><span class="muted small">pre-approved</span></div>
          <div><strong>${items.reduce((n, i) => n + i.use_count, 0)}</strong><span class="muted small">times used</span></div>
        </div>
        <p class="muted small">Save posts that work so the team can reuse them. Items marked <strong>pre-approved</strong> have been checked by an approver.</p>
      </aside>
      <section id="lib-grid" class="lib-grid"></section>
    </div>`,
  { eyebrow: 'Content', subtitle: `Ready-to-use posts for ${b.name} and all brands` });

  const grid = document.getElementById('lib-grid');
  const render = () => {
    const q = ui.q.toLowerCase();
    const shown = items.filter((i) => (!ui.cat || i.category === ui.cat) && (!ui.approved || i.approved)
      && (!q || `${i.title} ${i.body} ${i.tags.join(' ')}`.toLowerCase().includes(q)));
    grid.innerHTML = shown.length ? shown.map((i) => `<article class="card lib-item">
      <div class="row lib-meta"><span class="pill-muted">${esc(i.category)}</span>
        ${i.approved ? `<span class="lib-ok" title="Approved by ${esc(i.approved_by_name || 'an approver')}">✓ Pre-approved</span>` : ''}
        <span class="grow"></span><span class="muted small">${esc(i.brand_name || 'All brands')}</span></div>
      ${i.media ? `<div class="lib-media">${mediaThumb(i.media)}</div>` : ''}
      <h3>${esc(i.title)}</h3>
      <p class="lib-body">${esc(i.body)}</p>
      ${i.tags.length ? `<div class="lib-tags">${i.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="row lib-foot"><span class="muted small grow">Used ${i.use_count} time${i.use_count === 1 ? '' : 's'}</span>
        ${can.approve() ? `<button class="sm ghost" data-approve="${i.id}" data-on="${i.approved ? 0 : 1}">${i.approved ? 'Unapprove' : 'Approve'}</button>` : ''}
        ${editor ? `<button class="sm ghost" data-edit="${i.id}">Edit</button><button class="sm ghost danger" data-del="${i.id}" aria-label="Delete ${esc(i.title)}">Delete</button>
          <button class="sm primary" data-use="${i.id}">Use</button>` : ''}</div>
    </article>`).join('')
      : `<div class="card pipe-empty">${items.length ? 'Nothing matches these filters.' : `Your library is empty. ${editor ? 'Add a post the team can reuse, or use <strong>Save to library</strong> in the post editor.' : ''}`}</div>`;
    const byId = (id) => items.find((x) => x.id === Number(id));
    grid.querySelectorAll('[data-use]').forEach((btn) => btn.onclick = () => act(btn, () => useLibraryItem(btn.dataset.use)));
    grid.querySelectorAll('[data-edit]').forEach((btn) => btn.onclick = () => libraryDialog(byId(btn.dataset.edit)));
    grid.querySelectorAll('[data-approve]').forEach((btn) => btn.onclick = () => act(btn, async () => {
      await api(`/library/${btn.dataset.approve}/approve`, { method: 'POST', body: { approved: btn.dataset.on === '1' } });
      toast(btn.dataset.on === '1' ? 'Marked as pre-approved' : 'Approval removed');
      route();
    }));
    grid.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () => act(btn, async () => {
      if (!await confirmDialog(`Delete “${byId(btn.dataset.del).title}”?`, 'It will be removed from the library. Posts made from it are not affected.')) return;
      await api(`/library/${btn.dataset.del}`, { method: 'DELETE', body: {} });
      toast('Removed from the library');
      route();
    }));
  };
  render();
  document.getElementById('lib-q').oninput = (e) => { ui.q = e.target.value; render(); };
  document.getElementById('lib-approved').onchange = (e) => { ui.approved = e.target.checked; render(); };
  document.querySelectorAll('[data-cat]').forEach((btn) => btn.onclick = () => {
    ui.cat = btn.dataset.cat;
    document.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === btn));
    render();
  });
  document.getElementById('lib-add')?.addEventListener('click', () => libraryDialog(null));
};

// ---------- monthly reports ----------

const REPORT_TILES = [
  ['published', 'Posts published'], ['created', 'Posts created'], ['link_clicks', 'Link clicks'],
  ['approved', 'Approvals'], ['ai_requests', 'AI writing requests'], ['reminders_sent', 'Loan reminders sent'],
];

const monthLabel = (m) => new Date(`${m}-01T12:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const shiftMonth = (m, by) => {
  const d = new Date(`${m}-01T12:00`);
  d.setMonth(d.getMonth() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function monthDelta(cur, prev) {
  if (!prev && !cur) return '<span class="rp-delta flat">No change</span>';
  if (!prev) return '<span class="rp-delta up">▲ New</span>';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return '<span class="rp-delta flat">No change</span>';
  return `<span class="rp-delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
}

views.reports = async () => {
  const b = brand();
  const ui = state.reportUi ||= { month: '', all: false };
  const r = await api(`/reports/monthly?${new URLSearchParams({ ...(ui.month && { month: ui.month }), ...(!ui.all && { brand_id: b.id }) })}`);
  ui.month = r.month;
  const t = r.totals;
  const prevName = new Date(`${shiftMonth(r.month, -1)}-01T12:00`).toLocaleDateString(undefined, { month: 'short' });
  const tiles = REPORT_TILES.filter(([k]) => k in t);
  const maxDay = Math.max(1, ...r.daily.map((d) => d.published));
  const maxNet = Math.max(1, ...r.by_platform.map((x) => x.published));
  const maxBrand = Math.max(1, ...r.by_brand.map((x) => x.published));
  const weekdays = Array(7).fill(0);
  r.daily.forEach((d) => { weekdays[new Date(`${d.day}T12:00`).getDay()] += d.published; });
  const bestDay = r.daily.reduce((a, d) => (d.published > a.published ? d : a), { published: 0 });
  const bestWd = weekdays.indexOf(Math.max(...weekdays));
  const scope = r.brand ? r.brand.name : 'All brands';
  const net = (k) => state.platforms[k]?.label || k;

  shell('reports', 'Monthly report', `
    <div class="rp-controls no-print">
      <div class="seg-toggle"><button type="button" class="${ui.all ? '' : 'on'}" data-scope="0">${esc(b.name)}</button><button type="button" class="${ui.all ? 'on' : ''}" data-scope="1">All brands</button></div>
      <div class="rp-month"><button class="icon-btn" id="rp-prev" aria-label="Previous month">‹</button>
        <input type="month" id="rp-month" value="${r.month}" max="${r.current_month}" aria-label="Report month">
        <button class="icon-btn" id="rp-next" aria-label="Next month" ${r.month >= r.current_month ? 'disabled' : ''}>›</button></div>
      <button class="primary" id="rp-print">${NAV_ICON.download} Download PDF</button>
    </div>`, `
    <div class="print-only rp-print-head"><strong>Nexora</strong> · Monthly report · ${esc(scope)} · ${esc(monthLabel(r.month))}</div>
    <p class="muted rp-sub">${esc(scope)} · ${esc(monthLabel(r.month))}${r.month === r.current_month ? ' (so far)' : ''} · times in ${esc(r.timezone)} · compared with ${esc(prevName)}</p>
    <div class="rp-tiles">${tiles.map(([k, label]) => `<div class="card rp-tile">
      <div class="muted small">${label}</div><div class="n" data-count="${t[k]}">${t[k]}</div>
      <div class="small">${monthDelta(t[k], r.previous[k])} <span class="muted">vs ${r.previous[k]} in ${esc(prevName)}</span></div></div>`).join('')}</div>
    <div class="two-col">
      <div class="card stack"><h2>Published each day</h2>
        <div class="click-chart rp-daily">${r.daily.map((d) => `<div class="cc-col" title="${d.published} published · ${new Date(`${d.day}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}">
          <div class="cc-bar" data-h="${(d.published / maxDay) * 100}" style="height:0"></div></div>`).join('')}</div>
        <div class="cc-axis small muted">${[0, 7, 14, 21, r.daily.length - 1].map((i) => `<span>${Number(r.daily[i].day.slice(8))}</span>`).join('')}</div>
      </div>
      <div class="card stack"><h2>Published by network</h2>
        ${r.by_platform.length ? `<div class="bars">${r.by_platform.map((x) => `<div class="bar"><span class="row nowrap" style="gap:8px">${netLogo(x.platform, 16)}${esc(net(x.platform))}</span>
          <div class="track"><div class="fill" data-w="${(x.published / maxNet) * 100}" style="width:0"></div></div><span>${x.published}</span></div>`).join('')}</div>`
        : '<p class="muted">Nothing was published this month.</p>'}
      </div>
    </div>
    <div class="two-col rp-row">
      <div class="card stack"><h2>Highlights</h2>
        <ul class="rp-highlights">
          <li><span>Busiest day</span><strong>${bestDay.published ? `${new Date(`${bestDay.day}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${bestDay.published} post${bestDay.published === 1 ? '' : 's'}` : '—'}</strong></li>
          <li><span>Most active weekday</span><strong>${weekdays[bestWd] ? new Date(2026, 0, 4 + bestWd).toLocaleDateString(undefined, { weekday: 'long' }) : '—'}</strong></li>
          <li><span>Sent back for changes</span><strong>${t.sent_back}</strong></li>
          <li><span>Failed to publish</span><strong>${t.failed}</strong></li>
          <li><span>Media uploaded</span><strong>${t.media_uploaded}</strong></li>
          <li><span>Scheduled ahead (from today)</span><strong>${r.scheduled_ahead}</strong></li>
        </ul>
        <p class="muted small">Approvals, AI requests and media are counted for the whole workspace.</p>
      </div>
      <div class="card stack"><h2>${r.by_brand.length ? 'By brand' : 'Team'}</h2>
        ${r.by_brand.length ? `<div class="bars">${r.by_brand.map((x) => `<div class="bar"><span class="clip">${esc(x.name)}</span>
          <div class="track"><div class="fill" data-w="${(x.published / maxBrand) * 100}" style="width:0"></div></div><span>${x.published}</span></div>`).join('')}</div>` : ''}
        ${r.by_author.length ? `${r.by_brand.length ? '<h3 class="rp-h3">Team</h3>' : ''}<table class="ln-table"><thead><tr><th>Writer</th><th>Created</th><th>Published</th></tr></thead>
          <tbody>${r.by_author.map((a) => `<tr><td><strong>${esc(a.name)}</strong></td><td>${a.created}</td><td>${a.published}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">No posts were written or published this month.</p>'}
      </div>
    </div>
    <section class="card stack" style="margin-top:20px"><h2>Published posts <span class="muted small" style="font-weight:500">${r.published_posts.length}${r.published_posts.length === 50 ? ' (latest 50)' : ''}</span></h2>
      ${r.published_posts.length ? `<div class="table-wrap"><table class="ln-table"><thead><tr><th>Date</th><th>Post</th><th>Networks</th>${r.brand ? '' : '<th>Brand</th>'}<th>Writer</th></tr></thead>
        <tbody>${r.published_posts.map((p) => `<tr>
          <td class="nowrap small">${fmtDateTime(p.published_at)}</td>
          <td><a href="#/compose/${p.id}" class="rp-excerpt">${esc(p.excerpt)}</a></td>
          <td class="nowrap">${p.platforms.map((k) => `<span title="${esc(net(k))}">${netLogo(k, 16)}</span>`).join(' ')}</td>
          ${r.brand ? '' : `<td class="small">${esc(p.brand_name)}</td>`}
          <td class="small">${esc(p.author_name || '—')}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="pipe-empty">Nothing was published this month.</div>'}
    </section>`,
  { eyebrow: 'Reports', subtitle: 'What went out, how it did, and who did it — one month at a time' });

  animateCharts();
  const go = (month) => { ui.month = month; route(); };
  document.getElementById('rp-prev').onclick = () => go(shiftMonth(r.month, -1));
  document.getElementById('rp-next').onclick = () => go(shiftMonth(r.month, 1));
  document.getElementById('rp-month').onchange = (e) => e.target.value && go(e.target.value);
  document.querySelectorAll('[data-scope]').forEach((btn) => btn.onclick = () => { ui.all = btn.dataset.scope === '1'; route(); });
  document.getElementById('rp-print').onclick = () => {
    const old = document.title;
    document.title = `Nexora report ${scope} ${r.month}`;
    window.print();
    document.title = old;
  };
};

// ---------- brands & channels ----------

/** New brand: name, colour, voice and an optional first channel, created together. */
function addBrandDialog() {
  openDialog('Add brand', `
    <div class="row" style="align-items:flex-end">
      <label class="field grow"><span>Brand name</span><input name="name" required maxlength="80" placeholder="e.g. Priya Shah, Home Loans"></label>
      <label class="field"><span>Colour</span><input type="color" name="color" value="#0b7a75"></label>
    </div>
    <label class="field"><span>GSTIN</span><input name="gstin" required maxlength="15" autocomplete="off" spellcheck="false"
      class="upper" placeholder="15 characters, e.g. 27AAPFU0939F1ZV"></label>
    <label class="field"><span>Brand voice (used for AI drafts, optional)</span>
      <textarea name="voice" style="min-height:70px" maxlength="2000" placeholder="Warm, witty, never salesy. Short sentences. Uses British spelling."></textarea></label>
    <div>
      <span class="field-label">First channel (optional)</span>
      <div class="row">
        <select name="platform" style="width:auto" aria-label="Network">${Object.entries(state.platforms).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select>
        <input class="grow" name="handle" placeholder="@handle" maxlength="100" aria-label="Account handle">
      </div>
    </div>
    <p class="muted small" style="margin:0">New brands get a weekday 10:00 queue. You can add more channels after.</p>`,
  async (form) => {
    const f = form.elements;
    const name = f.namedItem('name').value.trim();
    if (!name) throw new Error('Brand name is required');
    const gstin = f.namedItem('gstin').value.trim();
    if (!gstin) throw new Error('GSTIN is required');
    const handle = f.namedItem('handle').value.trim();
    const b = await api('/brands', { method: 'POST', body: {
      name, gstin, color: f.namedItem('color').value, voice: f.namedItem('voice').value,
      channels: handle ? [{ platform: f.namedItem('platform').value, handle }] : [],
    } });
    state.brandId = b.id;
    try { localStorage.setItem('cadence.brand', state.brandId); } catch { /* storage unavailable */ }
    toast(`${b.name} added`);
    route();
  }, 'Add brand');
}

/** Deleting a brand cascades widely, so the admin types its name to confirm. */
function deleteBrandDialog(b) {
  const dlg = openDialog(`Delete ${b.name}?`, `
    <p style="margin:0">This permanently deletes the brand and everything that belongs to it:</p>
    <ul class="small" style="margin:0;padding-left:20px">
      <li>all of its posts, including scheduled ones</li>
      <li>its ${b.channels.length === 1 ? 'channel' : `${b.channels.length} channels`} and queue slots</li>
      <li>its link-in-bio page and click history</li>
      <li>library items saved for this brand only</li>
    </ul>
    <p class="muted small" style="margin:0">Short links and library items for all brands are kept. This cannot be undone.</p>
    <label class="field"><span>Type <strong>${esc(b.name)}</strong> to confirm</span>
      <input name="confirm" autocomplete="off" spellcheck="false"></label>`,
  async (form) => {
    if (form.elements.namedItem('confirm').value.trim() !== b.name) throw new Error('The name doesn’t match. Type it exactly as shown.');
    await api(`/brands/${b.id}`, { method: 'DELETE', body: {} });
    toast(`${b.name} deleted`);
    route();
  }, 'Delete brand', 'danger');
  const btn = dlg.querySelector('button[value="ok"]');
  btn.disabled = true;
  dlg.querySelector('[name="confirm"]').oninput = (e) => { btn.disabled = e.target.value.trim() !== b.name; };
}

views.brands = async () => {
  await loadBrands();
  const admin = can.admin();
  shell('brands', 'Brands & channels', admin ? `<button id="add-brand" class="primary">+ Add brand</button>` : '', `
    <div class="two-col">${state.brands.map((b) => `
      <div class="card stack" data-brand="${b.id}">
        <div class="row">
          <input type="color" value="${esc(b.color)}" data-k="color" ${admin ? '' : 'disabled'} aria-label="Brand colour">
          <input class="grow" value="${esc(b.name)}" data-k="name" maxlength="80" ${admin ? '' : 'readonly'} aria-label="Brand name">
        </div>
        <label class="field"><span>GSTIN${b.gstin ? '' : ' <span class="muted small">(not added yet)</span>'}</span>
          <input value="${esc(b.gstin || '')}" data-k="gstin" maxlength="15" autocomplete="off" spellcheck="false" class="upper"
            placeholder="15 characters" ${admin ? '' : 'readonly'}></label>
        <label class="field"><span>Brand voice (used for AI drafts)</span>
          <textarea data-k="voice" style="min-height:70px" maxlength="2000" placeholder="Warm, witty, never salesy. Short sentences. Uses British spelling." ${admin ? '' : 'readonly'}>${esc(b.voice)}</textarea></label>
        ${admin ? `<div class="row"><button class="sm" data-save>Save brand</button>
          ${state.brands.length > 1 ? `<button class="sm danger ghost" data-del-brand>Delete brand</button>` : ''}</div>` : ''}
        <div>
          <h2>Channels</h2>
          <div class="channels">${b.channels.map((c) => `<span class="chip">${channelChip(c)}
            ${admin ? `<button class="ghost sm" data-del-ch="${c.id}" aria-label="Remove">×</button>` : ''}</span>`).join('') || '<span class="muted">No channels yet.</span>'}</div>
        </div>
        ${admin ? `<div class="row">
          <select data-platform style="width:auto">${Object.entries(state.platforms).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select>
          <input data-handle placeholder="@handle" style="max-width:220px" maxlength="100">
          <button class="sm" data-add-ch>Add channel</button>
        </div>
        <p class="muted small" style="margin:0">Channels are publish targets. Until a network integration is configured, publishing is simulated and logged.</p>` : ''}
      </div>`).join('')}
    </div>`);

  if (!admin) return;
  document.getElementById('add-brand').onclick = addBrandDialog;
  document.querySelectorAll('[data-brand]').forEach((card) => {
    const id = Number(card.dataset.brand);
    const val = (k) => card.querySelector(`[data-k="${k}"]`).value;
    card.querySelector('[data-save]').onclick = (e) => act(e.currentTarget, async () => {
      // Older brands may have no GSTIN yet; leaving it blank keeps it that way.
      const gstin = val('gstin').trim();
      await api(`/brands/${id}`, { method: 'PATCH', body: { name: val('name'), color: val('color'), voice: val('voice'), ...(gstin && { gstin }) } });
      toast('Brand saved');
      route();
    });
    card.querySelector('[data-del-brand]')?.addEventListener('click', () => deleteBrandDialog(state.brands.find((x) => x.id === id)));
    card.querySelector('[data-add-ch]').onclick = (e) => act(e.currentTarget, async () => {
      await api(`/brands/${id}/channels`, { method: 'POST',
        body: { platform: card.querySelector('[data-platform]').value, handle: card.querySelector('[data-handle]').value } });
      route();
    });
    card.querySelectorAll('[data-del-ch]').forEach((btn) => btn.onclick = () => act(btn, async () => {
      if (!await confirmDialog('Remove channel?', 'Posts already scheduled to it will skip it.', 'Remove channel')) return;
      await api(`/brands/${id}/channels/${btn.dataset.delCh}`, { method: 'DELETE', body: {} });
      route();
    }));
  });
};

// ---------- team ----------

views.team = async () => {
  const team = await api('/team');
  const admin = can.admin();
  const owner = state.user.role === 'owner';
  const roleOpts = (cur) => ['admin', 'editor', 'viewer']
    .filter((r) => r !== 'admin' || owner || cur === 'admin')
    .map((r) => `<option ${r === cur ? 'selected' : ''}>${r}</option>`).join('');
  const editableRow = (m) => admin && m.role !== 'owner' && m.id !== state.user.id && (owner || m.role !== 'admin');

  shell('team', 'Team', '', `
    <div class="two-col">
      <div class="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Can approve</th><th></th></tr></thead>
          <tbody>${team.map((m) => `<tr data-member="${m.id}">
            <td><strong>${esc(m.display_name)}</strong>${m.id === state.user.id ? ' <span class="muted small">(you)</span>' : ''}</td>
            <td class="muted">${esc(m.username)}</td>
            <td>${editableRow(m) ? `<select data-role style="width:auto">${roleOpts(m.role)}</select>` : esc(m.role)}</td>
            <td>${editableRow(m) ? `<input type="checkbox" data-approve ${m.can_approve ? 'checked' : ''} aria-label="Can approve">`
              : (m.can_approve || ['owner', 'admin'].includes(m.role) ? '✓' : '—')}</td>
            <td>${editableRow(m) ? `<button class="sm danger ghost" data-remove>Remove</button>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="stack">
      ${admin ? `<form class="card stack" id="add-member">
        <h2 style="margin:0">Add a team member</h2>
        <input name="display_name" placeholder="Name" maxlength="80" aria-label="Name">
        <input name="username" placeholder="Username" required aria-label="Username">
        <input name="password" type="password" placeholder="Temporary password (8+ chars)" required minlength="8" autocomplete="new-password" aria-label="Temporary password">
        <div class="row">
          <select name="role" style="width:auto" aria-label="Role">${roleOpts('editor')}</select>
          <label class="row small"><input type="checkbox" name="can_approve"> Can approve posts</label>
        </div>
        <div class="row"><button class="primary">Add member</button>
          <span class="muted small grow">Share the username and temporary password with them directly.</span></div>
      </form>` : ''}
      <div class="card small muted">
        <strong>Roles:</strong> Viewers can see everything. Editors write, schedule and queue posts.
        Admins also manage brands, channels and the team. Approvers sign off posts when approval is required.
      </div>
      </div>
    </div>`);

  if (!admin) return;
  document.querySelectorAll('[data-member]').forEach((row) => {
    const id = row.dataset.member;
    row.querySelector('[data-role]')?.addEventListener('change', (e) => act(null, async () => {
      await api(`/team/${id}`, { method: 'PATCH', body: { role: e.target.value } });
      toast('Role updated');
    }));
    row.querySelector('[data-approve]')?.addEventListener('change', (e) => act(null, async () => {
      await api(`/team/${id}`, { method: 'PATCH', body: { can_approve: e.target.checked } });
      toast('Updated');
    }));
    row.querySelector('[data-remove]')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      if (!await confirmDialog('Remove team member?', 'They will lose access to this workspace. Their posts stay.', 'Remove')) return;
      await api(`/team/${id}`, { method: 'DELETE', body: {} });
      route();
    }));
  });
  const form = document.getElementById('add-member');
  form.onsubmit = (e) => {
    e.preventDefault();
    act(form.querySelector('button'), async () => {
      const body = Object.fromEntries(new FormData(form));
      body.can_approve = form.elements.namedItem('can_approve').checked;
      await api('/team', { method: 'POST', body });
      toast('Member added');
      route();
    });
  };
};

// ---------- settings ----------

views.settings = async () => {
  const admin = can.admin();
  const activity = await api('/activity');
  const zones = Intl.supportedValuesOf?.('timeZone') || [state.workspace.timezone];
  shell('settings', 'Settings', '', `
    <div class="grid-2">
      <form class="card stack" id="ws-form">
        <h2>Workspace</h2>
        <label class="field"><span>Name</span><input name="name" value="${esc(state.workspace.name)}" maxlength="80" ${admin ? '' : 'readonly'}></label>
        <label class="field"><span>Time zone (for queue slots)</span>
          <select name="timezone" ${admin ? '' : 'disabled'}>${zones.map((z) => `<option ${z === state.workspace.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
        <label class="row"><input type="checkbox" name="require_approval" ${state.workspace.require_approval ? 'checked' : ''} ${admin ? '' : 'disabled'}>
          Require approval before posts are scheduled</label>
        <label class="row"><input type="checkbox" name="loans_enabled" ${state.workspace.loans_enabled ? 'checked' : ''} ${admin ? '' : 'disabled'}>
          Loan reminders (customers, loans and due-date messages)</label>
        <label class="field"><span>Currency for loan amounts</span>
          <select name="currency" ${admin ? '' : 'disabled'}>${['INR', 'USD', 'GBP', 'EUR', 'AED', 'SGD', 'AUD', 'CAD']
            .map((cur) => `<option ${cur === state.workspace.currency ? 'selected' : ''}>${cur}</option>`).join('')}</select></label>
        ${admin ? `<div><button class="primary">Save</button></div>` : ''}
      </form>
      <div class="card">
        <h2>Recent activity</h2>
        <div class="table-wrap"><table><tbody>${activity.slice(0, 40).map((a) => `<tr>
          <td class="small muted" style="white-space:nowrap">${fmtDateTime(a.created_at)}</td>
          <td class="small"><strong>${esc(a.user || 'System')}</strong> ${esc(a.action.replace('.', ' '))} <span class="muted">${esc(a.detail)}</span></td>
        </tr>`).join('')}</tbody></table></div>
      </div>
    </div>`);
  if (!admin) return;
  const form = document.getElementById('ws-form');
  form.onsubmit = (e) => {
    e.preventDefault();
    act(form.querySelector('button'), async () => {
      const f = form.elements;
      state.workspace = await api('/workspace', { method: 'PATCH', body: {
        name: f.namedItem('name').value, timezone: f.namedItem('timezone').value,
        require_approval: f.namedItem('require_approval').checked,
        loans_enabled: f.namedItem('loans_enabled').checked, currency: f.namedItem('currency').value,
      } });
      toast('Settings saved');
      route();
    });
  };
};

boot().catch((err) => {
  $app.innerHTML = `<div class="boot">Could not reach the server: ${esc(err.message)}</div>`;
});
