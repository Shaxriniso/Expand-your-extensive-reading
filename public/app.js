import { T, LANG_NAMES, RTL, translate } from './i18n.js';

// ---------- state ----------
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

const state = {
  token: store.get('token'),
  lang: store.get('lang') || guessLang(),
  me: null,
  meta: null,
  quiz: null,
  installPrompt: null,
};

function guessLang() {
  const l = (navigator.language || 'uz').slice(0, 2);
  return T[l] ? l : 'uz';
}

// Inside the iOS app (Capacitor) purchases must go through Apple, so payment screens are hidden there.
const IN_IOS_APP = window.Capacitor?.getPlatform?.() === 'ios';
const t = (key, params) => translate(state.lang, key, params);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tx = (obj) => (obj && (obj[state.lang] || obj.en || obj.uz || Object.values(obj)[0])) || '';
const levelName = (i) => t(`lvl_${['beginner', 'elementary', 'intermediate', 'upper', 'advanced'][i]}`);
const subjectName = (s) => t(`sub_${s}`);
const money = (n, cur) => `${new Intl.NumberFormat(state.lang === 'uz' ? 'uz-UZ' : state.lang).format(n)} ${cur}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(state.lang) : '');
const SUBJECT_ICON = { math: '➗', logic: '🧩', english: '🇬🇧', uzbek: '🇺🇿', russian: '🇷🇺', korean: '🇰🇷', arabic: '🇸🇦' };

// ---------- api ----------
async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (state.token) h.Authorization = `Bearer ${state.token}`;
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && !path.startsWith('/api/auth')) {
    logout();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'generic');
    err.code = data.error;
    err.details = data.details;
    throw err;
  }
  return data;
}

const errText = (e) => (T.en[`err_${e.code}`] ? t(`err_${e.code}`) : t('err_generic'));

function logout() {
  state.token = null;
  state.me = null;
  store.set('token', null);
  location.hash = '#/';
}

async function loadMe() {
  if (!state.token) return null;
  const me = await api('/api/me');
  state.me = me;
  if (me.user.lang && me.user.lang !== state.lang) setLang(me.user.lang, false);
  return me;
}

function setLang(lang, persist = true) {
  state.lang = lang;
  store.set('lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  if (persist && state.token) api('/api/me', { method: 'PATCH', body: { lang } }).catch(() => {});
}

// ---------- layout ----------
const $app = document.getElementById('app');

function langSelect() {
  return `<select class="lang" data-change="lang" aria-label="Language">${Object.entries(LANG_NAMES)
    .map(([k, v]) => `<option value="${k}" ${k === state.lang ? 'selected' : ''}>${v}</option>`)
    .join('')}</select>`;
}

function shell(content, active = '') {
  const u = state.me?.user;
  const nav = u
    ? [
        ['today', '🏠', 'nav_today'],
        ['subjects', '📚', 'nav_subjects'],
        ['challenge', '🏆', 'nav_challenge'],
        ['profile', '👤', 'nav_profile'],
        ...(u.role === 'owner' || u.role === 'admin' ? [['owner', '⚙️', 'nav_owner']] : []),
      ]
    : [];
  const appName = esc(state.meta?.appName || 'BilimUp');
  return `
    <header class="top">
      <a class="brand" href="#/${u ? 'today' : ''}"><img src="/icons/icon.svg" alt="" width="32" height="32"><span>${appName}</span></a>
      <nav class="topnav">${nav.map(([r, i, k]) => `<a href="#/${r}" class="${active === r ? 'on' : ''}">${i} <span>${t(k)}</span></a>`).join('')}</nav>
      <div class="top-right">
        ${state.installPrompt ? `<button class="btn ghost sm" data-action="install">📲 ${t('install_app')}</button>` : ''}
        ${langSelect()}
        ${u ? `<button class="btn ghost sm" data-action="logout">${t('logout')}</button>` : `<a class="btn ghost sm" href="#/login">${t('login')}</a>`}
      </div>
    </header>
    <main class="wrap">${content}</main>
    ${u ? `<nav class="bottomnav">${nav.map(([r, i, k]) => `<a href="#/${r}" class="${active === r ? 'on' : ''}"><b>${i}</b><span>${t(k)}</span></a>`).join('')}</nav>` : ''}
    <footer class="foot">
      <p>${esc(t('footer_rights', { year: new Date().getFullYear(), owner: state.meta?.ownerName || state.meta?.appName || 'BilimUp' }))}</p>
      <p><a href="#/terms">${t('terms')}</a>${state.meta?.supportContact ? ` · ${t('contact')}: ${esc(state.meta.supportContact)}` : ''}</p>
    </footer>`;
}

function render(html, active) {
  $app.innerHTML = shell(html, active);
  window.scrollTo(0, 0);
}

const loading = () => render(`<p class="muted center pad">${t('loading')}</p>`);
const errorBox = (e) => `<div class="alert">${esc(errText(e))}</div>`;

// ---------- views ----------
const views = {};

views[''] = async () => {
  if (state.token) return go('today');
  const m = state.meta;
  const feats = [
    ['🎯', 'feat_diag'], ['🎬', 'feat_daily'], ['📈', 'feat_levels'], ['🏆', 'feat_play'], ['🌍', 'feat_langs'], ['👨‍👩‍👧', 'feat_ages'],
  ];
  render(`
    <section class="hero">
      <h1>${esc(m.appName)}</h1>
      <p class="lead">${t('tagline')}</p>
      <p>${t('hero_text')}</p>
      <div class="row center"><a class="btn big" href="#/register">${t('get_started')}</a><a class="btn ghost big" href="#/login">${t('login')}</a></div>
      <div class="chips">${m.subjects.map((s) => `<span class="chip">${SUBJECT_ICON[s]} ${subjectName(s)}</span>`).join('')}</div>
    </section>
    <section class="grid3">${feats.map(([i, k]) => `<div class="card"><div class="ico">${i}</div><h3>${t(k)}</h3><p>${t(`${k}_t`)}</p></div>`).join('')}</section>
    ${IN_IOS_APP ? '' : `<section><h2 class="center">${t('pricing')}</h2>${m.trialDays ? `<p class="center muted">${t('trial_note', { days: m.trialDays })}</p>` : ''}
      <div class="grid3">${m.plans.map((p) => `<div class="card plan"><h3>${esc(planLabel(p.id))}</h3><p class="price">${money(p.price, m.currency)}</p><p class="muted">${t('per_days', { days: p.days })}</p><a class="btn" href="#/register">${t('get_started')}</a></div>`).join('')}</div>
    </section>`}`);
};

const planLabel = (id) => ({ trial: t('plan_trial'), gift: t('plan_gift') })[id] || id.charAt(0).toUpperCase() + id.slice(1);

views.login = () => {
  render(`
    <form class="card narrow" data-submit="login">
      <h2>${t('login')}</h2>
      <div class="err"></div>
      <label>${t('email')}<input name="email" type="email" required autocomplete="email"></label>
      <label>${t('password')}<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn full">${t('login')}</button>
      <p class="muted center">${t('no_account')} <a href="#/register">${t('register')}</a></p>
    </form>`);
};

views.register = () => {
  const today = new Date();
  const max = new Date(today.getFullYear() - state.meta.ageLimits.min, today.getMonth(), today.getDate()).toISOString().slice(0, 10);
  const min = new Date(today.getFullYear() - state.meta.ageLimits.max - 1, today.getMonth(), today.getDate() + 1).toISOString().slice(0, 10);
  render(`
    <form class="card narrow" data-submit="register">
      <h2>${t('register')}</h2>
      <div class="err"></div>
      <label>${t('name')}<input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>
      <label>${t('email')}<input name="email" type="email" required autocomplete="email"></label>
      <label>${t('password')}<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <label>${t('birth_date')}<input name="birthDate" type="date" required min="${min}" max="${max}" data-change="birth"></label>
      <label>${t('ui_language')}${langSelect()}</label>
      <label class="check hidden" id="guardian"><input type="checkbox" name="guardianConsent"> ${t('guardian_consent')}</label>
      <label class="check"><input type="checkbox" name="acceptTerms" required> <span>${t('accept_terms')} <a href="#/terms" target="_blank">${t('terms')}</a></span></label>
      <button class="btn full">${t('register')}</button>
      <p class="muted center">${t('have_account')} <a href="#/login">${t('login')}</a></p>
    </form>`);
};

views.terms = () => {
  const name = esc(state.meta.ownerName || state.meta.appName);
  render(`<article class="card prose">
    <h2>${t('terms')}</h2>
    <p><b>${esc(state.meta.appName)}</b> — © ${new Date().getFullYear()} ${name}.</p>
    <h3>1. Ownership / Mulkchilik</h3>
    <p>All lessons, explanations, exercises, question generators, videos, design and software of this platform are the intellectual property of ${name} and are protected by copyright. Members receive a personal, non-transferable licence to view the content while their account is active. Copying, recording, re-uploading, reselling or sharing paid content or account access is prohibited.</p>
    <h3>2. Members</h3>
    <p>Membership is open to people aged 7 to 70. Members under 16 may register only with the permission of a parent or legal guardian, who is responsible for the child's use of the platform and for any payments.</p>
    <h3>3. Payments</h3>
    <p>Paid plans give access to all lessons, practice and videos for the period shown on the pricing page. Access starts after the payment is confirmed. Refunds are handled by the owner on request.</p>
    <h3>4. Privacy</h3>
    <p>We store your name, email, date of birth, interface language, learning progress and payment records only to run the service. Leaderboards show only your first name and the initial of your last name. We do not sell personal data. Contact the owner to delete your account and data.</p>
    <p class="muted">The owner should review these terms with a lawyer before launch.</p>
  </article>`);
};

views.today = async () => {
  loading();
  const d = await api('/api/today');
  const u = d.user;
  const plan = d.plan.length
    ? d.plan
        .map((p) => {
          const n = p.next;
          return `<div class="card task">
          <div class="task-h"><span class="big-ico">${SUBJECT_ICON[p.subject]}</span><div><h3>${subjectName(p.subject)}</h3><p class="muted">${levelName(p.level)} · ${p.progress.done}/${p.progress.total}</p></div></div>
          <div class="bar"><i style="width:${Math.round((100 * p.progress.done) / Math.max(1, p.progress.total))}%"></i></div>
          ${n ? `<p><b>${esc(tx(n.title))}</b> ${n.hasVideo ? '🎬' : ''}</p>${lockBadge(n.locked)}
                 ${n.locked === 'premium' && IN_IOS_APP ? '' : `<a class="btn" href="${n.locked === 'premium' ? '#/billing' : `#/lesson/${n.id}`}">${n.locked === 'premium' ? t('subscribe') : t('continue')}</a>`}`
              : `<a class="btn ghost" href="#/subject/${p.subject}">${t('practice')}</a>`}
        </div>`;
        })
        .join('')
    : `<div class="card"><p>${t('no_subjects')}</p><a class="btn" href="#/subjects">${t('choose_subject')}</a></div>`;
  render(`
    <h1>${t('hello_name', { name: esc(u.name.split(' ')[0]) })}</h1>
    ${accessBanner(u)}
    <div class="stats">
      <div class="stat"><b>🔥 ${u.streak}</b><span>${t('streak')}</span></div>
      <div class="stat"><b>⭐ ${u.xp}</b><span>${t('xp')}</span></div>
      <div class="stat"><b>+${d.xpToday}</b><span>${t('xp_today')}</span></div>
      <div class="stat"><b>${d.lessonsToday}</b><span>${t('lessons_today')}</span></div>
    </div>
    <a class="card challenge-cta" href="#/challenge"><span class="big-ico">🏆</span><div><h3>${t('daily_challenge')}</h3><p>${d.challenge ? t('challenge_done', { score: d.challenge.score }) : t('challenge_t')}</p></div></a>
    <h2>${t('todays_plan')}</h2>
    <div class="grid2">${plan}</div>`, 'today');
};

function accessBanner(u) {
  if (u.role === 'owner' || u.role === 'admin' || IN_IOS_APP) return '';
  if (u.access.active && u.access.plan !== 'trial') return '';
  const msg = u.access.active ? `${t('plan_trial')} · ${t('active_until', { date: fmtDate(u.access.expiresAt) })}` : t('no_access');
  return `<div class="banner"><span>${msg}</span><a class="btn sm" href="#/billing">${t('subscribe')}</a></div>`;
}

const lockBadge = (reason) =>
  reason === 'level' ? `<p class="lock">🔒 ${t('locked_level')}</p>` : reason === 'premium' ? `<p class="lock">💎 ${t('locked_premium')}</p>` : '';

views.subjects = async () => {
  loading();
  const me = await loadMe();
  const enr = Object.fromEntries(me.enrollments.map((e) => [e.subject, e.level]));
  render(`<h1>${t('choose_subject')}</h1>
    <div class="grid3">${state.meta.subjects
      .map((s) => `<a class="card subject" href="#/subject/${s}"><span class="big-ico">${SUBJECT_ICON[s]}</span><h3>${subjectName(s)}</h3>
        <p class="muted">${s in enr ? t('your_level', { level: levelName(enr[s]) }) : t('take_diagnostic')}</p></a>`)
      .join('')}</div>`, 'subjects');
};

views.subject = async ([subject]) => {
  loading();
  const d = await api(`/api/subjects/${subject}`);
  const byLevel = [0, 1, 2, 3, 4].map((lv) => d.lessons.filter((l) => l.level === lv));
  const enrolled = d.enrollment;
  render(`
    <a class="back" href="#/subjects">← ${t('back')}</a>
    <h1>${SUBJECT_ICON[subject]} ${subjectName(subject)}</h1>
    <div class="card">
      ${enrolled ? `<p><b>${t('your_level', { level: levelName(enrolled.level) })}</b></p>` : `<p>${t('diag_intro')}</p>`}
      <div class="row">
        <button class="btn" data-action="diagnostic" data-subject="${subject}">🎯 ${enrolled ? t('retake_diagnostic') : t('take_diagnostic')}</button>
        ${enrolled ? `<button class="btn ghost" data-action="practice" data-subject="${subject}" data-level="${enrolled.level}">💪 ${t('practice')}</button>` : `<button class="btn ghost" data-action="beginner" data-subject="${subject}">${t('start_beginner')}</button>`}
      </div>
    </div>
    ${byLevel
      .map((lessons, lv) => `<section class="level ${enrolled && lv === enrolled.level ? 'current' : ''}">
        <h2>${levelName(lv)}</h2>
        <div class="lessons">${lessons
          .map((l) => `<${l.locked === 'level' ? 'div' : 'a'} class="lesson-item ${l.locked ? 'locked' : ''} ${l.completed ? 'done' : ''}" ${l.locked === 'level' ? `title="${t('locked_level')}"` : `href="${l.locked === 'premium' ? '#/billing' : `#/lesson/${l.id}`}"`}>
            <span class="dot">${l.completed ? '✓' : l.locked ? '🔒' : l.seq}</span>
            <span class="li-t">${esc(tx(l.title))}</span>
            <span class="li-m">${l.hasVideo ? '🎬' : ''} ${l.free && !l.completed ? `<em class="tag">${t('free')}</em>` : ''} ${l.score != null ? `${l.score}%` : ''}</span>
          </${l.locked === 'level' ? 'div' : 'a'}>`)
          .join('')}</div></section>`)
      .join('')}`, 'subjects');
};

views.lesson = async ([id]) => {
  loading();
  let d;
  try {
    d = await api(`/api/lessons/${id}`);
  } catch (e) {
    if (e.code === 'locked') return render(`${errorBox(e)}${lockBadge(e.details?.reason)}<a class="btn" href="${e.details?.reason === 'premium' ? '#/billing' : '#/subjects'}">${e.details?.reason === 'premium' ? t('subscribe') : t('back')}</a>`, 'subjects');
    throw e;
  }
  const l = d.lesson;
  const video = d.video
    ? d.video.kind === 'embed'
      ? `<div class="video"><iframe src="${esc(d.video.src)}" title="${t('video')}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
      : `<div class="video"><video src="${esc(d.video.src)}" controls controlsList="nodownload" disablePictureInPicture preload="metadata" data-protect></video></div>`
    : `<div class="video empty"><span>🎬</span><p>${t('no_video')}</p></div>`;
  render(`
    <a class="back" href="#/subject/${l.subject}">← ${subjectName(l.subject)}</a>
    <p class="muted">${subjectName(l.subject)} · ${levelName(l.level)} · ${t('lesson')} ${l.seq}</p>
    <h1>${esc(tx(l.title))} ${l.completed ? `<span class="tag ok">✓ ${t('completed')}</span>` : ''}</h1>
    <h3>${t('video')}</h3>
    ${video}
    <div class="card">
      <h3>${t('explanation')}</h3>
      <p>${esc(tx(l.body))}</p>
      ${l.example ? `<p class="example"><b>${t('example')}:</b> <span dir="ltr">${esc(l.example)}</span></p>` : ''}
      ${d.words ? `<table class="words"><thead><tr><th>${t('word')}</th><th>${t('meaning')}</th></tr></thead><tbody>${d.words
        .map((w) => `<tr><td dir="auto" class="w">${esc(w.word)}</td><td dir="auto">${esc(w.meaning)}</td></tr>`)
        .join('')}</tbody></table>` : ''}
    </div>
    ${l.score != null ? `<p class="muted">${t('best_score', { score: l.score })}</p>` : ''}
    ${d.hasQuiz ? `<button class="btn big" data-action="lesson-quiz" data-id="${l.id}">▶ ${t('start_quiz')}</button>` : `<button class="btn big" data-action="lesson-done" data-id="${l.id}">✓ ${t('mark_done')}</button>`}
  `, 'subjects');
};

