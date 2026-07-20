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

/* ---------- SRSフラッシュカードエンジン(間隔反復・簡易SM-2) ---------- */
/* data: [{w:単語, pos:品詞, m:意味, ex:例文}] 固定デッキ
   storageKey: SRS状態+自作カードの保存先(localStorage)
   legacyKey: 旧Flashcardsの「覚えた」配列キー。あれば「間隔3日」として1回だけ移行 */
function SRSFlashcards(rootId, data, storageKey, legacyKey) {
  const DAY = 86400000;
  const root = $("#" + rootId);

  /* --- 状態(読み込み+旧記録の移行) --- */
  let S = store(storageKey);
  if (!S || !S.st) {
    S = { v: 1, st: {}, custom: [] };
    const old = legacyKey ? store(legacyKey) : null;
    if (Array.isArray(old)) old.forEach(w => {
      S.st[w] = { ease: 2.5, ivl: 3, due: Date.now() + 3 * DAY, reps: 1, lapses: 0 };
    });
    save();
  }
  if (!Array.isArray(S.custom)) S.custom = [];
  function save() { store(storageKey, S); }
  function deck() { return data.concat(S.custom); }
  function stateOf(c) { return S.st[c.w]; }

  /* --- 簡易SM-2: 評価g(0=再/1=難/2=可/3=易)で間隔を更新 --- */
  function applyGrade(c, g) {
    const now = Date.now();
    const s = S.st[c.w] || (S.st[c.w] = { ease: 2.5, ivl: 0, due: 0, reps: 0, lapses: 0 });
    s.reps++;
    if (g === 0) {
      s.lapses++; s.ease = Math.max(1.3, s.ease - 0.2);
      s.ivl = 0; s.due = now + 10 * 60000; // 10分後にセッション内で再出題
      return false;
    }
    if (g === 1) { s.ease = Math.max(1.3, s.ease - 0.15); s.ivl = Math.max(1, Math.round(s.ivl * 1.2) || 1); }
    else if (g === 2) { s.ivl = s.ivl < 1 ? 1 : Math.round(s.ivl * s.ease); }
    else { s.ease += 0.15; s.ivl = s.ivl < 1 ? 3 : Math.round(s.ivl * s.ease * 1.3); }
    s.ivl = Math.min(s.ivl, 365);
    s.due = now + s.ivl * DAY;
    return true;
  }
  function previewIvl(c, g) {
    const s = stateOf(c) || { ease: 2.5, ivl: 0 };
    let ivl;
    if (g === 1) ivl = Math.max(1, Math.round(s.ivl * 1.2) || 1);
    else if (g === 2) ivl = s.ivl < 1 ? 1 : Math.round(s.ivl * s.ease);
    else ivl = s.ivl < 1 ? 3 : Math.round(s.ivl * s.ease * 1.3);
    return Math.min(ivl, 365) + "日";
  }
  function dueCards() {
    const now = Date.now();
    return deck().filter(c => { const s = stateOf(c); return !s || s.due <= now; })
      .sort((a, b) => ((stateOf(a) || { due: 0 }).due) - ((stateOf(b) || { due: 0 }).due));
  }
  function nextDueDays() {
    const now = Date.now();
    let min = Infinity;
    deck().forEach(c => { const s = stateOf(c); if (s && s.due > now && s.due < min) min = s.due; });
    return min === Infinity ? null : Math.max(1, Math.ceil((min - now) / DAY));
  }

  /* --- 音声読み上げ(端末内のWeb Speech API。外部通信なし) --- */
  function speak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US"; u.rate = 0.95;
      speechSynthesis.speak(u);
    } catch (e) { /* 非対応端末では無音 */ }
  }

  /* --- セッション --- */
  const mainEl = el("div"); // 描画先(下のtools欄は書き換えない)
  let ses = null; // {queue, total, done, revealed}
  function startSession() {
    ses = { queue: dueCards(), total: dueCards().length, done: 0, revealed: false };
    render();
  }
  function answer(g) {
    const c = ses.queue.shift();
    if (applyGrade(c, g)) ses.done++;
    else ses.queue.splice(Math.min(3, ses.queue.length), 0, c); // 3枚後に再挿入
    save();
    ses.revealed = false;
    render();
  }

  /* --- 描画部品 --- */
  function boardRow(k, v, hot) {
    const r = el("div", "row");
    r.append(el("span", "k", k), el("span", "v" + (hot ? " hot" : ""), v));
    return r;
  }
  function routeBar(done, total) {
    const wrap = el("div", "srs-route");
    if (!total) return wrap;
    const stops = Math.min(total + 1, 9), ratio = done / total;
    for (let i = 0; i < stops; i++) {
      const p = i / (stops - 1);
      const cls = p < ratio ? "done" : (Math.abs(p - ratio) < 1 / (stops - 1) / 1.9 ? "here" : "");
      wrap.appendChild(el("div", "stop " + cls));
      if (i < stops - 1) wrap.appendChild(el("div", "rail " + (p < ratio ? "done" : "")));
    }
    return wrap;
  }
  function gradeBtn(cls, label, sub, g) {
    const b = el("button", cls, label);
    b.appendChild(el("span", "lbl", sub));
    b.addEventListener("click", () => answer(g));
    return b;
  }

  function renderHome() {
    const due = dueCards().length;
    const newCount = dueCards().filter(c => !stateOf(c)).length;
    const board = el("div", "srs-board");
    board.append(
      boardRow("今日の復習", String(due), due > 0),
      boardRow("うち新規", String(newCount)),
      boardRow("カード総数", deck().length + (S.custom.length ? "(自作 " + S.custom.length + ")" : ""))
    );
    const btn = el("button", "srs-main", due ? "復習をはじめる(" + due + "枚)" : "今日の復習は完了");
    btn.disabled = !due;
    btn.addEventListener("click", startSession);
    mainEl.replaceChildren(board, btn);
    if (!due) {
      const nd = nextDueDays();
      mainEl.appendChild(el("p", "srs-hint", nd ? "次の復習は " + nd + " 日後です。" : ""));
    }
  }

  function renderReview() {
    if (!ses.queue.length) {
      const doneMsg = el("div", "srs-done");
      doneMsg.append(el("div", "big", "本日終着です 🎉"),
        el("div", "sub", ses.total + "枚のカードを消化しました。おつかれさまでした。"));
      const back = el("button", "srs-main", "ホームに戻る");
      back.addEventListener("click", () => { ses = null; render(); });
      mainEl.replaceChildren(doneMsg, back);
      return;
    }
    const c = ses.queue[0];
    const s = stateOf(c);
    const meta = el("div", "srs-meta");
    const tts = el("button", "srs-tts", "🔊 読み上げ");
    tts.addEventListener("click", () => speak(c.w));
    meta.append(el("span", null, "残り " + ses.queue.length),
      tts,
      el("span", null, s && s.reps ? "復習 ×" + s.reps : "NEW"));

    const stage = el("div", "fc-stage");
    const card = el("div", "fc-card");
    const front = el("div", "fc-face front");
    front.append(el("div", "fc-word", c.w), el("div", "fc-pos", c.pos || ""));
    const back = el("div", "fc-face back");
    back.append(el("div", "fc-mean", c.m), el("div", "fc-ex", c.ex || ""));
    card.append(front, back);
    card.classList.toggle("flipped", ses.revealed);
    card.addEventListener("click", () => { ses.revealed = true; render(); });
    stage.appendChild(card);

    mainEl.replaceChildren(routeBar(ses.done, ses.total), meta, stage);
    if (ses.revealed) {
      const g = el("div", "srs-grades");
      g.append(gradeBtn("g0", "再", "10分", 0), gradeBtn("g1", "難", previewIvl(c, 1), 1),
        gradeBtn("g2", "可", previewIvl(c, 2), 2), gradeBtn("g3", "易", previewIvl(c, 3), 3));
      mainEl.appendChild(g);
    } else {
      const show = el("button", "srs-main", "答えを表示(カードをタップ/Space)");
      show.addEventListener("click", () => { ses.revealed = true; render(); });
      mainEl.appendChild(show);
    }
  }

  function render() { ses ? renderReview() : renderHome(); }

  /* --- カード追加・バックアップ(折りたたみ) --- */
  function buildTools() {
    const d = el("details", "srs-tools");
    d.appendChild(el("summary", null, "➕ カード追加・バックアップ・リセット"));

    d.appendChild(el("label", null, "単語を1枚追加(単語 / 意味 は必須)"));
    const iw = el("input"); iw.type = "text"; iw.placeholder = "deteriorate";
    const im = el("input"); im.type = "text"; im.placeholder = "悪化する";
    const ie = el("input"); ie.type = "text"; ie.placeholder = "例文(任意)";
    const bAdd = el("button", null, "追加する");
    const msg = el("p", "srs-hint", "");
    bAdd.addEventListener("click", () => {
      const w = iw.value.trim(), m = im.value.trim(), ex = ie.value.trim();
      if (!w || !m) { msg.textContent = "単語と意味を入力してください。"; return; }
      if (deck().some(x => x.w.toLowerCase() === w.toLowerCase())) { msg.textContent = "「" + w + "」は登録済みです。"; return; }
      S.custom.push({ w, pos: "", m, ex });
      save(); render();
      iw.value = im.value = ie.value = "";
      msg.textContent = "「" + w + "」を追加しました。今日の復習キューに入ります。";
    });
    d.append(iw, im, ie, bAdd, msg);

    d.appendChild(el("label", null, "まとめて追加(1行1枚、「単語,意味」形式。タブ・読点も可)"));
    const ta = el("textarea");
    ta.placeholder = "deteriorate,悪化する\nendeavor,努力・試み";
    const bBulk = el("button", null, "まとめて追加");
    bBulk.addEventListener("click", () => {
      let n = 0;
      ta.value.split("\n").map(l => l.trim()).filter(Boolean).forEach(l => {
        const p = l.split(/\t|,|、/);
        const w = (p[0] || "").trim(), m = p.slice(1).join(", ").trim();
        if (w && m && !deck().some(x => x.w.toLowerCase() === w.toLowerCase())) {
          S.custom.push({ w, pos: "", m, ex: "" }); n++;
        }
      });
      if (n) { save(); ta.value = ""; render(); }
      msg.textContent = n ? n + "枚追加しました。" : "追加できる行がありません(重複や形式を確認)。";
    });
    d.append(ta, bBulk);

    d.appendChild(el("label", null, "バックアップ(学習記録+自作カードをJSONで書き出し/読み込み)"));
    const bExp = el("button", null, "書き出す");
    bExp.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = storageKey + "-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click(); URL.revokeObjectURL(a.href);
    });
    const fi = el("input"); fi.type = "file"; fi.accept = ".json"; fi.style.display = "none";
    const bImp = el("button", null, "読み込む");
    bImp.addEventListener("click", () => fi.click());
    fi.addEventListener("change", () => {
      const f = fi.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d2 = JSON.parse(r.result);
          if (!d2 || typeof d2.st !== "object") throw 0;
          Object.keys(d2.st).forEach(w => { S.st[w] = d2.st[w]; });
          let n = 0;
          (d2.custom || []).forEach(c => {
            if (c.w && c.m && !deck().some(x => x.w.toLowerCase() === c.w.toLowerCase())) { S.custom.push(c); n++; }
          });
          save(); render();
          msg.textContent = "読み込みました(自作カード " + n + " 枚追加)。";
        } catch (e) { msg.textContent = "読み込めませんでした。書き出したJSONを選んでください。"; }
      };
      r.readAsText(f); fi.value = "";
    });
    const bReset = el("button", null, "⟲ 学習記録をリセット");
    bReset.addEventListener("click", () => {
      if (!confirm("間隔反復の学習記録をリセットしますか?(自作カードは残ります)")) return;
      S.st = {}; save(); ses = null; render();
    });
    const bDelCustom = el("button", null, "自作カードを全削除");
    bDelCustom.addEventListener("click", () => {
      if (!S.custom.length || !confirm("自作カード " + S.custom.length + " 枚を削除しますか?")) return;
      S.custom = []; save(); ses = null; render();
    });
    d.append(bExp, bImp, fi, bReset, bDelCustom);
    return d;
  }

  /* --- キーボード: Space=表示 / 1〜4=評価 --- */
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (!ses || !ses.queue.length) return;
    if (e.code === "Space") { e.preventDefault(); if (!ses.revealed) { ses.revealed = true; render(); } return; }
    if (ses.revealed && ["Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)) {
      answer(Number(e.code.slice(-1)) - 1);
    }
  });

  root.replaceChildren(mainEl, buildTools());
  render();

  /* 外部(辞書ページ等)からのカード登録用API */
  return {
    addCard: function (w, m, ex) {
      w = String(w || "").trim(); m = String(m || "").trim();
      if (!w || !m) return "invalid";
      if (deck().some(x => x.w.toLowerCase() === w.toLowerCase())) return "dup";
      S.custom.push({ w, pos: "", m, ex: String(ex || "").trim() });
      save(); render();
      return "ok";
    },
    count: function () { return deck().length; }
  };
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

/* ---------- PWA: Service Worker登録(オフライン閲覧用) ----------
   sw.js はサイト配下のみキャッシュ+KaTeX(jsdelivr)のみ例外。他の外部通信なし。
   file:// や非対応ブラウザでは静かにスキップ */
(function () {
  try {
    if (!("serviceWorker" in navigator)) return;
    const sc = document.currentScript;
    if (!sc || !sc.src || sc.src.indexOf("http") !== 0) return;
    const siteRoot = sc.src.replace(/assets\/app\.js.*$/, "");
    navigator.serviceWorker.register(siteRoot + "sw.js").catch(function () {});
  } catch (e) { /* noop */ }
})();
