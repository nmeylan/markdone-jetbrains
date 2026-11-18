// Generates corpus files (PLAN.md §7.3) deterministically.
// Usage: node scripts/gen-corpus.mjs [medium|large|huge|m4 ...]   (default: all)
// medium.md (5 000 lines), large.md (~1 MB) and m4/*-heavy.md are in git; huge.md (~20 MB) is git-ignored.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../src/test/resources/corpus/', import.meta.url));

// Small deterministic PRNG (mulberry32), so the output is the same on each run.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'the editor document block span patch view mode source parse render list item table code ' +
  'link image text line change stamp frame host page fidelity performance budget test corpus ' +
  'marker heading quote fence style theme value result number order reference definition'
).split(' ');

function generator(seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const sentence = () => {
    const s = words(int(5, 14));
    let out = s[0].toUpperCase() + s.slice(1);
    if (r() < 0.2) out += ` with *${pick(WORDS)}*`;
    if (r() < 0.2) out += ` and **${pick(WORDS)}**`;
    if (r() < 0.15) out += ` see \`${pick(WORDS)}()\``;
    if (r() < 0.1) out += ` [${pick(WORDS)}](https://example.com/${pick(WORDS)})`;
    return `${out}.`;
  };
  const paragraph = () => {
    const lines = [];
    for (let i = int(1, 4); i > 0; i--) lines.push(`${sentence()} ${sentence()}`);
    return lines.join('\n');
  };
  let section = 0;
  const blocks = [
    [3, () => `${'#'.repeat(int(2, 4))} ${words(int(2, 5))} ${++section}`],
    [10, paragraph],
    [3, () => Array.from({ length: int(2, 6) }, () => `- ${sentence()}`).join('\n')],
    [2, () => Array.from({ length: int(2, 5) }, (_, i) => `${i + 1}. ${sentence()}`).join('\n')],
    [1, () => `- ${sentence()}\n  - ${sentence()}\n  - ${sentence()}\n- ${sentence()}`],
    [2, () => `\`\`\`${pick(['js', 'kotlin', 'bash', ''])}\n${Array.from({ length: int(2, 8) }, () => `call(${pick(WORDS)}, ${int(0, 99)});`).join('\n')}\n\`\`\``],
    [1, () => `> ${sentence()}\n> ${sentence()}`],
    [1, () => {
      const rows = Array.from({ length: int(2, 5) }, () => `| ${pick(WORDS)} | ${int(0, 999)} | ${words(3)} |`);
      return ['| Name | Value | Notes |', '|:-----|------:|-------|', ...rows].join('\n');
    }],
    [1, () => '---'],
    [1, () => `- [${r() < 0.5 ? 'x' : ' '}] ${sentence()}\n- [ ] ${sentence()}`],
  ];
  const total = blocks.reduce((n, [w]) => n + w, 0);
  return () => {
    let x = r() * total;
    for (const [w, f] of blocks) {
      x -= w;
      if (x < 0) return f();
    }
    return paragraph();
  };
}

function build(seed, done) {
  const next = generator(seed);
  const parts = ['# Generated corpus document', '', 'Deterministic output of web/scripts/gen-corpus.mjs.'];
  let lines = 3;
  let size = parts.join('\n').length;
  while (!done(lines, size)) {
    const block = next();
    parts.push('', block);
    lines += 1 + block.split('\n').length;
    size += 2 + block.length;
  }
  return `${parts.join('\n')}\n`;
}