// ---------- quiz runner ----------
function startQuiz(session, meta) {
  state.quiz = { ...session, ...meta, idx: 0, answers: [], startedAt: session.startedAt || Date.now() };
  location.hash = '#/quiz';
  if (location.hash === '#/quiz') route();
}

function questionPrompt(q) {
  const p = q.prompt;
  return `<p class="q-key">${esc(t(p.key, p.params))}</p>${p.text ? `<p class="q-text" dir="auto">${esc(p.text)}</p>` : ''}`;
}

views.quiz = () => {
  const s = state.quiz;
  if (!s) return go('today');
  clearInterval(state.timer);
  const q = s.questions[s.idx];
  const chosen = s.answers[s.idx];
  render(`
    <div class="quiz card">
      <div class="quiz-h"><span>${esc(s.title || '')}</span><span>${t('question_of', { n: s.idx + 1, total: s.questions.length })}</span>${s.kind === 'challenge' ? '<span class="timer" id="timer"></span>' : ''}</div>
      <div class="bar"><i style="width:${(100 * s.idx) / s.questions.length}%"></i></div>
      ${questionPrompt(q)}
      <div class="choices ${q.choices.length === 3 ? 'three' : ''}">${q.choices
        .map((c, i) => `<button class="choice ${chosen === i ? 'sel' : ''}" data-action="choose" data-i="${i}" dir="auto">${esc(c)}</button>`)
        .join('')}</div>
      <div class="row end"><button class="btn" data-action="quiz-next" ${chosen === undefined ? 'disabled' : ''}>${s.idx === s.questions.length - 1 ? t('finish') : t('next')}</button></div>
    </div>`);
  if (s.kind === 'challenge') {
    const tick = () => {
      const el = document.getElementById('timer');
      if (el) el.textContent = `⏱ ${Math.floor((Date.now() - s.startedAt) / 1000)}s`;
    };
    tick();
    state.timer = setInterval(tick, 1000);
  }
};

