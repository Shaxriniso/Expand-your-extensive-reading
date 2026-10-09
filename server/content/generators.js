// Question generators. Every generator returns a multiple-choice question:
//   { prompt: { key, params, text }, choices: [string], answer: index }
// `key` is a UI translation key (e.g. "q.calc"), so the same question works in
// every interface language. Numbers and symbols in `text` are language-neutral.

export class Rng {
  constructor(seed) {
    this.s = seed >>> 0;
  }
  next() {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export function seedFrom(str) {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const sup = (n) => String(n).split('').map((d) => SUP[d]).join('');
const sub = (n) => String(n).split('').map((d) => SUB[d]).join('');
export const num = (n) => (n < 0 ? `−${-n}` : String(n));
const paren = (n) => (n < 0 ? `(${num(n)})` : String(n));

// Build a choice list: the correct answer, preferred distractors (common
// mistakes) first, then fallbacks, always `count` unique options.
function mc(rng, correct, preferred = [], fallback = [], count = 4) {
  const c = String(correct);
  const out = [c];
  const seen = new Set(out);
  for (const d of [...rng.shuffle(preferred.map(String)), ...rng.shuffle(fallback.map(String))]) {
    if (out.length >= count) break;
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  const choices = rng.shuffle(out);
  return { choices, answer: choices.indexOf(c) };
}

function mcNum(rng, correct, preferred = [], spread = 5) {
  const ok = (n) => Number.isInteger(n) && n !== correct && (correct < 0 || n >= 0);
  const fallback = [];
  for (let i = 1; i <= spread + 3; i++) fallback.push(correct + i, correct - i);
  return mc(rng, num(correct), preferred.filter(ok).map(num), fallback.filter(ok).map(num));
}

const q = (key, text, choiceSet, params = {}) => ({ prompt: { key, text, params }, ...choiceSet });

const EMOJI = ['🔴', '🔵', '🟢', '🟡', '⭐', '🌙', '🍎', '🐱', '🔺', '⬛', '🌸', '⚽'];
const PRIMES = [];
for (let n = 2; n < 400; n++) if (PRIMES.every((p) => n % p)) PRIMES.push(n);

export const GENERATORS = {
  // ---------- MATH ----------
  'math.add'(rng) {
    const a = rng.int(1, 10), b = rng.int(1, 10);
    return q('q.calc', `${a} + ${b} = ?`, mcNum(rng, a + b, [a + b + 1, a + b - 1, a + b + 10], 4));
  },
  'math.sub'(rng) {
    const a = rng.int(5, 20), b = rng.int(1, a);
    return q('q.calc', `${a} − ${b} = ?`, mcNum(rng, a - b, [a + b, a - b + 1, a - b - 1], 4));
  },
  'math.compare'(rng) {
    const a = rng.int(1, 99), b = rng.next() < 0.2 ? a : rng.int(1, 99);
    const choices = ['<', '>', '='];
    return q('q.compare', `${a}  ☐  ${b}`, { choices, answer: choices.indexOf(a < b ? '<' : a > b ? '>' : '=') });
  },
  'math.mul'(rng) {
    const a = rng.int(2, 12), b = rng.int(2, 12);
    return q('q.calc', `${a} × ${b} = ?`, mcNum(rng, a * b, [a * (b + 1), a * (b - 1), (a + 1) * b, a + b], 6));
  },
  'math.div'(rng) {
    const b = rng.int(2, 12), x = rng.int(2, 12);
    return q('q.calc', `${b * x} ÷ ${b} = ?`, mcNum(rng, x, [x + 1, x - 1, b, x + 2], 3));
  },
  'math.order_ops'(rng) {
    const a = rng.int(2, 9), b = rng.int(2, 9), c = rng.int(2, 9);
    const form = rng.int(0, 2);
    if (form === 0) return q('q.calc', `${a} + ${b} × ${c} = ?`, mcNum(rng, a + b * c, [(a + b) * c, a * b + c]));
    if (form === 1) return q('q.calc', `(${a} + ${b}) × ${c} = ?`, mcNum(rng, (a + b) * c, [a + b * c, a * b + c]));
    return q('q.calc', `${a} × ${b} − ${c} = ?`, mcNum(rng, a * b - c, [a * (b - c), a * b + c]));
  },
  'math.fractions'(rng) {
    const d = rng.int(4, 12), a = rng.int(1, d - 2), b = rng.int(1, d - 1 - a);
    const pre = [`${a + b}/${2 * d}`, `${a * b}/${d}`, `${a + b + 1}/${d}`, `${Math.abs(a - b)}/${d}`, `${a + b}/${d + 1}`]
      .filter((s) => !s.startsWith('0/'));
    const fb = [`${a + b - 1}/${d}`, `${a + b + 2}/${d}`, `${a + b}/${d - 1}`];
    return q('q.calc', `${a}/${d} + ${b}/${d} = ?`, mc(rng, `${a + b}/${d}`, pre, fb));
  },
  'math.percent'(rng) {
    const p = rng.pick([5, 10, 20, 25, 40, 50, 75]), n = rng.int(1, 20) * 20, ans = (n * p) / 100;
    return q('q.percent_of', `${p}% · ${n}`, mcNum(rng, ans, [ans * 2, ans / 2, n - ans, ans + 10, p]), { p, n });
  },
  'math.negatives'(rng) {
    let a = rng.int(-20, 20), b = rng.int(-20, 20);
    if (b === 0) b = -7;
    const plus = rng.next() < 0.5;
    const ans = plus ? a + b : a - b;
    const wrongSign = plus ? a - b : a + b;
    return q('q.calc', `${num(a)} ${plus ? '+' : '−'} ${paren(b)} = ?`, mcNum(rng, ans, [wrongSign, -ans, ans + 2, ans - 2]));
  },
  'math.linear'(rng) {
    const x = rng.int(-5, 12) || 3, a = rng.int(2, 9), b = rng.int(1, 20), c = a * x + b;
    return q('q.solve_x', `${a}x + ${b} = ${num(c)}`, mcNum(rng, x, [x + 1, x - 1, (c + b) / a, c - b, -x]));
  },
  'math.powers'(rng) {
    const base = rng.int(2, 9);
    let e = rng.int(2, 4);
    while (base ** e > 10000) e--;
    const ans = base ** e;
    return q('q.calc', `${base}${sup(e)} = ?`, mcNum(rng, ans, [base * e, base ** (e - 1), ans + base, ans - base]));
  },
  'math.roots'(rng) {
    if (rng.next() < 0.7) {
      const r = rng.int(2, 20);
      return q('q.calc', `√${r * r} = ?`, mcNum(rng, r, [r + 1, r - 1, r * 2, (r * r) / 2], 3));
    }
    const r = rng.int(2, 10);
    return q('q.calc', `∛${r ** 3} = ?`, mcNum(rng, r, [r + 1, r - 1, r * r, r * 3], 3));
  },
  'math.quadratic'(rng) {
    let r1 = rng.int(-9, 9), r2 = rng.int(-9, 9);
    if (r1 === r2) r2 = r1 + rng.int(1, 4);
    const b = -(r1 + r2), c = r1 * r2;
    const bTerm = b === 0 ? '' : ` ${b > 0 ? '+' : '−'} ${Math.abs(b) === 1 ? '' : Math.abs(b)}x`;
    const cTerm = c === 0 ? '' : ` ${c > 0 ? '+' : '−'} ${Math.abs(c)}`;
    const pair = (x, y) => `{${[x, y].sort((m, n) => m - n).map(num).join('; ')}}`;
    return q(
      'q.roots',
      `x²${bTerm}${cTerm} = 0`,
      mc(rng, pair(r1, r2), [pair(-r1, -r2), pair(-r1, r2), pair(r1, -r2), pair(r1 + 1, r2 + 1)], [pair(r1 - 1, r2 - 1), pair(r1 + 2, r2), pair(r1 - 2, r2 + 3), pair(r1 + 3, r2 - 2)]),
    );
  },
  'math.log'(rng) {
    const base = rng.pick([2, 3, 5, 10]);
    const k = rng.int(1, { 2: 8, 3: 5, 5: 4, 10: 4 }[base]);
    const n = base ** k;
    return q('q.calc', `log${sub(base)}(${n}) = ?`, mcNum(rng, k, [k + 1, k - 1, n / base, base * k], 3));
  },
  'math.series'(rng) {
    const a1 = rng.int(1, 10), d = rng.int(1, 6), n = rng.int(4, 12);
    const last = a1 + (n - 1) * d, S = (n * (a1 + last)) / 2;
    return q('q.series_sum', `a₁ = ${a1}, d = ${d}, n = ${n}`, mcNum(rng, S, [n * (a1 + last), last, S + d, S - d], 10));
  },

  // ---------- LOGIC ----------
  'logic.count_seq'(rng) {
    const s = rng.int(1, 20), st = rng.int(2, 6);
    const terms = [0, 1, 2, 3].map((i) => s + i * st), next = s + 4 * st;
    return q('q.next', `${terms.join(', ')}, ?`, mcNum(rng, next, [next + st, next - 1, next + 1]));
  },
  'logic.odd_one'(rng) {
    const rule = rng.pick(['even', 'odd', 'tens']);
    const pool = new Set();
    let odd;
    if (rule === 'tens') {
      while (pool.size < 3) pool.add(10 * rng.int(1, 9));
      do odd = rng.int(11, 95); while (odd % 10 === 0);
    } else {
      const parity = rule === 'even' ? 0 : 1;
      while (pool.size < 3) pool.add(2 * rng.int(1, 15) - 1 + (parity === 0 ? 1 : 0));
      odd = 2 * rng.int(1, 15) - (parity === 0 ? 1 : 0);
    }
    const choices = rng.shuffle([...pool, odd].map(String));
    return q('q.odd_one_out', '', { choices, answer: choices.indexOf(String(odd)) });
  },
  'logic.emoji_pattern'(rng) {
    const [A, B, ...rest] = rng.shuffle(EMOJI);
    const len = rng.int(4, 7);
    const seq = Array.from({ length: len }, (_, i) => (i % 2 ? B : A));
    return q('q.next', `${seq.join(' ')} ?`, mc(rng, len % 2 ? B : A, [len % 2 ? A : B, ...rest.slice(0, 2)], rest));
  },
  'logic.mul_seq'(rng) {
    const s = rng.int(1, 5), r = rng.int(2, 3);
    const terms = [0, 1, 2, 3].map((i) => s * r ** i), next = s * r ** 4;
    return q('q.next', `${terms.join(', ')}, ?`, mcNum(rng, next, [terms[3] + (terms[3] - terms[2]), next * r, next - 1, next + s]));
  },
  'logic.letter_seq'(rng) {
    const st = rng.int(1, 3), start = rng.int(0, 25 - 4 * st);
    const L = (i) => String.fromCharCode(65 + i);
    const terms = [0, 1, 2, 3].map((i) => L(start + i * st)), ni = start + 4 * st;
    const pre = [ni + 1, ni - 1, ni + st, start + 3 * st].filter((i) => i >= 0 && i < 26 && i !== ni).map(L);
    const fb = [ni + 2, ni - 2, ni + 3, ni - 3, ni - 4].filter((i) => i >= 0 && i < 26).map(L);
    return q('q.next', `${terms.join(', ')}, ?`, mc(rng, L(ni), pre, fb));
  },
  'logic.pattern3'(rng) {
    const syms = rng.shuffle(EMOJI);
    const shape = rng.pick(['ABC', 'ABB', 'AAB', 'ABAC']);
    const pat = shape.split('').map((ch) => syms[ch.charCodeAt(0) - 65]);
    const len = rng.int(7, 10);
    const seq = Array.from({ length: len }, (_, i) => pat[i % pat.length]);
    const ans = pat[len % pat.length];
    return q('q.next', `${seq.join(' ')} ?`, mc(rng, ans, [...new Set(pat)], syms.slice(4)));
  },
  'logic.alt_seq'(rng) {
    const a = rng.int(1, 10), d = rng.int(1, 5), x = rng.int(10, 30), e = rng.int(2, 10);
    const seq = [a, x, a + d, x + e, a + 2 * d, x + 2 * e], ans = a + 3 * d;
    return q('q.next', `${seq.join(', ')}, ?`, mcNum(rng, ans, [x + 3 * e, a + 2 * d + e, ans + 1, x + 2 * e + d]));
  },
  'logic.square_seq'(rng) {
    const k = rng.int(1, 8), c = rng.pick([0, 0, 1]);
    const terms = [0, 1, 2, 3].map((i) => (k + i) ** 2 + c), ans = (k + 4) ** 2 + c;
    return q('q.next', `${terms.join(', ')}, ?`, mcNum(rng, ans, [ans + 1, ans - 1, terms[3] + (terms[3] - terms[2]), (k + 4) * 2]));
  },
  'logic.fib'(rng) {
    const s = [rng.int(1, 5)];
    s.push(rng.int(s[0], s[0] + 5));
    while (s.length < 6) s.push(s.at(-1) + s.at(-2));
    const ans = s.at(-1) + s.at(-2);
    return q('q.next', `${s.join(', ')}, ?`, mcNum(rng, ans, [ans + 1, ans - 1, s.at(-1) * 2, s.at(-1) + (s.at(-1) - s.at(-2))]));
  },
  'logic.diff_seq'(rng) {
    const d0 = rng.int(1, 4), dd = rng.int(1, 3);
    const s = [rng.int(1, 10)];
    for (let i = 0; i < 4; i++) s.push(s.at(-1) + d0 + i * dd);
    const lastDiff = d0 + 3 * dd, ans = s.at(-1) + d0 + 4 * dd;
    return q('q.next', `${s.join(', ')}, ?`, mcNum(rng, ans, [ans + 1, ans - 1, s.at(-1) + lastDiff, ans + dd]));
  },
  'logic.analogy'(rng) {
    const k = rng.int(2, 5), m = rng.int(3, 9);
    const rules = [(x) => x * k, (x) => x + m, (x) => x * k + 1, (x) => x * k - 1, (x) => x * x];
    const f = rng.pick(rules);
    const xs = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4);
    const shown = xs.slice(0, 3).map((x) => `${x} → ${f(x)}`).join(',  ');
    const ans = f(xs[3]);
    const others = rules.filter((r) => r !== f).map((r) => r(xs[3]));
    return q('q.analogy', `${shown},  ${xs[3]} → ?`, mcNum(rng, ans, [...others, ans + 1]));
  },
  'logic.missing_op'(rng) {
    const ops = ['+', '−', '×', '÷'];
    const calc = (a, b, op) =>
      op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : b !== 0 && a % b === 0 ? a / b : NaN;
    for (;;) {
      const op = rng.pick(ops);
      let a = rng.int(2, 20);
      const b = rng.int(2, 9);
      if (op === '÷') a = b * rng.int(2, 9);
      if (op === '−' && a < b) continue;
      const c = calc(a, b, op);
      if (ops.filter((o) => calc(a, b, o) === c).length !== 1) continue;
      return q('q.which_op', `${a}  ?  ${b} = ${c}`, { choices: ops, answer: ops.indexOf(op) });
    }
  },
  'logic.primes'(rng) {
    const i = rng.int(3, 40), p = PRIMES[i], ans = PRIMES[i + 1];
    return q('q.next_prime', `${p}`, mcNum(rng, ans, [p + 2 === ans ? p + 4 : p + 2, p + 1, ans + 2, PRIMES[i + 2]].filter((n) => n !== ans), 4));
  },
  'logic.binary'(rng) {
    const n = rng.int(5, 63), bits = n.toString(2);
    const reversed = parseInt(bits.split('').reverse().join(''), 2);
    const ones = bits.split('').filter((b) => b === '1').length;
    return q('q.binary', `${bits}₂ = ?`, mcNum(rng, n, [n + 1, n - 1, n * 2, reversed, ones]));
  },
  'logic.matrix'(rng) {
    const rule = rng.pick(['sum', 'diff', 'prod']);
    const f = { sum: (a, b) => a + b, diff: (a, b) => a - b, prod: (a, b) => a * b }[rule];
    const row = () => {
      const a = rng.int(rule === 'diff' ? 6 : 2, rule === 'prod' ? 9 : 20);
      const b = rng.int(2, rule === 'diff' ? a - 1 : 9);
      return [a, b];
    };
    const rows = [row(), row(), row()];
    const text = rows.map(([a, b], i) => (i < 2 ? `${a}  ${b}  ${f(a, b)}` : `${a}  ${b}  ?`)).join('   |   ');
    const [a, b] = rows[2];
    return q('q.matrix', text, mcNum(rng, f(a, b), [a + b, a - b, a * b, f(a, b) + 1]));
  },
};

// Vocabulary question: shows a word in the target language and asks for its
// meaning (or the reverse). `words` are { en, uz, ru, ko, ar } objects.
export function vocabQuestion(rng, words, target, meaning) {
  const word = rng.pick(words);
  const others = words.filter((w) => w !== word);
  if (rng.next() < 0.5) {
    return q('q.translate', word[target], mc(rng, word[meaning], others.map((w) => w[meaning])), { word: word[target] });
  }
  return q('q.which_word', word[meaning], mc(rng, word[target], others.map((w) => w[target])), { word: word[meaning] });
}
