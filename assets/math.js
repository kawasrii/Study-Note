/* 数式レンダリング: KaTeX(CDN)が使えれば $$...$$ をTeX描画、
   使えないオフライン環境では $$ 記号を除去してプレーン表示に落とす */
"use strict";
(function () {
  function fallbackPlain() {
    document.querySelectorAll(".formula").forEach(el => {
      // $$ 区切りを外し、最低限のTeXコマンドを読める形に置換
      let t = el.textContent.replace(/\$\$/g, "");
      t = t.replace(/\\qquad|\\quad/g, "   ")
        .replace(/\\,|\\;|\\!/g, " ")
        .replace(/\\left|\\right|\\big|\\Big/g, "")
        .replace(/\\(text|mathrm)\{([^}]*)\}/g, "$2")
        .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
      el.textContent = t;
    });
  }
  window.addEventListener("load", function () {
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(document.body, {
          delimiters: [{ left: "$$", right: "$$", display: true }],
          throwOnError: false,
        });
      } catch (e) { fallbackPlain(); }
    } else {
      fallbackPlain();
    }
  });
})();