async function finishQuiz() {
  const s = state.quiz;
  clearInterval(state.timer);
  loading();
  const r = await api(`/api/quiz/${s.id}/submit`, { method: 'POST', body: { answers: s.answers } });
  state.quiz = null;
  if (state.token) loadMe().catch(() => {});
  let headline = '';
  if (s.kind === 'diagnostic') headline = `<p class="big-msg">🎯 ${t('placed_at', { level: levelName(r.level) })}</p>`;
  else if (s.kind === 'lesson') {
    headline = r.passed ? `<p class="big-msg ok">🎉 ${t('passed', { xp: r.xp })}</p>` : `<p class="big-msg">${t('not_passed')}</p>`;
    if (r.levelUp) headline += `<p class="big-msg ok">🚀 ${t('level_up', { level: levelName(r.level) })}</p>`;
  } else if (s.kind === 'challenge') headline = `<p class="big-msg ok">🏆 ${t('score')}: ${r.score} · +${r.xp} XP</p>`;
  else headline = `<p class="big-msg ok">+${r.xp} XP</p>`;
  const review = s.questions
    .map((q, i) => {
      const res = r.results[i];
      return `<li class="${res.correct ? 'ok' : 'bad'}">${questionPrompt(q)}
        <p>${res.correct ? '✅' : '❌'} ${t('your_answer')}: <b dir="auto">${esc(res.given != null ? q.choices[res.given] : '—')}</b>
        ${res.correct ? '' : ` · ${t('correct_answer')}: <b dir="auto">${esc(q.choices[res.answer])}</b>`}</p></li>`;
    })
    .join('');
  const again = s.kind === 'lesson' && !r.passed ? `<button class="btn" data-action="lesson-quiz" data-id="${s.ref}">${t('try_again')}</button>` : '';
  render(`
    <div class="card center">
      <h1>${t('result')}</h1>
      <p class="score-ring">${r.correct}/${r.total}</p>
      <p>${t('you_got', { correct: r.correct, total: r.total })}</p>
      ${headline}
      <div class="row center">${again}<a class="btn ghost" href="${s.back}">${t('continue')}</a></div>
    </div>
    <h2>${t('review')}</h2><ol class="review">${review}</ol>`);
}

