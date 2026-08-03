/**
 * 40-ui.js — サンプルデータ・DOM・描画・時差・チェックリスト・CRUD・ドラッグ
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

/* =========================================================
 * サンプルデータ
 * ========================================================= */
function createSampleTrip() {
  var items = [
    { id: genId(), cat: "sight", name: "浅草寺", loc: "", dur: 90, note: "雷門で写真", priv: false, notePriv: false, fixedStart: null, lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {}, noteNames: {} },
    { id: genId(), cat: "move", name: "浅草寺 → 上野公園", loc: "", dur: 25, note: "", priv: false, notePriv: false, fixedStart: null, lat: null, lon: null, coordSrc: null, mode: "train", distKm: 6.2, auto: true, arriveTz: "", names: {}, noteNames: {} },
    { id: genId(), cat: "sight", name: "上野公園", loc: "", dur: 60, note: "散策", priv: false, notePriv: false, fixedStart: null, lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {}, noteNames: {} },
    { id: genId(), cat: "meal", name: "上野でランチ", loc: "", dur: 60, note: "", priv: false, notePriv: false, fixedStart: null, lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {}, noteNames: {} },
    { id: genId(), cat: "stay", name: "三井ガーデンホテル上野", loc: "", dur: 0, note: "チェックイン15:00", priv: false, notePriv: false, fixedStart: "15:00", lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {}, noteNames: {} }
  ];
  return {
    v: 1,
    title: "東京旅行",
    titles: Object.assign({}, window.I18N.SAMPLE_TRIP_TITLES),
    lang: "ja",
    days: [{ id: genId(), date: "2026-07-20", startTime: "09:00", tz: "", priv: false, dateManual: false, items: items }],
    packing: [],
    todos: [],
    packingPriv: false,
    todosPriv: false
  };
}

// 複数しおりの管理（9）: 「＋ 新しいしおり」で作成する空のしおり。タイトルは現在言語のデフォルトを4言語プリセット
function createBlankTripData() {
  return {
    v: 1,
    title: window.I18N.NEW_TRIP_TITLES.ja,
    titles: Object.assign({}, window.I18N.NEW_TRIP_TITLES),
    lang: lang(),
    days: [{ id: genId(), date: "", startTime: "09:00", tz: "", priv: false, dateManual: false, items: [] }],
    packing: [],
    todos: [],
    packingPriv: false,
    todosPriv: false
  };
}

/* =========================================================
 * DOM キャッシュ
 * ========================================================= */
function cacheDom() {
  el.appHeader = document.querySelector(".app-header");
  el.tripTitle = document.getElementById("tripTitle");
  el.langSelect = document.getElementById("langSelect");
  el.shareBtn = document.getElementById("shareBtn");
  el.textioBtn = document.getElementById("textioBtn");
  el.dayTabs = document.getElementById("dayTabs");
  el.addDayBtn = document.getElementById("addDayBtn");
  el.dayDateInput = document.getElementById("dayDateInput");
  el.dayDateAutoBadge = document.getElementById("dayDateAutoBadge");
  el.dayStartTimeInput = document.getElementById("dayStartTimeInput");
  el.dayTzSelect = document.getElementById("dayTzSelect");
  // 非公開マーク（14拡張）: 日単位の🔓/🔒トグルとバッジ
  el.dayPrivToggle = document.getElementById("dayPrivToggle");
  el.dayPrivBadge = document.getElementById("dayPrivBadge");
  el.printBtn = document.getElementById("printBtn");
  el.routeBtn = document.getElementById("routeBtn");
  el.routeBtnLabel = document.getElementById("routeBtnLabel");
  el.timeline = document.getElementById("timeline");
  el.emptyDayMsg = document.getElementById("emptyDayMsg");
  el.addFormCats = document.getElementById("addFormCats");
  el.addName = document.getElementById("addName");
  el.addDur = document.getElementById("addDur");
  el.addDurUnit = document.getElementById("addDurUnit");
  el.addNote = document.getElementById("addNote");
  el.addBtn = document.getElementById("addBtn");

  // 持ち物リスト・やることリスト（10）: タイムライン下（メイン）
  el.packingSection = document.getElementById("packingSection");
  el.packingItems = document.getElementById("packingItems");
  el.packingEmptyMsg = document.getElementById("packingEmptyMsg");
  el.packingProgress = document.getElementById("packingProgress");
  el.packingAddInput = document.getElementById("packingAddInput");
  el.packingAddBtn = document.getElementById("packingAddBtn");
  el.todosSection = document.getElementById("todosSection");
  el.todosItems = document.getElementById("todosItems");
  el.todosEmptyMsg = document.getElementById("todosEmptyMsg");
  el.todosProgress = document.getElementById("todosProgress");
  el.todosAddInput = document.getElementById("todosAddInput");
  el.todosAddBtn = document.getElementById("todosAddBtn");
  // 非公開マーク（14拡張）: リスト全体単位の🔓/🔒トグルとバッジ（メイン）
  el.packingListPrivToggle = document.getElementById("packingListPrivToggle");
  el.packingListPrivBadge = document.getElementById("packingListPrivBadge");
  el.todosListPrivToggle = document.getElementById("todosListPrivToggle");
  el.todosListPrivBadge = document.getElementById("todosListPrivBadge");

  // 準備リストへのクイックアクセス（11）: ヘッダーの🧳ボタン・準備モーダル内の同UI
  el.prepBtn = document.getElementById("prepBtn");
  el.prepBadge = document.getElementById("prepBadge");
  el.prepModal = document.getElementById("prepModal");
  el.prepPackingSection = document.getElementById("prepPackingSection");
  el.prepPackingItems = document.getElementById("prepPackingItems");
  el.prepPackingEmptyMsg = document.getElementById("prepPackingEmptyMsg");
  el.prepPackingProgress = document.getElementById("prepPackingProgress");
  el.prepPackingAddInput = document.getElementById("prepPackingAddInput");
  el.prepPackingAddBtn = document.getElementById("prepPackingAddBtn");
  el.prepTodosSection = document.getElementById("prepTodosSection");
  el.prepTodosItems = document.getElementById("prepTodosItems");
  el.prepTodosEmptyMsg = document.getElementById("prepTodosEmptyMsg");
  el.prepTodosProgress = document.getElementById("prepTodosProgress");
  el.prepTodosAddInput = document.getElementById("prepTodosAddInput");
  el.prepTodosAddBtn = document.getElementById("prepTodosAddBtn");
  // 非公開マーク（14拡張）: リスト全体単位の🔓/🔒トグルとバッジ（準備モーダル）
  el.prepPackingListPrivToggle = document.getElementById("prepPackingListPrivToggle");
  el.prepPackingListPrivBadge = document.getElementById("prepPackingListPrivBadge");
  el.prepTodosListPrivToggle = document.getElementById("prepTodosListPrivToggle");
  el.prepTodosListPrivBadge = document.getElementById("prepTodosListPrivBadge");

  el.shareModal = document.getElementById("shareModal");
  el.shareUrl = document.getElementById("shareUrl");
  el.shareCopyBtn = document.getElementById("shareCopyBtn");
  // 非公開マークと公開用データ（14）: 公開プレビューモーダル
  el.sharePreviewBtn = document.getElementById("sharePreviewBtn");
  el.publicPreviewModal = document.getElementById("publicPreviewModal");
  el.publicPreviewContent = document.getElementById("publicPreviewContent");
  el.publicPreviewExcluded = document.getElementById("publicPreviewExcluded");

  // 共有（7・16統合）: ログイン時は #p= 方式（クラウド・固定スナップショット）、未ログイン時は #d= 方式
  // （URL埋め込み）に自動切替する。sharePublicSection は「固定方式」の補足説明・更新・停止のみを担う
  // （URL自体は共通の shareUrl/shareCopyBtn に表示する）
  el.sharePublicSection = document.getElementById("sharePublicSection");
  el.sharePublicExcluded = document.getElementById("sharePublicExcluded");
  // 共有中の内容を今の状態に更新するボタン（固定方式のため必要）
  el.sharePublicRefreshBtn = document.getElementById("sharePublicRefreshBtn");
  // 共有を停止（publicTrips のクラウドコピーを削除する。プライバシー上の取り消し導線）
  el.sharePublicStopBtn = document.getElementById("sharePublicStopBtn");
  el.shareLoginHint = document.getElementById("shareLoginHint");

  // 編集できる共有リンク（18）: 共有モーダルの「✏️ 編集できるリンクを発行」セクション（ログイン時のみ）
  el.shareEditSection = document.getElementById("shareEditSection");
  el.shareEditToggle = document.getElementById("shareEditToggle");
  el.shareEditBadge = document.getElementById("shareEditBadge");
  el.shareEditUrlWrap = document.getElementById("shareEditUrlWrap");
  el.shareEditUrl = document.getElementById("shareEditUrl");
  el.shareEditCopyBtn = document.getElementById("shareEditCopyBtn");
  el.shareEditLoginHint = document.getElementById("shareEditLoginHint");

  // 公開層と公開URL（16）: #p=<publicId> 読み取り専用モードのヘッダー表示
  el.viewOnlyBanner = document.getElementById("viewOnlyBanner");
  el.viewOnlyBackBtn = document.getElementById("viewOnlyBackBtn");

  // 編集できる共有リンク（18）: #e=<editId> 共同編集モードのヘッダー表示
  el.collabBanner = document.getElementById("collabBanner");
  el.collabBackBtn = document.getElementById("collabBackBtn");

  el.textioModal = document.getElementById("textioModal");
  el.textioArea = document.getElementById("textioArea");
  el.textioCopyBtn = document.getElementById("textioCopyBtn");
  el.textioLoadBtn = document.getElementById("textioLoadBtn");
  el.textioDownloadBtn = document.getElementById("textioDownloadBtn");
  el.textioOpenFileBtn = document.getElementById("textioOpenFileBtn");
  el.textioFileInput = document.getElementById("textioFileInput");

  el.tripsBtn = document.getElementById("tripsBtn");
  el.tripsModal = document.getElementById("tripsModal");
  el.tripsList = document.getElementById("tripsList");
  el.tripsNewBtn = document.getElementById("tripsNewBtn");
  // しおりのアーカイブ（11）
  el.tripsArchiveToggleBtn = document.getElementById("tripsArchiveToggleBtn");
  el.tripsArchiveToggleLabel = document.getElementById("tripsArchiveToggleLabel");
  el.tripsArchivedList = document.getElementById("tripsArchivedList");
  el.tripsSyncStatus = document.getElementById("tripsSyncStatus");

  // Google ログイン＋Firestore クラウド保存（15）
  el.authBtn = document.getElementById("authBtn");
  el.authBtnContent = document.getElementById("authBtnContent");
  el.authModal = document.getElementById("authModal");
  el.authEmail = document.getElementById("authEmail");
  el.authLogoutBtn = document.getElementById("authLogoutBtn");

  el.settingsBtn = document.getElementById("settingsBtn");
  el.settingsModal = document.getElementById("settingsModal");
  el.settingsApiKeyInput = document.getElementById("settingsApiKeyInput");
  el.settingsSaveBtn = document.getElementById("settingsSaveBtn");
  el.settingsDeleteBtn = document.getElementById("settingsDeleteBtn");
  el.tripCountdown = document.getElementById("tripCountdown");
  el.syncStatus = document.getElementById("syncStatus");
  el.settingsBackupBtn = document.getElementById("settingsBackupBtn");
  el.settingsRestoreBtn = document.getElementById("settingsRestoreBtn");
  el.settingsRestoreInput = document.getElementById("settingsRestoreInput");

  el.confirmModal = document.getElementById("confirmModal");
  el.confirmTitle = document.getElementById("confirmTitle");
  el.confirmBody = document.getElementById("confirmBody");
  el.confirmCancelBtn = document.getElementById("confirmCancelBtn");
  el.confirmOkBtn = document.getElementById("confirmOkBtn");

  el.toastContainer = document.getElementById("toastContainer");

  el.mapSection = document.getElementById("mapSection");
  el.mapToggleBtn = document.getElementById("mapToggleBtn");
  el.mapPanel = document.getElementById("mapPanel");
  el.mapContainer = document.getElementById("mapContainer");
  el.mapNoCoordsMsg = document.getElementById("mapNoCoordsMsg");
  el.mapUpdateBtn = document.getElementById("mapUpdateBtn");
  el.mapUpdateBtnLabel = document.getElementById("mapUpdateBtnLabel");
}

