/* Claude CodeのSTEP｜MVP
 * - 静的Web。バックエンド・外部スクリプトなし。
 * - 教材本文は data/*.json から読み込み、textContent / createElement のみで描画する（HTML注入を防ぐ）。
 * - 進捗（チェック状態）だけを localStorage に保存する。保存できなくても学習は継続できる。
 */
(function () {
  "use strict";

  var DATA_DIR = "data/";
  var STORAGE_KEY = "claude-code-step:progress:v1";
  var QUICKSTART_STORAGE_KEY = "claude-code-step:quickstart:v1";
  var TOTAL_LABEL = "STEP 0〜7";

  var state = {
    steps: [],
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

  function loadProgress() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.checks) {
          state.progress = parsed;
        }
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
        if (parsed && typeof parsed === "object" && parsed.checks) {
          state.quickstartProgress = parsed;
        }
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
        location.hash = "#/search?q=" + encodeURIComponent(q.query);
      });
      chips.appendChild(button);
    });
    return el("section", { class: "card question-entry", "aria-labelledby": "question-entry-h" }, [
      el("h2", { id: "question-entry-h", text: "今の疑問から探す" }),
      el("p", { text: "質問を1つ選ぶと、既存の用語・困りごと検索へ移動します。" }),
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
        say(input.checked ? "最初の15分の確認を保存しました。" : "確認を外しました。");
        if (isQuickstartStepComplete(item)) say("この実践項目の確認がすべて済みました。");
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
      el("p", { class: "crumb", text: "P1｜最初の15分" }),
      el("h1", { text: state.quickstart.title }),
      el("p", { class: "lead", text: state.quickstart.summary }),
      el("div", { class: "quickstart-progress", role: "status", text: "実践の進捗：" + done + " / " + items.length + " 項目" }),
      el("p", { class: "note", text: "このコースは練習用フォルダで行います。大事なファイルや個人情報は入れず、公開もしないでください。" }),
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
    var children = [hero, stats, homeRoadmap(), lab, facts, progress, questionChips(), guideCard(), el("p", { class: "note home-note", text: state.config.siteNote })];
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
    return [
      el("h1", { text: "STEP一覧" }),
      el("p", { class: "lead", text: TOTAL_LABEL + "を順番に進めます。完了済みのSTEPには「完了」と表示されます。" }),
      list
    ];
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
        say(input.checked ? "チェックを保存しました。" : "チェックを外しました。");
        if (isStepComplete(step)) say("このSTEPの確認が全て済みました。");
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
    return [el("div", { class: "lesson-page" }, [
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
      el("h1", { text: "最終チェック" }),
      el("p", { class: "lead", text: "完了：" + done + " / " + total + " STEP" }),
      list
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
    if (path === "/" || path === "") {
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
    state.storageOk = loadProgress() && loadQuickstartProgress();
    if (!state.storageOk && storeNotice) storeNotice.hidden = false;
    Promise.all([fetchJson("steps.json"), fetchJson("glossary.json"), fetchJson("config.json"), fetchJson("quickstart.json"), fetchJson("questions.json")])
      .then(function (res) {
        state.steps = (res[0].steps || []).slice().sort(function (a, b) { return a.order - b.order; });
        state.glossary = res[1];
        state.config = res[2];
        state.quickstart = res[3];
        state.questions = res[4].questions || [];
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