views.challenge = async () => {
  loading();
  const [c, lb] = await Promise.all([api('/api/challenge'), api('/api/leaderboard')]);
  const fmtMs = (ms) => `${Math.round(ms / 1000)}s`;
  render(`
    <h1>🏆 ${t('daily_challenge')}</h1>
    <div class="card">
      <p>${c.mine ? t('challenge_done', { score: c.mine.score }) : t('challenge_t')}</p>
      ${c.mine ? '' : `<button class="btn big" data-action="challenge">▶ ${t('start')}</button>`}
    </div>
    <div class="grid2">
      <div class="card"><h3>${t('leaderboard_today')}</h3>${board(c.top.map((r) => [r.name, `${r.score} · ${fmtMs(r.ms)}`, r.me]))}</div>
      <div class="card"><h3>${t('leaderboard_week')}</h3>${board(lb.top.map((r) => [r.name, `${r.xp} XP`, r.me]))}</div>
    </div>`, 'challenge');
};

const board = (rows) =>
  rows.length
    ? `<ol class="board">${rows.map(([n, v, me], i) => `<li class="${me ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || i + 1}</span><span>${esc(n)}</span><b>${esc(v)}</b></li>`).join('')}</ol>`
    : '<p class="muted">—</p>';

views.profile = async () => {
  loading();
  const me = await loadMe();
  const u = me.user;
  render(`
    <h1>👤 ${esc(u.name)}</h1>
    <div class="stats">
      <div class="stat"><b>⭐ ${u.xp}</b><span>${t('xp')}</span></div>
      <div class="stat"><b>🔥 ${u.streak}</b><span>${t('streak')}</span></div>
      <div class="stat"><b>${me.completed}</b><span>${t('completed')}</span></div>
      <div class="stat"><b>${u.age}</b><span>${t('age')}</span></div>
    </div>
    <div class="card"><h3>${t('badges')}</h3>${me.badges.length ? `<div class="badges">${me.badges.map((b) => `<span class="badge">🏅 ${t(`b_${b}`)}</span>`).join('')}</div>` : `<p class="muted">${t('no_badges')}</p>`}</div>
    <div class="card"><h3>${t('subscription')}</h3>
      <p>${u.access.active ? `${esc(planLabel(u.access.plan))}${u.access.expiresAt ? ` · ${t('active_until', { date: fmtDate(u.access.expiresAt) })}` : ''}` : t('no_access')}</p>
      ${IN_IOS_APP ? '' : `<a class="btn" href="#/billing">${t('subscribe')}</a>`}</div>
    <div class="card"><h3>${t('ui_language')}</h3>${langSelect()}</div>
    <form class="card" data-submit="password"><h3>${t('change_password')}</h3><div class="err"></div>
      <label>${t('current_password')}<input type="password" name="password" required autocomplete="current-password"></label>
      <label>${t('new_password')}<input type="password" name="newPassword" required minlength="8" autocomplete="new-password"></label>
      <button class="btn">${t('save')}</button></form>
    ${u.role === 'owner' ? '' : `<form class="card danger" data-submit="delete-account"><h3>${t('delete_account')}</h3><p class="muted">${t('delete_account_t')}</p><div class="err"></div>
      <label>${t('current_password')}<input type="password" name="password" id="delete-password" required autocomplete="current-password"></label>
      <label class="check"><input type="checkbox" name="confirm" id="delete-confirm" required> ${t('delete_confirm')}</label>
      <button class="btn danger">${t('delete_account')}</button></form>`}`, 'profile');
};

