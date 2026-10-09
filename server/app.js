import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { openDb, getSettings, saveSettings } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, ageOn, MIN_AGE, MAX_AGE, GUARDIAN_AGE } from './auth.js';
import { Router, HttpError, fail, sendJson, readJson, readRaw, dayString, addDays } from './util.js';
import { LANGS, LEVELS, SUBJECTS, LANGUAGE_SUBJECTS, VOCAB } from './content/curriculum.js';
import * as quiz from './quiz.js';
import { stripeEnabled, createStripeCheckout, verifyStripeSignature } from './payments.js';

const TOKEN_TTL = 30 * 24 * 3600;
const MEDIA_TTL = 4 * 3600;
const QUIZ_TTL_MS = 6 * 3600 * 1000;
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_MB || 1024) * 1024 * 1024;
const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' https:",
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const parseJson = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

export function videoInfo(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let yt = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    yt = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/) || [])[1];
  }
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${yt}` };
  if (host === 'vimeo.com') {
    const id = (u.pathname.match(/^\/(\d+)/) || [])[1];
    if (id) return { kind: 'embed', src: `https://player.vimeo.com/video/${id}` };
  }
  if (u.protocol === 'https:') return { kind: 'file', src: u.href };
  return null;
}

// Short public display name, e.g. "Aziza K." — members can be children.
const displayName = (name) => {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : parts[0];
};