/* =========================================================
 * 描画
 * ========================================================= */
function render() {
  if (currentDayIndex >= trip.days.length) currentDayIndex = trip.days.length - 1;
  if (currentDayIndex < 0) currentDayIndex = 0;

  window.I18N.applyLanguage(lang());
  applyExtraI18n();
  applyViewOnlyUI();
  applyCollabModeUI();

  renderHeader();
  renderDayTabs();
  renderDayMeta();
  renderTimeline();
  renderAddForm();
  renderChecklists();
  updateMap();
  updateMapStickyOffset();
  if (el.tripsModal && !el.tripsModal.classList.contains("hidden")) renderTripsList();
  renderAuthUI();

  el.langSelect.value = lang();
}

// しおりデータの多言語タイトル（6e）: titles[現在言語] || title を返す。
// ヘッダーのタイトル表示・しおり一覧・共有/テキスト出力のいずれもこれを共用する
function tripDisplayTitle(data) {
  var tt = data && data.titles;
  var base = (tt && tt.ja) || (data && data.title) || "";
  if (tt && typeof tt[lang()] === "string" && tt[lang()]) {
    // 新規しおりの初期値（例: "New Trip"）が残っているだけで、ベースタイトルは既に
    // 実名が付いている場合は、初期値ではなくベースタイトルを表示する。
    // （そのままだと翻訳前・APIキー未設定の間ずっと "New Trip" と表示され、実際の
    //   しおり名が見えなくなる。ベースタイトルも初期値のままなら本当に新規しおりなので
    //   その言語の初期値をそのまま使う）
    var isDefault = tt[lang()] === window.I18N.NEW_TRIP_TITLES[lang()];
    var baseIsDefault = base === window.I18N.NEW_TRIP_TITLES.ja;
    if (isDefault && !baseIsDefault) return base;
    return tt[lang()];
  }
  return (data && data.title) || "";
}

