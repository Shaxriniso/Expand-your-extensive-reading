import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { createApp, videoInfo } from '../server/app.js';
import { GENERATORS, Rng } from '../server/content/generators.js';
import { VOCAB } from '../server/content/curriculum.js';
import { placementLevel } from '../server/quiz.js';
import { verifyStripeSignature } from '../server/payments.js';
import { ageOn } from '../server/auth.js';

let server, db, base, dir;
const OWNER = { email: 'owner@example.com', password: 'owner-pass-123', name: 'Owner' };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilimup-'));
  ({ server, db } = createApp({ dataDir: dir, dbPath: ':memory:', secret: 'test-secret', owner: OWNER }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(p, { method = 'GET', body, token, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + p, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

const yearsAgo = (n, extraDays = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() + extraDays);
  return d.toISOString().slice(0, 10);
};

let counter = 0;
async function register(over = {}) {
  const body = {
    name: 'Test Student', email: `s${++counter}@example.com`, password: 'password123', birthDate: yearsAgo(20), lang: 'en', acceptTerms: true, ...over,
  };
  return call('/api/auth/register', { method: 'POST', body });
}

async function ownerToken() {
  const r = await call('/api/auth/login', { method: 'POST', body: { email: OWNER.email, password: OWNER.password } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'owner');
  return r.data.token;
}

test('every generator produces valid multiple-choice questions', () => {
  const rng = new Rng(123);
  for (const [name, gen] of Object.entries(GENERATORS)) {
    for (let i = 0; i < 2000; i++) {
      const q = gen(rng);
      assert.ok(q.answer >= 0, `${name} answer present`);
      assert.equal(new Set(q.choices).size, q.choices.length, `${name} unique choices`);
      assert.ok(q.choices.length === 4 || (name === 'math.compare' && q.choices.length === 3), `${name} choice count`);
    }
  }
});

test('vocabulary has all five languages for every word', () => {
  for (const words of Object.values(VOCAB)) {
    for (const w of words) for (const k of ['en', 'uz', 'ru', 'ko', 'ar']) assert.ok(w[k]?.length, `${w.en} ${k}`);
  }
});

test('age calculation and limits', () => {
  assert.equal(ageOn('2000-06-15', '2026-06-14'), 25);
  assert.equal(ageOn('2000-06-15', '2026-06-15'), 26);
  assert.ok(Number.isNaN(ageOn('2000-02-30', '2026-01-01')));
});

test('registration enforces the 7–70 age range and guardian consent', async () => {
  assert.equal((await register({ birthDate: yearsAgo(6) })).data.error, 'age_out_of_range');
  assert.equal((await register({ birthDate: yearsAgo(71) })).data.error, 'age_out_of_range');
  assert.equal((await register({ birthDate: yearsAgo(7, -1) })).data.error, 'guardian_consent_required');
  assert.equal((await register({ birthDate: yearsAgo(7, -1), guardianConsent: true })).status, 200);
  assert.equal((await register({ birthDate: yearsAgo(70, 1) })).status, 200);
  assert.equal((await register({ acceptTerms: false })).data.error, 'terms_required');
  const r = await register({ email: 'dup@example.com' });
  assert.equal(r.status, 200);
  assert.equal((await register({ email: 'dup@example.com' })).status, 409);
});

test('new members get a free trial; login works; bad password rejected', async () => {
  const r = await register({ email: 'trial@example.com' });
  assert.equal(r.data.user.access.active, true);
  assert.equal(r.data.user.access.plan, 'trial');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'trial@example.com', password: 'nope-nope' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'TRIAL@example.com', password: 'password123' } })).status, 200);
});

test('diagnostic places the learner and never leaks answers', async () => {
  const { token } = (await register()).data;
  const s = await call('/api/diagnostic/math', { method: 'POST', token });
  assert.equal(s.data.questions.length, 10);
  assert.ok(s.data.questions.every((q) => !('answer' in q)));
  const r = await call(`/api/quiz/${s.data.id}/submit`, { method: 'POST', token, body: { answers: [] } });
  assert.equal(r.data.level, 0);
  assert.equal(r.data.total, 10);
  // Cannot submit twice.
  assert.equal((await call(`/api/quiz/${s.data.id}/submit`, { method: 'POST', token, body: { answers: [] } })).status, 409);
  const sub = await call('/api/subjects/math', { token });
  assert.equal(sub.data.enrollment.level, 0);
});

