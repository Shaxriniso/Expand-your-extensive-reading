import crypto from 'node:crypto';
import { GENERATORS, Rng, seedFrom, vocabQuestion } from './content/generators.js';
import { LANGUAGE_SUBJECTS, VOCAB } from './content/curriculum.js';

// Which language vocabulary meanings are shown in. Learners who study the
// same language as their interface see meanings in Uzbek (or English when
// they are learning Uzbek).
export function meaningLang(subject, uiLang) {
  const target = LANGUAGE_SUBJECTS[subject];
  if (uiLang !== target) return uiLang;
  return target === 'uz' ? 'en' : 'uz';
}

export function questionFor(lesson, rng, uiLang) {
  if (lesson.gen === 'vocab') {
    const target = LANGUAGE_SUBJECTS[lesson.subject];
    return { ...vocabQuestion(rng, VOCAB[lesson.topic], target, meaningLang(lesson.subject, uiLang)), level: lesson.level };
  }
  const g = GENERATORS[lesson.gen];
  if (!g) return null;
  return { ...g(rng), level: lesson.level };
}

export function lessonQuestions(lesson, rng, uiLang, count = 5) {
  if (!lesson.gen) return [];
  return Array.from({ length: count }, () => questionFor(lesson, rng, uiLang));
}

// Diagnostic placement: two questions per level, easiest first.
export function diagnosticQuestions(lessons, rng, uiLang) {
  const out = [];
  for (let level = 0; level < 5; level++) {
    const pool = rng.shuffle(lessons.filter((l) => l.level === level && l.gen));
    for (let i = 0; i < 2 && pool.length; i++) out.push(questionFor(pool[i % pool.length], rng, uiLang));
  }
  return out;
}

// Climb the levels while both questions of a level are answered correctly;
// the first level with a mistake is where the learner starts.
export function placementLevel(questions, correctFlags) {
  for (let level = 0; level < 5; level++) {
    const idx = questions.map((q, i) => (q.level === level ? i : -1)).filter((i) => i >= 0);
    if (!idx.length || !idx.every((i) => correctFlags[i])) return level;
  }
  return 4;
}

// Daily challenge: the same 10 questions for everyone on a given day.
export function challengeQuestions(lessons, day) {
  const rng = new Rng(seedFrom(`challenge:${day}`));
  const levels = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
  return levels.map((level, i) => {
    const subject = i % 2 ? 'logic' : 'math';
    const lesson = rng.pick(lessons.filter((l) => l.subject === subject && l.level === level));
    return questionFor(lesson, rng, 'en');
  });
}

export function newRng() {
  return new Rng(crypto.randomBytes(4).readUInt32LE());
}

export const publicQuestion = ({ prompt, choices }) => ({ prompt, choices });

export function grade(questions, answers) {
  const list = Array.isArray(answers) ? answers : [];
  const results = questions.map((q, i) => ({ correct: list[i] === q.answer, answer: q.answer, given: list[i] ?? null }));
  return { results, correct: results.filter((r) => r.correct).length, total: questions.length };
}