function applyExtraI18n() {
  document.querySelectorAll("[data-cat-label]").forEach(function (node) {
    var cat = node.getAttribute("data-cat-label");
    node.textContent = window.I18N.CAT_NAMES[lang()][cat];
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(function (node) {
    var key = node.getAttribute("data-i18n-aria");
    node.setAttribute("aria-label", t(key));
  });
  if (el.tripTitle) {
    el.tripTitle.setAttribute("data-placeholder", t("header.titlePlaceholder"));
  }
}

// 公開層と公開URL（16）: 読み取り専用モードの共通UI（バナー・編集系ボタン群の非表示・タイトル編集不可化）。
// 個々のカード・チェックリスト行はビルド時（buildItemCard/buildChecklistRow）に readOnly/disabled を反映し、
// ボタン類の表示/非表示はCSSの .view-only-mode スコープで一括制御する（styles.css参照）
function applyViewOnlyUI() {
  document.body.classList.toggle("view-only-mode", viewOnly);
  if (el.viewOnlyBanner) el.viewOnlyBanner.classList.toggle("hidden", !viewOnly);
  // contentEditable プロパティ代入ではなく属性を直接書き換える（属性/プロパティ反映の環境差を避けるため）
  if (el.tripTitle) el.tripTitle.setAttribute("contenteditable", viewOnly ? "false" : "true");
  if (el.dayDateInput) el.dayDateInput.readOnly = viewOnly;
  if (el.dayStartTimeInput) el.dayStartTimeInput.readOnly = viewOnly;
  if (el.dayTzSelect) el.dayTzSelect.disabled = viewOnly;
  if (el.textioArea) el.textioArea.readOnly = viewOnly;
  if (el.textioLoadBtn) el.textioLoadBtn.disabled = viewOnly;
  if (el.textioOpenFileBtn) el.textioOpenFileBtn.disabled = viewOnly;
  if (el.textioFileInput) el.textioFileInput.disabled = viewOnly;
}

// 編集できる共有リンク（18）: 共同編集モードの共通UI（バナー表示・しおり一覧/共有ボタン等の非表示）。
// viewOnly と異なり編集操作自体は許可するため、入力欄の readOnly/disabled 化は行わない。
// 「しおり一覧」「共有」「🔒非公開トグル」類は自分のしおりではないデータに作用してしまうため
// body.collab-mode スコープのCSSで非表示にする（styles.css参照）
function applyCollabModeUI() {
  document.body.classList.toggle("collab-mode", collabMode);
  if (el.collabBanner) el.collabBanner.classList.toggle("hidden", !collabMode);
}

// 出発までの日数（カウントダウン）。Day1の日付を出発日とみなす。
// 日付は「その日の始まり」同士で比較する（時刻の影響を受けないように）
function tripCountdownDays() {
  var firstDate = trip.days && trip.days[0] && trip.days[0].date;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(firstDate || ""));
  if (!m) return null;
  var target = new Date(+m[1], +m[2] - 1, +m[3]);
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function renderCountdown() {
  if (!el.tripCountdown) return;
  var days = tripCountdownDays();
  if (days == null) {
    el.tripCountdown.classList.add("hidden");
    el.tripCountdown.textContent = "";
    return;
  }
  var text;
  if (days > 0) text = t("countdown.until", { n: days });
  else if (days === 0) text = t("countdown.today");
  else return el.tripCountdown.classList.add("hidden"); // 過ぎた旅行では出さない
  el.tripCountdown.textContent = text;
  el.tripCountdown.classList.remove("hidden");
}

function renderHeader() {
  if (document.activeElement !== el.tripTitle) {
    el.tripTitle.textContent = tripDisplayTitle(trip);
  }
  renderCountdown();
}

function renderDayTabs() {
  el.dayTabs.innerHTML = "";
  trip.days.forEach(function (day, idx) {
    var tab = document.createElement("div");
    tab.className = "day-tab" + (idx === currentDayIndex ? " active" : "");
    tab.dataset.index = String(idx);

    var label = document.createElement("span");
    label.className = "day-tab-label";
    label.textContent = t("day.dayLabel", { n: idx + 1 });
    tab.appendChild(label);

    // 非公開マーク（14拡張）: 日単位で非公開の日は、日タブにも小さく🔒を表示して一覧性を確保する
    if (day.priv) {
      var lockIcon = document.createElement("span");
      lockIcon.className = "day-tab-lock";
      lockIcon.textContent = "🔒";
      lockIcon.setAttribute("aria-hidden", "true");
      tab.appendChild(lockIcon);
    }

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "day-tab-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", t("day.deleteAria"));
    closeBtn.dataset.index = String(idx);
    tab.appendChild(closeBtn);

    el.dayTabs.appendChild(tab);
  });
}

function renderDayMeta() {
  var day = trip.days[currentDayIndex];
  el.dayDateInput.value = day.date || "";
  el.dayStartTimeInput.value = day.startTime || "09:00";

  // 日付の自動連番（2）: index>=1 の日で dateManual===false かつ日付が自動で入っている場合のみ、
  // 控えめな「自動」ヒントバッジを表示する（手動固定・空欄・Day1では表示しない）
  if (el.dayDateAutoBadge) {
    var showAutoBadge = currentDayIndex >= 1 && !day.dateManual && !!day.date;
    el.dayDateAutoBadge.classList.toggle("hidden", !showAutoBadge);
  }
  populateTzSelect(el.dayTzSelect, t("day.tzNone"));
  el.dayTzSelect.value = day.tz || "";

  // 非公開マーク（14拡張）: 日単位の🔓/🔒トグルとバッジ
  if (el.dayPrivToggle) {
    el.dayPrivToggle.className = "day-priv-toggle" + (day.priv ? " active" : "");
    el.dayPrivToggle.textContent = day.priv ? "🔒" : "🔓";
    el.dayPrivToggle.title = t(day.priv ? "day.privMarkOff" : "day.privMarkOn");
    el.dayPrivToggle.setAttribute("aria-label", t("day.privToggleAria"));
    el.dayPrivToggle.setAttribute("aria-pressed", day.priv ? "true" : "false");
  }
  if (el.dayPrivBadge) {
    el.dayPrivBadge.classList.toggle("hidden", !day.priv);
  }
}

/* =========================================================
 * 時差対応（13）
 * ========================================================= */
// その日の基準日（時差オフセット計算・DST判定に使う）。day.date が無ければ今日を使う
function dayBaseDate(day) {
  if (day && typeof day.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
    var parts = day.date.split("-").map(function (n) {
      return parseInt(n, 10);
    });
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date();
}

// Intl の longOffset 形式（例 "GMT+09:00"）の生テキストを返す。無効な tz は null
function tzOffsetRawLabel(tz, baseDate) {
  if (!tz) return null;
  try {
    var dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" });
    var parts = dtf.formatToParts(baseDate || new Date());
    var part = parts.filter(function (p) {
      return p.type === "timeZoneName";
    })[0];
    return part ? part.value : null;
  } catch (e) {
    return null;
  }
}

// IANAタイムゾーン文字列 -> 分単位のUTCオフセット。無効な tz は try/catch で null（時差なし扱い）
function tzOffsetMinutes(tz, baseDate) {
  var raw = tzOffsetRawLabel(tz, baseDate);
  if (!raw) return null;
  if (raw === "GMT") return 0;
  var m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(raw);
  if (!m) return null;
  var sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

// 時差バッジ表示用（例: "-1h" "+9h30m" "+0h"）
function tzDiffLabel(diffMinutes) {
  var sign = diffMinutes < 0 ? "-" : "+";
  var abs = Math.abs(diffMinutes);
  var h = Math.floor(abs / 60);
  var m = abs % 60;
  return sign + h + "h" + (m ? m + "m" : "");
}

// タイムゾーンセレクトの選択肢一覧。Intl.supportedValuesOf が使える環境ではそれを使い、
// 使えない環境向けに主要都市の固定リストにフォールバックする
var FALLBACK_TZ_LIST = [
  "UTC",
  "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Taipei",
  "Asia/Singapore", "Asia/Bangkok", "Asia/Manila", "Asia/Jakarta", "Asia/Kuala_Lumpur",
  "Asia/Kolkata", "Asia/Dubai", "Asia/Ho_Chi_Minh", "Asia/Yangon",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Rome", "Europe/Madrid", "Europe/Moscow",
  "Africa/Cairo", "Africa/Johannesburg",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "America/Sao_Paulo", "America/Mexico_City",
  "Pacific/Auckland", "Pacific/Honolulu", "Pacific/Guam",
  "Australia/Sydney", "Australia/Perth"
];

function getTzListForOptions() {
  var zones = null;
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      zones = Intl.supportedValuesOf("timeZone");
    } catch (e) {
      zones = null;
    }
  }
  if (!zones || !zones.length) zones = FALLBACK_TZ_LIST;
  return zones;
}

// 選択肢DOMは重い（数百件）ため、一度だけ組み立てて使い回す（言語に依存しないのでキャッシュしてよい）
var tzOptionsBaseFragment = null;
function buildTzOptionsBaseFragment() {
  var frag = document.createDocumentFragment();
  var zones = getTzListForOptions();
  var now = new Date();
  zones.forEach(function (tz) {
    var raw = tzOffsetRawLabel(tz, now);
    var opt = document.createElement("option");
    opt.value = tz;
    opt.textContent = tz + (raw ? " (" + raw + ")" : "");
    frag.appendChild(opt);
  });
  return frag;
}
function getTzOptionsFragmentClone() {
  if (!tzOptionsBaseFragment) tzOptionsBaseFragment = buildTzOptionsBaseFragment();
  return tzOptionsBaseFragment.cloneNode(true);
}

// select要素にタイムゾーン選択肢を（先頭に「未設定/時差なし」を挟んで）流し込む
function populateTzSelect(select, noneLabel) {
  select.innerHTML = "";
  var noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = noneLabel;
  select.appendChild(noneOpt);
  select.appendChild(getTzOptionsFragmentClone());
}

// 現在タイムゾーンを day.tz で初期化し、move の arriveTz を通過するたびに
// tzOffsetMinutes(arriveTz) - tzOffsetMinutes(現在tz) をその move の終了時刻以降（自身のendMin含む）に加算する。
// 開始時刻の手動固定（17）: item.fixedStart があれば、その項目のstartMinはcursor（それまでの累積）
// ではなく固定時刻から決める。固定時刻は「cursorが現在いる暦日と同じ日」の時刻として解釈する
// （日跨ぎでcursorが1440を超えていれば、固定時刻もその翌日側に乗る）。
// cursor は時差オフセット加算後の値のため、固定時刻もそのまま「画面表示上の現地時間」として
// 解釈される（tzとの整合は式の上で自然に保たれる。日をまたぐ move の直後に固定時刻を置いた
// 場合も、cursor が既に新tzでのその日の時刻になっているのでズレない）。
// 固定によりstartMinが直前の項目のendMin（＝この項目に来る前のcursor）より前になる場合は
// conflict:true を立てて返す（データは削除しない。UIで警告表示のみ）。
// day.items との1:1マッピングは崩さない（行程番号・地図・印刷ビューが依存するため）
function getDayTimedItems(day) {
  var cursor = parseTimeToMinutes(day.startTime || "09:00");
  var baseDate = dayBaseDate(day);
  var curTz = typeof day.tz === "string" ? day.tz : "";
  var pendingLocalNote = false;
  return day.items.map(function (item) {
    var cursorBefore = cursor;
    var startMin;
    var conflict = false;
    if (item.fixedStart) {
      startMin = Math.floor(cursorBefore / 1440) * 1440 + parseTimeToMinutes(item.fixedStart);
      if (startMin < cursorBefore) conflict = true;
    } else {
      startMin = cursorBefore;
    }
    var endMin = startMin + (item.dur || 0);
    var localTimeNote = pendingLocalNote;
    pendingLocalNote = false;
    var moveTzDiff = null;

    if (item.cat === "move" && item.arriveTz) {
      var toOffset = tzOffsetMinutes(item.arriveTz, baseDate);
      if (toOffset != null) {
        var fromOffset = curTz ? tzOffsetMinutes(curTz, baseDate) : null;
        var diff = fromOffset != null ? toOffset - fromOffset : 0;
        moveTzDiff = diff;
        if (diff !== 0) {
          endMin += diff;
          pendingLocalNote = true;
        }
        curTz = item.arriveTz;
      }
    }

    cursor = endMin;
    return { item: item, startMin: startMin, endMin: endMin, localTimeNote: localTimeNote, moveTzDiff: moveTzDiff, conflict: conflict };
  });
}

// 行程番号（move以外の項目に上から1,2,3...を振る。日ごとにリセット）。
// タイムラインの番号バッジと地図ピンの番号は、番号のズレが起きないよう必ずこれを共用する。
// 戻り値は item.id -> 番号 のマップ（move はキーを持たない）
function getItineraryNumberMap(day) {
  var map = {};
  var n = 0;
  day.items.forEach(function (item) {
    if (item.cat !== "move") {
      n += 1;
      map[item.id] = n;
    }
  });
  return map;
}

// gmap 手入力が無い項目向けの自動 Google Maps リンクを組み立てる（trip には保存しない）
function buildAutoGmapUrl(item) {
  if (typeof item.lat === "number" && typeof item.lon === "number") {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.lat + "," + item.lon);
  }
  var q = (item.loc || item.name || "").trim();
  if (!q) return null;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

// メモ欄（textarea）の高さを内容に合わせて伸縮させる。2行以上でも全文が見えるようにするため。
// 一度 auto に戻してから scrollHeight を読むことで、文字を消したときの縮小にも対応する
function autoGrowNote(ta) {
  ta.style.height = "auto";
  // 高さを auto に戻した後、scrollHeight を読む前に一度レイアウトを確定させる。
  // flex レイアウト内の textarea は幅が後から広がることがあり、幅が狭いまま
  // scrollHeight を測ると桁違いに大きい高さになる（33文字が719pxになる等）。
  // offsetWidth の読み取りで強制 reflow し、確定した幅で測る
  /* eslint-disable-next-line no-unused-expressions */
  ta.offsetWidth;
  ta.style.height = ta.scrollHeight + "px";
}

function renderTimeline() {
  var day = trip.days[currentDayIndex];
  el.timeline.innerHTML = "";

  if (!day.items.length) {
    el.emptyDayMsg.classList.remove("hidden");
  } else {
    el.emptyDayMsg.classList.add("hidden");
  }

  var numMap = getItineraryNumberMap(day);
  getDayTimedItems(day).forEach(function (timed, idx) {
    el.timeline.appendChild(buildItemCard(timed.item, timed.startMin, timed.endMin, day, idx, numMap, timed));
  });

  // 名前欄・メモ欄の初期高さ合わせ。scrollHeight はDOMに入ってからでないと測れないためここで行う。
  // requestAnimationFrame はタブ非アクティブ時に発火しないことがあるので同期実行する
  Array.prototype.forEach.call(el.timeline.querySelectorAll(".item-name, .item-note"), autoGrowNote);
}

function buildItemCard(item, startMin, endMin, day, idx, numMap, timedMeta) {
  var card = document.createElement("div");
  card.className =
    "item-card cat-" +
    item.cat +
    (item.cat === "move" && item.unresolved ? " item-card-unresolved" : "") +
    // 非公開マーク（14）: 項目まるごと非公開のときカードをわずかに沈んだ配色にする
    (item.priv ? " item-card-private" : "");
  card.dataset.id = item.id;

  var handle = document.createElement("div");
  handle.className = "drag-handle";
  handle.setAttribute("aria-label", t("timeline.dragHandleLabel"));
  handle.textContent = "⠿";
  card.appendChild(handle);

  var timeCol = document.createElement("div");
  timeCol.className = "item-time-col";
  var iconWrap = document.createElement("div");
  iconWrap.className = "icon-wrap";
  var iconEl = document.createElement("div");
  iconEl.className = "icon";
  iconEl.textContent = window.I18N.CATEGORY_ICONS[item.cat] || "";
  iconWrap.appendChild(iconEl);
  timeCol.appendChild(iconWrap);
  if (item.cat !== "move" && numMap && numMap[item.id] != null) {
    // カード左端のカテゴリー色ボーダーに半分重ねるため、timeCol ではなく
    // card 直下に置いて絶対配置する（ドラッグハンドル・時刻表示とは重ならない位置）
    var numBadge = document.createElement("span");
    numBadge.className = "item-num-badge cat-" + item.cat;
    numBadge.textContent = String(numMap[item.id]);
    numBadge.setAttribute("aria-hidden", "true");
    card.appendChild(numBadge);
  }
  if (item.cat === "move" && numMap) {
    var moveNeighbors = findAdjacentStops(day, idx);
    var prevNum = moveNeighbors.prev ? numMap[moveNeighbors.prev.id] : null;
    var nextNum = moveNeighbors.next ? numMap[moveNeighbors.next.id] : null;
    if (prevNum != null && nextNum != null) {
      var moveNumBadge = document.createElement("div");
      moveNumBadge.className = "item-move-num-badge";
      moveNumBadge.textContent = prevNum + " → " + nextNum;
      moveNumBadge.setAttribute("aria-hidden", "true");
      timeCol.appendChild(moveNumBadge);
    }
  }
  var timeText = document.createElement("div");
  timeText.className = "item-time-row";

  // 開始時刻の手動固定（17）: 開始時刻部分だけクリック可能にし、<input type="time"> をインライン表示する。
  // viewOnly（公開URL閲覧）中は編集不可（フォールバックのテキスト表示のみ）
  if (!viewOnly && fixedStartEditingId === item.id) {
    var fixedStartInput = document.createElement("input");
    fixedStartInput.type = "time";
    fixedStartInput.className = "item-fixed-start-input";
    fixedStartInput.value = minutesToHHMM(startMin);
    fixedStartInput.setAttribute("aria-label", t("timeline.fixedStartInputAria"));
    var closeFixedStartEditor = function (commit) {
      if (fixedStartEditingId !== item.id) return; // 既に確定/取消済み（二重発火防止）
      fixedStartEditingId = null;
      if (commit) {
        item.fixedStart = normalizeFixedStart(fixedStartInput.value);
        saveState();
      }
      render();
    };
    fixedStartInput.addEventListener("change", function () {
      closeFixedStartEditor(true);
    });
    fixedStartInput.addEventListener("blur", function () {
      // change が既に発火して確定済みなら何もしない。未確定のままフォーカスが外れた場合は
      // 値を保存せずに編集モードだけ閉じる（キャンセル扱い）
      closeFixedStartEditor(false);
    });
    fixedStartInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFixedStartEditor(false);
      }
    });
    timeText.appendChild(fixedStartInput);
    // DOM挿入直後にフォーカスしてピッカーを開きやすくする
    setTimeout(function () {
      fixedStartInput.focus();
    }, 0);
  } else {
    var startBtn = document.createElement(viewOnly ? "span" : "button");
    if (!viewOnly) startBtn.type = "button";
    startBtn.className = "item-start-time-btn" + (item.fixedStart ? " is-fixed" : "");
    startBtn.textContent = (item.fixedStart ? "📌 " : "") + minutesToTimeStr(startMin);
    startBtn.title = t(item.fixedStart ? "timeline.fixedStartBadgeTitle" : "timeline.fixedStartEditHint");
    if (!viewOnly) {
      startBtn.addEventListener("click", function () {
        if (viewOnly) return;
        fixedStartEditingId = item.id;
        render();
      });
    }
    timeText.appendChild(startBtn);

    if (item.fixedStart && !viewOnly) {
      var clearFixedBtn = document.createElement("button");
      clearFixedBtn.type = "button";
      clearFixedBtn.className = "item-fixed-clear-btn";
      clearFixedBtn.textContent = "✕";
      clearFixedBtn.title = t("timeline.fixedStartClearAria");
      clearFixedBtn.setAttribute("aria-label", t("timeline.fixedStartClearAria"));
      clearFixedBtn.addEventListener("click", function () {
        if (viewOnly) return;
        item.fixedStart = null;
        saveState();
        render();
      });
      timeText.appendChild(clearFixedBtn);
    }
  }

  var timeSepEl = document.createElement("span");
  timeSepEl.className = "item-time-sep";
  timeSepEl.textContent = t("timeline.timeSep");
  timeText.appendChild(timeSepEl);

  var endTimeEl = document.createElement("span");
  endTimeEl.textContent = minutesToTimeStr(endMin);
  timeText.appendChild(endTimeEl);

  timeCol.appendChild(timeText);
  // 時差対応（13）: 直前の move で tz が切り替わった直後の項目にだけ「(現地時間)」を1回表示する
  if (timedMeta && timedMeta.localTimeNote) {
    var localNoteEl = document.createElement("div");
    localNoteEl.className = "item-local-tz-note";
    localNoteEl.textContent = t("timeline.localTimeNote");
    timeCol.appendChild(localNoteEl);
  }
  card.appendChild(timeCol);

  var body = document.createElement("div");
  body.className = "item-body";

  var nameRow = document.createElement("div");
  nameRow.className = "item-name-row";

  // input ではなく textarea を使う。input は1行しか表示できず、モバイルの狭い幅では
  // 長いタイトルが大きく見切れてしまうため。高さは autoGrowNote() が内容に合わせて調整する
  var nameInput = document.createElement("textarea");
  nameInput.rows = 1;
  nameInput.className = "item-name";
  nameInput.value = item.name;
  nameInput.placeholder = t("timeline.namePlaceholder");
  nameInput.readOnly = viewOnly; // 公開URL閲覧（16）: 読み取り専用モードでは編集不可
  // タイトルは1行の想定なので Enter で改行を入れずに確定（フォーカスを外す）
  nameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      nameInput.blur();
    }
  });
  nameInput.addEventListener("input", function () {
    autoGrowNote(nameInput);
  });
  nameInput.addEventListener("change", function () {
    var newName = nameInput.value;
    if (newName !== item.name) {
      if (item.coordSrc !== "gmap") {
        item.lat = null;
        item.lon = null;
        item.coordSrc = null;
        // 地図更新で自動入力された gmap リンク（gmapAuto）は古い座標に基づくため、
        // 座標クリアに合わせて消す。手動で貼ったリンク（gmapAuto でない）は維持する
        if (item.cat !== "move" && item.gmapAuto) {
          item.gmap = "";
          item.gmapAuto = false;
        }
      }
      // 名前を編集したら、古い翻訳が残らないようその項目の names を全消去する（3c）
      if (item.cat !== "move") {
        item.names = {};
      }
    }
    item.name = newName;
    saveState();
    // 隣接する move カードの「Google Mapsで確認」リンクは名前に依存するため全体を再描画する
    render();
  });
  nameRow.appendChild(nameInput);

  if (item.cat !== "move") {
    // 手入力の gmap リンクがあれば優先。無ければ座標 or 名前から自動リンクを導出する（trip には保存しない）
    var gmapHref = isSafeHttpUrl(item.gmap) ? item.gmap.trim() : buildAutoGmapUrl(item);
    if (gmapHref) {
      var gmapLink = document.createElement("a");
      gmapLink.className = "item-gmap-link";
      gmapLink.href = gmapHref;
      gmapLink.target = "_blank";
      gmapLink.rel = "noopener";
      gmapLink.textContent = "🔗";
      gmapLink.title = t("timeline.gmapLinkLabel");
      gmapLink.setAttribute("aria-label", t("timeline.gmapLinkLabel"));
      nameRow.appendChild(gmapLink);
    }
  }

  var catTag = document.createElement("span");
  catTag.className = "item-cat-tag cat-" + item.cat;
  catTag.textContent = window.I18N.CAT_NAMES[lang()][item.cat];
  nameRow.appendChild(catTag);

  // 非公開マーク（14）: 項目まるごと非公開のときの淡いバッジ
  if (item.priv) {
    var privBadge = document.createElement("span");
    privBadge.className = "item-priv-badge";
    privBadge.textContent = "🔒 " + t("timeline.privBadge");
    nameRow.appendChild(privBadge);
  }

  // 場所を解決できないスポットの近隣アンカー概算バッジ（ツールチップで理由説明）
  if (item.cat === "move" && item.approx) {
    var approxBadge = document.createElement("span");
    approxBadge.className = "item-approx-badge";
    approxBadge.textContent = t("timeline.approxBadge");
    approxBadge.title = t("timeline.approxTooltip");
    nameRow.appendChild(approxBadge);
  }

  body.appendChild(nameRow);

  // スポット名の多言語表示（3c）: 名前入力欄の下に控えめに現地語名を表示する。
  // 入力欄自体・保存されている name 文字列は一切変更しない（表示のみ）
  var i18nHintText = null;
  if (item.cat !== "move") {
    var localizedName = item.names && typeof item.names[lang()] === "string" ? item.names[lang()] : null;
    // メモ側と同じく、原文と実質同じ訳は出さない（重複表示の防止）
    if (localizedName && !isEffectivelySameText(localizedName, item.name)) {
      i18nHintText = localizedName;
    }
  } else {
    var moveNeighborsForHint = day ? findAdjacentStops(day, idx) : null;
    if (moveNeighborsForHint && moveNeighborsForHint.prev && moveNeighborsForHint.next) {
      var prevLabel = localizedStopName(moveNeighborsForHint.prev);
      var nextLabel = localizedStopName(moveNeighborsForHint.next);
      var computedMoveTitle = prevLabel + " → " + nextLabel;
      if (computedMoveTitle !== item.name) {
        i18nHintText = computedMoveTitle;
      }
    } else {
      // 前後のスポットから「A → B」を組み立てられない move（手入力の move 名など）:
      // Translation API で翻訳した names[L] があればそれを表示する（3c 追記）
      var moveLocalizedName = item.names && typeof item.names[lang()] === "string" ? item.names[lang()] : null;
      if (moveLocalizedName && moveLocalizedName !== item.name) {
        i18nHintText = moveLocalizedName;
      }
    }
  }
  if (i18nHintText) {
    var i18nHintEl = document.createElement("div");
    i18nHintEl.className = "item-i18n-hint";
    i18nHintEl.textContent = "🌐 " + i18nHintText;
    body.appendChild(i18nHintEl);
  }

  if (item.cat === "move" && item.unresolved) {
    var unresolvedMsg = document.createElement("div");
    unresolvedMsg.className = "item-unresolved-msg";
    unresolvedMsg.textContent = t("timeline.unresolvedText");
    body.appendChild(unresolvedMsg);
  }

  // 開始時刻の手動固定（17）: 固定時刻が直前の項目の終了時刻より前で重なっている場合、常時警告を表示する
  if (timedMeta && timedMeta.conflict) {
    var conflictMsg = document.createElement("div");
    conflictMsg.className = "item-conflict-msg";
    conflictMsg.textContent = t("timeline.fixedStartConflict");
    body.appendChild(conflictMsg);
  }

  var metaRow = document.createElement("div");
  metaRow.className = "item-meta-row";

  if (item.cat === "move") {
    var modeSelect = document.createElement("select");
    modeSelect.className = "item-mode-select";
    modeSelect.setAttribute("aria-label", t("timeline.modeLabel"));
    window.I18N.MODES.forEach(function (mode) {
      var opt = document.createElement("option");
      opt.value = mode;
      opt.textContent = window.I18N.MODE_NAMES[lang()][mode];
      if (mode === item.mode) opt.selected = true;
      modeSelect.appendChild(opt);
    });
    modeSelect.addEventListener("change", function () {
      item.mode = modeSelect.value;

      var apiKey = getGmapsKey();
      var apiTravelMode = MODE_TO_API_TRAVELMODE[item.mode];
      var neighbors = day ? findAdjacentStops(day, idx) : null;

      if (apiKey && apiTravelMode && neighbors && neighbors.prev && neighbors.next) {
        var stopA = neighbors.prev;
        var stopB = neighbors.next;
        modeSelect.disabled = true;
        var currentDay = trip.days[currentDayIndex];
        var departureMinutes = departureMinutesForStop(currentDay, stopA);

        fetchRouteWithCache(stopA, stopB, apiTravelMode, currentDay, departureMinutes, apiKey)
          .then(function (result) {
            if (result.durMin != null) {
              item.dur = result.durMin;
              if (result.distKm != null) item.distKm = result.distKm;
              if (result.startLatLng && stopA.coordSrc !== "gmap") {
                stopA.lat = result.startLatLng.latitude;
                stopA.lon = result.startLatLng.longitude;
                stopA.coordSrc = "geo";
              }
              if (result.endLatLng && stopB.coordSrc !== "gmap") {
                stopB.lat = result.endLatLng.latitude;
                stopB.lon = result.endLatLng.longitude;
                stopB.coordSrc = "geo";
              }
            } else {
              var recalcedFallback = recalcDurationForMode(item.mode, item.distKm);
              if (recalcedFallback != null) item.dur = recalcedFallback;
            }
          })
          .catch(function (err) {
            if (err && err.keyInvalid) {
              showToast(t("toast.routesApiKeyError"), "error");
            } else {
              showToast(t("toast.routesApiError"), "error");
            }
            var recalcedOnError = recalcDurationForMode(item.mode, item.distKm);
            if (recalcedOnError != null) item.dur = recalcedOnError;
          })
          .then(function () {
            saveState();
            render();
          });
        return;
      }

      var recalced = recalcDurationForMode(item.mode, item.distKm);
      if (recalced != null) {
        item.dur = recalced;
      }
      saveState();
      render();
    });
    modeSelect.disabled = viewOnly; // 公開URL閲覧（16）
    metaRow.appendChild(modeSelect);

    // 時差対応（13）: 到着地のタイムゾーン（コンパクトなセレクト）。スペースが厳しいため
    // 既存の移動手段セレクトの隣に小さく配置する
    var arriveTzSelect = document.createElement("select");
    arriveTzSelect.className = "item-arrivetz-select";
    arriveTzSelect.setAttribute("aria-label", t("timeline.arriveTzLabel"));
    arriveTzSelect.title = t("timeline.arriveTzLabel");
    populateTzSelect(arriveTzSelect, t("timeline.arriveTzNone"));
    arriveTzSelect.value = item.arriveTz || "";
    arriveTzSelect.addEventListener("change", function () {
      item.arriveTz = arriveTzSelect.value;
      saveState();
      render();
    });
    arriveTzSelect.disabled = viewOnly; // 公開URL閲覧（16）
    metaRow.appendChild(arriveTzSelect);

    if (timedMeta && timedMeta.moveTzDiff != null) {
      var tzBadge = document.createElement("span");
      tzBadge.className = "item-tz-badge";
      tzBadge.textContent = "🕐 " + tzDiffLabel(timedMeta.moveTzDiff);
      metaRow.appendChild(tzBadge);
    }

    var routeInfo = day ? buildMoveRouteLink(day, idx, item.mode) : null;
    if (routeInfo) {
      var routeLink = document.createElement("a");
      routeLink.className = "item-gmap-route-link";
      routeLink.href = routeInfo.href;
      routeLink.target = "_blank";
      routeLink.rel = "noopener";
      routeLink.textContent = "🗺 " + t("timeline.gmapRouteLabel");
      metaRow.appendChild(routeLink);
    }
  }

  var durWrap = document.createElement("div");
  durWrap.className = "item-dur-wrap";
  var durInput = document.createElement("input");
  durInput.type = "number";
  durInput.min = "0";
  durInput.step = "5";
  durInput.className = "item-dur-input";
  // 場所を解決できずアンカーも無い move（unresolved）は dur=0 のまま挿入されるため、
  // 「0分」と表示せず空欄＋プレースホルダで「時間を入力」してもらう
  var showDurPlaceholder = item.cat === "move" && item.auto && item.dur === 0 && (item.distKm == null || item.unresolved);
  durInput.value = showDurPlaceholder ? "" : String(item.dur);
  if (showDurPlaceholder) {
    durInput.placeholder = t("timeline.durPlaceholder");
  }
  durInput.addEventListener("change", function () {
    item.dur = clampInt(durInput.value, 0, 100000, 0);
    saveState();
    render();
  });
  durInput.readOnly = viewOnly; // 公開URL閲覧（16）
  durWrap.appendChild(durInput);
  var durUnit = document.createElement("span");
  durUnit.className = "item-dur-unit";
  durUnit.textContent = window.I18N.DURATION_UNITS[lang()];
  durWrap.appendChild(durUnit);
  metaRow.appendChild(durWrap);

  body.appendChild(metaRow);

  if (item.cat !== "move") {
    var gmapRow = document.createElement("div");
    gmapRow.className = "item-gmap-row";

    var gmapIcon = document.createElement("span");
    gmapIcon.className = "item-gmap-icon";
    gmapIcon.textContent = "📍";
    gmapIcon.setAttribute("aria-hidden", "true");
    gmapRow.appendChild(gmapIcon);

    var gmapInput = document.createElement("input");
    gmapInput.type = "url";
    gmapInput.className = "item-gmap-input";
    gmapInput.placeholder = t("timeline.gmapPlaceholder");
    gmapInput.value = item.gmap || "";
    gmapInput.addEventListener("change", function () {
      handleGmapChange(item, gmapInput.value);
    });
    gmapInput.readOnly = viewOnly; // 公開URL閲覧（16）
    gmapRow.appendChild(gmapInput);

    body.appendChild(gmapRow);
  }

  var noteRow = document.createElement("div");
  noteRow.className = "item-note-row";

  var noteInput = document.createElement("textarea");
  noteInput.className = "item-note";
  noteInput.rows = 1;
  noteInput.placeholder = t("timeline.notePlaceholder");
  noteInput.value = item.note || "";
  // 入力のたびに高さを追従させる（改行・折り返しで2行以上になっても全文が見えるように）
  noteInput.addEventListener("input", function () {
    autoGrowNote(noteInput);
  });
  noteInput.addEventListener("change", function () {
    var newNote = noteInput.value;
    if (newNote !== item.note) {
      // メモを編集したら、古い翻訳が残らないようその項目の noteNames を全消去する（3c 追記）
      item.noteNames = {};
    }
    item.note = newNote;
    saveState();
    render();
  });
  noteInput.readOnly = viewOnly; // 公開URL閲覧（16）
  noteRow.appendChild(noteInput);

  // 非公開マーク（14）: メモだけを非公開にする小さなトグル
  var notePrivBtn = document.createElement("button");
  notePrivBtn.type = "button";
  notePrivBtn.className = "item-note-priv-toggle" + (item.notePriv ? " active" : "");
  notePrivBtn.textContent = item.notePriv ? "🔒" : "🔓";
  notePrivBtn.title = t(item.notePriv ? "timeline.notePrivMarkOff" : "timeline.notePrivMarkOn");
  notePrivBtn.setAttribute("aria-label", t("timeline.notePrivToggleAria"));
  notePrivBtn.setAttribute("aria-pressed", item.notePriv ? "true" : "false");
  notePrivBtn.addEventListener("click", function () {
    item.notePriv = !item.notePriv;
    saveState();
    render();
  });
  noteRow.appendChild(notePrivBtn);

  body.appendChild(noteRow);

  // メモの多言語表示（3c 追記）: 名前の 🌐 ヒントと同じ見た目・考え方で翻訳文を控えめに表示する。
  // メモ入力欄自体は常に元の文のまま（編集の正は変えない）
  var noteI18nText = item.noteNames && typeof item.noteNames[lang()] === "string" ? item.noteNames[lang()] : null;
  // 原文と実質同じ（空白の違いしかない）訳は出さない。原文の真下にほぼ同じ文が
  // 重複表示されてカードが無駄に長くなるのを防ぐ
  if (noteI18nText && item.note && !isEffectivelySameText(noteI18nText, item.note)) {
    var noteI18nHintEl = document.createElement("div");
    noteI18nHintEl.className = "item-i18n-hint";
    noteI18nHintEl.textContent = "🌐 " + noteI18nText;
    body.appendChild(noteI18nHintEl);
  }

  if (item.notePriv) {
    var notePrivHint = document.createElement("div");
    notePrivHint.className = "item-note-priv-hint";
    notePrivHint.textContent = t("timeline.notePrivHint");
    body.appendChild(notePrivHint);
  }

  card.appendChild(body);

  // 操作ボタン（🔒複製削除）はラッパーにまとめる。モバイルでは縦1列にして
  // 名前欄に横幅を回すため（.item-action-col のCSS参照）
  var actionCol = document.createElement("div");
  actionCol.className = "item-action-col";

  // 非公開マーク（14）: 項目まるごとの 🔓/🔒 トグル（複製・削除ボタンと並べて配置）
  var privBtn = document.createElement("button");
  privBtn.type = "button";
  privBtn.className = "item-priv-toggle" + (item.priv ? " active" : "");
  privBtn.textContent = item.priv ? "🔒" : "🔓";
  privBtn.title = t(item.priv ? "timeline.privMarkOff" : "timeline.privMarkOn");
  privBtn.setAttribute("aria-label", t("timeline.privToggleAria"));
  privBtn.setAttribute("aria-pressed", item.priv ? "true" : "false");
  privBtn.addEventListener("click", function () {
    item.priv = !item.priv;
    saveState();
    render();
  });
  actionCol.appendChild(privBtn);

  // 上下ボタン: ドラッグが難しい場面の代替。端では隣の日へ移動する
  var upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "item-nudge";
  upBtn.textContent = "↑";
  upBtn.title = t("timeline.moveUp");
  upBtn.setAttribute("aria-label", t("timeline.moveUp"));
  upBtn.addEventListener("click", function () {
    nudgeItem(item.id, -1);
  });
  actionCol.appendChild(upBtn);

  var downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "item-nudge";
  downBtn.textContent = "↓";
  downBtn.title = t("timeline.moveDown");
  downBtn.setAttribute("aria-label", t("timeline.moveDown"));
  downBtn.addEventListener("click", function () {
    nudgeItem(item.id, 1);
  });
  actionCol.appendChild(downBtn);

  var dupBtn = document.createElement("button");
  dupBtn.type = "button";
  dupBtn.className = "item-duplicate";
  dupBtn.textContent = "⧉";
  dupBtn.title = t("timeline.duplicateItem");
  dupBtn.setAttribute("aria-label", t("timeline.duplicateItem"));
  dupBtn.addEventListener("click", function () {
    duplicateItem(item.id);
  });
  actionCol.appendChild(dupBtn);

  var delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "item-delete";
  delBtn.textContent = "🗑";
  delBtn.setAttribute("aria-label", t("timeline.deleteItem"));
  delBtn.addEventListener("click", function () {
    deleteItem(item.id);
  });
  actionCol.appendChild(delBtn);

  card.appendChild(actionCol);

  return card;
}