views.billing = async () => {
  if (IN_IOS_APP) return render(`<h1>💎 ${t('subscription')}</h1><div class="card"><p>${t('ios_billing_note')}</p></div>`, 'profile');
  loading();
  const b = await api('/api/billing');
  const methods = b.methods.map((m) => `<option value="${esc(m)}">${esc(m.charAt(0).toUpperCase() + m.slice(1))}</option>`).join('');
  render(`
    <h1>💎 ${t('subscription')}</h1>
    <div class="card"><p>${b.access.active ? `${esc(planLabel(b.access.plan))}${b.access.expiresAt ? ` · ${t('active_until', { date: fmtDate(b.access.expiresAt) })}` : ''}` : t('no_access')}</p></div>
    <h2>${t('choose_plan')}</h2>
    <form data-submit="pay">
      <div class="grid3">${b.plans
        .map((p, i) => `<label class="card plan pick"><input type="radio" name="plan" value="${esc(p.id)}" ${i === 0 ? 'checked' : ''}>
          <h3>${esc(planLabel(p.id))}</h3><p class="price">${money(p.price, b.currency)}</p><p class="muted">${t('per_days', { days: p.days })}</p></label>`)
        .join('')}</div>
      ${b.stripe ? `<button class="btn big" name="via" value="stripe">💳 ${t('pay_card')}</button>` : ''}
      <div class="card"><h3>${t('pay_manual')}</h3>
        <p class="pre">${esc(b.instructions)}</p>
        ${b.supportContact ? `<p>${t('contact')}: <b>${esc(b.supportContact)}</b></p>` : ''}
        <div class="err"></div>
        <label>${t('method')}<select name="method">${methods}</select></label>
        <label>${t('reference')}<input name="reference" maxlength="100"></label>
        <button class="btn" name="via" value="manual">${t('submit_payment')}</button>
      </div>
    </form>
    ${b.history.length ? `<h2>${t('payment_history')}</h2><div class="table-wrap"><table><tbody>${b.history
      .map((p) => `<tr><td>${fmtDate(p.created_at.replace(' ', 'T') + 'Z')}</td><td>${esc(planLabel(p.plan))}</td><td>${money(p.amount, p.currency)}</td><td>${esc(p.method || p.provider)}</td><td><span class="tag ${p.status}">${t(`st_${p.status}`)}</span></td></tr>`)
      .join('')}</tbody></table></div>` : ''}`, 'profile');
};

// ---------- owner dashboard ----------
views.owner = async ([tab = '']) => {
  const u = state.me?.user;
  if (!u || (u.role !== 'owner' && u.role !== 'admin')) return go('today');
  if (u.role === 'admin' && tab !== 'content') return go('owner/content');
  loading();
  const tabs = u.role === 'owner' ? [['', 'owner_dashboard'], ['payments', 'pending_payments'], ['users', 'users'], ['content', 'content'], ['settings', 'settings']] : [['content', 'content']];
  const head = `<h1>⚙️ ${t('owner_dashboard')}</h1><div class="tabs">${tabs.map(([k, l]) => `<a href="#/owner${k ? `/${k}` : ''}" class="${tab === k ? 'on' : ''}">${t(l)}</a>`).join('')}</div>`;
  const body = await ownerTabs[tab]();
  render(head + body, 'owner');
};

