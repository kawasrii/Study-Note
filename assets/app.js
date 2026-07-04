/* StudyAcceleration 共通スクリプト(外部通信なし) */
"use strict";

/* ---------- ユーティリティ ---------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // textContent のみ使用(XSS対策)
  return e;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) { return null; }
}

/* ---------- 目次ページ:カード描画+検索 ---------- */
function renderIndex() {
  const grids = { stats: $("#grid-stats"), eng: $("#grid-eng") };
  TOPICS.forEach(t => {
    const a = el("a", "topic-card " + t.cat + (t.ready ? "" : " soon"));
    if (t.ready) a.href = t.path;
    a.appendChild(el("div", "t", t.title));
    a.appendChild(el("div", "d", t.desc));
    const tags = el("div", "tags");
    t.tags.forEach(tg => tags.appendChild(el("span", "tag", tg)));
    a.appendChild(tags);
    a.dataset.search = (t.title + " " + t.desc + " " + t.tags.join(" ")).toLowerCase();
    grids[t.cat].appendChild(a);
  });

  const box = $("#search");
  box.addEventListener("input", () => {
    const q = box.value.trim().toLowerCase();
    let hits = 0;
    document.querySelectorAll(".topic-card").forEach(c => {
      const show = !q || c.dataset.search.includes(q);
      c.style.display = show ? "" : "none";
      if (show) hits++;
    });
    ["stats", "eng"].forEach(cat => {
      const any = [...grids[cat].children].some(c => c.style.display !== "none");
      $("#sec-" + cat).style.display = any ? "" : "none";
    });
    $("#no-hit").style.display = hits ? "none" : "block";
  });
}

/* ---------- フラッシュカードエンジン ---------- */
/* data: [{w:単語, pos:品詞, m:意味, ex:例文}] */
function Flashcards(rootId, data, storageKey) {
  const root = $("#" + rootId);
  let deck = shuffle(data);
  let i = 0, flipped = false;
  const known = new Set(store(storageKey) || []);

  const stage = el("div", "fc-stage");
  const card = el("div", "fc-card");
  const front = el("div", "fc-face front");
  const back = el("div", "fc-face back");
  card.append(front, back);
  stage.appendChild(card);

  const nav = el("div", "fc-nav");
  const bFlip = el("button", "primary", "めくる (Space)");
  const bKnew = el("button", "knew", "✓ 覚えた");
  const bForgot = el("button", "forgot", "✗ まだ");
  const bNext = el("button", null, "次へ →");
  const bReset = el("button", null, "⟲ 記録をリセット");
  nav.append(bFlip, bKnew, bForgot, bNext, bReset);
  const prog = el("div", "fc-progress");
  root.append(stage, nav, prog);

  function render() {
    const c = deck[i];
    front.replaceChildren(el("div", "fc-word", c.w), el("div", "fc-pos", c.pos));
    back.replaceChildren(
      el("div", "fc-mean", c.m),
      el("div", "fc-ex", c.ex),
      el("div", "fc-pos", known.has(c.w) ? "✓ 覚えた単語" : "")
    );
    card.classList.toggle("flipped", flipped);
    prog.textContent = (i + 1) + " / " + deck.length + " 枚 ・ 覚えた: " + known.size + " / " + data.length + " 語";
  }
  function flip() { flipped = !flipped; render(); }
  function next() { flipped = false; i = (i + 1) % deck.length; render(); }
  function mark(ok) {
    const w = deck[i].w;
    ok ? known.add(w) : known.delete(w);
    store(storageKey, [...known]);
    next();
  }
  card.addEventListener("click", flip);
  bFlip.addEventListener("click", flip);
  bNext.addEventListener("click", next);
  bKnew.addEventListener("click", () => mark(true));
  bForgot.addEventListener("click", () => mark(false));
  bReset.addEventListener("click", () => {
    if (confirm("学習記録をリセットしますか?")) { known.clear(); store(storageKey, []); render(); }
  });
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); flip(); }
    if (e.code === "ArrowRight") next();
  });
  render();
}