function renderAddForm() {
  el.addName.placeholder = t("add.namePlaceholder");
  el.addNote.placeholder = t("add.notePlaceholder");
  el.addDurUnit.textContent = window.I18N.DURATION_UNITS[lang()];
  Array.prototype.forEach.call(el.addFormCats.querySelectorAll(".cat-btn"), function (btn) {
    btn.classList.toggle("selected", btn.dataset.cat === addFormCat);
  });
  // 公開URL閲覧（16）: #addForm 自体はCSSで非表示にするが、念のため入力も無効化しておく
  el.addName.readOnly = viewOnly;
  el.addDur.readOnly = viewOnly;
  el.addNote.readOnly = viewOnly;
  el.addBtn.disabled = viewOnly;
}

/* =========================================================
 * 持ち物リスト・やることリスト（10・11）
 * しおり単位（日ごとではない）。kind は "packing" | "todos"。
 * 準備リストへのクイックアクセス（11）: 同じデータをタイムライン下（"main"）と
 * 準備モーダル（"prep"）の2箇所に描画できるよう、target 引数で描画先を切り替える。
 * 描画ロジック自体（buildChecklistRow・renderChecklistSection）は完全に共有し、重複させない
 * ========================================================= */
function checklistArray(kind) {
  return kind === "packing" ? trip.packing : trip.todos;
}