const ownerTabs = {
  async ''() {
    const s = await api('/api/admin/stats');
    const rev = (list) => (list.length ? list.map((r) => money(r.total, r.currency)).join(' · ') : '0');
    const maxAge = Math.max(1, ...Object.values(s.ages));
    return `<div class="stats">
      <div class="stat"><b>${s.users}</b><span>${t('users')}</span></div>
      <div class="stat"><b>${s.newUsers7d}</b><span>${t('new_7d')}</span></div>
      <div class="stat"><b>${s.activeToday}</b><span>${t('active_today')}</span></div>
      <div class="stat"><b>${s.paidSubscribers}</b><span>${t('paid_subs')}</span></div>
      <div class="stat"><b>${s.trials}</b><span>${t('trials')}</span></div>
      <div class="stat"><b>${s.pendingPayments}</b><span>${t('pending_payments')}</span></div>
      <div class="stat"><b>${s.lessonsWithVideo}/${s.lessons}</b><span>${t('with_video')}</span></div>
      <div class="stat"><b>${s.lessonsCompleted}</b><span>${t('completed')}</span></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>${t('revenue')}</h3><p class="price">${rev(s.revenue)}</p><p class="muted">${t('revenue_30d')}: ${rev(s.revenue30d)}</p></div>
      <div class="card"><h3>${t('age_groups')}</h3>${Object.entries(s.ages)
        .map(([k, v]) => `<div class="hbar"><span>${k}</span><div class="bar"><i style="width:${(100 * v) / maxAge}%"></i></div><b>${v}</b></div>`)
        .join('')}</div>
    </div>`;
  },
  async payments() {
    const { payments } = await api('/api/admin/payments');
    if (!payments.length) return '<p class="muted">—</p>';
    return `<div class="table-wrap"><table><thead><tr><th>#</th><th>${t('users')}</th><th>${t('choose_plan')}</th><th>${t('method')}</th><th>${t('reference')}</th><th></th></tr></thead><tbody>${payments
      .map((p) => `<tr><td>${p.id}<br><small>${esc(p.created_at)}</small></td><td>${esc(p.name)}<br><small>${esc(p.email)}</small></td>
        <td>${esc(p.plan)}<br>${money(p.amount, p.currency)}</td><td>${esc(p.method || p.provider)}</td><td><code>${esc(p.reference || '')}</code></td>
        <td>${p.status === 'pending' && p.provider === 'manual'
          ? `<button class="btn sm" data-action="pay-approve" data-id="${p.id}">${t('approve')}</button> <button class="btn sm ghost" data-action="pay-reject" data-id="${p.id}">${t('reject')}</button>`
          : `<span class="tag ${p.status}">${t(`st_${p.status}`)}</span>`}</td></tr>`)
      .join('')}</tbody></table></div>`;
  },
  async users() {
    const q = state.userQuery || '';
    const { users } = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
    return `<form class="row" data-submit="user-search"><input name="q" value="${esc(q)}" placeholder="${t('search')}"><button class="btn">${t('search')}</button></form>
      <div class="table-wrap"><table><thead><tr><th>${t('name')}</th><th>${t('age')}</th><th>XP</th><th>${t('subscription')}</th><th>${t('role')}</th><th>${t('grant_days')}</th></tr></thead><tbody>${users
        .map((x) => `<tr><td>${esc(x.name)}<br><small>${esc(x.email)}</small></td><td>${x.age}${x.guardianConsent ? ' 👪' : ''}</td><td>${x.xp}</td>
          <td>${x.plan ? `${esc(planLabel(x.plan))}<br><small>${fmtDate(x.expiresAt)}</small>` : '—'}</td>
          <td>${x.role === 'owner' ? 'owner' : `<select data-change="role" data-id="${x.id}"><option ${x.role === 'student' ? 'selected' : ''}>student</option><option ${x.role === 'admin' ? 'selected' : ''}>admin</option></select>`}</td>
          <td><button class="btn sm ghost" data-action="grant" data-id="${x.id}">+30</button></td></tr>`)
        .join('')}</tbody></table></div>`;
  },
  async content() {
    const subject = state.contentSubject || 'math';
    const { lessons } = await api(`/api/admin/lessons?subject=${subject}`);
    return `<div class="row"><select data-change="content-subject">${state.meta.subjects.map((s) => `<option value="${s}" ${s === subject ? 'selected' : ''}>${subjectName(s)}</option>`).join('')}</select>
      <button class="btn ghost" data-action="new-lesson" data-subject="${subject}">+ ${t('new_lesson')}</button></div>
      ${lessons
        .map((l) => `<details class="card editor"><summary><b>${levelName(l.level)} · ${l.seq}.</b> ${esc(tx(l.title))} ${l.hasVideo ? '🎬' : ''}</summary>
          <form data-submit="lesson-save" data-id="${l.id}">
            ${state.meta.langs.map((lg) => `<fieldset><legend>${LANG_NAMES[lg]}</legend>
              <label>${t('title')}<input name="title_${lg}" value="${esc(l.title[lg] || '')}" dir="auto"></label>
              <label>${t('body')}<textarea name="body_${lg}" rows="3" dir="auto">${esc(l.body[lg] || '')}</textarea></label></fieldset>`).join('')}
            <label>${t('example')}<input name="example" value="${esc(l.example)}"></label>
            <label>${t('video_url')}<input name="videoUrl" type="url" value="${esc(l.videoUrl || '')}" placeholder="https://www.youtube.com/watch?v=…"></label>
            <label class="check"><input type="checkbox" name="free" ${l.free ? 'checked' : ''}> ${t('free')}</label>
            <div class="row"><button class="btn">${t('save')}</button><span class="saved muted"></span></div>
          </form>
          <div class="row"><label class="btn ghost sm">⬆ ${t('upload_video')}<input type="file" accept="video/mp4,video/webm,video/ogg" hidden data-change="video-upload" data-id="${l.id}"></label>
            ${l.videoFile ? `<button class="btn ghost sm" data-action="video-remove" data-id="${l.id}">${t('remove_video')}</button>` : ''}<span class="upl muted"></span></div>
        </details>`)
        .join('')}`;
  },
  async settings() {
    const s = await api('/api/admin/settings');
    return `<form class="card" data-submit="settings"><div class="err"></div>
      <label>${t('app_name')}<input name="appName" value="${esc(s.appName)}" required></label>
      <label>© Owner<input name="ownerName" value="${esc(s.ownerName)}" placeholder="Your full name"></label>
      <div class="grid2"><label>${t('currency')}<input name="currency" value="${esc(s.currency)}" pattern="[A-Z]{3}" required></label>
      <label>${t('trial_days')}<input name="trialDays" type="number" min="0" max="60" value="${s.trialDays}"></label></div>
      <label>${t('plans')}</label>
      <div id="plans">${s.plans.map(planRow).join('')}</div>
      <button type="button" class="btn ghost sm" data-action="add-plan">+ ${t('add_plan')}</button>
      <label>${t('methods')}<input name="manualMethods" value="${esc(s.manualMethods.join(', '))}"></label>
      <label>${t('instructions')}<textarea name="paymentInstructions" rows="4">${esc(s.paymentInstructions)}</textarea></label>
      <label>${t('support_contact')}<input name="supportContact" value="${esc(s.supportContact)}" placeholder="+998 … / @telegram"></label>
      <div class="row"><button class="btn">${t('save')}</button><span class="saved muted"></span></div></form>`;
  },
};