// M4 heavy blocks: m4/math-heavy.md (200 formulas), m4/mermaid-heavy.md (30 diagrams, 11 types),
// m4/code-heavy.md (400 blocks, 12 languages). One sequence of the PRNG for the three files.
function m4() {
  const files = {};
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const prose = () =>
    Array.from({ length: 3 + Math.floor(rnd() * 4) }, () =>
      pick([
        'The value converges quickly',
        'We now look at the bound',
        'This follows from the lemma',
        'Note that the series is absolutely convergent',
        'Consider the general case',
        'A short calculation gives the result',
        'With **strong** and *emphasis* text and `code $x$ here`',
      ]),
    ).join('. ') + '.';

  const inline = [
    'a^2+b^2=c^2',
    'e^{i\\pi}+1=0',
    '\\alpha_{n+1} = \\frac{\\alpha_n}{2}',
    '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}',
    '\\lim_{x\\to 0} \\frac{\\sin x}{x} = 1',
    'f\\colon X \\to Y',
    '\\mathbb{R}^n',
    '\\|v\\|_2 \\le \\sqrt{n}\\,\\|v\\|_\\infty',
    'O(n \\log n)',
    '\\binom{n}{k}',
    '\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}',
    'x \\in [0, 1]',
    'p \\Rightarrow q',
    '\\hat{\\theta}_{\\text{MLE}}',
    '\\$5',
  ];
  const blocks = [
    '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
    '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}^{-1} = \\frac{1}{ad-bc}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}',
    '\\begin{aligned}\n  (a+b)^2 &= a^2 + 2ab + b^2 \\\\\n  (a-b)^2 &= a^2 - 2ab + b^2\n\\end{aligned}',
    'f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n',
    '\\mathcal{L}(\\theta) = \\prod_{i=1}^{N} p(x_i \\mid \\theta)',
    'P(A \\mid B) = \\frac{P(B \\mid A)\\,P(A)}{P(B)}',
    '\\oint_{\\partial \\Sigma} \\mathbf{B} \\cdot d\\boldsymbol{\\ell} = \\mu_0 \\iint_{\\Sigma} \\mathbf{J} \\cdot d\\mathbf{S}',
    'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    '\\begin{cases} 0 & x < 0 \\\\ 1 & x \\ge 0 \\end{cases}',
    '\\zeta(s) = \\sum_{n=1}^\\infty \\frac{1}{n^s} = \\prod_{p} \\frac{1}{1 - p^{-s}}',
  ];
  {
    const parts = ['# Math-heavy document (M4)\n', 'Prices like $5 and $10 stay text; `$x$` in code stays code; \\$ is an escape.\n'];
    let n = 0;
    let i = 0;
    while (n < 200) {
      i++;
      if (i % 5 === 0) {
        parts.push(`## Section ${i / 5}\n`);
        continue;
      }
      if (i % 3 === 0) {
        const b = `${blocks[n % blocks.length]}\n\\quad (${n})`;
        parts.push(`${prose()}\n\n$$\n${b}\n$$\n`);
        n++;
      } else {
        const a = `${n}+${inline[n % inline.length]}`;
        const b = `${inline[(n + 3) % inline.length]} + ${n + 1}`;
        parts.push(`${prose()} Here $${a}$ holds and also $${b}$ in the same line. ${prose()}\n`);
        n += 2;
      }
    }
    files['m4/math-heavy'] = parts.join('\n');
  }

  const diagrams = [
    (k) => `flowchart TD\n  A${k}[Start ${k}] --> B{Is it ok?}\n  B -- Yes --> C[Do work]\n  B -- No --> D[Fix]\n  D --> B\n  C --> E((End))\n  C --> F[Log]\n  F --> E`,
    (k) => `sequenceDiagram\n  participant A as Alice ${k}\n  participant B as Bob\n  A->>B: Hello\n  B-->>A: Hi\n  A->>B: How are you?\n  loop Every minute\n    B->>A: Ping\n  end\n  Note right of B: Thinking`,
    (k) => `classDiagram\n  class Animal${k} {\n    +String name\n    +int age\n    +makeSound() void\n  }\n  class Dog\n  class Cat\n  Animal${k} <|-- Dog\n  Animal${k} <|-- Cat\n  Dog : +fetch()`,
    (k) => `stateDiagram-v2\n  [*] --> Idle${k}\n  Idle${k} --> Running : start\n  Running --> Paused : pause\n  Paused --> Running : resume\n  Running --> [*] : stop`,
    (k) => `erDiagram\n  CUSTOMER${k} ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  CUSTOMER${k} {\n    string name\n    string email\n  }`,
    (k) => `gantt\n  title Plan ${k}\n  dateFormat YYYY-MM-DD\n  section A\n  Task one :a1, 2026-01-01, 10d\n  Task two :after a1, 5d\n  section B\n  Task three :2026-01-08, 7d`,
    (k) => `pie title Share ${k}\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15`,
    (k) => `gitGraph\n  commit id: "c${k}"\n  branch dev\n  checkout dev\n  commit\n  checkout main\n  merge dev\n  commit`,
    (k) => `mindmap\n  root((Root ${k}))\n    A\n      A1\n      A2\n    B\n      B1`,
    (k) => `timeline\n  title History ${k}\n  2020 : Start\n  2021 : Growth : More\n  2022 : Stable`,
    (k) => `journey\n  title Day ${k}\n  section Morning\n    Coffee: 5: Me\n    Commute: 2: Me\n  section Work\n    Code: 4: Me, Team`,
  ];
  const order = [0, 1, 2, 3, 0, 4, 5, 6, 1, 7, 0, 3, 8, 9, 10, 1, 0, 2, 3, 4, 0, 1, 5, 6, 7, 0, 1, 2, 8, 0];
  {
    const parts = ['# Mermaid-heavy document (M4)\n'];
    order.forEach((d, k) => {
      parts.push(`## Diagram ${k + 1}\n\n${prose()}\n\n\`\`\`mermaid\n${diagrams[d](k)}\n\`\`\`\n\n${prose()}\n`);
    });
    files['m4/mermaid-heavy'] = parts.join('\n');
  }

  const code = {
    ts: (k) =>
      `interface Item${k} {\n  id: number;\n  name: string;\n}\n\nexport async function load${k}(url: string): Promise<Item${k}[]> {\n  const res = await fetch(url);\n  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);\n  const items = (await res.json()) as Item${k}[];\n  return items.filter((i) => i.id > ${k}).map((i) => ({ ...i, name: i.name.trim() }));\n}`,
    python: (k) =>
      `import json\nfrom dataclasses import dataclass\n\n@dataclass\nclass Item${k}:\n    id: int\n    name: str\n\ndef load_${k}(path: str) -> list[Item${k}]:\n    with open(path) as f:\n        data = json.load(f)\n    # keep the large ids\n    return [Item${k}(**d) for d in data if d["id"] > ${k}]`,
    java: (k) =>
      `public final class Service${k} {\n    private final Map<String, Integer> counts = new HashMap<>();\n\n    public int add(String key) {\n        return counts.merge(key, 1, Integer::sum);\n    }\n\n    @Override\n    public String toString() {\n        return "Service${k}" + counts;\n    }\n}`,
    kotlin: (k) => `data class Item${k}(val id: Int, val name: String)\n\nfun process${k}(items: List<Item${k}>): Map<Int, String> =\n    items.filter { it.id > ${k} }\n        .associate { it.id to it.name.uppercase() }`,
    rust: (k) => `use std::collections::HashMap;\n\npub fn count_${k}(words: &[&str]) -> HashMap<String, usize> {\n    let mut m = HashMap::new();\n    for w in words {\n        *m.entry(w.to_string()).or_insert(0) += 1;\n    }\n    m\n}`,
    go: (k) => `package main\n\nimport "fmt"\n\nfunc sum${k}(xs []int) int {\n\ttotal := 0\n\tfor _, x := range xs {\n\t\ttotal += x\n\t}\n\treturn total\n}\n\nfunc main() { fmt.Println(sum${k}([]int{1, 2, 3})) }`,
    bash: (k) => `#!/usr/bin/env bash\nset -euo pipefail\nfor f in *.md; do\n  echo "file $f (${k})"\n  wc -l "$f" | awk '{print $1}'\ndone`,
    json: (k) => `{\n  "name": "pkg-${k}",\n  "version": "1.0.${k}",\n  "dependencies": { "a": "1.2.3", "b": "4.5.6" },\n  "private": true\n}`,
    yaml: (k) => `name: build-${k}\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm test`,
    sql: (k) => `SELECT c.name, COUNT(o.id) AS orders\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id\nWHERE c.created_at > '2026-01-0${(k % 9) + 1}'\nGROUP BY c.name\nORDER BY orders DESC\nLIMIT ${k + 10};`,
    css: (k) => `.card-${k} {\n  display: grid;\n  grid-template-columns: 1fr 2fr;\n  color: #333;\n  padding: ${k}px;\n}\n.card-${k}:hover { background: rgba(0, 0, 0, 0.05); }`,
    html: (k) => `<section class="hero-${k}">\n  <h1>Title ${k}</h1>\n  <p>Some <b>bold</b> text.</p>\n  <button type="button" disabled>Go</button>\n</section>`,
  };
  {
    const langs = Object.keys(code);
    const parts = ['# Code-heavy document (M4)\n'];
    for (let k = 0; k < 400; k++) {
      const l = langs[k % langs.length];
      parts.push(`## Example ${k + 1} (${l})\n\n${prose()}\n\n\`\`\`${l}\n${code[l](k)}\n\`\`\`\n`);
    }
    files['m4/code-heavy'] = parts.join('\n');
  }
  return files;
}

const targets = {
  medium: () => build(1, (lines) => lines >= 5000),
  large: () => build(2, (_, size) => size >= 1024 * 1024),
  huge: () => build(3, (_, size) => size >= 20 * 1024 * 1024),
  m4,
};

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(targets)) {
  if (!targets[name]) throw new Error(`unknown target ${name}`);
  const out = targets[name]();
  for (const [file, text] of Object.entries(typeof out === 'string' ? { [name]: out } : out)) {
    writeFileSync(`${dir}${file}.md`, text);
    console.log(`${file}.md: ${text.split('\n').length - 1} lines, ${text.length} chars`);
  }
}