// 非公開マーク（14拡張）: リスト全体単位のフラグ名（"packingPriv" | "todosPriv"）
function checklistPrivKey(kind) {
  return kind === "packing" ? "packingPriv" : "todosPriv";
}

function checklistEls(kind, target) {
  var isPrep = target === "prep";
  if (kind === "packing") {
    return isPrep
      ? {
          items: el.prepPackingItems,
          empty: el.prepPackingEmptyMsg,
          progress: el.prepPackingProgress,
          addInput: el.prepPackingAddInput,
          section: el.prepPackingSection,
          listPrivToggle: el.prepPackingListPrivToggle,
          listPrivBadge: el.prepPackingListPrivBadge
        }
      : {
          items: el.packingItems,
          empty: el.packingEmptyMsg,
          progress: el.packingProgress,
          addInput: el.packingAddInput,
          section: el.packingSection,
          listPrivToggle: el.packingListPrivToggle,
          listPrivBadge: el.packingListPrivBadge
        };
  }
  return isPrep
    ? {
        items: el.prepTodosItems,
        empty: el.prepTodosEmptyMsg,
        progress: el.prepTodosProgress,
        addInput: el.prepTodosAddInput,
        section: el.prepTodosSection,
        listPrivToggle: el.prepTodosListPrivToggle,
        listPrivBadge: el.prepTodosListPrivBadge
      }
    : {
        items: el.todosItems,
        empty: el.todosEmptyMsg,
        progress: el.todosProgress,
        addInput: el.todosAddInput,
        section: el.todosSection,
        listPrivToggle: el.todosListPrivToggle,
        listPrivBadge: el.todosListPrivBadge
      };
}