test('placement climbs levels while both answers are right', () => {
  const qs = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4].map((level) => ({ level }));
  assert.equal(placementLevel(qs, Array(10).fill(true)), 4);
  assert.equal(placementLevel(qs, [true, true, true, true, true, false, true, true, true, true]), 2);
  assert.equal(placementLevel(qs, [false, true, true, true, true, true, true, true, true, true]), 0);
});

test('lesson quiz: pass, XP, streak, level-up, and lock rules', async () => {
  const { token } = (await register({ lang: 'uz' })).data;
  await call('/api/subjects/logic/start-beginner', { method: 'POST', token });
  const subj = await call('/api/subjects/logic', { token });
  const beginner = subj.data.lessons.filter((l) => l.level === 0);
  assert.ok(subj.data.lessons.filter((l) => l.level === 1).every((l) => l.locked === 'level'));
  for (const l of beginner) {
    const lesson = await call(`/api/lessons/${l.id}`, { token });
    assert.equal(lesson.status, 200);
    const s = await call(`/api/lessons/${l.id}/quiz`, { method: 'POST', token });
    assert.equal(s.data.questions.length, 5);
    const answers = await correctAnswers(s.data.id);
    const r = await call(`/api/quiz/${s.data.id}/submit`, { method: 'POST', token, body: { answers } });
    assert.equal(r.data.passed, true);
    assert.equal(r.data.correct, 5);
    assert.equal(r.data.streak, 1);
  }
  const me = await call('/api/me', { token });
  assert.equal(me.data.enrollments.find((e) => e.subject === 'logic').level, 1);
  assert.ok(me.data.user.xp >= beginner.length * 70);
  assert.ok(me.data.badges.includes('first_lesson'));
  const today = await call('/api/today', { token });
  assert.equal(today.data.plan[0].next.level, 1);
});

// Correct answers are only stored server-side; tests read them from the db.
async function correctAnswers(sessionId) {
  const row = db.prepare('SELECT payload FROM quiz_sessions WHERE id = ?').get(sessionId);
  return JSON.parse(row.payload).map((q) => q.answer);
}

test('premium lessons need a subscription; manual payment approved by owner unlocks them', async () => {
  const owner = await ownerToken();
  await call('/api/admin/settings', { method: 'PUT', token: owner, body: { trialDays: 0 } });
  const { token } = (await register({ email: 'payer@example.com' })).data;
  await call('/api/subjects/math/start-beginner', { method: 'POST', token });
  const subj = await call('/api/subjects/math', { token });
  const free = subj.data.lessons.find((l) => l.level === 0 && l.free);
  const paid = subj.data.lessons.find((l) => l.level === 0 && !l.free);
  assert.equal(free.locked, null);
  assert.equal(paid.locked, 'premium');
  assert.equal((await call(`/api/lessons/${paid.id}`, { token })).status, 403);
  assert.equal((await call('/api/practice', { method: 'POST', token, body: { subject: 'math', level: 0 } })).status, 403);

  const pay = await call('/api/billing/manual', { method: 'POST', token, body: { plan: 'monthly', method: 'click', reference: 'TX-998877' } });
  assert.equal(pay.status, 200);
  const list = await call('/api/admin/payments?status=pending', { token: owner });
  const p = list.data.payments.find((x) => x.reference === 'TX-998877');
  assert.equal(p.amount, 99000);
  assert.equal((await call(`/api/admin/payments/${p.id}/approve`, { method: 'POST', token: owner })).status, 200);
  assert.equal((await call(`/api/admin/payments/${p.id}/approve`, { method: 'POST', token: owner })).status, 409);

  assert.equal((await call(`/api/lessons/${paid.id}`, { token })).status, 200);
  const me = await call('/api/me', { token });
  assert.equal(me.data.user.access.plan, 'monthly');
  const stats = await call('/api/admin/stats', { token: owner });
  assert.deepEqual(stats.data.revenue, [{ currency: 'UZS', total: 99000, n: 1 }]);
  await call('/api/admin/settings', { method: 'PUT', token: owner, body: { trialDays: 3 } });
});

test('owner-only endpoints reject students and admins', async () => {
  const { token } = (await register()).data;
  for (const p of ['/api/admin/stats', '/api/admin/users', '/api/admin/payments', '/api/admin/settings']) {
    assert.equal((await call(p, { token })).status, 403, p);
  }
  assert.equal((await call('/api/admin/stats')).status, 401);
});