/* ---------- 4択クイズエンジン ---------- */
/* items: [{q:問題文, a:正解, wrong:[誤答3つ], note:解説}] */
function QuizMC(rootId, items) {
  const root = $("#" + rootId);
  let order = shuffle(items);
  let i = 0, score = 0, answered = false;

  const qEl = el("div", "quiz-q");
  const opts = el("div", "quiz-opts");
  const fb = el("div", "quiz-feedback");
  const scoreEl = el("div", "quiz-score");
  const nav = el("div", "fc-nav");
  const bNext = el("button", "primary", "次の問題 →");
  nav.appendChild(bNext);
  root.append(qEl, opts, fb, nav, scoreEl);

  function render() {
    answered = false;
    const it = order[i];
    qEl.textContent = "Q" + (i + 1) + ". " + it.q;
    fb.textContent = "";
    opts.replaceChildren();
    shuffle([it.a, ...it.wrong]).forEach(choice => {
      const b = el("button", null, choice);
      b.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const ok = choice === it.a;
        if (ok) { score++; b.classList.add("correct"); fb.textContent = "○ 正解! " + (it.note || ""); }
        else {
          b.classList.add("wrong");
          [...opts.children].find(x => x.textContent === it.a).classList.add("correct");
          fb.textContent = "× 正解は「" + it.a + "」。" + (it.note || "");
        }
        [...opts.children].forEach(x => x.disabled = true);
        scoreEl.textContent = "スコア: " + score + " / " + (i + 1);
      });
      opts.appendChild(b);
    });
  }
  bNext.addEventListener("click", () => {
    if (i + 1 >= order.length) {
      qEl.textContent = "終了! " + score + " / " + order.length + " 問正解 🎉";
      opts.replaceChildren(); fb.textContent = "";
      bNext.textContent = "もう一度 (シャッフル)";
      bNext.onclick = () => location.reload();
      return;
    }
    i++; render();
  });
  render();
}

/* ---------- Canvas プロット補助 ---------- */
function setupCanvas(canvas, hCss) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  canvas.width = w * dpr;
  canvas.height = hCss * dpr;
  canvas.style.height = hCss + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, W: w, H: hCss };
}
function themeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    ink: s.getPropertyValue("--ink").trim(),
    soft: s.getPropertyValue("--ink-soft").trim(),
    line: s.getPropertyValue("--line").trim(),
    accent: s.getPropertyValue("--accent").trim(),
    ok: s.getPropertyValue("--ok").trim() || "#2f855a",
    ng: s.getPropertyValue("--ng").trim() || "#c53030",
  };
}

/* ---------- 数学関数(統計ページ共用) ---------- */
function lnGamma(x) { // Lanczos 近似
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function lnFact(n) { return lnGamma(n + 1); }
function normPdf(x, mu, s) { return Math.exp(-((x - mu) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI)); }
function normCdf(x, mu, s) { // erf 近似 (Abramowitz–Stegun 7.1.26)
  const z = (x - mu) / (s * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + Math.sign(z) * y);
}
function normInv(p) { // 二分法で十分
  let lo = -8, hi = 8;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    (normCdf(mid, 0, 1) < p) ? lo = mid : hi = mid;
  }
  return (lo + hi) / 2;
}
function binomPmf(k, n, p) {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(lnFact(n) - lnFact(k) - lnFact(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
function poisPmf(k, lam) { return Math.exp(-lam + k * Math.log(lam) - lnFact(k)); }
function tPdf(x, df) {
  return Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2)) / Math.sqrt(df * Math.PI) *
    Math.pow(1 + x * x / df, -(df + 1) / 2);
}
function chi2Pdf(x, df) {
  if (x <= 0) return 0;
  return Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - lnGamma(df / 2));
}
function fPdf(x, d1, d2) {
  if (x <= 0) return 0;
  const lnB = lnGamma(d1 / 2) + lnGamma(d2 / 2) - lnGamma((d1 + d2) / 2);
  return Math.exp((d1 / 2) * Math.log(d1 / d2) + (d1 / 2 - 1) * Math.log(x)
    - ((d1 + d2) / 2) * Math.log(1 + d1 * x / d2) - lnB);
}
