import { DatabaseSync } from 'node:sqlite';
import { seedLessons } from './content/curriculum.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass TEXT NOT NULL,
  name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  lang TEXT NOT NULL DEFAULT 'uz',
  xp INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_active TEXT,
  guardian_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  level INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  gen TEXT,
  topic TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  example TEXT NOT NULL DEFAULT '',
  video_url TEXT,
  video_file TEXT,
  is_free INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lessons_subject ON lessons(subject, level, seq);
CREATE TABLE IF NOT EXISTS enrollments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  level INTEGER NOT NULL,
  placed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, subject)
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  best_score INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER
);
CREATE TABLE IF NOT EXISTS challenge_results (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  score INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS xp_log (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS xp_log_day ON xp_log(day);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  days INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,
  method TEXT,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const DEFAULT_SETTINGS = {
  appName: 'BilimUp',
  ownerName: '',
  currency: 'UZS',
  trialDays: 3,
  plans: [
    { id: 'monthly', days: 30, price: 99000 },
    { id: 'quarterly', days: 90, price: 249000 },
    { id: 'yearly', days: 365, price: 799000 },
  ],
  manualMethods: ['click', 'payme', 'uzcard', 'humo', 'bank'],
  paymentInstructions:
    'Pay the plan amount with Click, Payme, Uzcard/Humo or a bank transfer to the owner account shown here, then enter the transaction ID. Your access opens as soon as the owner confirms the payment.',
  supportContact: '',
};

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  if (db.prepare('SELECT COUNT(*) AS n FROM lessons').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO lessons (subject, level, seq, gen, topic, title, body, example, is_free) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    db.exec('BEGIN');
    for (const r of seedLessons()) {
      ins.run(r.subject, r.level, r.seq, r.gen, r.topic, JSON.stringify(r.title), JSON.stringify(r.body), r.example, r.is_free);
    }
    db.exec('COMMIT');
  }
  return db;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const { key, value } of rows) if (key in s) s[key] = JSON.parse(value);
  return s;
}

export function saveSettings(db, patch) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) up.run(k, JSON.stringify(v));
}