function buildChecklistRow(kind, it) {
  var row = document.createElement("div");
  row.className = "checklist-item" + (it.done ? " done" : "") + (it.priv ? " checklist-item-private" : "");
  row.dataset.id = it.id;

  // 持ち物・やることリストの並べ替え（10 拡張）: ハンドルからのみドラッグ開始できるようにする
  // （チェックボックス・テキスト編集を誤操作で邪魔しないため）。viewOnly 時は既存の
  // .view-only-mode スコープCSSで非表示にする（タイムラインの .drag-handle と同じ方針）
  var handle = document.createElement("div");
  handle.className = "checklist-drag-handle";
  handle.setAttribute("aria-label", t("timeline.dragHandleLabel"));
  handle.textContent = "⠿";
  row.appendChild(handle);

  var checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "checklist-checkbox";
  checkbox.checked = it.done;
  checkbox.setAttribute("aria-label", t("checklist.doneAria"));
  checkbox.addEventListener("change", function () {
    it.done = checkbox.checked;
    saveState();
    renderChecklistSection(kind);
  });
  checkbox.disabled = viewOnly; // 公開URL閲覧（16）: チェックボックスも読み取り専用にする
  row.appendChild(checkbox);

  // input ではなく textarea を使う。input は構造上1行しか表示できず、長い項目名が
  // 見切れてしまうため。高さは autoGrowNote() が内容に合わせて調整する
  var textInput = document.createElement("textarea");
  textInput.rows = 1;
  textInput.className = "checklist-text-input";
  textInput.value = it.text;
  textInput.placeholder = t("checklist.addPlaceholder");
  textInput.addEventListener("input", function () {
    autoGrowNote(textInput);
  });
  textInput.addEventListener("change", function () {
    it.text = textInput.value;
    saveState();
    // モーダル用・タイムライン下用の両方に同じテキストを反映する
    renderChecklistSection(kind);
  });
  textInput.readOnly = viewOnly; // 公開URL閲覧（16）
  row.appendChild(textInput);

  // 非公開マーク（14）: 持ち物・やること各行の 🔓/🔒 トグル
  var privBtn = document.createElement("button");
  privBtn.type = "button";
  privBtn.className = "checklist-priv-toggle" + (it.priv ? " active" : "");
  privBtn.textContent = it.priv ? "🔒" : "🔓";
  privBtn.title = t(it.priv ? "checklist.privMarkOff" : "checklist.privMarkOn");
  privBtn.setAttribute("aria-label", t("checklist.privToggleAria"));
  privBtn.setAttribute("aria-pressed", it.priv ? "true" : "false");
  privBtn.addEventListener("click", function () {
    it.priv = !it.priv;
    saveState();
    renderChecklistSection(kind);
  });
  row.appendChild(privBtn);

  var delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "checklist-delete";
  delBtn.textContent = "🗑";
  delBtn.setAttribute("aria-label", t("timeline.deleteItem"));
  delBtn.addEventListener("click", function () {
    deleteChecklistItem(kind, it.id);
  });
  row.appendChild(delBtn);

  return row;
}

// 未完了件数の合計（persisting/todos）をヘッダーの🧳バッジに反映する
function updatePrepBadge() {
  if (!el.prepBadge) return;
  var incomplete =
    trip.packing.filter(function (it) {
      return !it.done;
    }).length +
    trip.todos.filter(function (it) {
      return !it.done;
    }).length;
  if (incomplete > 0) {
    el.prepBadge.textContent = incomplete > 99 ? "99+" : String(incomplete);
    el.prepBadge.classList.remove("hidden");
  } else {
    el.prepBadge.classList.add("hidden");
  }
}