const planRow = (p = { id: '', days: 30, price: 0 }) =>
  `<div class="row plan-row"><input name="plan_id" value="${esc(p.id)}" placeholder="monthly"><input name="plan_days" type="number" min="1" value="${p.days}"><input name="plan_price" type="number" min="1" step="any" value="${p.price}"><button type="button" class="btn ghost sm" data-action="del-plan">✕</button></div>`;

// ---------- events ----------
const actions = {
  logout,
  async install() {
    state.installPrompt?.prompt();
    state.installPrompt = null;
  },
  async diagnostic(el) {
    const s = await api(`/api/diagnostic/${el.dataset.subject}`, { method: 'POST' });
    startQuiz(s, { title: `🎯 ${subjectName(el.dataset.subject)}`, back: `#/subject/${el.dataset.subject}` });
  },
  async beginner(el) {
    await api(`/api/subjects/${el.dataset.subject}/start-beginner`, { method: 'POST' });
    route();
  },
  async practice(el) {
    const s = await api('/api/practice', { method: 'POST', body: { subject: el.dataset.subject, level: Number(el.dataset.level) } });
    startQuiz(s, { title: `💪 ${subjectName(el.dataset.subject)}`, back: `#/subject/${el.dataset.subject}` });
  },
  async 'lesson-quiz'(el) {
    const s = await api(`/api/lessons/${el.dataset.id}/quiz`, { method: 'POST' });
    startQuiz({ ...s, ref: el.dataset.id }, { title: t('lesson'), back: `#/lesson/${el.dataset.id}` });
  },
  async 'lesson-done'(el) {
    await api(`/api/lessons/${el.dataset.id}/complete`, { method: 'POST' });
    route();
  },
  async challenge() {
    const s = await api('/api/challenge/start', { method: 'POST' });
    startQuiz(s, { title: `🏆 ${t('daily_challenge')}`, back: '#/challenge' });
  },
  choose(el) {
    state.quiz.answers[state.quiz.idx] = Number(el.dataset.i);
    for (const b of document.querySelectorAll('.choice')) b.classList.toggle('sel', b === el);
    document.querySelector('[data-action="quiz-next"]').disabled = false;
  },
  async 'quiz-next'() {
    const s = state.quiz;
    if (s.idx < s.questions.length - 1) {
      s.idx++;
      views.quiz();
    } else await finishQuiz();
  },
  async 'pay-approve'(el) {
    await api(`/api/admin/payments/${el.dataset.id}/approve`, { method: 'POST' });
    route();
  },
  async 'pay-reject'(el) {
    await api(`/api/admin/payments/${el.dataset.id}/reject`, { method: 'POST' });
    route();
  },
  async grant(el) {
    await api(`/api/admin/users/${el.dataset.id}`, { method: 'PATCH', body: { grantDays: 30 } });
    route();
  },
  async 'new-lesson'(el) {
    const title = prompt(t('title'));
    if (!title) return;
    const level = Number(prompt(`${t('level')} (0–4)`, '0'));
    await api('/api/admin/lessons', { method: 'POST', body: { subject: el.dataset.subject, level, title: { [state.lang]: title }, body: {} } });
    route();
  },
  async 'video-remove'(el) {
    await api(`/api/admin/lessons/${el.dataset.id}/video`, { method: 'DELETE' });
    route();
  },
  'add-plan'() {
    document.getElementById('plans').insertAdjacentHTML('beforeend', planRow());
  },
  'del-plan'(el) {
    el.closest('.plan-row').remove();
  },
};