test('owner edits lessons, sets video links and uploads protected videos', async () => {
  const owner = await ownerToken();
  const { lessons } = (await call('/api/admin/lessons?subject=math', { token: owner })).data;
  const l = lessons[0];
  assert.equal((await call(`/api/admin/lessons/${l.id}`, { method: 'PUT', token: owner, body: { videoUrl: 'javascript:alert(1)' } })).status, 400);
  const up = await call(`/api/admin/lessons/${l.id}`, {
    method: 'PUT', token: owner, body: { videoUrl: 'https://youtu.be/dQw4w9WgXcQ', title: { ...l.title, en: 'Addition (updated)' } },
  });
  assert.equal(up.status, 200);
  assert.equal(up.data.lesson.title.en, 'Addition (updated)');
  const { token } = (await register()).data;
  const view = await call(`/api/lessons/${l.id}`, { token });
  assert.deepEqual(view.data.video, { kind: 'embed', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });

  const bytes = crypto.randomBytes(5000);
  const put = await call(`/api/admin/lessons/${l.id}/video`, { method: 'PUT', token: owner, raw: bytes, headers: { 'Content-Type': 'video/mp4' } });
  assert.equal(put.status, 200);
  const v2 = await call(`/api/lessons/${l.id}`, { token });
  assert.equal(v2.data.video.kind, 'file');
  const full = await fetch(base + v2.data.video.src);
  assert.equal(full.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await full.arrayBuffer()), bytes), 0);
  const part = await fetch(base + v2.data.video.src, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(`${base}/media/lessons/${l.id}?t=forged`)).status, 403);
  assert.equal((await fetch(`${base}/media/lessons/${l.id}`)).status, 403);
});

test('daily challenge: one attempt per day, resumes the same session, leaderboard uses short names', async () => {
  const { token } = (await register({ name: 'Aziza Karimova' })).data;
  const s1 = await call('/api/challenge/start', { method: 'POST', token });
  const s2 = await call('/api/challenge/start', { method: 'POST', token });
  assert.equal(s1.data.id, s2.data.id);
  assert.equal(s1.data.questions.length, 10);
  const r = await call(`/api/quiz/${s1.data.id}/submit`, { method: 'POST', token, body: { answers: await correctAnswers(s1.data.id) } });
  assert.equal(r.data.correct, 10);
  assert.ok(r.data.score >= 1000);
  assert.equal((await call('/api/challenge/start', { method: 'POST', token })).data.error, 'already_played');
  const board = await call('/api/challenge', { token });
  assert.ok(board.data.top.some((x) => x.name === 'Aziza K.' && x.me));
  const other = (await register()).data.token;
  const s3 = await call('/api/challenge/start', { method: 'POST', token: other });
  assert.deepEqual(s3.data.questions, s1.data.questions, 'same questions for everyone today');
});

test('vocabulary lessons show words in the learner language', async () => {
  const { token } = (await register({ lang: 'ru' })).data;
  const subj = await call('/api/subjects/korean', { token });
  const first = subj.data.lessons[0];
  const l = await call(`/api/lessons/${first.id}`, { token });
  assert.deepEqual(l.data.words[0], { word: '안녕하세요', meaning: 'Привет' });
});

test('stripe webhook signature verification', () => {
  const secret = 'whsec_test';
  const body = '{"type":"x"}';
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${ts},v1=${sig}`, secret), true);
  assert.equal(verifyStripeSignature(body, `t=${ts},v1=${'0'.repeat(64)}`, secret), false);
  assert.equal(verifyStripeSignature(body, `t=${ts - 1000},v1=${sig}`, secret), false);
});

test('video link parsing', () => {
  assert.equal(videoInfo('https://www.youtube.com/watch?v=abcdefghijk').src, 'https://www.youtube-nocookie.com/embed/abcdefghijk');
  assert.equal(videoInfo('https://vimeo.com/123456').src, 'https://player.vimeo.com/video/123456');
  assert.equal(videoInfo('https://cdn.example.com/a.mp4').kind, 'file');
  assert.equal(videoInfo('http://cdn.example.com/a.mp4'), null);
  assert.equal(videoInfo('javascript:alert(1)'), null);
});

test('static site, security headers and path traversal', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await home.text(), /<div id="app">/);
  assert.equal((await fetch(base + '/manifest.webmanifest')).status, 200);
  for (const raw of ['/..%2Fpackage.json', '/%2e%2e%2fserver%2fapp.js']) {
    const status = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: server.address().port, path: raw }, (r) => resolve(r.statusCode)));
    assert.equal(status, 400, raw);
  }
  assert.equal((await fetch(base + '/nope.js')).status, 404);
});