// kind の一覧を "main"（タイムライン下）・"prep"（準備モーダル）の両方に再描画する
function renderChecklistSection(kind) {
  var list = checklistArray(kind);
  var doneCount = list.filter(function (it) {
    return it.done;
  }).length;
  // 非公開マーク（14拡張）: リスト全体単位の非公開フラグ
  var isListPriv = !!trip[checklistPrivKey(kind)];

  ["main", "prep"].forEach(function (target) {
    var els = checklistEls(kind, target);
    if (!els.items) return;
    els.items.innerHTML = "";
    if (!list.length) {
      els.empty.classList.remove("hidden");
    } else {
      els.empty.classList.add("hidden");
    }
    els.progress.textContent = doneCount + "/" + list.length;
    list.forEach(function (it) {
      els.items.appendChild(buildChecklistRow(kind, it));
    });

    // 項目名の高さを内容に合わせる。scrollHeight はDOMに入ってからでないと測れないためここで行う。
    // requestAnimationFrame はタブ非アクティブ時に発火しないことがあるので同期実行する
    Array.prototype.forEach.call(els.items.querySelectorAll(".checklist-text-input"), autoGrowNote);

    // 非公開マーク（14拡張）: リスト全体単位の🔓/🔒トグル・バッジ・淡いスタイル
    if (els.section) {
      els.section.classList.toggle("checklist-section-private", isListPriv);
    }
    if (els.listPrivToggle) {
      els.listPrivToggle.className = "checklist-list-priv-toggle" + (isListPriv ? " active" : "");
      els.listPrivToggle.textContent = isListPriv ? "🔒" : "🔓";
      els.listPrivToggle.title = t(isListPriv ? "checklist.listPrivMarkOff" : "checklist.listPrivMarkOn");
      els.listPrivToggle.setAttribute("aria-label", t("checklist.listPrivToggleAria"));
      els.listPrivToggle.setAttribute("aria-pressed", isListPriv ? "true" : "false");
    }
    if (els.listPrivBadge) {
      els.listPrivBadge.classList.toggle("hidden", !isListPriv);
    }
  });

  updatePrepBadge();
}

// 非公開マーク（14拡張）: リスト全体単位の🔓/🔒トグルのクリックハンドラ（bindEvents から呼ぶ）
function toggleListPriv(kind) {
  var key = checklistPrivKey(kind);
  trip[key] = !trip[key];
  saveState();
  renderChecklistSection(kind);
}

function renderChecklists() {
  renderChecklistSection("packing");
  renderChecklistSection("todos");
}

// target: "main"（タイムライン下の追加欄） | "prep"（準備モーダルの追加欄）
function addChecklistItem(kind, target) {
  if (viewOnly) return;
  var els = checklistEls(kind, target);
  var text = els.addInput.value.trim();
  if (!text) {
    els.addInput.focus();
    return;
  }
  checklistArray(kind).push({ id: genId(), text: text, done: false, priv: false });
  els.addInput.value = "";
  saveState();
  renderChecklistSection(kind);
  els.addInput.focus();
}

function deleteChecklistItem(kind, id) {
  if (viewOnly) return;
  var list = checklistArray(kind);
  var idx = list.findIndex(function (it) {
    return it.id === id;
  });
  if (idx === -1) return;
  var removed = list[idx]; // 「元に戻す」で同じ位置に復元するため控える
  list.splice(idx, 1);
  saveState();
  renderChecklistSection(kind);
  showActionToast(t("toast.itemDeleted"), t("toast.undo"), function () {
    var cur = checklistArray(kind);
    cur.splice(Math.min(idx, cur.length), 0, removed);
    saveState();
    renderChecklistSection(kind);
  });
}

// 準備モーダルのサイズを復元する。保存値が今の画面より大きい場合は画面に収まるよう抑える
// （小さい画面で開いたときに画面外へはみ出さないように）
function restorePrepModalSize() {
  var card = el.prepModal.querySelector(".modal-prep");
  if (!card) return;
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(PREP_SIZE_KEY) || "null");
  } catch (e) {
    saved = null;
  }
  if (!saved || typeof saved.w !== "number" || typeof saved.h !== "number") return;
  var maxW = Math.max(280, window.innerWidth - 32);
  var maxH = Math.max(240, window.innerHeight * 0.86);
  card.style.width = Math.min(saved.w, maxW) + "px";
  card.style.height = Math.min(saved.h, maxH) + "px";
  // 復元したサイズが既定の max-width(620px) に負けないようにする
  card.style.maxWidth = "none";
}

// 公開URL閲覧（16）: 準備モーダルは閲覧モードでも開けるが（10参照）、
// サイズ記憶はUI設定とはいえ localStorage への書き込みには変わりないため、
// 「閲覧モードでは localStorage を一切変更しない」という絶対条件を優先してここでも viewOnly ガードを置く
function savePrepModalSize() {
  if (viewOnly) return;
  var card = el.prepModal.querySelector(".modal-prep");
  if (!card) return;
  var r = card.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return; // 非表示時のゼロサイズは保存しない
  try {
    localStorage.setItem(PREP_SIZE_KEY, JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) }));
  } catch (e) {
    /* 保存できなくても動作に支障はない */
  }
}

// 準備リストへのクイックアクセス（10）: 公開URL閲覧（16）中もこのボタン・モーダルは表示したまま使える
// （タイムライン最下部までスクロールしなくても持ち物・やることリストを見落とさないため）。
// renderChecklistSection がチェックボックス/テキスト欄に viewOnly ガードを適用済みで、
// 🔒トグル・削除・追加欄・ドラッグハンドルは既存の body.view-only-mode スコープCSS
// （クラスセレクタのため main/prepModal 共通で効く）で非表示になるため、モーダルは自然に読み取り専用になる
function openPrepModal() {
  renderChecklists();
  openModal(el.prepModal);
  restorePrepModalSize();
  // 項目名の高さの測り直し。モーダルが閉じている間は要素が非表示で scrollHeight が
  // 測れず（0扱い）、renderChecklists 時点の自動伸縮が効かないため、表示した後に必ずやり直す
  Array.prototype.forEach.call(el.prepModal.querySelectorAll(".checklist-text-input"), autoGrowNote);
}

/* =========================================================
 * 持ち物・やることリストの並べ替え（10 拡張・Pointer Events）
 * タイムラインのドラッグ実装（dragState・onDragHandlePointerDown系）と同じ設計思想
 * （Pointer Events + ハンドルからのみ開始 + ドロップインジケータ）を踏襲するが、
 * 対象配列が2種類（trip.packing/trip.todos）かつ描画先が2箇所（main/prepModal）ある点が
 * タイムライン（1つの el.timeline・1つの day.items）と異なるため、別関数として実装する。
 * positionGhost はタイムライン側と共通利用する
 * ========================================================= */
function onChecklistDragPointerDown(e) {
  if (viewOnly) return;
  var handle = e.target.closest(".checklist-drag-handle");
  if (!handle) return;
  var row = handle.closest(".checklist-item");
  if (!row) return;

  e.preventDefault();

  var container = e.currentTarget;
  var kind = container.dataset.checklistKind;
  var id = row.dataset.id;
  var list = checklistArray(kind);
  var startIndex = list.findIndex(function (it) {
    return it.id === id;
  });
  if (startIndex === -1) return;

  var rect = row.getBoundingClientRect();

  var ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  var textNode = row.querySelector(".checklist-text-input");
  var ghostText = document.createElement("span");
  ghostText.textContent = textNode ? textNode.value : "";
  ghost.appendChild(ghostText);
  document.body.appendChild(ghost);

  var offsetY = e.clientY - rect.top;
  positionGhost(ghost, e.clientX, e.clientY, offsetY);

  row.classList.add("dragging");

  var indicator = document.createElement("div");
  indicator.className = "drop-indicator";
  row.parentNode.insertBefore(indicator, row.nextSibling);

  checklistDragState = {
    pointerId: e.pointerId,
    handle: handle,
    row: row,
    container: container,
    kind: kind,
    ghost: ghost,
    indicator: indicator,
    offsetY: offsetY,
    draggedId: id
  };

  try {
    handle.setPointerCapture(e.pointerId);
  } catch (err) {
    /* ignore */
  }

  handle.addEventListener("pointermove", onChecklistDragPointerMove);
  handle.addEventListener("pointerup", onChecklistDragPointerUp);
  handle.addEventListener("pointercancel", onChecklistDragPointerCancel);
}

function onChecklistDragPointerMove(e) {
  if (!checklistDragState || e.pointerId !== checklistDragState.pointerId) return;
  positionGhost(checklistDragState.ghost, e.clientX, e.clientY, checklistDragState.offsetY);

  var container = checklistDragState.container;
  var rows = Array.prototype.slice.call(container.querySelectorAll(".checklist-item"));
  var targetEl = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r === checklistDragState.row) continue;
    var rect = r.getBoundingClientRect();
    var mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      targetEl = r;
      break;
    }
  }

  if (targetEl) {
    container.insertBefore(checklistDragState.indicator, targetEl);
  } else {
    container.appendChild(checklistDragState.indicator);
  }
}

function onChecklistDragPointerUp(e) {
  if (!checklistDragState || e.pointerId !== checklistDragState.pointerId) return;
  finishChecklistDrag();
}

function onChecklistDragPointerCancel(e) {
  if (!checklistDragState || e.pointerId !== checklistDragState.pointerId) return;
  cleanupChecklistDrag();
}

function finishChecklistDrag() {
  var container = checklistDragState.container;
  var kind = checklistDragState.kind;
  var indicator = checklistDragState.indicator;
  var draggedId = checklistDragState.draggedId;

  var nodes = Array.prototype.slice.call(container.children).filter(function (node) {
    return node === indicator || (node.classList && node.classList.contains("checklist-item"));
  });

  var indicatorPos = nodes.indexOf(indicator);
  var idsBeforeIndicator = [];
  var allIds = [];
  nodes.forEach(function (node, i) {
    if (node === indicator) return;
    allIds.push(node.dataset.id);
    if (indicatorPos !== -1 && i < indicatorPos && node.dataset.id !== draggedId) {
      idsBeforeIndicator.push(node.dataset.id);
    }
  });

  var idsWithoutDragged = allIds.filter(function (id) {
    return id !== draggedId;
  });
  var insertAt = indicatorPos === -1 ? idsWithoutDragged.length : idsBeforeIndicator.length;
  idsWithoutDragged.splice(insertAt, 0, draggedId);

  var list = checklistArray(kind);
  var itemsById = {};
  list.forEach(function (it) {
    itemsById[it.id] = it;
  });
  var reordered = idsWithoutDragged.map(function (id) {
    return itemsById[id];
  });
  if (kind === "packing") {
    trip.packing = reordered;
  } else {
    trip.todos = reordered;
  }

  cleanupChecklistDrag();
  saveState();
  // main/prepModal の両方に反映する（renderChecklistSection の既存パターンを踏襲）
  renderChecklistSection(kind);
}