const changes = {
  lang(el) {
    setLang(el.value);
    route();
  },
  birth(el) {
    const birth = new Date(el.value);
    const age = (Date.now() - birth.getTime()) / (365.25 * 86400000);
    document.getElementById('guardian').classList.toggle('hidden', !(age < state.meta.ageLimits.guardian));
  },
  async role(el) {
    await api(`/api/admin/users/${el.dataset.id}`, { method: 'PATCH', body: { role: el.value } });
  },
  'content-subject'(el) {
    state.contentSubject = el.value;
    route();
  },
  async 'video-upload'(el) {
    const file = el.files[0];
    if (!file) return;
    const info = el.closest('.row').querySelector('.upl');
    info.textContent = t('uploading');
    try {
      await api(`/api/admin/lessons/${el.dataset.id}/video`, { method: 'PUT', raw: file, headers: { 'Content-Type': file.type } });
      route();
    } catch (e) {
      info.textContent = errText(e);
    }
  },
};

const submits = {
  async login(f) {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
    signedIn(r);
  },
  async register(f) {
    const r = await api('/api/auth/register', {
      method: 'POST',
      body: {
        name: f.name.value, email: f.email.value, password: f.password.value, birthDate: f.birthDate.value, lang: state.lang,
        guardianConsent: f.guardianConsent.checked, acceptTerms: f.acceptTerms.checked,
      },
    });
    signedIn(r);
  },
  async password(f) {
    await api('/api/me', { method: 'PATCH', body: { password: f.password.value, newPassword: f.newPassword.value } });
    f.reset();
    f.querySelector('.err').innerHTML = `<div class="alert ok">${t('saved')}</div>`;
  },
  async 'delete-account'(f) {
    await api('/api/me', { method: 'DELETE', body: { password: f.password.value } });
    logout();
  },
  async pay(f, submitter) {
    const plan = f.plan.value;
    if (submitter?.value === 'stripe') {
      const r = await api('/api/billing/stripe', { method: 'POST', body: { plan } });
      location.href = r.url;
      return;
    }
    await api('/api/billing/manual', { method: 'POST', body: { plan, method: f.method.value, reference: f.reference.value } });
    await views.billing();
    document.querySelector('main').insertAdjacentHTML('afterbegin', `<div class="alert ok">${t('payment_sent')}</div>`);
  },
  async 'user-search'(f) {
    state.userQuery = f.q.value;
    route();
  },
  async 'lesson-save'(f) {
    const title = {}, body = {};
    for (const lg of state.meta.langs) {
      title[lg] = f[`title_${lg}`].value;
      body[lg] = f[`body_${lg}`].value;
    }
    await api(`/api/admin/lessons/${f.dataset.id}`, {
      method: 'PUT', body: { title, body, example: f.example.value, videoUrl: f.videoUrl.value, free: f.free.checked },
    });
    f.querySelector('.saved').textContent = `✓ ${t('saved')}`;
  },
  async settings(f) {
    const ids = [...f.querySelectorAll('[name=plan_id]')].map((i) => i.value.trim());
    const days = [...f.querySelectorAll('[name=plan_days]')].map((i) => Number(i.value));
    const prices = [...f.querySelectorAll('[name=plan_price]')].map((i) => Number(i.value));
    await api('/api/admin/settings', {
      method: 'PUT',
      body: {
        appName: f.appName.value, ownerName: f.ownerName.value, currency: f.currency.value.toUpperCase(), trialDays: Number(f.trialDays.value),
        plans: ids.map((id, i) => ({ id, days: days[i], price: prices[i] })),
        manualMethods: f.manualMethods.value.split(',').map((s) => s.trim()).filter(Boolean),
        paymentInstructions: f.paymentInstructions.value, supportContact: f.supportContact.value,
      },
    });
    state.meta = await api('/api/meta');
    f.querySelector('.saved').textContent = `✓ ${t('saved')}`;
  },
};

function signedIn(r) {
  state.token = r.token;
  state.me = null;
  store.set('token', r.token);
  setLang(r.user.lang || state.lang, false);
  location.hash = '#/today';
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  el.disabled = true;
  try {
    await actions[el.dataset.action](el);
  } catch (err) {
    showError(err, el);
  } finally {
    el.disabled = false;
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-change]');
  if (!el || !changes[el.dataset.change]) return;
  try {
    await changes[el.dataset.change](el);
  } catch (err) {
    showError(err, el);
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-submit]');
  if (!f) return;
  e.preventDefault();
  const btns = f.querySelectorAll('button');
  btns.forEach((b) => (b.disabled = true));
  try {
    await submits[f.dataset.submit](f, e.submitter);
  } catch (err) {
    const box = f.querySelector('.err');
    if (box) box.innerHTML = errorBox(err);
    else showError(err, f);
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
});

function showError(err, near) {
  if (err.message === 'unauthorized') return;
  const div = document.createElement('div');
  div.className = 'alert toast';
  div.textContent = errText(err);
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
  console.error(err, near);
}

// Discourage casual saving of protected lesson videos.
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('video[data-protect]')) e.preventDefault();
});

// ---------- router ----------
const go = (r) => {
  location.hash = `#/${r}`;
};

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const [name, ...args] = parts;
  const publicViews = ['', 'login', 'register', 'terms'];
  if (!publicViews.includes(name) && !state.token) return go('login');
  if (state.token && !state.me) {
    try {
      await loadMe();
    } catch {
      return;
    }
  }
  if ((name === 'login' || name === 'register') && state.token) return go('today');
  const view = views[name] || views[''];
  try {
    await view(args);
  } catch (err) {
    if (err.message !== 'unauthorized') render(errorBox(err));
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
  route();
});

(async function init() {
  setLang(state.lang, false);
  try {
    state.meta = await api('/api/meta');
  } catch {
    $app.innerHTML = `<p class="pad center">${t('err_generic')}</p>`;
    return;
  }
  document.title = state.meta.appName;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  route();
})();