export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.resolve('data');
  fs.mkdirSync(path.join(dataDir, 'videos'), { recursive: true });
  const db = openDb(options.dbPath || path.join(dataDir, 'bilimup.db'));
  const publicDir = options.publicDir || fileURLToPath(new URL('../public', import.meta.url));
  const secret = options.secret || process.env.APP_SECRET || loadSecret(dataDir);
  const today = options.today || (() => dayString());
  const router = new Router();
  const loginAttempts = new Map();

  const owner = options.owner || { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD, name: process.env.OWNER_NAME };
  const ownerEmail = owner.email ? owner.email.trim().toLowerCase() : null;
  bootstrapOwner(db, owner);

  // ---------- helpers ----------
  const lessonRow = (id) => db.prepare('SELECT * FROM lessons WHERE id = ?').get(Number(id));
  const subjectLessons = (subject) => db.prepare('SELECT * FROM lessons WHERE subject = ? ORDER BY level, seq, id').all(subject);
  const isStaff = (u) => u.role === 'owner' || u.role === 'admin';
  const subscription = (u) => db.prepare('SELECT plan, expires_at FROM subscriptions WHERE user_id = ?').get(u.id);
  const hasAccess = (u) => {
    if (isStaff(u)) return true;
    const s = subscription(u);
    return Boolean(s && s.expires_at > new Date().toISOString());
  };
  const enrollment = (u, subject) => db.prepare('SELECT level FROM enrollments WHERE user_id = ? AND subject = ?').get(u.id, subject);
  const completedSet = (u) => new Set(db.prepare('SELECT lesson_id FROM progress WHERE user_id = ?').all(u.id).map((r) => r.lesson_id));

  function lockReason(u, lesson, access) {
    if (isStaff(u)) return null;
    const level = enrollment(u, lesson.subject)?.level ?? 0;
    if (lesson.level > level) return 'level';
    if (!lesson.is_free && !access) return 'premium';
    return null;
  }

  function authUser(req) {
    const h = req.headers.authorization || '';
    const payload = verifyToken(secret, h.startsWith('Bearer ') ? h.slice(7) : null);
    if (!payload || payload.typ !== 'session') return null;
    return db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid) || null;
  }

  function addXp(u, amount, reason) {
    if (amount <= 0) return;
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, u.id);
    db.prepare('INSERT INTO xp_log (user_id, amount, reason, day) VALUES (?, ?, ?, ?)').run(u.id, amount, reason, today());
  }

  function touchActivity(u) {
    const d = today();
    const cur = db.prepare('SELECT last_active, streak, best_streak FROM users WHERE id = ?').get(u.id);
    if (cur.last_active === d) return cur.streak;
    const streak = cur.last_active === addDays(d, -1) ? cur.streak + 1 : 1;
    db.prepare('UPDATE users SET last_active = ?, streak = ?, best_streak = MAX(best_streak, ?) WHERE id = ?').run(d, streak, streak, u.id);
    return streak;
  }

  function extendSubscription(userId, plan, days) {
    const now = new Date();
    const cur = db.prepare('SELECT expires_at FROM subscriptions WHERE user_id = ?').get(userId);
    const from = cur && new Date(cur.expires_at) > now ? new Date(cur.expires_at) : now;
    const expires = new Date(from.getTime() + days * 86400000).toISOString();
    db.prepare(
      'INSERT INTO subscriptions (user_id, plan, expires_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, expires_at = excluded.expires_at',
    ).run(userId, plan, expires);
    return expires;
  }

  function markPaid(paymentId) {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!p || p.status !== 'pending') return false;
    db.prepare("UPDATE payments SET status = 'paid', decided_at = datetime('now') WHERE id = ?").run(p.id);
    extendSubscription(p.user_id, p.plan, p.days);
    return true;
  }

  function badges(u) {
    const done = db.prepare('SELECT COUNT(*) AS n FROM progress WHERE user_id = ?').get(u.id).n;
    const enr = db.prepare('SELECT subject, level FROM enrollments WHERE user_id = ?').all(u.id);
    const challenges = db.prepare('SELECT COUNT(*) AS n FROM challenge_results WHERE user_id = ?').get(u.id).n;
    const langs = enr.filter((e) => e.subject in LANGUAGE_SUBJECTS).length;
    const list = [
      ['first_lesson', done >= 1], ['ten_lessons', done >= 10], ['fifty_lessons', done >= 50],
      ['streak_3', u.best_streak >= 3], ['streak_7', u.best_streak >= 7], ['streak_30', u.best_streak >= 30],
      ['xp_100', u.xp >= 100], ['xp_1000', u.xp >= 1000], ['xp_5000', u.xp >= 5000],
      ['diagnostic', enr.length >= 1], ['polyglot', langs >= 3],
      ['challenger', challenges >= 1], ['challenger_7', challenges >= 7],
      ['advanced', enr.some((e) => e.level >= 4)],
    ];
    return list.filter(([, ok]) => ok).map(([id]) => id);
  }

  function publicUser(u) {
    const s = subscription(u);
    return {
      id: u.id, email: u.email, name: u.name, role: u.role, lang: u.lang, birthDate: u.birth_date,
      age: ageOn(u.birth_date, today()), xp: u.xp, streak: u.last_active && u.last_active >= addDays(today(), -1) ? u.streak : 0,
      bestStreak: u.best_streak,
      access: { active: hasAccess(u), plan: isStaff(u) ? u.role : s?.plan || null, expiresAt: s?.expires_at || null },
    };
  }

  function lessonView(l) {
    return {
      id: l.id, subject: l.subject, level: l.level, seq: l.seq, gen: l.gen, topic: l.topic,
      title: parseJson(l.title, {}), body: parseJson(l.body, {}), example: l.example,
      free: Boolean(l.is_free), hasVideo: Boolean(l.video_file || videoInfo(l.video_url)),
    };
  }

  function startSession(u, kind, ref, questions) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO quiz_sessions (id, user_id, kind, ref, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, u.id, kind, ref, JSON.stringify(questions), Date.now(),
    );
    return { id, kind, questions: questions.map(quiz.publicQuestion) };
  }

  const requireUser = (ctx) => ctx.user || fail(401, 'unauthorized');
  const requireStaff = (ctx) => (requireUser(ctx), isStaff(ctx.user) ? ctx.user : fail(403, 'forbidden'));
  const requireOwner = (ctx) => (requireUser(ctx), ctx.user.role === 'owner' ? ctx.user : fail(403, 'forbidden'));
  const validSubject = (s) => (SUBJECTS.includes(s) ? s : fail(404, 'unknown_subject'));

  function rateLimit(req, key, max = 20, windowMs = 10 * 60 * 1000) {
    const id = `${key}:${req.socket.remoteAddress}`;
    const now = Date.now();
    const e = loginAttempts.get(id);
    if (!e || e.reset < now) return loginAttempts.set(id, { n: 1, reset: now + windowMs });
    if (++e.n > max) fail(429, 'too_many_attempts');
  }

  // ---------- public ----------
  // Used by Docker and uptime monitors.
  router.add('GET', '/api/health', () => (db.prepare('SELECT 1').get(), { ok: true }));

  router.add('GET', '/api/meta', () => {
    const s = getSettings(db);
    return {
      appName: s.appName, ownerName: s.ownerName, langs: LANGS, levels: LEVELS, subjects: SUBJECTS, languageSubjects: LANGUAGE_SUBJECTS,
      ageLimits: { min: MIN_AGE, max: MAX_AGE, guardian: GUARDIAN_AGE },
      currency: s.currency, plans: s.plans, trialDays: s.trialDays, supportContact: s.supportContact,
    };
  });

  router.add('POST', '/api/auth/register', async (ctx) => {
    rateLimit(ctx.req, 'register');
    const b = await readJson(ctx.req);
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim().slice(0, 80);
    const password = String(b.password || '');
    const lang = LANGS.includes(b.lang) ? b.lang : 'uz';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) fail(400, 'invalid_email');
    if (name.length < 2) fail(400, 'invalid_name');
    if (password.length < 8 || password.length > 200) fail(400, 'weak_password');
    const age = ageOn(b.birthDate, today());
    if (Number.isNaN(age)) fail(400, 'invalid_birth_date');
    if (age < MIN_AGE || age > MAX_AGE) fail(400, 'age_out_of_range', { min: MIN_AGE, max: MAX_AGE });
    if (age < GUARDIAN_AGE && b.guardianConsent !== true) fail(400, 'guardian_consent_required');
    if (b.acceptTerms !== true) fail(400, 'terms_required');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'email_taken');
    const role = email === ownerEmail ? 'owner' : 'student';
    const r = db.prepare('INSERT INTO users (email, pass, name, birth_date, lang, guardian_consent, role) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      email, hashPassword(password), name, b.birthDate, lang, age < GUARDIAN_AGE ? 1 : 0, role,
    );
    const trialDays = getSettings(db).trialDays;
    if (trialDays > 0) extendSubscription(Number(r.lastInsertRowid), 'trial', trialDays);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
    return { token: signToken(secret, { typ: 'session', uid: u.id }, TOKEN_TTL), user: publicUser(u) };
  });

  router.add('POST', '/api/auth/login', async (ctx) => {
    rateLimit(ctx.req, 'login');
    const b = await readJson(ctx.req);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(b.email || '').trim().toLowerCase());
    if (!u || !verifyPassword(String(b.password || ''), u.pass)) fail(401, 'invalid_credentials');
    return { token: signToken(secret, { typ: 'session', uid: u.id }, TOKEN_TTL), user: publicUser(u) };
  });

  // ---------- member ----------
  router.add('GET', '/api/me', (ctx) => {
    const u = requireUser(ctx);
    const enrollments = db.prepare('SELECT subject, level FROM enrollments WHERE user_id = ?').all(u.id);
    const completed = db.prepare('SELECT COUNT(*) AS n FROM progress WHERE user_id = ?').get(u.id).n;
    return { user: publicUser(u), enrollments, completed, badges: badges(u) };
  });

  // Members can delete their own account (required by the App Store).
  router.add('DELETE', '/api/me', async (ctx) => {
    const u = requireUser(ctx);
    const b = await readJson(ctx.req);
    if (u.role === 'owner') fail(400, 'cannot_delete_owner');
    if (!verifyPassword(String(b.password || ''), u.pass)) fail(401, 'invalid_credentials');
    db.prepare('DELETE FROM quiz_sessions WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    return { ok: true };
  });

  router.add('PATCH', '/api/me', async (ctx) => {
    const u = requireUser(ctx);
    const b = await readJson(ctx.req);
    if (b.lang !== undefined) {
      if (!LANGS.includes(b.lang)) fail(400, 'invalid_lang');
      db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(b.lang, u.id);
    }
    if (b.name !== undefined) {
      const name = String(b.name).trim().slice(0, 80);
      if (name.length < 2) fail(400, 'invalid_name');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
    }
    if (b.newPassword !== undefined) {
      if (!verifyPassword(String(b.password || ''), u.pass)) fail(401, 'invalid_credentials');
      if (String(b.newPassword).length < 8) fail(400, 'weak_password');
      db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(String(b.newPassword)), u.id);
    }
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) };
  });

  router.add('GET', '/api/today', (ctx) => {
    const u = requireUser(ctx);
    const done = completedSet(u);
    const access = hasAccess(u);
    const plan = db.prepare('SELECT subject, level FROM enrollments WHERE user_id = ? ORDER BY placed_at').all(u.id).map((e) => {
      const lessons = subjectLessons(e.subject);
      const next = lessons.find((l) => l.level <= e.level && !done.has(l.id)) || null;
      const atLevel = lessons.filter((l) => l.level === e.level);
      return {
        subject: e.subject, level: e.level,
        progress: { done: atLevel.filter((l) => done.has(l.id)).length, total: atLevel.length },
        next: next && { ...lessonView(next), locked: lockReason(u, next, access) },
      };
    });
    const d = today();
    const xpToday = db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM xp_log WHERE user_id = ? AND day = ?').get(u.id, d).n;
    const lessonsToday = db.prepare('SELECT COUNT(*) AS n FROM progress WHERE user_id = ? AND substr(completed_at, 1, 10) = ?').get(u.id, d).n;
    const challenge = db.prepare('SELECT score, correct FROM challenge_results WHERE user_id = ? AND day = ?').get(u.id, d) || null;
    return { day: d, plan, xpToday, lessonsToday, challenge, user: publicUser(u) };
  });

  router.add('GET', '/api/subjects/:subject', (ctx) => {
    const u = requireUser(ctx);
    const subject = validSubject(ctx.params.subject);
    const access = hasAccess(u);
    const done = new Map(db.prepare('SELECT lesson_id, best_score FROM progress WHERE user_id = ?').all(u.id).map((r) => [r.lesson_id, r.best_score]));
    const lessons = subjectLessons(subject).map((l) => ({
      ...lessonView(l), completed: done.has(l.id), score: done.get(l.id) ?? null, locked: lockReason(u, l, access),
    }));
    return { subject, enrollment: enrollment(u, subject) || null, access, lessons };
  });

  router.add('POST', '/api/subjects/:subject/start-beginner', (ctx) => {
    const u = requireUser(ctx);
    const subject = validSubject(ctx.params.subject);
    db.prepare('INSERT OR IGNORE INTO enrollments (user_id, subject, level) VALUES (?, ?, 0)').run(u.id, subject);
    return { enrollment: enrollment(u, subject) };
  });

  router.add('POST', '/api/diagnostic/:subject', (ctx) => {
    const u = requireUser(ctx);
    const subject = validSubject(ctx.params.subject);
    const questions = quiz.diagnosticQuestions(subjectLessons(subject), quiz.newRng(), u.lang);
    return startSession(u, 'diagnostic', subject, questions);
  });

  router.add('GET', '/api/lessons/:id', (ctx) => {
    const u = requireUser(ctx);
    const l = lessonRow(ctx.params.id) || fail(404, 'not_found');
    const locked = lockReason(u, l, hasAccess(u));
    if (locked) fail(403, 'locked', { reason: locked });
    let video = null;
    if (l.video_file) {
      const t = signToken(secret, { typ: 'media', lid: l.id, uid: u.id }, MEDIA_TTL);
      video = { kind: 'file', src: `/media/lessons/${l.id}?t=${encodeURIComponent(t)}` };
    } else video = videoInfo(l.video_url);
    let words = null;
    if (l.gen === 'vocab') {
      const target = LANGUAGE_SUBJECTS[l.subject];
      const meaning = quiz.meaningLang(l.subject, u.lang);
      words = VOCAB[l.topic].map((w) => ({ word: w[target], meaning: w[meaning] }));
    }
    const p = db.prepare('SELECT best_score FROM progress WHERE user_id = ? AND lesson_id = ?').get(u.id, l.id);
    return { lesson: { ...lessonView(l), completed: Boolean(p), score: p?.best_score ?? null }, video, words, hasQuiz: Boolean(l.gen) };
  });

  router.add('POST', '/api/lessons/:id/quiz', (ctx) => {
    const u = requireUser(ctx);
    const l = lessonRow(ctx.params.id) || fail(404, 'not_found');
    const locked = lockReason(u, l, hasAccess(u));
    if (locked) fail(403, 'locked', { reason: locked });
    if (!l.gen) fail(400, 'no_quiz');
    return startSession(u, 'lesson', String(l.id), quiz.lessonQuestions(l, quiz.newRng(), u.lang));
  });

  // Lessons without an exercise generator (custom owner lessons) are completed by watching/reading.
  router.add('POST', '/api/lessons/:id/complete', (ctx) => {
    const u = requireUser(ctx);
    const l = lessonRow(ctx.params.id) || fail(404, 'not_found');
    const locked = lockReason(u, l, hasAccess(u));
    if (locked) fail(403, 'locked', { reason: locked });
    if (l.gen) fail(400, 'quiz_required');
    return completeLesson(u, l, 100, 10);
  });

  function completeLesson(u, l, score, xp) {
    const first = !db.prepare('SELECT 1 FROM progress WHERE user_id = ? AND lesson_id = ?').get(u.id, l.id);
    db.prepare(
      `INSERT INTO progress (user_id, lesson_id, best_score, completed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, lesson_id) DO UPDATE SET best_score = MAX(best_score, excluded.best_score)`,
    ).run(u.id, l.id, score, `${today()}T${new Date().toISOString().slice(11, 19)}`);
    const gained = xp + (first ? 20 : 0);
    addXp(u, gained, 'lesson');
    const streak = touchActivity(u);
    db.prepare('INSERT OR IGNORE INTO enrollments (user_id, subject, level) VALUES (?, ?, ?)').run(u.id, l.subject, l.level);
    let levelUp = false;
    const e = enrollment(u, l.subject);
    if (e.level < 4) {
      const remaining = db.prepare(
        'SELECT COUNT(*) AS n FROM lessons l WHERE subject = ? AND level = ? AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.user_id = ? AND p.lesson_id = l.id)',
      ).get(l.subject, e.level, u.id).n;
      if (remaining === 0) {
        db.prepare('UPDATE enrollments SET level = level + 1 WHERE user_id = ? AND subject = ?').run(u.id, l.subject);
        levelUp = true;
      }
    }
    return { passed: true, xp: gained, streak, levelUp, level: enrollment(u, l.subject).level };
  }

  router.add('POST', '/api/practice', async (ctx) => {
    const u = requireUser(ctx);
    if (!hasAccess(u)) fail(403, 'locked', { reason: 'premium' });
    const b = await readJson(ctx.req);
    const subject = validSubject(b.subject);
    const max = isStaff(u) ? 4 : enrollment(u, subject)?.level ?? 0;
    const level = Math.min(Math.max(0, Number(b.level) || 0), max);
    const pool = subjectLessons(subject).filter((l) => l.level === level && l.gen);
    if (!pool.length) fail(404, 'no_questions');
    const rng = quiz.newRng();
    const questions = Array.from({ length: 10 }, () => quiz.questionFor(rng.pick(pool), rng, u.lang));
    return startSession(u, 'practice', `${subject}:${level}`, questions);
  });

  router.add('GET', '/api/challenge', (ctx) => {
    const u = requireUser(ctx);
    const d = today();
    const mine = db.prepare('SELECT score, correct, ms FROM challenge_results WHERE user_id = ? AND day = ?').get(u.id, d) || null;
    const top = db.prepare(
      'SELECT u.id, u.name, c.score, c.correct, c.ms FROM challenge_results c JOIN users u ON u.id = c.user_id WHERE c.day = ? ORDER BY c.score DESC, c.ms ASC LIMIT 20',
    ).all(d).map((r) => ({ name: displayName(r.name), score: r.score, correct: r.correct, ms: r.ms, me: r.id === u.id }));
    return { day: d, mine, top };
  });

  router.add('POST', '/api/challenge/start', (ctx) => {
    const u = requireUser(ctx);
    const d = today();
    if (db.prepare('SELECT 1 FROM challenge_results WHERE user_id = ? AND day = ?').get(u.id, d)) fail(409, 'already_played');
    // Re-opening the challenge resumes the same session, so the timer keeps running.
    const open = db.prepare("SELECT * FROM quiz_sessions WHERE user_id = ? AND kind = 'challenge' AND ref = ? AND submitted_at IS NULL").get(u.id, d);
    if (open) return { id: open.id, kind: 'challenge', questions: JSON.parse(open.payload).map(quiz.publicQuestion), startedAt: open.created_at };
    return { ...startSession(u, 'challenge', d, quiz.challengeQuestions(db.prepare("SELECT * FROM lessons WHERE subject IN ('math','logic') AND gen IS NOT NULL").all(), d)), startedAt: Date.now() };
  });

  router.add('GET', '/api/leaderboard', (ctx) => {
    const u = requireUser(ctx);
    const from = addDays(today(), -6);
    const rows = db.prepare(
      'SELECT u.id, u.name, SUM(x.amount) AS xp FROM xp_log x JOIN users u ON u.id = x.user_id WHERE x.day >= ? GROUP BY u.id ORDER BY xp DESC LIMIT 20',
    ).all(from);
    return { from, top: rows.map((r) => ({ name: displayName(r.name), xp: r.xp, me: r.id === u.id })) };
  });

  router.add('POST', '/api/quiz/:id/submit', async (ctx) => {
    const u = requireUser(ctx);
    const b = await readJson(ctx.req);
    const s = db.prepare('SELECT * FROM quiz_sessions WHERE id = ? AND user_id = ?').get(ctx.params.id, u.id) || fail(404, 'not_found');
    if (s.submitted_at) fail(409, 'already_submitted');
    const now = Date.now();
    if (s.kind !== 'challenge' && now - s.created_at > QUIZ_TTL_MS) fail(410, 'expired');
    db.prepare('UPDATE quiz_sessions SET submitted_at = ? WHERE id = ?').run(now, s.id);
    const questions = JSON.parse(s.payload);
    const g = quiz.grade(questions, b.answers);
    const out = { correct: g.correct, total: g.total, results: g.results, xp: 0 };

    if (s.kind === 'lesson') {
      const l = lessonRow(s.ref);
      const score = Math.round((100 * g.correct) / g.total);
      out.score = score;
      out.passed = score >= 60;
      if (out.passed && l) Object.assign(out, completeLesson(u, l, score, g.correct * 10));
      else touchActivity(u);
    } else if (s.kind === 'diagnostic') {
      const level = quiz.placementLevel(questions, g.results.map((r) => r.correct));
      db.prepare(
        "INSERT INTO enrollments (user_id, subject, level) VALUES (?, ?, ?) ON CONFLICT(user_id, subject) DO UPDATE SET level = excluded.level, placed_at = datetime('now')",
      ).run(u.id, s.ref, level);
      out.level = level;
      out.xp = g.correct * 5;
      addXp(u, out.xp, 'diagnostic');
      out.streak = touchActivity(u);
    } else if (s.kind === 'practice') {
      out.xp = g.correct * 2;
      addXp(u, out.xp, 'practice');
      out.streak = touchActivity(u);
    } else if (s.kind === 'challenge') {
      const ms = now - s.created_at;
      const bonus = Math.round((Math.max(0, 180 - ms / 1000) * g.correct) / 10);
      out.score = g.correct * 100 + bonus;
      out.ms = ms;
      db.prepare('INSERT OR IGNORE INTO challenge_results (user_id, day, score, correct, ms) VALUES (?, ?, ?, ?, ?)').run(u.id, s.ref, out.score, g.correct, ms);
      out.xp = Math.round(out.score / 10);
      addXp(u, out.xp, 'challenge');
      out.streak = touchActivity(u);
    }
    return out;
  });

  // ---------- billing ----------
  router.add('GET', '/api/billing', (ctx) => {
    const u = requireUser(ctx);
    const s = getSettings(db);
    const history = db.prepare('SELECT id, plan, amount, currency, provider, method, reference, status, created_at FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(u.id);
    return {
      currency: s.currency, plans: s.plans, methods: s.manualMethods, instructions: s.paymentInstructions,
      supportContact: s.supportContact, stripe: stripeEnabled(), access: publicUser(u).access, history,
    };
  });

  const findPlan = (id) => getSettings(db).plans.find((p) => p.id === id) || fail(400, 'invalid_plan');

  router.add('POST', '/api/billing/manual', async (ctx) => {
    const u = requireUser(ctx);
    const b = await readJson(ctx.req);
    const plan = findPlan(b.plan);
    const s = getSettings(db);
    if (!s.manualMethods.includes(b.method)) fail(400, 'invalid_method');
    const reference = String(b.reference || '').trim();
    if (reference.length < 3 || reference.length > 100) fail(400, 'invalid_reference');
    const pending = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND status = 'pending'").get(u.id).n;
    if (pending >= 3) fail(429, 'too_many_pending');
    const r = db.prepare('INSERT INTO payments (user_id, plan, days, amount, currency, provider, method, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      u.id, plan.id, plan.days, plan.price, s.currency, 'manual', b.method, reference,
    );
    return { id: Number(r.lastInsertRowid), status: 'pending' };
  });

  router.add('POST', '/api/billing/stripe', async (ctx) => {
    const u = requireUser(ctx);
    if (!stripeEnabled()) fail(400, 'stripe_disabled');
    const b = await readJson(ctx.req);
    const plan = findPlan(b.plan);
    const s = getSettings(db);
    const r = db.prepare('INSERT INTO payments (user_id, plan, days, amount, currency, provider) VALUES (?, ?, ?, ?, ?, ?)').run(
      u.id, plan.id, plan.days, plan.price, s.currency, 'stripe',
    );
    const paymentId = Number(r.lastInsertRowid);
    const baseUrl = process.env.PUBLIC_URL || `http://${ctx.req.headers.host}`;
    const checkout = await createStripeCheckout({
      paymentId, planName: `${s.appName} — ${plan.id}`, amount: plan.price, currency: s.currency, email: u.email, baseUrl,
    });
    db.prepare('UPDATE payments SET reference = ? WHERE id = ?').run(checkout.id, paymentId);
    return { url: checkout.url };
  });

  router.add('POST', '/api/billing/stripe/webhook', async (ctx) => {
    const raw = (await readRaw(ctx.req, 1024 * 1024)).toString('utf8');
    if (!verifyStripeSignature(raw, ctx.req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) fail(400, 'bad_signature');
    const event = JSON.parse(raw);
    if (event.type === 'checkout.session.completed' && event.data?.object?.payment_status === 'paid') {
      const obj = event.data.object;
      const p = db.prepare("SELECT id FROM payments WHERE id = ? AND provider = 'stripe' AND reference = ?").get(Number(obj.metadata?.payment_id), obj.id);
      if (p) markPaid(p.id);
    }
    return { received: true };
  });

  // ---------- owner dashboard ----------
  router.add('GET', '/api/admin/stats', (ctx) => {
    requireOwner(ctx);
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const ages = { '7-12': 0, '13-17': 0, '18-25': 0, '26-40': 0, '41-70': 0 };
    for (const { birth_date } of db.prepare("SELECT birth_date FROM users WHERE role = 'student'").all()) {
      const a = ageOn(birth_date, today());
      const k = a <= 12 ? '7-12' : a <= 17 ? '13-17' : a <= 25 ? '18-25' : a <= 40 ? '26-40' : '41-70';
      ages[k]++;
    }
    return {
      users: one('SELECT COUNT(*) AS n FROM users').n,
      newUsers7d: one("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-7 days')").n,
      activeToday: one('SELECT COUNT(*) AS n FROM users WHERE last_active = ?', today()).n,
      paidSubscribers: one("SELECT COUNT(*) AS n FROM subscriptions WHERE plan != 'trial' AND expires_at > ?", new Date().toISOString()).n,
      trials: one("SELECT COUNT(*) AS n FROM subscriptions WHERE plan = 'trial' AND expires_at > ?", new Date().toISOString()).n,
      revenue: db.prepare("SELECT currency, SUM(amount) AS total, COUNT(*) AS n FROM payments WHERE status = 'paid' GROUP BY currency").all(),
      revenue30d: db.prepare("SELECT currency, SUM(amount) AS total FROM payments WHERE status = 'paid' AND decided_at >= datetime('now', '-30 days') GROUP BY currency").all(),
      pendingPayments: one("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending' AND provider = 'manual'").n,
      lessons: one('SELECT COUNT(*) AS n FROM lessons').n,
      lessonsWithVideo: one("SELECT COUNT(*) AS n FROM lessons WHERE video_file IS NOT NULL OR (video_url IS NOT NULL AND video_url != '')").n,
      lessonsCompleted: one('SELECT COUNT(*) AS n FROM progress').n,
      ages,
    };
  });

  router.add('GET', '/api/admin/users', (ctx) => {
    requireOwner(ctx);
    const q = `%${String(ctx.url.searchParams.get('q') || '').trim()}%`;
    const rows = db.prepare(
      `SELECT u.*, s.plan, s.expires_at FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.email LIKE ? OR u.name LIKE ? ORDER BY u.id DESC LIMIT 200`,
    ).all(q, q);
    return {
      users: rows.map((u) => ({
        id: u.id, email: u.email, name: u.name, role: u.role, age: ageOn(u.birth_date, today()), xp: u.xp,
        plan: u.plan, expiresAt: u.expires_at, createdAt: u.created_at, lastActive: u.last_active, guardianConsent: Boolean(u.guardian_consent),
      })),
    };
  });

  router.add('PATCH', '/api/admin/users/:id', async (ctx) => {
    const owner = requireOwner(ctx);
    const b = await readJson(ctx.req);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ctx.params.id)) || fail(404, 'not_found');
    if (b.role !== undefined) {
      if (!['student', 'admin'].includes(b.role)) fail(400, 'invalid_role');
      if (target.id === owner.id || target.role === 'owner') fail(400, 'cannot_change_owner');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, target.id);
    }
    if (b.grantDays !== undefined) {
      const days = Number(b.grantDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) fail(400, 'invalid_days');
      extendSubscription(target.id, 'gift', days);
    }
    return { ok: true };
  });

  router.add('GET', '/api/admin/payments', (ctx) => {
    requireOwner(ctx);
    const status = ctx.url.searchParams.get('status');
    const rows = db.prepare(
      `SELECT p.*, u.email, u.name FROM payments p JOIN users u ON u.id = p.user_id
       ${status ? 'WHERE p.status = ?' : ''} ORDER BY p.id DESC LIMIT 200`,
    ).all(...(status ? [status] : []));
    return { payments: rows };
  });

  router.add('POST', '/api/admin/payments/:id/:action', (ctx) => {
    requireOwner(ctx);
    const id = Number(ctx.params.id);
    if (ctx.params.action === 'approve') {
      if (!markPaid(id)) fail(409, 'not_pending');
    } else if (ctx.params.action === 'reject') {
      const r = db.prepare("UPDATE payments SET status = 'rejected', decided_at = datetime('now') WHERE id = ? AND status = 'pending'").run(id);
      if (!r.changes) fail(409, 'not_pending');
    } else fail(404, 'not_found');
    return { ok: true };
  });

  router.add('GET', '/api/admin/settings', (ctx) => (requireOwner(ctx), getSettings(db)));

  router.add('PUT', '/api/admin/settings', async (ctx) => {
    requireOwner(ctx);
    const b = await readJson(ctx.req);
    const patch = {};
    if (b.appName !== undefined) patch.appName = String(b.appName).trim().slice(0, 60) || fail(400, 'invalid_app_name');
    if (b.ownerName !== undefined) patch.ownerName = String(b.ownerName).trim().slice(0, 120);
    if (b.currency !== undefined) patch.currency = /^[A-Z]{3}$/.test(b.currency) ? b.currency : fail(400, 'invalid_currency');
    if (b.trialDays !== undefined) {
      const n = Number(b.trialDays);
      patch.trialDays = Number.isInteger(n) && n >= 0 && n <= 60 ? n : fail(400, 'invalid_trial_days');
    }
    if (b.plans !== undefined) {
      if (!Array.isArray(b.plans) || !b.plans.length || b.plans.length > 6) fail(400, 'invalid_plans');
      patch.plans = b.plans.map((p) => {
        const id = String(p.id || '').trim();
        const days = Number(p.days), price = Number(p.price);
        if (!/^[a-z0-9_-]{2,30}$/.test(id) || !Number.isInteger(days) || days < 1 || days > 3650 || !(price > 0)) fail(400, 'invalid_plans');
        return { id, days, price };
      });
      if (new Set(patch.plans.map((p) => p.id)).size !== patch.plans.length) fail(400, 'invalid_plans');
    }
    if (b.manualMethods !== undefined) {
      if (!Array.isArray(b.manualMethods)) fail(400, 'invalid_methods');
      patch.manualMethods = b.manualMethods.map((m) => String(m).trim().toLowerCase()).filter((m) => /^[a-z0-9_-]{2,20}$/.test(m));
    }
    if (b.paymentInstructions !== undefined) patch.paymentInstructions = String(b.paymentInstructions).slice(0, 2000);
    if (b.supportContact !== undefined) patch.supportContact = String(b.supportContact).slice(0, 200);
    saveSettings(db, patch);
    return getSettings(db);
  });

  // Lessons — owner and admins (teachers) can edit content and videos.
  router.add('GET', '/api/admin/lessons', (ctx) => {
    requireStaff(ctx);
    const subject = validSubject(ctx.url.searchParams.get('subject'));
    return { lessons: subjectLessons(subject).map((l) => ({ ...lessonView(l), videoUrl: l.video_url, videoFile: Boolean(l.video_file) })) };
  });

  function lessonFields(b, existing) {
    const out = {};
    const langObj = (v) => {
      if (!v || typeof v !== 'object') fail(400, 'invalid_text');
      return Object.fromEntries(LANGS.filter((k) => typeof v[k] === 'string').map((k) => [k, v[k].slice(0, 5000)]));
    };
    if (b.title !== undefined) out.title = JSON.stringify(langObj(b.title));
    if (b.body !== undefined) out.body = JSON.stringify(langObj(b.body));
    if (b.example !== undefined) out.example = String(b.example).slice(0, 500);
    if (b.videoUrl !== undefined) {
      const v = String(b.videoUrl || '').trim();
      if (v && !videoInfo(v)) fail(400, 'invalid_video_url');
      out.video_url = v || null;
    }
    if (b.free !== undefined) out.is_free = b.free ? 1 : 0;
    if (!existing && !out.title) fail(400, 'invalid_text');
    return out;
  }

  router.add('PUT', '/api/admin/lessons/:id', async (ctx) => {
    requireStaff(ctx);
    const l = lessonRow(ctx.params.id) || fail(404, 'not_found');
    const f = lessonFields(await readJson(ctx.req), l);
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE lessons SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), l.id);
    return { lesson: lessonView(lessonRow(l.id)) };
  });

  router.add('POST', '/api/admin/lessons', async (ctx) => {
    requireStaff(ctx);
    const b = await readJson(ctx.req);
    const subject = validSubject(b.subject);
    const level = Number(b.level);
    if (!Number.isInteger(level) || level < 0 || level > 4) fail(400, 'invalid_level');
    const f = lessonFields(b, null);
    const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM lessons WHERE subject = ? AND level = ?').get(subject, level).n;
    const r = db.prepare('INSERT INTO lessons (subject, level, seq, title, body, example, video_url, is_free) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      subject, level, seq, f.title, f.body || '{}', f.example || '', f.video_url || null, f.is_free || 0,
    );
    return { lesson: lessonView(lessonRow(r.lastInsertRowid)) };
  });

  router.add('DELETE', '/api/admin/lessons/:id', (ctx) => {
    requireOwner(ctx);
    const l = lessonRow(ctx.params.id) || fail(404, 'not_found');
    if (l.video_file) fs.rmSync(path.join(dataDir, 'videos', l.video_file), { force: true });
    db.prepare('DELETE FROM lessons WHERE id = ?').run(l.id);
    return { ok: true };
  });

  // Raw upload: PUT the video file as the request body with its Content-Type.
  router.add('PUT', '/api/admin/lessons/:id/video', async (ctx) => {
    requireStaff(ctx);
    const l = lessonRow(ctx.params.id) || fail(404, 'not_found');
    const ext = VIDEO_TYPES[String(ctx.req.headers['content-type'] || '').split(';')[0]] || fail(415, 'unsupported_video_type');
    const name = `${l.id}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const dest = path.join(dataDir, 'videos', name);
    let size = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        cb(size > MAX_VIDEO_BYTES ? new HttpError(413, 'too_large') : null, chunk);
      },
    });
    try {
      await pipeline(ctx.req, limiter, fs.createWriteStream(dest));
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw e instanceof HttpError ? e : new HttpError(400, 'upload_failed');
    }
    if (l.video_file) fs.rmSync(path.join(dataDir, 'videos', l.video_file), { force: true });
    db.prepare('UPDATE lessons SET video_file = ? WHERE id = ?').run(name, l.id);
    return { ok: true, size };
  });

  router.add('DELETE', '/api/admin/lessons/:id/video', (ctx) => {
    requireStaff(ctx);
    const l = lessonRow(ctx.params.id) || fail(404, 'not_found');
    if (l.video_file) fs.rmSync(path.join(dataDir, 'videos', l.video_file), { force: true });
    db.prepare('UPDATE lessons SET video_file = NULL WHERE id = ?').run(l.id);
    return { ok: true };
  });

  // ---------- protected video streaming ----------
  function serveVideo(req, res, url, id) {
    const payload = verifyToken(secret, url.searchParams.get('t'));
    const l = lessonRow(id);
    if (!payload || payload.typ !== 'media' || payload.lid !== Number(id) || !l?.video_file) {
      res.writeHead(403).end();
      return;
    }
    const file = path.join(dataDir, 'videos', l.video_file);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      res.writeHead(404).end();
      return;
    }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, stat.size - 1);
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      fs.createReadStream(file).pipe(res);
    }
  }

  // ---------- static files (website + installable app) ----------
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    let file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep)) {
      res.writeHead(400).end();
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(rel)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      file = path.join(publicDir, 'index.html');
    }
    const ext = path.extname(file);
    const cache = ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://localhost');
    try {
      const media = /^\/media\/lessons\/(\d+)$/.exec(url.pathname);
      if (media && req.method === 'GET') return serveVideo(req, res, url, media[1]);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
        return serveStatic(req, res, url);
      }
      const m = router.match(req.method, url.pathname);
      if (!m) fail(404, 'not_found');
      if (m.methodNotAllowed) fail(405, 'method_not_allowed');
      const ctx = { req, res, url, params: m.params, user: authUser(req) };
      const result = await m.handler(ctx);
      sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, details: e.details });
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
      else res.end();
    }
  });

  return { server, db };
}

function loadSecret(dataDir) {
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

// The owner account is created (or promoted) from OWNER_EMAIL / OWNER_PASSWORD.
function bootstrapOwner(db, { email, password, name } = {}) {
  if (!email) return;
  const e = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(e);
  db.prepare("UPDATE users SET role = 'student' WHERE role = 'owner' AND email != ?").run(e);
  if (existing) {
    db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(existing.id);
    // OWNER_RESET_PASSWORD=1 sets the owner's password back to OWNER_PASSWORD (for a forgotten password).
    if (password && process.env.OWNER_RESET_PASSWORD === '1') db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(password), existing.id);
  } else if (password) {
    db.prepare("INSERT INTO users (email, pass, name, birth_date, role) VALUES (?, ?, ?, '1990-01-01', 'owner')").run(
      e, hashPassword(password), name || 'Owner',
    );
  } else {
    console.warn('OWNER_EMAIL is set but no account exists yet: set OWNER_PASSWORD too, or register with that email.');
  }
}
