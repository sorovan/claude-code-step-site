/* Claude CodeのSTEP｜MVP
 * - 静的Web。バックエンド・外部スクリプトなし。
 * - 教材本文は data/*.json から読み込み、textContent / createElement のみで描画する（HTML注入を防ぐ）。
 * - 進捗と教材項目ブックマークを localStorage に保存する。保存できなくても学習は継続できる。
 */
(function () {
  "use strict";

  var DATA_DIR = "data/";
  var STORAGE_KEY = "claude-code-step:progress:v1";
  var QUICKSTART_STORAGE_KEY = "claude-code-step:quickstart:v1";
  var TOTAL_LABEL = "STEP 0〜7";

  var state = {
    steps: [],
    extension: null,
    quickstart: null,
    questions: [],
    glossary: null,
    config: null,
    progress: { checks: {}, lastStepId: null },
    quickstartProgress: { checks: {} },
    storageOk: true,
    memoryOnly: {}
  };

  var app = document.getElementById("app");
  var statusRegion = document.getElementById("status");
  var storeNotice = document.getElementById("store-notice");

  /* ---------- 進捗（localStorage：失敗しても動く） ---------- */

  function validProgress(parsed) {
    return parsed && typeof parsed === "object" && parsed.checks && typeof parsed.checks === "object" && !Array.isArray(parsed.checks);
  }
  function cleanChecks(checks) {
    var result = Object.create(null);
    Object.keys(checks).forEach(function (id) {
      if (Array.isArray(checks[id])) result[id] = checks[id].map(function (v) { return v === true; });
    });
    return result;
  }

  function loadProgress() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (!validProgress(parsed)) throw new Error("invalid progress");
        state.progress = { checks: cleanChecks(parsed.checks), lastStepId: typeof parsed.lastStepId === "string" ? parsed.lastStepId : null };
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveProgress() {
    if (!state.storageOk) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    } catch (e) {
      state.storageOk = false;
      if (storeNotice) storeNotice.hidden = false;
    }
  }

  function loadQuickstartProgress() {
    try {
      var raw = window.localStorage.getItem(QUICKSTART_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (!validProgress(parsed)) throw new Error("invalid progress");
        state.quickstartProgress = { checks: cleanChecks(parsed.checks) };
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveQuickstartProgress() {
    if (!state.storageOk) return;
    try {
      window.localStorage.setItem(QUICKSTART_STORAGE_KEY, JSON.stringify(state.quickstartProgress));
    } catch (e) {
      state.storageOk = false;
      if (storeNotice) storeNotice.hidden = false;
    }
  }

  function getChecks(stepId) {
    return state.progress.checks[stepId] || [];
  }

  function setCheck(stepId, index, value) {
    var step = findStep(stepId);
    var arr = (state.progress.checks[stepId] || []).slice();
    for (var i = 0; i < step.checklist.length; i++) {
      if (arr[i] === undefined) arr[i] = false;
    }
    arr[index] = !!value;
    state.progress.checks[stepId] = arr;
    saveProgress();
  }

  function getQuickChecks(itemId) {
    return state.quickstartProgress.checks[itemId] || [];
  }

  function setQuickCheck(itemId, index, value) {
    var item = findQuickstartStep(itemId);
    var arr = (state.quickstartProgress.checks[itemId] || []).slice();
    for (var i = 0; i < item.checklist.length; i++) {
      if (arr[i] === undefined) arr[i] = false;
    }
    arr[index] = !!value;
    state.quickstartProgress.checks[itemId] = arr;
    saveQuickstartProgress();
  }

  function isStepComplete(step) {
    var checks = getChecks(step.id);
    if (!step.checklist.length) return false;
    for (var i = 0; i < step.checklist.length; i++) {
      if (!checks[i]) return false;
    }
    return true;
  }

  function completedCount() {
    var n = 0;
    state.steps.forEach(function (s) { if (isStepComplete(s)) n++; });
    return n;
  }

  function findQuickstartStep(id) {
    var items = state.quickstart ? state.quickstart.steps : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function isQuickstartStepComplete(item) {
    var checks = getQuickChecks(item.id);
    if (!item.checklist.length) return false;
    for (var i = 0; i < item.checklist.length; i++) {
      if (!checks[i]) return false;
    }
    return true;
  }

  function quickstartCompletedCount() {
    var n = 0;
    (state.quickstart ? state.quickstart.steps : []).forEach(function (item) {
      if (isQuickstartStepComplete(item)) n++;
    });
    return n;
  }

  function setLastStep(stepId) {
    state.progress.lastStepId = stepId;
    saveProgress();
  }

  /* ---------- 共通ユーティリティ ---------- */

  function findStep(id) {
    for (var i = 0; i < state.steps.length; i++) {
      if (state.steps[i].id === id) return state.steps[i];
    }
    return null;
  }

  function stepIndex(id) {
    for (var i = 0; i < state.steps.length; i++) {
      if (state.steps[i].id === id) return i;
    }
    return -1;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === "text") { node.textContent = v; return; }
        if (k === "class") { node.className = v; return; }
        if (v === false || v === null || v === undefined) return;
        if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function say(message) {
    if (statusRegion) statusRegion.textContent = message;
  }

  /* 外部リンクの許可リスト判定：https かつ許可ホストのみ */
  function isAllowedExternal(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== "https:") return false;
      var hosts = (state.config && state.config.allowedExternalHosts) || [];
      return hosts.some(function (h) {
        return u.hostname === h || u.hostname.slice(-(h.length + 1)) === "." + h;
      });
    } catch (e) {
      return false;
    }
  }

  function externalLink(label, url) {
    return el("a", {
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      text: label + "（外部サイトへ）"
    });
  }

  /* 教材リンク：config の enabled と許可リストの両方を満たすときだけ表示 */
  function linkByKey(key) {
    var item = state.config.links[key];
    if (!item || !item.enabled || !item.url) return null;
    if (!isAllowedExternal(item.url)) return null;
    return externalLink(item.label, item.url);
  }

  function relatedLinkFor(step) {
    if (!step.relatedUrl || !isAllowedExternal(step.relatedUrl)) return null;
    return externalLink("公式・関連ページ", step.relatedUrl);
  }

  /* ---------- 指示文コピー ---------- */

  function copyText(text, button) {
    function ok() {
      if (window.stepAnalytics && (!button || !button.hasAttribute('data-keyword-copy'))) window.stepAnalytics.copy();
      say("指示文をコピーしました。");
      if (button) flashButton(button, "コピーしました");
    }
    function ng() {
      say("コピーできませんでした。指示文を選択して手動でコピーしてください。");
      if (button) flashButton(button, "コピー失敗");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text) ? ok() : ng(); });
    } else {
      fallbackCopy(text) ? ok() : ng();
    }
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var done = document.execCommand("copy");
      document.body.removeChild(ta);
      return done;
    } catch (e) {
      return false;
    }
  }

  function flashButton(button, label) {
    var original = button.getAttribute("data-label") || button.textContent;
    button.setAttribute("data-label", original);
    button.textContent = label;
    window.setTimeout(function () { button.textContent = original; }, 1800);
  }

  /* ---------- 本文の描画（安全なブロック形式のみ） ---------- */

  function renderBody(blocks) {
    var wrap = el("div", { class: "body" });
    (blocks || []).forEach(function (b) {
      switch (b.type) {
        case "heading":
          wrap.appendChild(el("h3", { text: b.text }));
          break;
        case "p":
          wrap.appendChild(el("p", { text: b.text }));
          break;
        case "ul":
          wrap.appendChild(el("ul", null, (b.items || []).map(function (t) { return el("li", { text: t }); })));
          break;
        case "steps":
          wrap.appendChild(el("ol", { class: "try-steps" }, (b.items || []).map(function (t) { return el("li", { text: t }); })));
          break;
        case "note":
          wrap.appendChild(el("p", { class: "note", text: b.text }));
          break;
        default:
          break;
      }
    });
    return wrap;
  }

  /* STEP画像（16:9）。alt必須。表示が崩れないよう幅・高さを指定し、遅延読み込みにする */
  function renderStepImage(image) {
    if (!image || !image.src || !image.alt) return null;
    if (image.src.indexOf("assets/images/step/") !== 0) return null;
    var img = el("img", {
      src: image.src,
      alt: image.alt,
      width: 1376,
      height: 768,
      loading: "lazy",
      decoding: "async",
      class: "step-image"
    });
    return el("figure", { class: "step-figure" }, [img]);
  }

  function renderPrompt(prompt) {
    if (!prompt) return null;
    var button = el("button", { type: "button", class: "btn", text: "指示文をコピー" });
    var pre = el("pre", { class: "prompt" }, [el("code", { text: prompt })]);
    button.addEventListener("click", function () { copyText(prompt, button); });
    return el("section", { class: "card prompt-card", "aria-labelledby": "prompt-h" }, [
      el("h3", { id: "prompt-h", text: "コピーする：指示文" }),
      pre,
      el("div", { class: "row" }, [button])
    ]);
  }

  function questionChips() {
    if (!state.questions.length) return null;
    var chips = el("div", { class: "question-chips" });
    state.questions.forEach(function (q) {
      var button = el("button", { type: "button", class: "question-chip" }, [
        el("span", { class: "question-number", text: String(state.questions.indexOf(q) + 1).padStart(2, "0") }),
        el("span", { class: "question-label", text: q.label }),
        el("span", { class: "question-query", text: q.query + " →" })
      ]);
      button.addEventListener("click", function () {
        location.hash = "#/questions?q=" + encodeURIComponent(q.id);
      });
      chips.appendChild(button);
    });
    return el("section", { class: "card question-entry", "aria-labelledby": "question-entry-h" }, [
      el("h2", { id: "question-entry-h", text: "今の疑問から探す" }),
      el("p", { text: "質問を1つ選ぶと、関連する章と既存検索への入口が表示されます。" }),
      chips
    ]);
  }

  function quickstartCard() {
    if (!state.quickstart) return null;
    var total = state.quickstart.steps.length;
    var done = quickstartCompletedCount();
    return el("section", { class: "card quickstart-card", "aria-labelledby": "quickstart-card-h" }, [
      el("p", { class: "eyebrow", text: "P1｜最初の15分" }),
      el("h2", { id: "quickstart-card-h", text: state.quickstart.title }),
      el("p", { text: state.quickstart.summary }),
      el("p", { class: "progress-line", text: "実践の進捗：" + done + " / " + total + " 項目" }),
      el("div", { class: "row" }, [
        el("a", { class: "btn primary", href: "#/start", text: done === 0 ? "最初の1回を試す →" : "続きから再開 →" }),
        el("a", { class: "btn", href: "#/steps", text: "STEP 0〜7を見る" })
      ])
    ]);
  }

  function homeRoadmap() {
    var grid = el("div", { class: "home-roadmap-grid" });
    state.steps.forEach(function (s) {
      var complete = isStepComplete(s);
      grid.appendChild(el("a", { class: "roadmap-item" + (complete ? " is-done" : ""), href: "#/step/" + s.id }, [
        el("span", { class: "roadmap-no", text: String(s.order).padStart(2, "0") }),
        el("span", { class: "roadmap-copy" }, [
          el("strong", { text: s.title }),
          el("small", { text: complete ? "完了" : s.summary })
        ]),
        el("span", { class: "roadmap-arrow", text: "→" })
      ]));
    });
    return el("section", { class: "home-roadmap", "aria-labelledby": "roadmap-h" }, [
      el("div", { class: "section-heading roadmap-heading" }, [
        el("div", null, [el("p", { class: "eyebrow", text: "LEARNING ROADMAP" }), el("h2", { id: "roadmap-h", text: "8つのSTEPで、できることを増やす" })]),
        el("a", { class: "text-link", href: "#/steps", text: "一覧を見る →" })
      ]),
      el("p", { class: "section-lead", text: "最初の操作から、安全な指示、結果確認、GitHubの入口までを順番に学べます。" }),
      grid
    ]);
  }

  function homeStartSection() {
    if (!state.quickstart) return null;
    var items = state.quickstart.steps || [];
    var done = quickstartCompletedCount();
    return el("section", { class: "home-start-preview", "aria-labelledby": "home-start-h" }, [
      el("div", { class: "home-start-copy" }, [
        el("p", { class: "eyebrow", text: "START SMALL" }),
        el("h2", { id: "home-start-h", text: "最初の15分で、\n小さなページを完成。" }),
        el("p", { text: state.quickstart.summary }),
        el("img", { src: "assets/images/characters/step-character-01-teacher.png", alt: "考えながら説明する渋沢A壱" }),
        el("a", { class: "btn dark", href: "#/start", text: "4項目を順番に見る →" })
      ]),
      el("div", { class: "home-start-check" }, [
        el("div", { class: "home-start-count" }, [el("span", { text: "実践の進捗" }), el("strong", { text: done + " / " + items.length })]),
        el("ol", null, items.map(function (item) { return el("li", { text: item.title }); })),
        el("p", { text: "できた項目にチェックを付けながら進めます。" }),
        el("div", { class: "home-start-achievement", hidden: done !== items.length }, [el("img", { src: "assets/images/characters/step-character-06-complete.png", alt: "完成を喜ぶ渋沢A壱" }), el("span", { text: "最初の1回、実験完了！" })])
      ])
    ]);
  }

  function quickstartChecklist(item) {
    var wrap = el("section", { class: "quickstart-check card", "aria-labelledby": "quick-check-" + item.id });
    wrap.appendChild(el("h3", { id: "quick-check-" + item.id, text: "確認する" }));
    var checks = getQuickChecks(item.id);
    var ul = el("ul", { class: "checklist" });
    item.checklist.forEach(function (text, i) {
      var cid = "quick-chk-" + item.id + "-" + i;
      var input = el("input", { type: "checkbox", id: cid, checked: !!checks[i] });
      input.addEventListener("change", function () {
        setQuickCheck(item.id, i, input.checked);
        say(state.storageOk ? (input.checked ? "最初の15分の確認を保存しました。" : "確認を外しました。") : "進捗を保存できませんでした。この画面内だけで有効です。");
        if (state.storageOk && isQuickstartStepComplete(item)) say("この実践項目の確認がすべて済みました。");
        var achievement = document.querySelector("[data-quick-achievement]");
        if (achievement) achievement.hidden = quickstartCompletedCount() !== state.quickstart.steps.length;
      });
      ul.appendChild(el("li", null, [input, el("label", { for: cid, text: text })]));
    });
    wrap.appendChild(ul);
    return wrap;
  }

  function viewQuickstart() {
    if (!state.quickstart) return [el("h1", { text: "実践コースを読み込めませんでした" })];
    var items = state.quickstart.steps;
    var done = quickstartCompletedCount();
    var children = [
      el("header", { class: "page-hero quickstart-hero" }, [
        el("p", { class: "crumb", text: "P1｜最初の15分" }),
        el("h1", { text: state.quickstart.title }),
        el("p", { class: "lead", text: state.quickstart.summary }),
        el("div", { class: "quickstart-progress", role: "status", text: "実践の進捗：" + done + " / " + items.length + " 項目" }),
        el("p", { class: "note", text: "このコースは練習用フォルダで行います。大事なファイルや個人情報は入れず、公開もしないでください。" })
      ]),
      el("figure", { class: "quickstart-visual" }, [
        el("img", {
          src: "assets/images/quickstart/shibusawa-robo-15min.webp",
          alt: "渋沢A壱とROBOが、Codeタブ、Local、練習フォルダ、完成ページの順番を案内する図解"
        }),
        el("figcaption", { text: "図解の順番に沿って、4つの項目を上から順に進めます。" })
      ]),
      el("aside", { class: "quickstart-guide" }, [
        el("img", { src: "assets/images/characters/step-character-01-teacher.png", alt: "考えながら説明する渋沢A壱" }),
        el("p", { text: "まずは練習用フォルダで、小さく試してみましょう。" })
      ])
    ];
    items.forEach(function (item, i) {
      var card = el("article", { class: "quickstart-item" }, [
        el("div", { class: "quickstart-item-head" }, [
          el("span", { class: "quickstart-number", text: String(item.order).padStart(2, "0") }),
          el("div", null, [el("h2", { text: item.title }), el("p", { class: "meta", text: item.summary })])
        ]),
        renderBody(item.body),
        renderPrompt(item.prompt),
        quickstartChecklist(item)
      ]);
      children.push(card);
      if (i < items.length - 1) children.push(el("p", { class: "quickstart-arrow", text: "次へ ↓" }));
    });
    children.push(el("section", { class: "card quickstart-achievement", "data-quick-achievement": "", hidden: done !== items.length }, [
      el("img", { src: "assets/images/characters/step-character-06-complete.png", alt: "完成を喜ぶ渋沢A壱" }),
      el("div", null, [el("h2", { text: "最初の1回、実験完了！" }), el("p", { text: "小さな成果物を完成させました。次はSTEP 0〜7から、気になる場所へ進めます。" })])
    ]));
    children.push(el("section", { class: "card quickstart-finish" }, [
      el("h2", { text: "できたら次へ" }),
      el("p", { text: done === items.length ? "小さな成果物を完成させました。次はSTEP 0〜7で安全な進め方を深めます。" : "4項目を順番に確認すると、最初の成果物まで進められます。" }),
      el("div", { class: "row" }, [
        el("a", { class: "btn primary", href: "#/step/step-0", text: "STEP 0から学ぶ →" }),
        el("a", { class: "btn", href: "#/search", text: "困りごとを検索" })
      ])
    ]));
    return [el("div", { class: "quickstart-page" }, children)];
  }

  /* ---------- 画面：トップ ---------- */

  function viewHome() {
    var total = state.steps.length;
    var done = completedCount();
    var last = state.progress.lastStepId ? findStep(state.progress.lastStepId) : null;
    var resumeTarget = last || state.steps[0];

    var hero = el("section", { class: "home-hero" }, [
      el("div", { class: "hero-copy" }, [
        el("p", { class: "eyebrow", text: "CLAUDE CODE BEGINNER GUIDE" }),
        el("h1", { text: "Claude Codeを、最初の1回から安全に使う。" }),
        el("p", { class: "lead", text: "初回操作から、AIへの指示の書き方、作業ファイルの守り方、GitHubの入口までを、一歩ずつ学べる無料教材です。" }),
        el("div", { class: "row hero-actions" }, [
          el("a", { class: "btn primary", href: "#/start", text: "最初の1回を試す →" }),
          el("a", { class: "btn", href: "#/steps", text: "STEP 0〜7を見る" })
        ])
      ]),
      el("aside", { class: "hero-panel" }, [
        el("p", { class: "eyebrow", text: "YOUR FIRST WIN" }),
        el("figure", { class: "hero-visual" }, [
          el("img", { src: "assets/images/characters/step-character-07-tora-dialogue.png", alt: "TORAと掛け合いながら説明する渋沢A壱", width: 1448, height: 1086, loading: "eager", decoding: "async" }),
          el("figcaption", { text: "渋沢A壱とTORAが、最初の一歩を案内します。" })
        ]),
        el("h2", { text: "小さなページを1つ完成させる" }),
        el("p", { text: "練習用フォルダで作り、実際に開いて確認するところまで進みます。" }),
        el("div", { class: "tora-guide" }, [
          el("strong", { text: "TORAのひとこと" }),
          el("p", { "data-tora-speech": "", text: "まずは小さく作ってみよ！" }),
          el("button", { class: "btn", type: "button", "data-tora-control": "", text: "TORAに聞く" })
        ]),
        el("p", { class: "hero-stat" }, [el("strong", { text: quickstartCompletedCount() + " / " + (state.quickstart ? state.quickstart.steps.length : 0) }), el("span", { text: "実践の進捗" })]),
        el("a", { class: "text-link", href: "#/start", text: "実践コースを開く →" })
      ])
    ]);
    var facts = el("section", { class: "home-facts", "aria-label": "この教材で学べること" }, [
      el("article", { class: "home-fact" }, [el("span", { class: "fact-number", text: "01" }), el("h2", { text: "まず動かす" }), el("p", { text: "最初の会話から、小さな成果物を開くまでを体験します。" })]),
      el("article", { class: "home-fact" }, [el("span", { class: "fact-number", text: "02" }), el("h2", { text: "安全に守る" }), el("p", { text: "作業場所、バックアップ、危険な依頼を避ける考え方を学びます。" })]),
      el("article", { class: "home-fact" }, [el("span", { class: "fact-number", text: "03" }), el("h2", { text: "確認して残す" }), el("p", { text: "結果を確認し、GitHubへの入口まで自分で進めます。" })])
    ]);
    var stats = el("section", { class: "home-stats", "aria-label": "STEPの特徴" }, [
      el("div", null, [el("strong", { text: String(total) }), el("span", { text: "STEP" })]),
      el("div", null, [el("strong", { text: "4" }), el("span", { text: "実践項目" })]),
      el("div", null, [el("strong", { text: "1" }), el("span", { text: "クリックで開始" })]),
      el("div", null, [el("strong", { text: "0" }), el("span", { text: "個人情報収集" })])
    ]);
    var progress = el("section", { class: "card home-progress", "aria-labelledby": "home-progress-h" }, [
      el("div", { class: "section-heading" }, [el("div", null, [el("p", { class: "eyebrow", text: "YOUR PROGRESS" }), el("h2", { id: "home-progress-h", text: "学習の進み具合" })]), el("strong", { text: done + " / " + total + " STEP" })]),
      el("p", { text: done === 0 ? "STEP 0から始めるか、知りたいテーマを選んでください。" : "続きから再開できます。最後に学んだSTEPは「" + resumeTarget.title + "」です。" }),
      el("div", { class: "row compact-actions" }, [
        el("a", { class: "btn primary", href: "#/step/" + resumeTarget.id, text: done === 0 ? "STEP 0から始める" : "続きから再開" }),
        el("a", { class: "btn", href: "#/search", text: "用語・困りごと検索" }),
        el("a", { class: "btn", href: "#/final", text: "最終チェック" })
      ])
    ]);
    var lab = el("section", { class: "home-lab", "aria-labelledby": "home-lab-h" }, [
      el("div", { class: "section-heading" }, [el("div", null, [el("p", { class: "eyebrow", text: "TORA'S DIGITAL LAB" }), el("h2", { id: "home-lab-h", text: "TORAの電脳実験室" })]), el("span", { class: "lab-caption", text: "カードを開いて、最初の指示文を見る" })]),
      el("div", { class: "home-lab-visual" }, [el("img", { src: "assets/images/characters/step-character-08-tora-lab.png", alt: "電脳実験に驚く渋沢A壱" }), el("p", { text: "正解を急がず、まずは小さく試してみます。" })]),
      el("div", { class: "home-lab-grid" }, [
        labExperiment("猫が社長の会社サイトを作る", "会社紹介・社長紹介・問い合わせ先の3項目から始めます。", "猫が社長の会社サイトを、小さなindex.htmlとして作ってください。"),
        labExperiment("押すたびに褒めてくれるボタンを作る", "クリックするたびに短いメッセージが変わる実験です。", "押すたびに表示が変わるボタンのページを作ってください。"),
        labExperiment("今日の運勢が出るページを作る", "外部APIなしで、用意した候補から表示します。", "今日の運勢を表示する小さなページを作ってください。")
      ])
    ]);
    var toraLines = ["まずは小さく作ってみよ！", "そこ消したらアカン！", "完成したら自分で開いて確認や！", "次は何を実験する？"];
    var toraIndex = 0;
    var toraButton = hero.querySelector("[data-tora-control]");
    var toraSpeech = hero.querySelector("[data-tora-speech]");
    if (toraButton && toraSpeech) toraButton.addEventListener("click", function () {
      toraIndex = (toraIndex + 1) % toraLines.length;
      toraSpeech.textContent = toraLines[toraIndex];
      say("TORAの案内を更新しました。");
    });
    var children = [hero, stats, homeRoadmap(), homeStartSection(), lab, facts, progress, questionChips(), guideCard(), el("p", { class: "note home-note", text: state.config.siteNote })];
    return [el("div", { class: "home-page" }, children)];
  }

  function labExperiment(title, summary, prompt) {
    var details = el("details", { class: "home-lab-card" }, [
      el("summary", null, [el("strong", { text: title }), el("span", { text: "ひらく →" })]),
      el("p", { text: summary }),
      el("code", { text: prompt })
    ]);
    return details;
  }

  /* 無料教材の周辺案内。未公開の項目は「準備中」と表示し、URLは設定しない */
  function guideCard() {
    var rows = [
      { name: "無料note", desc: "STEPの使い方と受け取り案内（無料）", key: "freeNote" },
      { name: "公式LINE", desc: "更新のお知らせ（任意。登録は必須ではありません）", key: "officialLine" },
      { name: "noteメンバーシップ", desc: "追加教材・更新版・実践例（「AI開発の道具箱｜STEP実践室」、月額980円予定）", key: "membership" },
      { name: "ココナラ", desc: "個別のAI開発作業ルール整理（有料の個別相談）", key: "coconala" }
    ];
    var list = el("ul", { class: "guide-list" }, rows.map(function (r) {
      var link = linkByKey(r.key);
      return el("li", null, [
        el("strong", { text: r.name }),
        el("span", { text: "：" + r.desc }),
        el("br"),
        link || el("span", { class: "coming", text: "準備中" })
      ]);
    }));
    return el("section", { class: "card", "aria-labelledby": "guide-h" }, [
      el("h3", { id: "guide-h", text: "続けて学ぶ・支援の案内" }),
      el("p", { text: "STEP 0〜7は無料です。以下は任意の案内です。学習の途中で購入を求めることはありません。" }),
      list
    ]);
  }

  /* ---------- 画面：STEP一覧 ---------- */

  function viewStepList() {
    var list = el("ol", { class: "step-list" });
    state.steps.forEach(function (s) {
      var complete = isStepComplete(s);
      list.appendChild(el("li", null, [
        el("a", { href: "#/step/" + s.id, class: "step-link" + (complete ? " is-done" : "") }, [
          el("span", { class: "step-no", text: "STEP " + s.order }),
          el("span", { class: "step-title", text: s.title }),
          el("span", { class: "step-badge", text: complete ? "完了" : "未完了" })
        ])
      ]));
    });
    var done = completedCount();
    return [el("div", { class: "steps-page" }, [
      el("header", { class: "page-hero steps-hero" }, [
        el("p", { class: "eyebrow", text: "LEARNING ROADMAP" }),
        el("h1", { text: "STEP一覧" }),
        el("p", { class: "lead", text: TOTAL_LABEL + "を順番に進めます。完了済みのSTEPには「完了」と表示されます。" })
      ]),
      el("section", { class: "steps-overview", "aria-label": "学習進捗" }, [
        el("div", null, [el("span", { class: "eyebrow", text: "YOUR PROGRESS" }), el("strong", { text: done + " / " + state.steps.length }), el("span", { text: "STEP完了" })]),
        el("a", { class: "btn primary", href: "#/step/" + (state.steps[0] ? state.steps[0].id : ""), text: done ? "続きから学ぶ →" : "STEP 0から始める →" })
      ]),
      el("section", { class: "steps-grid-section", "aria-labelledby": "steps-grid-h" }, [
        el("div", { class: "section-heading" }, [el("h2", { id: "steps-grid-h", text: "8つのSTEPで、できることを増やす" }), el("span", { class: "section-lead", text: "気になるSTEPから始めても大丈夫です。" })]),
        list
      ])
    ])];
  }

  /* ---------- 画面：STEP詳細 ---------- */

  function stepRail(current) {
    var list = el("ol", { class: "step-rail-list" });
    state.steps.forEach(function (s) {
      var link = el("a", { href: "#/step/" + s.id, text: "STEP " + s.order + "　" + s.title });
      if (s.id === current.id) link.setAttribute("aria-current", "page");
      list.appendChild(el("li", { class: s.id === current.id ? "is-current" : "" }, [link]));
    });
    var details = el("details", { class: "step-rail", "aria-label": "STEPの目次" }, [
      el("summary", null, [
        el("span", { class: "eyebrow", text: "LEARNING PATH" }),
        el("span", { class: "rail-title", text: "STEPの目次" }),
        el("span", { class: "rail-progress", text: completedCount() + " / " + state.steps.length + " 完了" })
      ]),
      list
    ]);
    details.open = window.matchMedia ? window.matchMedia("(min-width: 701px)").matches : true;
    return details;
  }

  function viewStep(id) {
    var step = findStep(id);
    if (!step) return [el("h1", { text: "STEPが見つかりません" }), el("p", { text: "一覧から選び直してください。" }), el("a", { class: "btn", href: "#/steps", text: "STEP一覧へ" })];
    setLastStep(step.id);

    var idx = stepIndex(step.id);
    var prev = idx > 0 ? state.steps[idx - 1] : null;
    var next = idx < state.steps.length - 1 ? state.steps[idx + 1] : null;

    var checklistWrap = el("section", { class: "card check-card", "aria-labelledby": "check-h" });
    checklistWrap.appendChild(el("h3", { id: "check-h", text: "チェックする" }));
    var checks = getChecks(step.id);
    var ul = el("ul", { class: "checklist" });
    step.checklist.forEach(function (text, i) {
      var cid = "chk-" + step.id + "-" + i;
      var input = el("input", { type: "checkbox", id: cid, checked: !!checks[i] });
      input.addEventListener("change", function () {
        setCheck(step.id, i, input.checked);
        say(state.storageOk ? (input.checked ? "チェックを保存しました。" : "チェックを外しました。") : "進捗を保存できませんでした。この画面内だけで有効です。");
        if (state.storageOk && isStepComplete(step)) say("このSTEPの確認が全て済みました。");
      });
      ul.appendChild(el("li", null, [input, el("label", { for: cid, text: text })]));
    });
    checklistWrap.appendChild(ul);
    if (!state.storageOk) checklistWrap.appendChild(el("p", { class: "note", text: "この環境では進捗を保存できないため、ページを離れるとチェックは消えます。学習自体は続けられます。" }));

    var nextLinks = [];
    var relLink = relatedLinkFor(step);
    if (relLink) nextLinks.push(relLink);
    if (step.nextLinks) {
      step.nextLinks.forEach(function (k) {
        var l = linkByKey(k);
        if (l) nextLinks.push(l);
      });
    }

    var nav = el("nav", { class: "pager", "aria-label": "STEPの移動" }, [
      prev ? el("a", { class: "btn", href: "#/step/" + prev.id, text: "← 前へ：" + prev.title }) : el("span"),
      next ? el("a", { class: "btn primary", href: "#/step/" + next.id, text: "次へ：" + next.title + " →" }) : el("a", { class: "btn primary", href: "#/final", text: "最終チェックへ →" })
    ]);

    var lessonHeader = el("header", { class: "lesson-header" }, [
      el("p", { class: "crumb", text: "STEP " + step.order + " / " + (state.steps.length - 1) + "　" + (isStepComplete(step) ? "（完了）" : "（未完了）") }),
      el("h1", { text: step.title }),
      el("p", { class: "lead", text: step.summary })
    ]);
    var children = [
      lessonHeader,
      renderStepImage(step.image),
      renderBody(step.body),
      renderPrompt(step.prompt),
      checklistWrap
    ];
    if (nextLinks.length) {
      children.push(el("section", { class: "card", "aria-labelledby": "more-h" }, [
        el("h3", { id: "more-h", text: "関連教材" }),
        el("ul", null, nextLinks.map(function (a) { return el("li", null, [a]); }))
      ]));
    }
    if (step.nextText) children.push(el("p", { class: "next-text", text: "次へ進む：" + step.nextText }));
    children.push(nav);
    children.push(el("p", { class: "meta", text: "教材の更新日：" + step.updatedAt }));
    return [el("div", {
      class: "lesson-page step-accent-" + String(step.order),
      "data-step-order": String(step.order)
    }, [
      el("div", { class: "lesson-layout" }, [stepRail(step), el("div", { class: "lesson-content" }, children)])
    ])];
  }

  /* ---------- 画面：検索 ---------- */

  function textOfStep(s) {
    var parts = [s.title, s.summary, s.prompt || ""];
    (s.body || []).forEach(function (b) {
      if (b.text) parts.push(b.text);
      if (b.items) parts = parts.concat(b.items);
    });
    parts = parts.concat(s.checklist || []);
    return parts.join("\n");
  }

  function viewSearch(query) {
    var q = (query || "").trim();
    var lower = q.toLowerCase();
    var input = el("input", { type: "search", id: "q", name: "q", value: q, placeholder: "例：指示文、バックアップ、GitHub", "aria-label": "キーワード検索", class: "search-input" });
    var form = el("form", { class: "search-form", role: "search" }, [input, el("button", { type: "submit", class: "btn primary", text: "検索" })]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      location.hash = "#/search?q=" + encodeURIComponent(input.value.trim());
    });

    var children = [el("h1", { text: "用語・困りごと検索" }), form];
    if (!q) {
      children.push(el("p", { class: "lead", text: "キーワードを入れると、STEP・用語集・困りごとを探せます。" }));
      children.push(questionChips());
      return [el("div", { class: "search-page" }, children)];
    }

    var stepHits = state.steps.filter(function (s) { return textOfStep(s).toLowerCase().indexOf(lower) !== -1; });
    var termHits = (state.glossary.items || []).filter(function (g) { return (g.term + g.meaning).toLowerCase().indexOf(lower) !== -1; });
    var troubleHits = (state.glossary.troubles || []).filter(function (t) { return (t.question + t.answer).toLowerCase().indexOf(lower) !== -1; });

    children = children.concat(extensionSearch(q));
    children.push(el("h2", { text: "STEP（" + stepHits.length + "件）" }));
    children.push(stepHits.length
      ? el("div", { class: "search-results" }, stepHits.map(function (s) {
          return resultCard("STEP " + s.order, s.title, s.summary, null, "#/step/" + s.id);
        }))
      : el("p", { text: "一致するSTEPはありません。" }));

    children.push(el("h2", { text: "用語（" + termHits.length + "件）" }));
    children.push(termHits.length
      ? el("div", { class: "search-results" }, termHits.map(function (g) {
          return resultCard("用語", g.term, g.meaning, g.stepIds, null);
        }))
      : el("p", { text: "一致する用語はありません。" }));

    children.push(el("h2", { text: "困りごと（" + troubleHits.length + "件）" }));
    children.push(troubleHits.length
      ? el("div", { class: "search-results" }, troubleHits.map(function (t) {
          return resultCard("困りごと", t.question, t.answer, t.stepIds, null);
        }))
      : el("p", { text: "一致する困りごとはありません。" }));
    return [el("div", { class: "search-page" }, children)];
  }

  /* 検索結果1件のカード表示（データ構造は変えず、表示だけを変える） */
  function resultCard(kind, title, body, stepIds, href) {
    var heading = el("h3", null, [href ? el("a", { href: href, text: title }) : el("span", { text: title })]);
    var children = [el("p", { class: "eyebrow", text: kind }), heading];
    if (body) children.push(el("p", { class: "result-body", text: body }));
    var related = relatedStepLinks(stepIds);
    if (related) children.push(related);
    return el("article", { class: "card search-result" }, children);
  }

  /* 関連STEPへのリンク（既存のSTEPルートのみ使用）。該当がなければ null */
  function relatedStepLinks(stepIds) {
    var links = (stepIds || []).filter(function (id) { return findStep(id); }).map(function (id) {
      var s = findStep(id);
      return el("a", { href: "#/step/" + s.id, text: "STEP " + s.order + "：" + s.title });
    });
    if (!links.length) return null;
    var children = [el("span", { class: "related", text: "関連STEP：" })];
    links.forEach(function (a, i) {
      if (i > 0) children.push(el("span", { text: "・" }));
      children.push(a);
    });
    return el("p", { class: "result-related" }, children);
  }

  /* ---------- 画面：最終チェック ---------- */

  function viewFinal() {
    var done = completedCount();
    var total = state.steps.length;
    var list = el("ul", { class: "checklist-summary" });
    state.steps.forEach(function (s) {
      var complete = isStepComplete(s);
      list.appendChild(el("li", null, [
        el("a", { href: "#/step/" + s.id, text: "STEP " + s.order + "：" + s.title }),
        el("span", { text: complete ? "　完了" : "　未完了" })
      ]));
    });
    var children = [
      el("header", { class: "page-hero final-hero" }, [
        el("p", { class: "eyebrow", text: "FINISH LINE" }),
        el("h1", { text: "最終チェック" }),
        el("p", { class: "lead", text: "完了：" + done + " / " + total + " STEP" })
      ]),
      el("section", { class: "final-progress", "aria-label": "学習完了状況" }, [
        el("span", { class: "eyebrow", text: "YOUR PROGRESS" }),
        el("strong", { text: done + " / " + total }),
        el("span", { text: "STEP完了" })
      ]),
      el("section", { class: "final-list card", "aria-labelledby": "final-list-h" }, [
        el("h2", { id: "final-list-h", text: "STEPごとの確認状況" }),
        list
      ])
    ];
    if (state.quickstart) {
      var quickDone = quickstartCompletedCount();
      children.push(el("section", { class: "card", "aria-labelledby": "quick-final-h" }, [
        el("h2", { id: "quick-final-h", text: "最初の15分" }),
        el("p", { text: "実践の進捗：" + quickDone + " / " + state.quickstart.steps.length + " 項目" }),
        el("a", { class: "btn", href: "#/start", text: quickDone === state.quickstart.steps.length ? "実践を見直す →" : "実践を続ける →" })
      ]));
    }
    if (done === total) {
      children.push(el("p", { text: "STEP 0〜7の確認がすべて済みました。おつかれさまでした。" }));
    } else {
      children.push(el("p", { text: "未完了のSTEPは、上のリンクから確認を再開できます。" }));
    }
    var fl = linkByKey("freeNote");
    if (fl) children.push(el("p", null, [fl]));
    var line = linkByKey("officialLine");
    if (line) children.push(el("p", { text: "更新のお知らせは、任意で公式LINEから案内しています（登録は必須ではありません）。" }), el("p", null, [line]));
    return [el("div", { class: "final-page" }, children)];
  }

  /* ---------- 承認済み16章拡張：旧教材を参照する独立した学習経路 ---------- */
  var BOOKMARK_KEY = "claude-code-step:bookmarks:v1";
  var bookmarkIds = [];
  var bookmarkLoadWarning = "";

  function byId(items, id) { return items.find(function (x) { return x.id === id; }); }
  function extension() { return state.extension; }
  function chapterLinks(ids) {
    return el("div", { class: "extension-links" }, (ids || []).map(function (id) {
      var c = byId(extension().chapters, id);
      return c ? el("a", { href: "#/chapter/" + id, text: String(c.order).padStart(2, "0") + " " + c.title }) : null;
    }));
  }
  function missingPage() { return [el("h1", { text: "ページが見つかりません" }), el("a", { href: "#/chapters", text: "16章の一覧へ戻る" })]; }
  function extensionHeader(title, lead) {
    return el("header", { class: "page-hero extension-hero" }, [el("p", { class: "eyebrow", text: "CLAUDE CODE / LEARNING PATH" }), el("h1", { text: title }), lead ? el("p", { class: "lead", text: lead }) : null]);
  }
  function extensionMenu() {
    return el("nav", { class: "extension-menu", "aria-label": "16章と学習ツール" }, [
      ["chapters", "16章"], ["questions", "質問から探す"], ["prompts", "依頼文12件"], ["glossary", "用語辞典"], ["bookmarks", "保存した項目"], ["line", "LINE受け取り"], ["steps", "旧STEP 0〜7"], ["final", "最終チェック"]
    ].map(function (x) { return el("a", { href: "#/" + x[0], text: x[1] }); }));
  }
  function itemInfo(key) {
    var parts = key.split("/"), type = parts[0], id = parts[1], data;
    if (type === "prompt") { data = byId(extension().prompts, id); return data && { title: data.title, href: "#/prompt/" + id }; }
    if (type === "learn") { data = byId(extension().chapters, id); return data && { title: data.title + "：学ぶ", href: "#/chapter/" + id }; }
    if (type === "term" || type === "trouble") {
      data = byId(type === "term" ? extension().terms : extension().troubles, id);
      var source = data && (type === "term" ? state.glossary.items : state.glossary.troubles)[data.sourceIndex];
      return source && { title: source.term || source.question, href: "#/" + type + "/" + id };
    }
    return null;
  }
  function loadBookmarks() {
    try {
      var raw = localStorage.getItem(BOOKMARK_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.items)) throw new Error("invalid bookmarks");
      bookmarkIds = parsed.items.filter(function (key, i, all) { return typeof key === "string" && itemInfo(key) && all.indexOf(key) === i; });
      if (bookmarkIds.length !== parsed.items.length) bookmarkLoadWarning = "読み取れない保存項目を除いて表示しています。元データは自動削除していません。";
    } catch (e) { bookmarkLoadWarning = "保存項目を読み取れませんでした。教材は利用できます。次に保存できたときに一覧を作り直します。"; }
  }
  function bookmarkButton(key) {
    var button = el("button", { type: "button", class: "btn bookmark-button", "data-bookmark": key });
    var feedback = el("p", { class: "bookmark-feedback", role: "status" });
    function update() { var saved = bookmarkIds.indexOf(key) >= 0; button.setAttribute("aria-pressed", String(saved)); button.textContent = saved ? "保存を解除" : "この項目を保存"; }
    update();
    button.addEventListener("click", function () {
      var saved = bookmarkIds.indexOf(key) >= 0;
      var next = saved ? bookmarkIds.filter(function (id) { return id !== key; }) : bookmarkIds.concat(key);
      try {
        localStorage.setItem(BOOKMARK_KEY, JSON.stringify({ schemaVersion: 1, items: next }));
        bookmarkIds = next;
        bookmarkLoadWarning = "";
        update();
        feedback.textContent = saved ? "保存を解除しました。" : "この項目を保存しました。";
      } catch (e) { feedback.textContent = "保存できませんでした。保存状態は変更していません。ブラウザの保存設定や空き容量を確認してください。"; }
      say(feedback.textContent);
    });
    return el("div", { class: "bookmark-control" }, [button, feedback]);
  }
  function readingComplete(c) {
    return c.checkRefs.every(function (ref) {
      var item = ref.kind === "step" ? findStep(ref.id) : findQuickstartStep(ref.id);
      var checks = ref.kind === "step" ? getChecks(ref.id) : getQuickChecks(ref.id);
      return item && item.checklist.length && item.checklist.every(function (_, i) { return checks[i] === true; });
    });
  }
  function viewChapters() {
    return [extensionHeader("16章で学ぶ", "目的に合わせて選ぶ学習経路です。STEP 0〜7も引き続き利用できます。"), extensionMenu(),
      el("div", { class: "extension-grid" }, extension().chapters.map(function (c) {
        return el("article", { class: "card" }, [el("p", { class: "eyebrow", text: "CHAPTER " + String(c.order).padStart(2, "0") }), el("h2", null, [el("a", { href: "#/chapter/" + c.id, "data-chapter-link": c.id, text: c.title })]), el("p", { text: c.summary }), el("p", { text: readingComplete(c) ? "読了（既存チェック連動）" : "学習中（既存チェック連動）" })]);
      }))];
  }
  function viewChapter(id) {
    var c = byId(extension().chapters, id);
    if (!c) return missingPage();
    var reading = el("p", { class: "reading-state", "data-reading": "", text: readingComplete(c) ? "読了（既存チェック連動）" : "学習中（既存チェック連動）" });
    var toc = el("details", { class: "extension-toc card" }, [el("summary", { text: "この章の目次" }), el("nav", { class: "extension-links", "aria-label": "この章の目次" }, [ ["learn","学ぶ"],["terms","用語"],["exercise","やってみる"],["request","依頼文"],["checks","チェック"] ].map(function (x) {
      var a = el("a", { href: "#section-" + x[0], text: x[1] });
      a.addEventListener("click", function (ev) { ev.preventDefault(); var target = document.getElementById("section-" + x[0]); target.focus(); target.scrollIntoView(); }); return a;
    }))]);
    function section(id, title, children) { return el("section", { id: "section-" + id, tabindex: "-1", class: "card" }, [el("h2", { text: title })].concat(children)); }
    var checkSection = section("checks", "既存チェックと読了", [el("p", { text: "関連する旧教材のチェックをそのまま共有します。すべてのチェックが付くと、この章も読了になります。" }), reading]);
    c.checkRefs.forEach(function (ref) {
      var item = ref.kind === "step" ? findStep(ref.id) : findQuickstartStep(ref.id);
      var checks = ref.kind === "step" ? getChecks(ref.id) : getQuickChecks(ref.id);
      checkSection.appendChild(el("h3", null, [el("a", { href: ref.kind === "step" ? "#/step/" + ref.id : "#/start", text: item.title })]));
      var list = el("ul", { class: "checklist extension-checklist" });
      item.checklist.forEach(function (text, index) {
        var cid = "ext-" + ref.id + "-" + index;
        var input = el("input", { type: "checkbox", id: cid, checked: checks[index] === true });
        input.addEventListener("change", function () {
          if (ref.kind === "step") setCheck(ref.id, index, input.checked); else setQuickCheck(ref.id, index, input.checked);
          reading.textContent = readingComplete(c) ? "読了（既存チェック連動）" : "学習中（既存チェック連動）";
          say(state.storageOk ? "チェックを保存しました。" : "チェックはこの画面内だけで有効です。進捗を保存できませんでした。");
        });
        list.appendChild(el("li", null, [input, el("label", { for: cid, text: text })]));
      });
      checkSection.appendChild(list);
    });
    var prompt = byId(extension().prompts, c.promptId);
    var body = [extensionHeader(String(c.order).padStart(2, "0") + " " + c.title, c.summary), extensionMenu(), toc,
      section("learn", "学ぶ", c.learn.map(function (text) { return el("p", { text: text }); }).concat([bookmarkButton("learn/" + id), el("h3", { text: "既存教材を読む" }), relatedStepLinks(c.stepIds)].concat(c.quickIds.length ? [el("a", { href: "#/start", text: "最初の15分の4項目へ" })] : []))),
      section("terms", "用語", [el("div", { class: "extension-links" }, c.termIds.map(function (id) { var t = byId(extension().terms, id); return el("a", { href: "#/term/" + id, text: state.glossary.items[t.sourceIndex].term }); })), el("a", { href: "#/glossary", text: "用語辞典を開く" })]),
      section("exercise", "やってみる", [el("p", { text: c.exercise })]),
      section("request", "コピー可能な依頼文", [el("p", { text: prompt.useCase }), renderPrompt(prompt.text), el("a", { href: "#/prompt/" + prompt.id, text: "この依頼文を保存・詳しく見る" })]), checkSection];
    if (c.order === 9) body.push(troubleCards());
    if (c.order === 11 || c.order === 15) body.push(el("section", { class: "card" }, [el("h2", { text: "公式で確かめる" })].concat(extension().officialSources.map(function (src) { return el("p", null, [isAllowedExternal(src.url) ? externalLink(src.title, src.url) : null, el("span", { text: "確認日：" + src.checkedAt + " / " + src.scope })]); }))));
    if (c.order === 16) body.push(el("p", null, [el("a", { class: "btn", href: "#/glossary", text: "同じ16用語を辞典で読む" })]));
    body.push(el("details", { class: "card" }, [el("summary", { text: "再利用元と追加した内容" }), el("ul", null, c.sourceRefs.map(function (src) { return el("li", { text: src }); }))]));
    body.push(el("nav", { class: "pager", "aria-label": "章の移動" }, [c.order > 1 ? el("a", { class: "btn", href: "#/chapter/" + extension().chapters[c.order-2].id, text: "← 前の章" }) : el("a", { href: "#/chapters", text: "16章の一覧へ" }), c.order < 16 ? el("a", { class: "btn primary", href: "#/chapter/" + extension().chapters[c.order].id, text: "次の章 →" }) : el("a", { class: "btn", href: "#/final", text: "最終チェックへ" })]));
    return [el("div", { class: "extension-page" }, body)];
  }
  function viewPrompts(id) {
    var prompts = id ? extension().prompts.filter(function (p) { return p.id === id; }) : extension().prompts;
    if (!prompts.length) return missingPage();
    return [extensionHeader(id ? prompts[0].title : "依頼文ライブラリ", "用途を読んで選び、本文だけをコピーします。実際の対象・条件に合わせてから送ってください。"), extensionMenu(), el("div", { class: "extension-items" }, prompts.map(function (p) {
      // renderPrompt uses fixed heading IDs for legacy single-prompt pages; rename per card here.
      var card = renderPrompt(p.text); card.querySelector("h3").id = "prompt-" + p.id; card.setAttribute("aria-labelledby", "prompt-" + p.id);
      return el("article", { class: "card" }, [el("h2", null, [el("a", { href: "#/prompt/" + p.id, text: p.title })]), el("p", { text: p.useCase }), card, bookmarkButton("prompt/" + p.id), chapterLinks(p.chapterIds), el("p", { class: "meta", text: "再利用元：" + p.sourceRef })]);
    }))];
  }
  function viewTerms(id) {
    var terms = id ? extension().terms.filter(function (t) { return t.id === id; }) : extension().terms;
    if (!terms.length) return missingPage();
    return [extensionHeader(id ? state.glossary.items[terms[0].sourceIndex].term : "用語辞典", "旧教材と同じ16用語を、関連章と一緒に引けます。"), extensionMenu(), el("div", { class: "extension-grid" }, terms.map(function (t) {
      var src = state.glossary.items[t.sourceIndex];
      return el("article", { class: "card" }, [el("h2", null, [el("a", { href: "#/term/" + t.id, text: src.term })]), el("p", { text: src.meaning }), bookmarkButton("term/" + t.id), chapterLinks(t.chapterIds), relatedStepLinks(src.stepIds)]);
    }))];
  }
  function troubleCards(id) {
    return el("section", { class: "extension-items", "aria-label": "困りごと" }, extension().troubles.filter(function (t) { return !id || t.id === id; }).map(function (t) {
      var src = state.glossary.troubles[t.sourceIndex];
      return el("article", { class: "card" }, [el("h2", null, [el("a", { href: "#/trouble/" + t.id, text: src.question })]), el("p", { text: src.answer }), bookmarkButton("trouble/" + t.id), chapterLinks(t.chapterIds), relatedStepLinks(src.stepIds)]);
    }));
  }
  function viewQuestions(selected) {
    var answer = el("section", { class: "card question-answer", "aria-live": "polite" });
    var buttons = state.questions.map(function (q) {
      var button = el("button", { class: "btn", type: "button", "data-question": q.id, "aria-pressed": "false", text: q.label });
      function select() {
        buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); });
        var m = extension().questionMappings.find(function (m) { return m.questionId === q.id; });
        answer.replaceChildren(el("h2", { text: q.label }), el("p", { text: q.description }), chapterLinks(m ? m.chapterIds : []), el("a", { href: "#/search?q=" + encodeURIComponent(q.query), text: "既存の検索結果も見る" }));
      }
      button.addEventListener("click", select);
      return button;
    });
    var match = state.questions.findIndex(function (q) { return q.id === selected; });
    if (match >= 0) buttons[match].click(); else answer.appendChild(el("p", { text: "質問を選ぶと関連する章がここに表示されます。" }));
    return [extensionHeader("質問から探す", "4つの疑問から、今読みたい章を選べます。"), extensionMenu(), el("div", { class: "extension-links" }, buttons), answer, troubleCards()];
  }
  function viewBookmarks() {
    return [extensionHeader("保存した教材項目", "依頼文・用語・困りごと・各章の「学ぶ」を保存できます。"), extensionMenu(), bookmarkLoadWarning ? el("p", { class: "note", text: bookmarkLoadWarning }) : null,
      bookmarkIds.length ? el("div", { class: "extension-grid" }, bookmarkIds.map(function (key) { var info = itemInfo(key); return el("article", { class: "card" }, [el("h2", null, [el("a", { href: info.href, text: info.title })]), bookmarkButton(key)]); })) : el("p", { text: "保存した項目はまだありません。教材の「この項目を保存」から追加できます。" })];
  }
  function viewLine(slug) {
    if (!slug) return [extensionHeader("LINEで受け取る", "最初の一回・安全な頼み方・完成確認の3テーマです。"), extensionMenu(), el("div", { class: "extension-grid" }, extension().lineThemes.map(function (t) { return el("article", { class: "card" }, [el("h2", null, [el("a", { href: "#/line/" + t.slug, text: t.title })]), el("p", { text: t.problem })]); }))];
    var t = extension().lineThemes.find(function (t) { return t.slug === slug; }); if (!t) return missingPage();
    var config = state.config.links[t.lineUrl];
    var link = linkByKey(t.lineUrl);
    var keyword = el("button", { class: "btn primary", type: "button", "data-keyword-copy": "", text: "「" + t.keyword + "」をコピー" });
    keyword.addEventListener("click", function () { copyText(t.keyword, keyword); });
    function list(items) { return el("ol", null, items.map(function (text) { return el("li", { text: text }); })); }
    return [el("div", { class: "extension-page line-page" }, [
      extensionHeader(t.title, t.problem), extensionMenu(),
      el("section", { class: "card", "data-line-section": "cases" }, [el("h2", { text: "こんな3つの場面で" }), el("div", { class: "extension-grid" }, t.useCases.map(function (text) { return el("article", { class: "card line-use-case" }, [el("h3", { text: text })]); }))]),
      el("section", { class: "card", "data-line-section": "boundary" }, [el("h2", { text: "使い分けの目安" }), el("p", { text: t.boundary })]),
      el("section", { class: "card", "data-line-section": "receive" }, [el("h2", { text: "LINE受け取り3ステップ" }), el("h3", { text: t.resourceTitle }), el("p", { text: t.resourceDescription }), el("p", { text: "版番号：" + (t.resourceVersion || "未確認") + " / 更新日：" + (t.resourceUpdatedAt || "未確認") }), el("p", { text: "配布物の実体・版情報は確認待ちです。" }), el("p", { class: "meta", text: "参照元：" + t.resourceSource }), list(["公式LINEを開く", "友だち追加する（追加済みならトークを開く）", "キーワード「" + t.keyword + "」を送る"]), el("p", { text: "トークでキーワードを送ると配布物が届きます。" }), link, keyword]),
      el("section", { class: "card", "data-line-section": "devices" }, [el("h2", { text: "スマホ・PCから受け取る" }), el("div", { class: "extension-grid" }, [el("article", null, [el("h3", { text: "スマホの方" }), list(t.mobileInstructions)]), el("article", null, [el("h3", { text: "PCの方" }), el("img", { class: "line-qr", src: "assets/images/line-qr.png", width: "290", height: "290", alt: "公式LINEをスマホで開くQRコード。下のURLからも開けます。" }), config && config.enabled && isAllowedExternal(config.url) ? el("p", null, [externalLink(config.url, config.url)]) : null, list(t.desktopInstructions)])])]),
      el("section", { class: "card", "data-line-section": "related" }, [el("h2", { text: "関連する教材へ戻る" }), chapterLinks(t.relatedChapters), relatedStepLinks(t.stepIds), el("p", null, [el("a", { href: "#/start", text: "最初の15分へ" })]), el("img", { class: "extension-tora", src: "assets/images/characters/step-character-07-tora-dialogue.png", alt: "TORAと一緒に教材へ戻ろう", loading: "lazy" })])
    ])];
  }
  function extensionSearch(query) {
    var lower = query.toLowerCase(), children = [];
    [["16章", extension().chapters, function(c){return c.title+' '+c.summary+' '+c.learn.join(' ')+' '+c.exercise;}, "chapter"], ["依頼文", extension().prompts, function(p){return p.title+' '+p.useCase+' '+p.text;}, "prompt"]].forEach(function (group) {
      var hits = group[1].filter(function (x) { return group[2](x).toLowerCase().indexOf(lower) >= 0; });
      children.push(el("h2", { text: group[0] + "（" + hits.length + "件）" }));
      children.push(el("div", { class: "search-results", "data-extension-search": group[3] }, hits.map(function (x) { return resultCard(group[0], x.title, x.summary || x.useCase, null, "#/" + group[3] + "/" + x.id); })));
    });
    return children;
  }

  /* ---------- ルーター ---------- */

  function route() {
    var raw = location.hash.replace(/^#/, "") || "/";
    var parts = raw.split("?");
    var path = parts[0];
    var query = "";
    if (parts[1]) {
      var m = parts[1].match(/(?:^|&)q=([^&]*)/);
      if (m) { try { query = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { query = ""; } }
    }

    var content;
    var focusTitle = true;
    var titleText = "Claude CodeのSTEP";
    if (path === "/chapters") {
      content = viewChapters(); titleText = "16章で学ぶ";
    } else if (path.indexOf("/chapter/") === 0) {
      content = viewChapter(path.slice(9)); var chapter = byId(extension().chapters, path.slice(9)); if (chapter) titleText = chapter.title;
    } else if (path === "/prompts" || path.indexOf("/prompt/") === 0) {
      content = viewPrompts(path === "/prompts" ? null : path.slice(8)); titleText = "依頼文ライブラリ";
    } else if (path === "/glossary" || path.indexOf("/term/") === 0) {
      content = viewTerms(path === "/glossary" ? null : path.slice(6)); titleText = "用語辞典";
    } else if (path.indexOf("/trouble/") === 0) {
      var troubleId = path.slice(9);
      content = byId(extension().troubles, troubleId) ? [extensionHeader("困りごと", "既存教材の回答と関連章"), extensionMenu(), troubleCards(troubleId)] : missingPage(); titleText = "困りごと";
    } else if (path === "/questions") {
      content = viewQuestions(query); titleText = "質問から探す";
    } else if (path === "/bookmarks") {
      content = viewBookmarks(); titleText = "保存した項目";
    } else if (path === "/line" || path.indexOf("/line/") === 0) {
      content = viewLine(path === "/line" ? null : path.slice(6)); titleText = "LINE受け取り";
    } else if (path === "/" || path === "") {
      content = viewHome();
    } else if (path === "/start") {
      content = viewQuickstart();
      titleText = "最初の15分";
    } else if (path === "/steps") {
      content = viewStepList();
    } else if (path.indexOf("/step/") === 0) {
      var id = path.slice("/step/".length);
      content = viewStep(id);
      var s = findStep(id);
      if (s) titleText = "STEP " + s.order + "：" + s.title;
    } else if (path === "/search") {
      content = viewSearch(query);
    } else if (path === "/final") {
      content = viewFinal();
    } else {
      content = [el("h1", { text: "ページが見つかりません" }), el("a", { class: "btn", href: "#/", text: "トップへ戻る" })];
    }

    app.innerHTML = "";
    content.forEach(function (node) { if (node) app.appendChild(node); });
    document.title = titleText + " | Claude CodeのSTEP";
    if (window.stepAnalytics) window.stepAnalytics.view();
    updateNav(path);
    if (focusTitle) {
      var h1 = app.querySelector("h1");
      if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: false }); }
    }
    window.scrollTo(0, 0);
  }

  function updateNav(path) {
    var links = document.querySelectorAll("[data-nav]");
    for (var i = 0; i < links.length; i++) {
      var key = links[i].getAttribute("data-nav");
      var active = (key === "home" && (path === "/" || path === "")) ||
                   (key === "start" && path === "/start") ||
                   (key === "steps" && (path === "/steps" || path.indexOf("/step/") === 0)) ||
                   (key === "search" && path === "/search") ||
                   (key === "chapters" && (path === "/chapters" || path.indexOf("/chapter/") === 0)) ||
                   (key === "final" && path === "/final");
      if (active) links[i].setAttribute("aria-current", "page");
      else links[i].removeAttribute("aria-current");
    }
  }

  /* ---------- 起動 ---------- */

  function fetchJson(name) {
    return fetch(DATA_DIR + name, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(name + " " + r.status);
      return r.json();
    });
  }

  function showFatal(message) {
    app.innerHTML = "";
    app.appendChild(el("h1", { text: "教材を読み込めませんでした" }));
    app.appendChild(el("p", { text: message }));
    app.appendChild(el("p", { text: "このアプリは data/ フォルダの教材データを読み込みます。README.md の「ローカルで開く」を参照し、Webサーバー経由で開いてください。" }));
  }

  /* スキップリンクはハッシュルーターと衝突させない（#app へ遷移すると画面が壊れるため） */
  function bindSkipLink() {
    var skip = document.querySelector(".skip");
    if (!skip) return;
    skip.addEventListener("click", function (e) {
      e.preventDefault();
      app.focus();
      app.scrollIntoView({ block: "start" });
    });
  }

  function start() {
    bindSkipLink();
    var progressOk = loadProgress();
    var quickOk = loadQuickstartProgress();
    state.storageOk = progressOk && quickOk;
    if (!state.storageOk && storeNotice) storeNotice.hidden = false;
    Promise.all([fetchJson("steps.json"), fetchJson("glossary.json"), fetchJson("config.json"), fetchJson("quickstart.json"), fetchJson("questions.json"), fetchJson("extension.json")])
      .then(function (res) {
        state.steps = (res[0].steps || []).slice().sort(function (a, b) { return a.order - b.order; });
        state.glossary = res[1];
        state.config = res[2];
        state.quickstart = res[3];
        state.questions = res[4].questions || [];
        state.extension = res[5];
        loadBookmarks();
        window.addEventListener("hashchange", route);
        if (!location.hash) location.hash = "#/";
        route();
      }, function (err) {
        /* 読み込み失敗のみこの案内を出す（描画時の例外と区別する） */
        showFatal("読み込みエラー：" + err.message);
      });
  }

  start();
})();