function cleanupChecklistDrag() {
  if (!checklistDragState) return;
  var handle = checklistDragState.handle;
  handle.removeEventListener("pointermove", onChecklistDragPointerMove);
  handle.removeEventListener("pointerup", onChecklistDragPointerUp);
  handle.removeEventListener("pointercancel", onChecklistDragPointerCancel);
  try {
    handle.releasePointerCapture(checklistDragState.pointerId);
  } catch (err) {
    /* ignore */
  }
  if (checklistDragState.ghost && checklistDragState.ghost.parentNode) checklistDragState.ghost.parentNode.removeChild(checklistDragState.ghost);
  if (checklistDragState.indicator && checklistDragState.indicator.parentNode) checklistDragState.indicator.parentNode.removeChild(checklistDragState.indicator);
  if (checklistDragState.row) checklistDragState.row.classList.remove("dragging");
  checklistDragState = null;
}

/* =========================================================
 * 項目 CRUD
 * ========================================================= */
function deleteItem(id) {
  if (viewOnly) return;
  var day = trip.days[currentDayIndex];
  var idx = day.items.findIndex(function (it) {
    return it.id === id;
  });
  if (idx === -1) return;
  // 削除した項目と位置を控え、「元に戻す」で同じ場所に復元できるようにする。
  // スマホでは🗑を誤タップしやすく、確認ダイアログを毎回出すより操作を邪魔しない
  var removed = day.items[idx];
  var dayIdx = currentDayIndex;
  day.items.splice(idx, 1);
  saveState();
  render();
  showActionToast(t("toast.itemDeleted"), t("toast.undo"), function () {
    var d = trip.days[dayIdx];
    if (!d) return; // 日ごと消えていた場合は何もしない
    d.items.splice(Math.min(idx, d.items.length), 0, removed);
    currentDayIndex = dayIdx;
    saveState();
    render();
  });
}

// 項目を1つ上/下へ動かす。ドラッグが使えない場面（キーボード操作・細かい調整）の補助。
// 端まで来たら前後の日へ移す（「この観光を2日目に回す」が複製+削除なしでできる）
function nudgeItem(id, dir) {
  if (viewOnly) return;
  var day = trip.days[currentDayIndex];
  var idx = day.items.findIndex(function (it) {
    return it.id === id;
  });
  if (idx === -1) return;
  var target = idx + dir;
  if (target >= 0 && target < day.items.length) {
    // 同じ日の中で入れ替え
    var tmp = day.items[idx];
    day.items[idx] = day.items[target];
    day.items[target] = tmp;
    saveState();
    render();
    return;
  }
  // 端を越えたら隣の日へ移す（先頭より上→前日の末尾 / 末尾より下→翌日の先頭）
  var destDayIdx = currentDayIndex + dir;
  if (destDayIdx < 0 || destDayIdx >= trip.days.length) return;
  var moved = day.items.splice(idx, 1)[0];
  var destDay = trip.days[destDayIdx];
  if (dir < 0) destDay.items.push(moved);
  else destDay.items.unshift(moved);
  currentDayIndex = destDayIdx; // 追いかけて表示を移す
  saveState();
  render();
  showToast(t("timeline.movedToDay", { n: destDayIdx + 1 }));
}

// カードの完全コピー（idのみ新規発行）を直後に挿入する（move も複製可）
function duplicateItem(id) {
  if (viewOnly) return;
  var day = trip.days[currentDayIndex];
  var idx = day.items.findIndex(function (it) {
    return it.id === id;
  });
  if (idx === -1) return;
  var copy = JSON.parse(JSON.stringify(day.items[idx]));
  copy.id = genId();
  day.items.splice(idx + 1, 0, copy);
  saveState();
  render();
}

function addItemFromForm() {
  if (viewOnly) return;
  var name = el.addName.value.trim();
  if (!name) {
    showToast(t("toast.nameRequired"), "error");
    el.addName.focus();
    return;
  }
  var dur = clampInt(el.addDur.value, 0, 100000, 0);
  var note = el.addNote.value.trim();
  var item = {
    id: genId(),
    cat: addFormCat,
    name: name,
    loc: "",
    dur: dur,
    note: note,
    priv: false,
    notePriv: false,
    fixedStart: null,
    lat: null,
    lon: null,
    coordSrc: null,
    names: {},
    noteNames: {}
  };
  if (addFormCat === "move") {
    item.mode = "train";
    item.distKm = null;
    item.auto = false;
    item.arriveTz = "";
  } else {
    item.gmap = "";
    item.gmapAuto = false;
  }
  trip.days[currentDayIndex].items.push(item);
  el.addName.value = "";
  el.addNote.value = "";
  saveState();
  render();
  el.addName.focus();
}

/* =========================================================
 * 日タブ操作
 * ========================================================= */
function requestDeleteDay(idx) {
  if (viewOnly) return;
  if (trip.days.length <= 1) {
    showToast(t("day.cannotDeleteLast"), "error");
    return;
  }
  showConfirm(t("day.deleteConfirmTitle"), t("day.deleteConfirmBody", { n: idx + 1 }), function () {
    trip.days.splice(idx, 1);
    if (currentDayIndex >= trip.days.length) {
      currentDayIndex = trip.days.length - 1;
    } else if (currentDayIndex > idx) {
      currentDayIndex -= 1;
    }
    // 日付の自動連番（2）: 日を削除すると前後関係が変わるため、自動の日を再計算する
    recalcAutoDates();
    saveState();
    render();
  });
}

/* =========================================================
 * ドラッグ&ドロップ（Pointer Events）
 * ========================================================= */
function onDragHandlePointerDown(e) {
  if (viewOnly) return;
  var handle = e.target.closest(".drag-handle");
  if (!handle) return;
  var card = handle.closest(".item-card");
  if (!card) return;

  e.preventDefault();

  var id = card.dataset.id;
  var day = trip.days[currentDayIndex];
  var startIndex = day.items.findIndex(function (it) {
    return it.id === id;
  });
  if (startIndex === -1) return;

  var rect = card.getBoundingClientRect();

  var ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  var iconNode = card.querySelector(".item-time-col .icon");
  var nameNode = card.querySelector(".item-name");
  var ghostIcon = document.createElement("span");
  ghostIcon.textContent = iconNode ? iconNode.textContent : "";
  var ghostName = document.createElement("span");
  ghostName.textContent = nameNode ? nameNode.value : "";
  ghost.appendChild(ghostIcon);
  ghost.appendChild(ghostName);
  document.body.appendChild(ghost);

  var offsetY = e.clientY - rect.top;
  positionGhost(ghost, e.clientX, e.clientY, offsetY);

  card.classList.add("dragging");

  var indicator = document.createElement("div");
  indicator.className = "drop-indicator";
  card.parentNode.insertBefore(indicator, card.nextSibling);

  dragState = {
    pointerId: e.pointerId,
    handle: handle,
    card: card,
    ghost: ghost,
    indicator: indicator,
    offsetY: offsetY,
    draggedId: id
  };

  try {
    handle.setPointerCapture(e.pointerId);
  } catch (err) {
    /* ignore */
  }

  handle.addEventListener("pointermove", onDragPointerMove);
  handle.addEventListener("pointerup", onDragPointerUp);
  handle.addEventListener("pointercancel", onDragPointerCancel);
}

function positionGhost(ghost, clientX, clientY, offsetY) {
  ghost.style.top = clientY - offsetY + "px";
  ghost.style.left = clientX + 16 + "px";
}

function onDragPointerMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  positionGhost(dragState.ghost, e.clientX, e.clientY, dragState.offsetY);

  var cards = Array.prototype.slice.call(el.timeline.querySelectorAll(".item-card"));
  var targetEl = null;
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (c === dragState.card) continue;
    var r = c.getBoundingClientRect();
    var mid = r.top + r.height / 2;
    if (e.clientY < mid) {
      targetEl = c;
      break;
    }
  }

  if (targetEl) {
    el.timeline.insertBefore(dragState.indicator, targetEl);
  } else {
    el.timeline.appendChild(dragState.indicator);
  }
}

function onDragPointerUp(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  finishDrag();
}

function onDragPointerCancel(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  cleanupDrag();
}

function finishDrag() {
  var day = trip.days[currentDayIndex];
  var indicator = dragState.indicator;
  var draggedId = dragState.draggedId;

  var nodes = Array.prototype.slice.call(el.timeline.children).filter(function (node) {
    return node === indicator || (node.classList && node.classList.contains("item-card"));
  });

  var indicatorPos = nodes.indexOf(indicator);
  var idsBeforeIndicator = [];
  var allIds = [];
  nodes.forEach(function (node, i) {
    if (node === indicator) return;
    allIds.push(node.dataset.id);
    if (indicatorPos !== -1 && i < indicatorPos && node.dataset.id !== draggedId) {
      idsBeforeIndicator.push(node.dataset.id);
    }
  });

  var idsWithoutDragged = allIds.filter(function (id) {
    return id !== draggedId;
  });
  var insertAt = indicatorPos === -1 ? idsWithoutDragged.length : idsBeforeIndicator.length;
  idsWithoutDragged.splice(insertAt, 0, draggedId);

  var itemsById = {};
  day.items.forEach(function (it) {
    itemsById[it.id] = it;
  });
  day.items = idsWithoutDragged.map(function (id) {
    return itemsById[id];
  });

  cleanupDrag();
  saveState();
  render();
}

function cleanupDrag() {
  if (!dragState) return;
  var handle = dragState.handle;
  handle.removeEventListener("pointermove", onDragPointerMove);
  handle.removeEventListener("pointerup", onDragPointerUp);
  handle.removeEventListener("pointercancel", onDragPointerCancel);
  try {
    handle.releasePointerCapture(dragState.pointerId);
  } catch (err) {
    /* ignore */
  }
  if (dragState.ghost && dragState.ghost.parentNode) dragState.ghost.parentNode.removeChild(dragState.ghost);
  if (dragState.indicator && dragState.indicator.parentNode) dragState.indicator.parentNode.removeChild(dragState.indicator);
  if (dragState.card) dragState.card.classList.remove("dragging");
  dragState = null;
}
