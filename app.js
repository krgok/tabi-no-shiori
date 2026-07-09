/**
 * app.js
 * 「旅のしおり」アプリ本体
 * 状態管理・描画・ドラッグ&ドロップ・ルート計算・共有・テキスト入出力
 * 外部ライブラリ不使用のバニラJS（ES2020+）。XSS対策として textContent / createElement のみ使用。
 */
(function () {
  "use strict";

  /* =========================================================
   * 定数
   * ========================================================= */
  var STORAGE_KEY_V1 = "tabi-shiori-v1";
  var STORAGE_KEY = "tabi-shiori-v2"; // v2: { currentId, trips: [{ id, data: <trip> }] }（複数しおりの管理 9）
  var GEO_CACHE_KEY = "tabi-geo-cache";
  var MAP_OPEN_KEY = "tabi-map-open";
  var NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
  var GEOCODE_MIN_INTERVAL_MS = 1100;
  var MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  var MAP_DEFAULT_CENTER = [36.5, 138];
  var MAP_DEFAULT_ZOOM = 5;
  var MAP_LINE_COLOR = "#f2749a";

  // Google Routes API 連携
  var GMAPS_KEY_STORAGE = "tabi-gmaps-key";
  var ROUTES_CACHE_KEY = "tabi-routes-cache";
  var ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
  var ROUTES_FIELD_MASK = "routes.duration,routes.distanceMeters,routes.legs.startLocation,routes.legs.endLocation";
  // Places API (New) Text Search（スポット位置解決の統一チェーン 6d のフォールバック用）
  var PLACES_API_URL = "https://places.googleapis.com/v1/places:searchText";
  var PLACES_FIELD_MASK = "places.location,places.displayName";
  var PLACES_BIAS_RADIUS_M = 50000;
  // スポット名の多言語表示（3c 追記）: 対象言語での displayName 照会用。
  // スポット自身の座標があるときはごく狭い範囲（1km）に限定し、無いときは近隣アンカー基準（50km）を使う
  var PLACES_NAME_BIAS_RADIUS_M = 1000;
  // Cloud Translation API v2（3c 追記のフォールバック・6e のタイトル自動翻訳で共用）
  var TRANSLATE_API_URL = "https://translation.googleapis.com/language/translate/v2";
  // 手段セレクトの値 -> Routes API travelMode（plane/other はAPI照会対象外）
  var MODE_TO_API_TRAVELMODE = {
    walk: "WALK",
    car: "DRIVE",
    train: "TRANSIT",
    bus: "TRANSIT",
    shinkansen: "TRANSIT",
    ferry: "TRANSIT"
  };

  /* =========================================================
   * 状態
   * ========================================================= */
  var trip = null;
  // 複数しおりの管理（9）: tripsStore は [{ id, data: <trip> }] の配列。
  // trip 変数は常に tripsStore 内の現在のエントリの data と同一の参照を指す（saveState はこの配列全体を保存する）
  var tripsStore = [];
  var currentTripId = null;
  var currentDayIndex = 0;
  var addFormCat = "sight";
  var isGeoRunning = false;
  var lastGeocodeAt = 0;
  // Places API (New) の「未有効化」トーストは1回のルート検討/地図更新実行につき1回だけ表示する
  var placesApiErrorShown = false;
  // Cloud Translation API の「未有効化」トーストは1回の言語切替（名前補完・タイトル自動翻訳）につき1回だけ表示する
  var translateApiErrorShown = false;
  // スポット名の多言語表示（3c）: ルート検討/地図更新（isGeoRunning）とは別フラグで管理する。
  // nameFetchToken は実行中バッチの識別用。中断時にインクリメントし、進行中のループに「もう古い」と伝える
  var isNameFetchRunning = false;
  var nameFetchToken = 0;
  var nameFetchToastEl = null;
  var confirmCallback = null;
  var dragState = null;
  var leafletMap = null;
  var mapMarkersLayer = null;
  var mapLineLayer = null;
  var mapReady = false;

  var el = {};

  /* =========================================================
   * ユーティリティ
   * ========================================================= */
  function genId() {
    return Math.random().toString(36).slice(2, 8);
  }

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = fallback;
    if (min != null && n < min) n = min;
    if (max != null && n > max) n = max;
    return n;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function parseTimeToMinutes(str) {
    if (!str) return 9 * 60;
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str).trim());
    if (!m) return 9 * 60;
    var h = parseInt(m[1], 10);
    var mi = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mi)) return 9 * 60;
    return h * 60 + mi;
  }

  function minutesToTimeStr(mins) {
    var wrapped = ((mins % 1440) + 1440) % 1440;
    var overflowDays = Math.floor(mins / 1440);
    var h = Math.floor(wrapped / 60);
    var m = wrapped % 60;
    var s = pad2(h) + ":" + pad2(m);
    if (overflowDays > 0) s += " (+" + overflowDays + ")";
    return s;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function lang() {
    return (trip && trip.lang) || "ja";
  }

  function t(key, vars) {
    return window.I18N.t(lang(), key, vars);
  }

  function uniq(arr) {
    return arr.filter(function (v, idx) {
      return arr.indexOf(v) === idx;
    });
  }

  /* =========================================================
   * Google Maps 連携（座標抽出・リンク生成）
   * ========================================================= */
  function isSafeHttpUrl(str) {
    return typeof str === "string" && /^https?:\/\//i.test(str.trim());
  }

  function isShortGmapLink(str) {
    return typeof str === "string" && /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(str.trim());
  }

  function isValidLatLon(lat, lon) {
    return isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function extractGmapCoords(rawUrl) {
    var url = String(rawUrl || "");
    var decoded = url;
    try {
      decoded = decodeURIComponent(url);
    } catch (e) {
      decoded = url;
    }
    var candidates = uniq([decoded, url]);
    for (var i = 0; i < candidates.length; i++) {
      var u = candidates[i];
      var m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(u);
      if (m) {
        var lat1 = parseFloat(m[1]);
        var lon1 = parseFloat(m[2]);
        if (isValidLatLon(lat1, lon1)) return { lat: lat1, lon: lon1 };
      }
      m = /[?&](?:q|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(u);
      if (m) {
        var lat2 = parseFloat(m[1]);
        var lon2 = parseFloat(m[2]);
        if (isValidLatLon(lat2, lon2)) return { lat: lat2, lon: lon2 };
      }
      m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),\d+(?:\.\d+)?z/.exec(u);
      if (m) {
        var lat3 = parseFloat(m[1]);
        var lon3 = parseFloat(m[2]);
        if (isValidLatLon(lat3, lon3)) return { lat: lat3, lon: lon3 };
      }
    }
    return null;
  }

  // /maps/place/<場所名>/ の部分から場所名を抽出する（URLデコード + '+' を空白に置換）。
  // 抽出できない形式（短縮リンクや place を含まないURL等）では null を返す
  function extractGmapPlaceName(rawUrl) {
    var url = String(rawUrl || "");
    var m = /\/maps\/place\/([^/?#]+)/i.exec(url);
    if (!m) return null;
    var seg = m[1].replace(/\+/g, " ");
    try {
      seg = decodeURIComponent(seg);
    } catch (e) {
      return null;
    }
    seg = seg.trim();
    return seg || null;
  }

  function handleGmapChange(item, rawValue) {
    var value = (rawValue || "").trim();
    var prevGmap = item.gmap || "";
    if (value === prevGmap) return;
    item.gmap = value;
    // 手動で gmap 欄を編集したので、自動入力フラグ（地図更新ボタン由来）は解除する
    item.gmapAuto = false;

    if (!value) {
      if (item.coordSrc === "gmap") {
        item.lat = null;
        item.lon = null;
        item.coordSrc = null;
      }
      saveState();
      render();
      return;
    }

    var coords = extractGmapCoords(value);
    if (coords) {
      item.lat = coords.lat;
      item.lon = coords.lon;
      item.coordSrc = "gmap";
    } else if (item.coordSrc === "gmap") {
      item.lat = null;
      item.lon = null;
      item.coordSrc = null;
    }

    // 名前が空の項目のみ、リンクから場所名を補完する（既に名前がある場合は上書きしない）
    var filledName = null;
    if (!item.name.trim()) {
      var placeName = extractGmapPlaceName(value);
      if (placeName) {
        item.name = placeName;
        filledName = placeName;
      }
    }

    saveState();

    if (coords) {
      showToast(t("toast.gmapExtracted"));
    } else if (isShortGmapLink(value)) {
      showToast(t("toast.gmapShortLink"), "error");
    }
    if (filledName) {
      showToast(t("toast.gmapNameFilled", { name: filledName }));
    }

    render();
  }

  var TRAVELMODE_MAP = {
    walk: "walking",
    car: "driving",
    train: "transit",
    bus: "transit",
    shinkansen: "transit",
    ferry: "transit"
  };

  // スポット名の多言語表示（3c）: 表示用に names[現在言語] || name を返す（保存文字列は変更しない）
  function localizedStopName(stop) {
    if (stop && stop.names && typeof stop.names[lang()] === "string" && stop.names[lang()]) {
      return stop.names[lang()];
    }
    return (stop && stop.name) || "";
  }

  function findAdjacentStops(day, idx) {
    var items = day.items;
    var prev = null;
    for (var i = idx - 1; i >= 0; i--) {
      if (items[i].cat !== "move") {
        prev = items[i];
        break;
      }
    }
    var next = null;
    for (var j = idx + 1; j < items.length; j++) {
      if (items[j].cat !== "move") {
        next = items[j];
        break;
      }
    }
    return { prev: prev, next: next };
  }

  function stopParam(stop) {
    if (typeof stop.lat === "number" && typeof stop.lon === "number") {
      return stop.lat + "," + stop.lon;
    }
    return stop.loc || stop.name || "";
  }

  function buildMoveRouteLink(day, idx, mode) {
    var neighbors = findAdjacentStops(day, idx);
    if (!neighbors.prev || !neighbors.next) return null;
    var originStr = stopParam(neighbors.prev);
    var destStr = stopParam(neighbors.next);
    if (!originStr || !destStr) return null;
    var url =
      "https://www.google.com/maps/dir/?api=1&origin=" +
      encodeURIComponent(originStr) +
      "&destination=" +
      encodeURIComponent(destStr);
    var travelmode = TRAVELMODE_MAP[mode];
    if (travelmode) url += "&travelmode=" + travelmode;
    return { href: url };
  }

  /* =========================================================
   * ストレージ（複数しおりの管理 9: v2 = { currentId, trips: [{ id, data }] }）
   * ========================================================= */
  // 現在のしおりを保持する tripsStore のエントリを返す（見つからない場合は先頭にフォールバック）
  function getCurrentEntry() {
    for (var i = 0; i < tripsStore.length; i++) {
      if (tripsStore[i].id === currentTripId) return tripsStore[i];
    }
    return tripsStore[0];
  }

  // trip 変数は常に tripsStore 内エントリの data と同一参照のため、
  // 保存は tripsStore 全体を書き出すだけでよい（該当エントリの内容は自動的に反映される）
  function saveState() {
    try {
      var storeObj = {
        currentId: currentTripId,
        trips: tripsStore.map(function (e) {
          return { id: e.id, data: e.data };
        })
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storeObj));
    } catch (e) {
      console.warn("save failed", e);
    }
  }

  // v2 ストレージを読み込む。壊れたJSON・不正な構造は null を返し、呼び出し元でフォールバックさせる
  function loadStoreV2() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.trips)) return null;
      var trips = parsed.trips
        .map(function (entry) {
          if (!entry || typeof entry !== "object" || !entry.data || !Array.isArray(entry.data.days)) return null;
          var id = typeof entry.id === "string" && entry.id ? entry.id : genId();
          return { id: id, data: normalizeTrip(entry.data) };
        })
        .filter(Boolean);
      if (trips.length === 0) return null;
      var currentId = parsed.currentId;
      var hasCurrent = trips.some(function (e) {
        return e.id === currentId;
      });
      if (!hasCurrent) currentId = trips[0].id;
      return { currentId: currentId, trips: trips };
    } catch (e) {
      return null;
    }
  }

  // 旧キー tabi-shiori-v1 があれば最初のしおりとして移行し、旧キーは（成功・失敗を問わず）残さず削除する
  function migrateV1() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY_V1);
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    var result = null;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.days)) {
        var id = genId();
        result = { currentId: id, trips: [{ id: id, data: normalizeTrip(parsed) }] };
      }
    } catch (e) {
      /* 壊れたJSON: 移行データなしとして扱う（起動は壊さない） */
    }
    try {
      localStorage.removeItem(STORAGE_KEY_V1);
    } catch (e) {
      /* ignore */
    }
    return result;
  }

  // v2 を優先し、無ければ v1 からの移行を試みる。どちらも無ければ null（呼び出し元でサンプルしおりを作成する）
  function loadState() {
    var v2 = loadStoreV2();
    if (v2) return v2;
    return migrateV1();
  }

  function getGeoCache() {
    try {
      var raw = localStorage.getItem(GEO_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveGeoCache(cache) {
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      /* ignore */
    }
  }

  // Google Maps APIキー。trip には絶対に含めない（共有リンク・テキスト出力対策）
  function getGmapsKey() {
    try {
      return (localStorage.getItem(GMAPS_KEY_STORAGE) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function setGmapsKey(key) {
    try {
      if (key) {
        localStorage.setItem(GMAPS_KEY_STORAGE, key);
      } else {
        localStorage.removeItem(GMAPS_KEY_STORAGE);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function getRoutesCache() {
    try {
      var raw = localStorage.getItem(ROUTES_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveRoutesCache(cache) {
    try {
      localStorage.setItem(ROUTES_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      /* ignore */
    }
  }

  /* =========================================================
   * データ正規化
   * ========================================================= */
  // names: { en?: string|null, zh?: string|null, th?: string|null, ja?: string|null }
  // 取得済みの言語のみキーを持つ（null =「取得を試みたが無かった」の記録で再取得しない）。
  // 不正な型・未知の言語キーは無視する
  function normalizeNames(raw) {
    var names = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      window.I18N.LANGUAGES.forEach(function (Lc) {
        if (Object.prototype.hasOwnProperty.call(raw, Lc)) {
          var v = raw[Lc];
          if (typeof v === "string" || v === null) {
            names[Lc] = v;
          }
        }
      });
    }
    return names;
  }

  // しおりデータの多言語タイトル（6e）: { ja?, en?, zh?, th? }（文字列型のキーのみ・未知言語キーは無視）。
  // normalizeNames と同様の防御的処理だが、null は許容しない（タイトルは常に文字列 or 未設定）
  function normalizeTitles(raw) {
    var titles = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      window.I18N.LANGUAGES.forEach(function (Lc) {
        if (Object.prototype.hasOwnProperty.call(raw, Lc) && typeof raw[Lc] === "string") {
          titles[Lc] = raw[Lc];
        }
      });
    }
    return titles;
  }

  function normalizeTrip(raw) {
    var out = {
      v: 1,
      title: typeof raw.title === "string" ? raw.title : "",
      titles: normalizeTitles(raw.titles),
      lang: window.I18N.LANGUAGES.indexOf(raw.lang) !== -1 ? raw.lang : lang(),
      days: []
    };
    var days = Array.isArray(raw.days) ? raw.days : [];
    if (days.length === 0) {
      days = [{ date: "", startTime: "09:00", items: [] }];
    }
    days.forEach(function (d) {
      var day = {
        date: typeof d.date === "string" ? d.date : "",
        startTime: typeof d.startTime === "string" && d.startTime ? d.startTime : "09:00",
        items: []
      };
      var items = Array.isArray(d.items) ? d.items : [];
      items.forEach(function (it) {
        var cat = window.I18N.CATEGORIES.indexOf(it.cat) !== -1 ? it.cat : "sight";
        var item = {
          id: typeof it.id === "string" && it.id ? it.id : genId(),
          cat: cat,
          name: typeof it.name === "string" ? it.name : "",
          loc: typeof it.loc === "string" ? it.loc : "",
          dur: clampInt(it.dur, 0, 100000, 0),
          note: typeof it.note === "string" ? it.note : "",
          lat: typeof it.lat === "number" && isFinite(it.lat) ? it.lat : null,
          lon: typeof it.lon === "number" && isFinite(it.lon) ? it.lon : null,
          coordSrc: it.coordSrc === "gmap" || it.coordSrc === "geo" ? it.coordSrc : null
        };
        if (item.lat == null || item.lon == null) {
          item.coordSrc = null;
        }
        if (cat === "move") {
          item.mode = window.I18N.MODES.indexOf(it.mode) !== -1 ? it.mode : "other";
          item.distKm = typeof it.distKm === "number" && isFinite(it.distKm) ? it.distKm : null;
          item.auto = !!it.auto;
          item.approx = !!it.approx;
          item.unresolved = !!it.unresolved;
        } else {
          item.gmap = typeof it.gmap === "string" ? it.gmap : "";
          // 地図更新ボタンが自動入力した gmap リンクかどうかのフラグ（3b追記）
          item.gmapAuto = !!it.gmapAuto;
          item.names = normalizeNames(it.names);
        }
        day.items.push(item);
      });
      out.days.push(day);
    });
    return out;
  }

  /* =========================================================
   * サンプルデータ
   * ========================================================= */
  function createSampleTrip() {
    var items = [
      { id: genId(), cat: "sight", name: "浅草寺", loc: "", dur: 90, note: "雷門で写真", lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {} },
      { id: genId(), cat: "move", name: "浅草寺 → 上野公園", loc: "", dur: 25, note: "", lat: null, lon: null, coordSrc: null, mode: "train", distKm: 6.2, auto: true },
      { id: genId(), cat: "sight", name: "上野公園", loc: "", dur: 60, note: "散策", lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {} },
      { id: genId(), cat: "meal", name: "上野でランチ", loc: "", dur: 60, note: "", lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {} },
      { id: genId(), cat: "stay", name: "三井ガーデンホテル上野", loc: "", dur: 0, note: "チェックイン15:00", lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {} }
    ];
    return {
      v: 1,
      title: "東京旅行",
      titles: Object.assign({}, window.I18N.SAMPLE_TRIP_TITLES),
      lang: "ja",
      days: [{ date: "2026-07-20", startTime: "09:00", items: items }]
    };
  }

  // 複数しおりの管理（9）: 「＋ 新しいしおり」で作成する空のしおり。タイトルは現在言語のデフォルトを4言語プリセット
  function createBlankTripData() {
    return {
      v: 1,
      title: window.I18N.NEW_TRIP_TITLES.ja,
      titles: Object.assign({}, window.I18N.NEW_TRIP_TITLES),
      lang: lang(),
      days: [{ date: "", startTime: "09:00", items: [] }]
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
    el.dayStartTimeInput = document.getElementById("dayStartTimeInput");
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

    el.shareModal = document.getElementById("shareModal");
    el.shareUrl = document.getElementById("shareUrl");
    el.shareCopyBtn = document.getElementById("shareCopyBtn");

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

    el.settingsBtn = document.getElementById("settingsBtn");
    el.settingsModal = document.getElementById("settingsModal");
    el.settingsApiKeyInput = document.getElementById("settingsApiKeyInput");
    el.settingsSaveBtn = document.getElementById("settingsSaveBtn");
    el.settingsDeleteBtn = document.getElementById("settingsDeleteBtn");

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

    renderHeader();
    renderDayTabs();
    renderDayMeta();
    renderTimeline();
    renderAddForm();
    updateMap();
    updateMapStickyOffset();
    if (el.tripsModal && !el.tripsModal.classList.contains("hidden")) renderTripsList();

    el.langSelect.value = lang();
  }

  // しおりデータの多言語タイトル（6e）: titles[現在言語] || title を返す。
  // ヘッダーのタイトル表示・しおり一覧・共有/テキスト出力のいずれもこれを共用する
  function tripDisplayTitle(data) {
    var tt = data && data.titles;
    if (tt && typeof tt[lang()] === "string" && tt[lang()]) return tt[lang()];
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

  function renderHeader() {
    if (document.activeElement !== el.tripTitle) {
      el.tripTitle.textContent = tripDisplayTitle(trip);
    }
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
  }

  function getDayTimedItems(day) {
    var cursor = parseTimeToMinutes(day.startTime || "09:00");
    return day.items.map(function (item) {
      var startMin = cursor;
      var endMin = cursor + (item.dur || 0);
      cursor = endMin;
      return { item: item, startMin: startMin, endMin: endMin };
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
      el.timeline.appendChild(buildItemCard(timed.item, timed.startMin, timed.endMin, day, idx, numMap));
    });
  }

  function buildItemCard(item, startMin, endMin, day, idx, numMap) {
    var card = document.createElement("div");
    card.className = "item-card cat-" + item.cat + (item.cat === "move" && item.unresolved ? " item-card-unresolved" : "");
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
    timeText.textContent = minutesToTimeStr(startMin) + t("timeline.timeSep") + minutesToTimeStr(endMin);
    timeCol.appendChild(timeText);
    card.appendChild(timeCol);

    var body = document.createElement("div");
    body.className = "item-body";

    var nameRow = document.createElement("div");
    nameRow.className = "item-name-row";

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "item-name";
    nameInput.value = item.name;
    nameInput.placeholder = t("timeline.namePlaceholder");
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
      if (localizedName && localizedName !== item.name) {
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
      metaRow.appendChild(modeSelect);

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
      gmapRow.appendChild(gmapInput);

      body.appendChild(gmapRow);
    }

    var noteInput = document.createElement("textarea");
    noteInput.className = "item-note";
    noteInput.rows = 1;
    noteInput.placeholder = t("timeline.notePlaceholder");
    noteInput.value = item.note || "";
    noteInput.addEventListener("change", function () {
      item.note = noteInput.value;
      saveState();
    });
    body.appendChild(noteInput);

    card.appendChild(body);

    var dupBtn = document.createElement("button");
    dupBtn.type = "button";
    dupBtn.className = "item-duplicate";
    dupBtn.textContent = "⧉";
    dupBtn.title = t("timeline.duplicateItem");
    dupBtn.setAttribute("aria-label", t("timeline.duplicateItem"));
    dupBtn.addEventListener("click", function () {
      duplicateItem(item.id);
    });
    card.appendChild(dupBtn);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "item-delete";
    delBtn.textContent = "🗑";
    delBtn.setAttribute("aria-label", t("timeline.deleteItem"));
    delBtn.addEventListener("click", function () {
      deleteItem(item.id);
    });
    card.appendChild(delBtn);

    return card;
  }

  function renderAddForm() {
    el.addName.placeholder = t("add.namePlaceholder");
    el.addNote.placeholder = t("add.notePlaceholder");
    el.addDurUnit.textContent = window.I18N.DURATION_UNITS[lang()];
    Array.prototype.forEach.call(el.addFormCats.querySelectorAll(".cat-btn"), function (btn) {
      btn.classList.toggle("selected", btn.dataset.cat === addFormCat);
    });
  }

  /* =========================================================
   * 項目 CRUD
   * ========================================================= */
  function deleteItem(id) {
    var day = trip.days[currentDayIndex];
    day.items = day.items.filter(function (it) {
      return it.id !== id;
    });
    saveState();
    render();
  }

  // カードの完全コピー（idのみ新規発行）を直後に挿入する（move も複製可）
  function duplicateItem(id) {
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
      lat: null,
      lon: null,
      coordSrc: null
    };
    if (addFormCat === "move") {
      item.mode = "train";
      item.distKm = null;
      item.auto = false;
    } else {
      item.gmap = "";
      item.gmapAuto = false;
      item.names = {};
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
      saveState();
      render();
    });
  }

  /* =========================================================
   * ドラッグ&ドロップ（Pointer Events）
   * ========================================================= */
  function onDragHandlePointerDown(e) {
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

  /* =========================================================
   * ルート計算（Nominatim ジオコーディング）
   * ========================================================= */
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = ((lat2 - lat1) * Math.PI) / 180;
    var dLon = ((lon2 - lon1) * Math.PI) / 180;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function estimateModeAndDuration(distKm) {
    var mode, minutes;
    if (distKm < 1.5) {
      mode = "walk";
      minutes = (distKm / 4.5) * 60;
    } else if (distKm < 30) {
      mode = "train";
      minutes = (distKm / 25) * 60 + 12;
    } else if (distKm < 200) {
      mode = "train";
      minutes = (distKm / 70) * 60 + 25;
    } else if (distKm < 700) {
      mode = "shinkansen";
      minutes = (distKm / 180) * 60 + 40;
    } else {
      mode = "plane";
      minutes = (distKm / 700) * 60 + 150;
    }
    minutes = Math.max(5, Math.round(minutes / 5) * 5);
    return { mode: mode, minutes: minutes };
  }

  function recalcDurationForMode(mode, distKm) {
    if (distKm == null || !isFinite(distKm)) return null;
    var minutes;
    switch (mode) {
      case "walk":
        minutes = (distKm / 4.5) * 60;
        break;
      case "train":
        minutes = distKm < 30 ? (distKm / 25) * 60 + 12 : (distKm / 70) * 60 + 25;
        break;
      case "bus":
        minutes = (distKm / 18) * 60 + 15;
        break;
      case "car":
        minutes = (distKm / 35) * 60 + 5;
        break;
      case "shinkansen":
        minutes = (distKm / 180) * 60 + 40;
        break;
      case "plane":
        minutes = (distKm / 700) * 60 + 150;
        break;
      case "ferry":
        minutes = (distKm / 20) * 60 + 20;
        break;
      case "other":
      default:
        return null;
    }
    return Math.max(5, Math.round(minutes / 5) * 5);
  }

  function geocode(query) {
    var cache = getGeoCache();
    if (Object.prototype.hasOwnProperty.call(cache, query)) {
      return Promise.resolve(cache[query]);
    }
    var now = Date.now();
    var elapsed = now - lastGeocodeAt;
    var wait = elapsed < GEOCODE_MIN_INTERVAL_MS ? GEOCODE_MIN_INTERVAL_MS - elapsed : 0;

    return sleep(wait).then(function () {
      lastGeocodeAt = Date.now();
      var url = NOMINATIM_URL + "?format=json&limit=1&q=" + encodeURIComponent(query);
      return fetch(url, { headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) return null; // 一時的なAPIエラーはキャッシュしない
          return res.json().then(function (data) {
            var result = null;
            if (Array.isArray(data) && data.length > 0) {
              var lat = parseFloat(data[0].lat);
              var lon = parseFloat(data[0].lon);
              if (isFinite(lat) && isFinite(lon)) {
                result = { lat: lat, lon: lon };
              }
            }
            // 正常応答のみキャッシュ（「該当なし」の null は意図的に保存する）
            cache[query] = result;
            saveGeoCache(cache);
            return result;
          });
        })
        .catch(function () {
          return null; // ネットワークエラーはキャッシュせず次回再試行できるようにする
        });
    });
  }

  /* =========================================================
   * スポット位置解決の統一チェーン（6d）: 既存座標 → Nominatim → Places API (New) Text Search
   * ルート検討の Nominatim 経路（processPairViaNominatim）と地図更新（runMapUpdate）の両方が使う。
   * Routes API 経路（processPairViaRoutesApi）は失敗時に processPairViaNominatim へフォールバックするため、
   * 間接的にこのチェーンが効く。
   * ========================================================= */

  // Places Text Search の locationBias 中心＆キャッシュキーの粗い位置合わせに使う、
  // 同じ日の中で最も近い位置関係にある座標付きスポット（直前優先）。findAnchorStop（近隣アンカー概算）と同じロジックを流用する
  function findLocationBiasCenter(day, stop) {
    if (!day) return null;
    var anchor = findAnchorStop(day, stop);
    if (anchor && typeof anchor.lat === "number" && typeof anchor.lon === "number") {
      return { lat: anchor.lat, lon: anchor.lon };
    }
    return null;
  }

  // places: キャッシュキー。バイアスありのときは中心座標を小数1桁に丸めて含める
  // （チェーン店名が別都市の店舗にヒットしないよう、都市が変われば別キャッシュ扱いになる）
  function placesCacheKeyFor(query, biasCenter) {
    if (biasCenter) {
      return "places:" + query + "@" + biasCenter.lat.toFixed(1) + "," + biasCenter.lon.toFixed(1);
    }
    return "places:" + query;
  }

  // 実行（ルート検討/地図更新/名前補完・タイトル翻訳）開始時に呼ぶ。「Places API未有効化」トーストの1回制限をリセットする
  function resetPlacesApiErrorFlag() {
    placesApiErrorShown = false;
  }

  // 実行（言語切替の名前補完・タイトル翻訳）開始時に呼ぶ。「Translation API未有効化」トーストの1回制限をリセットする
  function resetTranslateApiErrorFlag() {
    translateApiErrorShown = false;
  }

  // Google Places API (New) の Text Search 共通下位処理。1件だけ問い合わせて place オブジェクト（または null）を返す。
  // 403/400（未有効化・キー制限）は専用トーストを実行につき1回だけ表示して null を返す。
  // ネットワークエラーは静かに null を返し、呼び出し元の既存フォールバックに委ねる
  function placesApiRequest(body, apiKey) {
    return fetch(PLACES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK
      },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        if (!res.ok) {
          var err = new Error("places api http error " + res.status);
          err.isPlacesApiError = true;
          err.notEnabled = res.status === 403 || res.status === 400;
          throw err;
        }
        return res.json();
      })
      .then(function (data) {
        return data && Array.isArray(data.places) && data.places.length > 0 ? data.places[0] : null;
      })
      .catch(function (err) {
        if (err && err.isPlacesApiError) {
          if (err.notEnabled && !placesApiErrorShown) {
            placesApiErrorShown = true;
            showToast(t("toast.placesApiNotEnabled"), "error");
          }
          return null;
        }
        return null; // ネットワークエラーはキャッシュせず次回再試行できるようにする
      });
  }

  // Google Places API (New) の Text Search を1件だけ問い合わせる（6d: スポット位置解決の統一チェーン用）。
  // languageCode は現在のUI言語。成功したら tabi-geo-cache にキャッシュする
  function placesTextSearch(query, apiKey, biasCenter, cacheKey) {
    var body = { textQuery: query, languageCode: lang(), pageSize: 1 };
    if (biasCenter) {
      body.locationBias = {
        circle: {
          center: { latitude: biasCenter.lat, longitude: biasCenter.lon },
          radius: PLACES_BIAS_RADIUS_M
        }
      };
    }

    return placesApiRequest(body, apiKey).then(function (place) {
      var loc = place && place.location;
      if (loc && typeof loc.latitude === "number" && typeof loc.longitude === "number") {
        var result = { lat: loc.latitude, lon: loc.longitude };
        var cache = getGeoCache();
        cache[cacheKey] = result;
        saveGeoCache(cache);
        return result;
      }
      return null;
    });
  }

  // スポット名の多言語表示（3c 追記）: Places Text Search を対象言語で照会し displayName.text を採用する。
  // biasCenter はスポット自身の座標があればそれ（半径1km）、無ければ近隣アンカー（findLocationBiasCenter・半径50km）。
  // キャッシュは行わない（names の既存キーで再取得を防ぐため）
  function placesDisplayNameSearch(item, day, targetLang, apiKey) {
    var query = (item.loc || item.name || "").trim();
    if (!query) return Promise.resolve(null);

    var biasCenter = null;
    var radius = PLACES_BIAS_RADIUS_M;
    if (typeof item.lat === "number" && typeof item.lon === "number") {
      biasCenter = { lat: item.lat, lon: item.lon };
      radius = PLACES_NAME_BIAS_RADIUS_M;
    } else {
      biasCenter = findLocationBiasCenter(day, item);
    }

    var body = { textQuery: query, languageCode: targetLang, pageSize: 1 };
    if (biasCenter) {
      body.locationBias = {
        circle: {
          center: { latitude: biasCenter.lat, longitude: biasCenter.lon },
          radius: radius
        }
      };
    }

    return placesApiRequest(body, apiKey).then(function (place) {
      var name = place && place.displayName && typeof place.displayName.text === "string" ? place.displayName.text.trim() : "";
      return name || null;
    });
  }

  // Cloud Translation API v2 で機械翻訳する（3c 追記のフォールバック・6e のタイトル自動翻訳で共用）。
  // 403/400（未有効化・キー制限）は専用トーストを実行につき1回だけ表示して null を返す。
  // ネットワークエラーは静かに null を返す
  function translateText(text, apiKey, targetLang) {
    if (!text) return Promise.resolve(null);
    return fetch(TRANSLATE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey
      },
      body: JSON.stringify({ q: text, target: targetLang, format: "text" })
    })
      .then(function (res) {
        if (!res.ok) {
          var err = new Error("translate api http error " + res.status);
          err.isTranslateApiError = true;
          err.notEnabled = res.status === 403 || res.status === 400;
          throw err;
        }
        return res.json();
      })
      .then(function (json) {
        var data = json && json.data;
        var translations = data && Array.isArray(data.translations) ? data.translations : null;
        var translated = translations && translations[0] && typeof translations[0].translatedText === "string" ? translations[0].translatedText.trim() : "";
        return translated || null;
      })
      .catch(function (err) {
        if (err && err.isTranslateApiError) {
          if (err.notEnabled && !translateApiErrorShown) {
            translateApiErrorShown = true;
            showToast(t("toast.translateApiNotEnabled"), "error");
          }
          return null;
        }
        return null; // ネットワークエラーは静かに次回再試行できるようにする
      });
  }

  // スポット位置解決の統一チェーン本体。
  // 1. 既に座標を持つ（gmap 由来含む）→ そのまま使う
  // 2. Nominatim（geocode。キャッシュ・レート制限は既存のまま）
  // 3. APIキーがあれば Google Places API (New) Text Search（成功時のみ tabi-geo-cache にキャッシュ）
  // 成功時は stop.lat/lon/coordSrc を直接更新する（呼び出し元での再代入は不要）
  function resolveStopCoords(stop, day) {
    if (typeof stop.lat === "number" && typeof stop.lon === "number") {
      return Promise.resolve({ lat: stop.lat, lon: stop.lon });
    }
    var query = (stop.loc || stop.name || "").trim();
    if (!query) return Promise.resolve(null);

    var biasCenter = findLocationBiasCenter(day, stop);
    var placesCacheKey = placesCacheKeyFor(query, biasCenter);

    // Places由来のキャッシュが既にあれば、Nominatim より先にそれを使ってよい（6d）
    var cache = getGeoCache();
    if (Object.prototype.hasOwnProperty.call(cache, placesCacheKey) && cache[placesCacheKey]) {
      var cachedPlace = cache[placesCacheKey];
      stop.lat = cachedPlace.lat;
      stop.lon = cachedPlace.lon;
      stop.coordSrc = "geo";
      return Promise.resolve(cachedPlace);
    }

    return geocode(query).then(function (geoResult) {
      if (geoResult) {
        stop.lat = geoResult.lat;
        stop.lon = geoResult.lon;
        stop.coordSrc = "geo";
        return geoResult;
      }
      var apiKey = getGmapsKey();
      if (!apiKey) return null;
      return placesTextSearch(query, apiKey, biasCenter, placesCacheKey).then(function (placeResult) {
        if (placeResult) {
          stop.lat = placeResult.lat;
          stop.lon = placeResult.lon;
          stop.coordSrc = "geo";
        }
        return placeResult;
      });
    });
  }

  /* =========================================================
   * スポット名の多言語表示（3c）: Nominatim の namedetails 付き検索による現地語名の取得
   * 既存の geocode() と同じレート制限（lastGeocodeAt / GEOCODE_MIN_INTERVAL_MS）を共用する。
   * 逆ジオコーディング（座標→名前）は「その地点にある別の施設」を拾ってしまうため使わない。
   * 名前で検索して当該POIの name:en / name:zh / name:th / name:ja タグを1リクエストで全言語分取る。
   * キャッシュは行わない（再取得は names の既存キーで防ぐ）
   * ========================================================= */
  function fetchSpotNameDetails(item) {
    var query = (item.loc || item.name || "").trim();
    if (!query) return Promise.resolve({ ok: false });

    var now = Date.now();
    var elapsed = now - lastGeocodeAt;
    var wait = elapsed < GEOCODE_MIN_INTERVAL_MS ? GEOCODE_MIN_INTERVAL_MS - elapsed : 0;

    return sleep(wait).then(function () {
      lastGeocodeAt = Date.now();
      var url = NOMINATIM_URL + "?format=json&limit=1&namedetails=1&q=" + encodeURIComponent(query);
      if (typeof item.lat === "number" && typeof item.lon === "number") {
        // 座標が分かっている場合は約4km四方に限定し、同名の別地域施設への誤ヒットを防ぐ
        var d = 0.02;
        url +=
          "&bounded=1&viewbox=" +
          (item.lon - d) + "," + (item.lat + d) + "," + (item.lon + d) + "," + (item.lat - d);
      }
      return fetch(url, { headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) return { ok: false }; // 一時的なAPIエラーは保存せず次回再試行
          return res.json().then(function (data) {
            var nd = Array.isArray(data) && data[0] && data[0].namedetails ? data[0].namedetails : {};
            function tag(keys) {
              for (var i = 0; i < keys.length; i++) {
                var v = nd[keys[i]];
                if (typeof v === "string" && v.trim()) return v.trim();
              }
              return null;
            }
            return {
              ok: true,
              names: {
                ja: tag(["name:ja"]),
                en: tag(["name:en"]),
                zh: tag(["name:zh", "name:zh-Hans", "name:zh-CN"]),
                th: tag(["name:th"])
              }
            };
          });
        })
        .catch(function () {
          return { ok: false }; // ネットワークエラーは保存せず次回再試行できるようにする
        });
    });
  }

  // 実行中の name-fetch バッチを安全に中断する（ルート検討/地図更新開始時に呼ぶ）。
  // トークンをインクリメントすることで、進行中のループに「もう古い」と伝える
  function abortNameFetch() {
    if (isNameFetchRunning) {
      nameFetchToken += 1;
      isNameFetchRunning = false;
    }
  }

  // 既存トーストを流用した控えめな進捗表示。呼ぶたびに新規トーストを積み上げず、
  // 表示中の同じトースト要素のテキストを更新する（連続表示で更新）
  function showNameFetchProgress(message) {
    if (nameFetchToastEl && nameFetchToastEl.parentNode) {
      nameFetchToastEl.textContent = message;
      clearTimeout(nameFetchToastEl._hideTimer);
    } else {
      var toast = document.createElement("div");
      toast.className = "toast";
      toast.textContent = message;
      el.toastContainer.appendChild(toast);
      requestAnimationFrame(function () {
        toast.classList.add("toast-show");
      });
      nameFetchToastEl = toast;
    }
    var toastRef = nameFetchToastEl;
    toastRef._hideTimer = setTimeout(function () {
      toastRef.classList.remove("toast-show");
      setTimeout(function () {
        if (toastRef.parentNode) toastRef.parentNode.removeChild(toastRef);
        if (nameFetchToastEl === toastRef) nameFetchToastEl = null;
      }, 300);
    }, 3600);
  }

  // 言語切替時に、全日の「名前があり names[新言語] がまだ非空文字列でない move 以外の項目」を対象に、
  // OSM namedetails → Places Text Search（APIキー設定時）→ Cloud Translation API（APIキー設定時）の順で
  // 逐次解決する（3c 追記のフォールバックチェーン）。ルート検討/地図更新（isGeoRunning）の実行中は開始しない。
  // 以前の name-fetch が実行中なら（連打対策として）中断してから新しいバッチを開始する
  function fetchLocalizedNames(targetLang) {
    abortNameFetch();
    if (isGeoRunning) return; // ルート検討/地図更新と競合させない

    var targets = [];
    trip.days.forEach(function (day) {
      day.items.forEach(function (item) {
        if (item.cat === "move") return;
        if (!((item.loc || item.name || "").trim())) return;
        if (!item.names) item.names = {};
        // names[targetLang] が非空文字列のときだけ取得済みとしてスキップする。
        // null（取得を試みたが見つからなかった）はキー追加後の再試行対象として残す
        if (typeof item.names[targetLang] === "string" && item.names[targetLang]) return;
        targets.push({ item: item, day: day });
      });
    });
    if (targets.length === 0) return;

    isNameFetchRunning = true;
    var myToken = (nameFetchToken += 1);
    var total = targets.length;
    var completed = 0;

    var chain = Promise.resolve();
    targets.forEach(function (pair) {
      var item = pair.item;
      var day = pair.day;
      chain = chain.then(function () {
        if (myToken !== nameFetchToken) return; // 中断済み：新規開始しない
        completed += 1;
        showNameFetchProgress(t("timeline.nameFetchProgress", { cur: completed, total: total }));

        // 1. OSM namedetails（全言語一括保存のため、names にいずれかのキーが既にある項目はスキップ）
        var hasAnyOsmKey = Object.keys(item.names).length > 0;
        var osmStep = hasAnyOsmKey
          ? Promise.resolve()
          : fetchSpotNameDetails(item).then(function (result) {
              // 中断後でも、既に発行済みのリクエストの結果は無駄にせずそのまま items に反映する。
              // ただしループの続行や完了処理（isNameFetchRunning解除・saveState・render）は行わない
              if (result.ok) {
                // 全言語を一括保存（見つからなかった言語は null =「取得済み・名前なし」）
                window.I18N.LANGUAGES.forEach(function (lg) {
                  item.names[lg] = result.names[lg];
                });
              }
            });

        return osmStep.then(function () {
          if (typeof item.names[targetLang] === "string" && item.names[targetLang]) return; // OSMで解決済み

          var apiKey = getGmapsKey();
          if (!apiKey) return; // キー未設定ならここまで（従来どおり null のまま）

          // 2. Places Text Search を対象言語で照会
          return placesDisplayNameSearch(item, day, targetLang, apiKey).then(function (placeName) {
            if (placeName) {
              item.names[targetLang] = placeName;
              return;
            }
            // 3. Cloud Translation API で機械翻訳
            var query = (item.loc || item.name || "").trim();
            return translateText(query, apiKey, targetLang).then(function (translated) {
              item.names[targetLang] = translated || null; // 全滅なら null のまま
            });
          });
        });
      });
    });

    chain.then(function () {
      if (myToken !== nameFetchToken) return; // 中断済み（既に isNameFetchRunning=false 済み）
      isNameFetchRunning = false;
      saveState();
      render();
    });
  }

  // しおりデータの多言語タイトル（6e 追記）: 言語切替時、titles[新言語] が無い/空、または
  // ベースタイトルと同一（＝未翻訳のまま）でAPIキーがあれば
  // ベースタイトル（titles.ja || title）を Cloud Translation API で翻訳して titles[新言語] に保存する。
  // fetchLocalizedNames と同じ言語切替ハンドラから呼ばれ、トースト管理（実行ごと1回）を共有する。
  // 手動編集はいつでも上書き可能（この関数は既に非空文字列かつベースタイトルと異なる値があれば何もしない）
  function fetchLocalizedTitle(targetLang) {
    if (!trip.titles) trip.titles = {};
    if (targetLang === "ja") return; // ja はベースタイトルそのものなので翻訳対象外

    var base = (trip.titles.ja || trip.title || "").trim();

    // titles[L] が「非空」かつ「ベースタイトルと異なる」場合のみ翻訳済みとみなしてスキップする。
    // titles[L] === base の場合は未翻訳（例: タイトルblurハンドラが変更なしで誤って
    // 現在の表示文字列を保存してしまった名残）とみなし、翻訳を実行して成功したら上書きする
    var current = trip.titles[targetLang];
    if (typeof current === "string" && current && current !== base) return;

    var apiKey = getGmapsKey();
    if (!apiKey) return;

    if (!base) return; // 翻訳できるベースタイトルが無ければ何もしない

    var myTrip = trip; // 翻訳完了までにしおりが切り替わっていた場合、誤って別のしおりに保存しない
    translateText(base, apiKey, targetLang).then(function (translated) {
      if (!translated) return;
      if (trip !== myTrip) return; // しおり切替後は保存しない
      var latest = myTrip.titles[targetLang];
      if (typeof latest === "string" && latest && latest !== base) return; // その間に手動編集された等
      myTrip.titles[targetLang] = translated;
      saveState();
      renderHeader();
    });
  }

  /* =========================================================
   * Google Routes API 連携
   * ========================================================= */

  // キャッシュキー・住所照会用に滞在地を文字列化する（座標優先）
  function stopKeyString(stop) {
    if (typeof stop.lat === "number" && typeof stop.lon === "number") {
      return stop.lat.toFixed(5) + "," + stop.lon.toFixed(5);
    }
    return (stop.loc || stop.name || "").trim().toLowerCase();
  }

  // Routes API の origin/destination フィールド（座標があれば latLng、なければ address）
  function stopRequestField(stop) {
    if (typeof stop.lat === "number" && typeof stop.lon === "number") {
      return { location: { latLng: { latitude: stop.lat, longitude: stop.lon } } };
    }
    return { address: stop.loc || stop.name || "" };
  }

  // 実際に成功した travelMode から表示用モードを決める。距離だけで判定してはいけない
  // （例: タイなど鉄道網の無い地域では TRANSIT が失敗して DRIVE で再試行されるが、
  // その結果を距離だけで「電車」と表示するのは誤り。実際に使われたモードを反映して「車」と表示する）
  function routesModeToDisplay(usedMode, distKm) {
    if (usedMode === "WALK") return "walk";
    if (usedMode === "DRIVE") return "car";
    // TRANSIT（Routes APIは飛行機を扱わないため、遠距離は新幹線扱いにする）
    return typeof distKm === "number" && distKm < 200 ? "train" : "shinkansen";
  }

  // 区間の出発予定時刻を組み立てる（日の日付＋累積時刻。過去日時なら翌日の同時刻に補正）
  function computeDepartureDate(day, minutesSinceMidnight) {
    var base;
    if (day.date && /^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
      var parts = day.date.split("-").map(function (n) {
        return parseInt(n, 10);
      });
      base = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    } else {
      base = new Date();
      base.setHours(0, 0, 0, 0);
    }
    var dt = new Date(base.getTime() + minutesSinceMidnight * 60000);
    var now = new Date();
    if (dt.getTime() < now.getTime()) {
      // 旅行日が過去の場合、+24hを1回足すだけでは何日も前の日付だと過去のままなので、
      // 「今後で最も近い同じ時刻」（今日または明日の同時刻）に補正する
      var next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      next = new Date(next.getTime() + (((minutesSinceMidnight % 1440) + 1440) % 1440) * 60000);
      if (next.getTime() < now.getTime()) {
        next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
      }
      dt = next;
    }
    return dt;
  }

  // その滞在地から出発する時刻（分・0時起点、日をまたぐ場合は1440超）を現在のタイムラインから求める
  function departureMinutesForStop(day, stopItem) {
    var idx = day.items.indexOf(stopItem);
    var fallback = parseTimeToMinutes(day.startTime || "09:00");
    if (idx === -1) return fallback;
    var timed = getDayTimedItems(day);
    return timed[idx] ? timed[idx].endMin : fallback;
  }

  // computeRoutes を1回呼び出す。res.ok と routes[0] の存在チェックを行う
  function callComputeRoutes(originStop, destStop, travelMode, departureDate, apiKey) {
    var body = {
      origin: stopRequestField(originStop),
      destination: stopRequestField(destStop),
      travelMode: travelMode
    };
    // departureTime は出発時刻が結果に影響する TRANSIT のときのみ付与する
    if (travelMode === "TRANSIT" && departureDate) {
      body.departureTime = departureDate.toISOString();
    }

    return fetch(ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK
      },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        if (!res.ok) {
          // 400 は「キー無効」と「地名が解決できない」の両方で返るため、
          // エラー本文のメッセージを見て区別する（403 は権限/API未有効化なのでキー系扱い）
          return res
            .json()
            .catch(function () {
              return null;
            })
            .then(function (errBody) {
              var msg = (errBody && errBody.error && errBody.error.message) || "";
              var err = new Error("routes api http error " + res.status + ": " + msg);
              err.isRoutesApiError = true;
              err.status = res.status;
              err.keyInvalid = res.status === 403 || (res.status === 400 && /api key/i.test(msg));
              // 地名が解決できない等の 400 はルート無し扱いにして DRIVE 再試行/フォールバックへ
              err.noRoute = res.status === 400 && !err.keyInvalid;
              throw err;
            });
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
          var noRouteErr = new Error("no route found");
          noRouteErr.isRoutesApiError = true;
          noRouteErr.noRoute = true;
          throw noRouteErr;
        }
        var route = data.routes[0];
        // duration は "1234s" のような文字列で返るため parseInt で秒数に変換する
        var durSec = typeof route.duration === "string" ? parseInt(route.duration, 10) : NaN;
        var distMeters =
          typeof route.distanceMeters === "number" ? route.distanceMeters : parseFloat(route.distanceMeters);
        var legs = Array.isArray(route.legs) ? route.legs : [];
        var startLoc = legs.length > 0 ? legs[0].startLocation : null;
        var endLoc = legs.length > 0 ? legs[legs.length - 1].endLocation : null;
        return {
          durSec: isFinite(durSec) ? durSec : null,
          distMeters: isFinite(distMeters) ? distMeters : null,
          startLatLng: startLoc && startLoc.latLng ? startLoc.latLng : null,
          endLatLng: endLoc && endLoc.latLng ? endLoc.latLng : null
        };
      });
  }

  // キャッシュを確認しつつ1つの travelMode で照会する（origin|dest|mode|departureHour で丸めてキャッシュ）
  function fetchRouteWithCache(originStop, destStop, travelMode, day, departureMinutes, apiKey) {
    var departureDate = computeDepartureDate(day, departureMinutes);
    var cacheKey =
      stopKeyString(originStop) + "|" + stopKeyString(destStop) + "|" + travelMode + "|" + departureDate.getHours();

    var cache = getRoutesCache();
    var cached = cache[cacheKey];
    if (cached && typeof cached.durMin === "number" && typeof cached.distKm === "number") {
      return Promise.resolve({
        durMin: cached.durMin,
        distKm: cached.distKm,
        startLatLng: null,
        endLatLng: null,
        // 既存キャッシュ（本機能追加前に保存されたもの）に usedMode が無い場合は、
        // キャッシュキーに使った travelMode をそのまま使う（このキャッシュ自体が travelMode 別に分かれているため）
        usedMode: cached.usedMode || travelMode,
        fromCache: true
      });
    }

    return callComputeRoutes(originStop, destStop, travelMode, departureDate, apiKey).then(function (result) {
      var distKm = result.distMeters != null ? result.distMeters / 1000 : null;
      var durMin = result.durSec != null ? Math.max(5, Math.round(result.durSec / 60 / 5) * 5) : null;
      if (distKm != null && durMin != null) {
        var freshCache = getRoutesCache();
        freshCache[cacheKey] = { durMin: durMin, distKm: distKm, usedMode: travelMode, ts: Date.now() };
        saveRoutesCache(freshCache);
      }
      return {
        durMin: durMin,
        distKm: distKm,
        startLatLng: result.startLatLng,
        endLatLng: result.endLatLng,
        usedMode: travelMode,
        fromCache: false
      };
    });
  }

  // ルート検討ボタン用: TRANSIT→(近距離ならWALK再照会)→(ルート無しならDRIVE再試行)
  function queryRouteForPairWithRetry(originStop, destStop, day, departureMinutes, apiKey) {
    return fetchRouteWithCache(originStop, destStop, "TRANSIT", day, departureMinutes, apiKey)
      .then(function (result) {
        if (result.distKm != null && result.distKm < 1.5) {
          return fetchRouteWithCache(originStop, destStop, "WALK", day, departureMinutes, apiKey);
        }
        return result;
      })
      .catch(function (err) {
        if (err && err.isRoutesApiError && err.noRoute) {
          return fetchRouteWithCache(originStop, destStop, "DRIVE", day, departureMinutes, apiKey);
        }
        throw err;
      });
  }

  // 呼び出し時点で day.items から auto な move は削除済みという前提で、
  // move 以外の連続する滞在地ペアを列挙する（間に手動 move が挟まっているペアは対象外）
  function buildRoutePairs(day) {
    var items = day.items;
    var stops = [];
    items.forEach(function (item, idx) {
      if (item.cat !== "move") stops.push({ item: item, idx: idx });
    });

    var pairs = [];
    for (var i = 0; i < stops.length - 1; i++) {
      var a = stops[i];
      var b = stops[i + 1];
      var between = items.slice(a.idx + 1, b.idx);
      if (between.length === 0) {
        pairs.push({ a: a.item, b: b.item });
      }
      /* 手動追加のmoveが間にある場合はそのままにする（生成対象外） */
    }
    return pairs;
  }

  // 場所を解決できないスポットの近隣アンカー概算:
  // stopItem 自身が座標を持たない場合に、同じ日の中で座標を持つ最寄りのスポットを探す。
  // 位置（day.items内の順序）が直前側を優先し、直前に見つからなければ直後側を探す。
  // move 項目は対象外。stopItem 自身に一致する要素はスキップする。
  function findAnchorStop(day, stopItem) {
    var items = day.items;
    var idx = items.indexOf(stopItem);
    if (idx === -1) return null;
    for (var i = idx - 1; i >= 0; i--) {
      var prevIt = items[i];
      if (prevIt.cat !== "move" && typeof prevIt.lat === "number" && typeof prevIt.lon === "number") {
        return prevIt;
      }
    }
    for (var j = idx + 1; j < items.length; j++) {
      var nextIt = items[j];
      if (nextIt.cat !== "move" && typeof nextIt.lat === "number" && typeof nextIt.lon === "number") {
        return nextIt;
      }
    }
    return null;
  }

  function runRouteCalculation(dayIndex) {
    if (isGeoRunning) return;
    // スポット名の多言語表示（3c）とはフラグ・レート制限を共用するため、
    // name-fetch が実行中なら安全に中断してからルート検討を開始する
    abortNameFetch();
    resetPlacesApiErrorFlag();
    var day = trip.days[dayIndex];
    if (!day || day.items.length < 2) return;

    // 並べ替え等で前後関係が変わり不要になった自動移動を残さないよう、
    // ルート検討のたびに auto な move を一旦すべて削除してから組み直す。
    // ユーザーが手動追加した move (auto=false) は削除しない。
    // 削除・挿入とも day.items 配列へのメモリ上の操作にとどめ、
    // saveState() は従来どおり計算完了時に1回だけ呼ぶ
    var removedAutoMove = false;
    day.items = day.items.filter(function (it) {
      if (it.cat === "move" && it.auto) {
        removedAutoMove = true;
        return false;
      }
      return true;
    });

    var pairs = buildRoutePairs(day);
    if (pairs.length === 0) {
      if (removedAutoMove) {
        saveState();
        render();
      }
      showToast(t("timeline.routeDone"));
      return;
    }

    isGeoRunning = true;
    el.routeBtn.disabled = true;
    el.mapUpdateBtn.disabled = true;
    var originalLabel = el.routeBtnLabel.textContent;

    var notFound = [];
    var insertions = [];
    var items = day.items;
    var apiKey = getGmapsKey();
    var routesKeyError = false;
    var routesOtherError = false;

    function applyPairResult(pair, mode, dur, distKm, approx, unresolved) {
      var name = pair.a.name + " → " + pair.b.name;
      insertions.push({
        before: pair.b,
        newItem: {
          id: genId(),
          cat: "move",
          name: name,
          loc: "",
          dur: dur,
          note: "",
          lat: null,
          lon: null,
          mode: mode,
          distKm: distKm,
          auto: true,
          approx: !!approx,
          unresolved: !!unresolved
        }
      });
    }

    // 区間処理（キー無し時はこれが唯一の経路。キーあり時は Routes API のフォールバックとしても使う）。
    // 場所解決は resolveStopCoords（6d の統一チェーン: 既存座標 → Nominatim → Places API (New)）に任せる
    function processPairViaNominatim(pair) {
      var queryA = pair.a.loc || pair.a.name;
      var queryB = pair.b.loc || pair.b.name;
      var hadCoordsA = typeof pair.a.lat === "number" && typeof pair.a.lon === "number";
      var hadCoordsB = typeof pair.b.lat === "number" && typeof pair.b.lon === "number";

      return Promise.all([resolveStopCoords(pair.a, day), resolveStopCoords(pair.b, day)]).then(function (results) {
        var geoA = results[0];
        var geoB = results[1];
        var mode, dur, distKm;

        // resolveStopCoords が成功した場合、pair.a/pair.b の lat/lon/coordSrc は既に更新済み。
        // 元々座標を持っていなかったのに解決できなかった場合のみ notFound に積む
        if (!hadCoordsA && !geoA) notFound.push(queryA);
        if (!hadCoordsB && !geoB) notFound.push(queryB);

        // 場所を解決できないスポットの近隣アンカー概算:
        // ジオコーディングに失敗した側は、同じ日の直前（無ければ直後）の解決済みスポットの
        // 座標で概算する。アンカーの座標は当該スポット自身の lat/lon には保存しない
        // （地図ピンは欠番のままにする）
        var usedAnchorA = false;
        var usedAnchorB = false;
        var effA = geoA;
        var effB = geoB;
        if (!effA) {
          var anchorA = findAnchorStop(day, pair.a);
          if (anchorA) {
            effA = { lat: anchorA.lat, lon: anchorA.lon };
            usedAnchorA = true;
          }
        }
        if (!effB) {
          var anchorB = findAnchorStop(day, pair.b);
          if (anchorB) {
            effB = { lat: anchorB.lat, lon: anchorB.lon };
            usedAnchorB = true;
          }
        }

        var approx, unresolved;
        if (effA && effB) {
          var straight = haversineKm(effA.lat, effA.lon, effB.lat, effB.lon);
          var corrected = straight * 1.3;
          var est = estimateModeAndDuration(corrected);
          mode = est.mode;
          dur = est.minutes;
          distKm = corrected;
          approx = usedAnchorA || usedAnchorB;
          unresolved = false;
        } else {
          // アンカーも見つからない（その日に解決済みスポットが1つも無い）場合のみ unresolved
          mode = "other";
          dur = 0;
          distKm = null;
          approx = false;
          unresolved = true;
        }

        applyPairResult(pair, mode, dur, distKm, approx, unresolved);
      });
    }

    // Google Routes API での区間処理。エラー/ルート無しの場合は Nominatim にフォールバックする
    function processPairViaRoutesApi(pair) {
      // 場所を解決できないスポットの近隣アンカー概算:
      // 自身の座標が無いスポットにアンカー（同日の直前/直後の解決済みスポット）が見つかる場合は、
      // 未確定な名前（例:「ホテル周辺の喫茶店」）を address として Google に送って誤解決させず、
      // アンカーの座標を latLng として渡す。アンカーが無いスポットは従来どおり address 照会を試みる
      var anchorA = null;
      var anchorB = null;
      if (!(typeof pair.a.lat === "number" && typeof pair.a.lon === "number")) {
        anchorA = findAnchorStop(day, pair.a);
      }
      if (!(typeof pair.b.lat === "number" && typeof pair.b.lon === "number")) {
        anchorB = findAnchorStop(day, pair.b);
      }
      var originStop = anchorA ? { lat: anchorA.lat, lon: anchorA.lon, name: pair.a.name, loc: pair.a.loc } : pair.a;
      var destStop = anchorB ? { lat: anchorB.lat, lon: anchorB.lon, name: pair.b.name, loc: pair.b.loc } : pair.b;

      var departureMinutes = departureMinutesForStop(day, pair.a);
      return queryRouteForPairWithRetry(originStop, destStop, day, departureMinutes, apiKey)
        .then(function (result) {
          if (result.durMin == null || result.distKm == null) {
            var missingErr = new Error("incomplete routes api result");
            missingErr.isRoutesApiError = true;
            throw missingErr;
          }
          // legs の座標を前後の滞在地に保存する（gmap 由来の座標・アンカー概算の項目は上書きしない。
          // アンカー概算の項目自身の lat/lon は保存しないため地図ピンは欠番のままになる）
          if (result.startLatLng && pair.a.coordSrc !== "gmap" && !anchorA) {
            pair.a.lat = result.startLatLng.latitude;
            pair.a.lon = result.startLatLng.longitude;
            pair.a.coordSrc = "geo";
          }
          if (result.endLatLng && pair.b.coordSrc !== "gmap" && !anchorB) {
            pair.b.lat = result.endLatLng.latitude;
            pair.b.lon = result.endLatLng.longitude;
            pair.b.coordSrc = "geo";
          }
          var mode = routesModeToDisplay(result.usedMode, result.distKm);
          applyPairResult(pair, mode, result.durMin, result.distKm, !!(anchorA || anchorB), false);
        })
        .catch(function (err) {
          if (err && err.keyInvalid) {
            routesKeyError = true;
          } else {
            routesOtherError = true;
          }
          return processPairViaNominatim(pair);
        });
    }

    var chain = Promise.resolve();
    pairs.forEach(function (pair, index) {
      chain = chain.then(function () {
        el.routeBtnLabel.textContent = t("timeline.routeSearching", { cur: index + 1, total: pairs.length });
        return apiKey ? processPairViaRoutesApi(pair) : processPairViaNominatim(pair);
      });
    });

    chain
      .then(function () {
        insertions.forEach(function (ins) {
          var idx = items.indexOf(ins.before);
          if (idx === -1) idx = items.length;
          items.splice(idx, 0, ins.newItem);
        });

        saveState();
        render();

        if (routesKeyError) {
          showToast(t("toast.routesApiKeyError"), "error");
        } else if (routesOtherError) {
          showToast(t("toast.routesApiError"), "error");
        }

        var uniqueNotFound = uniq(notFound);
        if (uniqueNotFound.length > 0) {
          showToast(t("timeline.notFound", { list: uniqueNotFound.join(", ") }), "error");
        } else {
          showToast(t("timeline.routeDone"));
        }
      })
      .catch(function () {
        showToast(t("toast.geocodeNetworkError"), "error");
      })
      .then(function () {
        isGeoRunning = false;
        el.routeBtn.disabled = false;
        el.mapUpdateBtn.disabled = false;
        el.routeBtnLabel.textContent = originalLabel;
      });
  }

  // 「📍 地図を更新」で座標が確定した項目（move以外。今回新たに解決した項目・既に座標を持っていた
  // 項目のいずれも含む）のうち、gmap が空のものに座標ベースの Google Maps リンクを自動入力する（3b追記）。
  // 手動でリンクを貼った項目（gmap 非空）は上書きしない。何か変更したら true を返す
  function backfillAutoGmap(day) {
    var changed = false;
    day.items.forEach(function (it) {
      if (it.cat !== "move" && typeof it.lat === "number" && typeof it.lon === "number" && !it.gmap) {
        it.gmap = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(it.lat + "," + it.lon);
        it.gmapAuto = true;
        changed = true;
      }
    });
    return changed;
  }

  /* =========================================================
   * 地図更新ボタン（座標未取得の滞在地をまとめてジオコーディング）
   * ========================================================= */
  function runMapUpdate() {
    if (isGeoRunning) return;
    // スポット名の多言語表示（3c）とはフラグ・レート制限を共用するため、
    // name-fetch が実行中なら安全に中断してから地図更新を開始する
    abortNameFetch();
    resetPlacesApiErrorFlag();
    var day = trip.days[currentDayIndex];
    var targets = day.items.filter(function (it) {
      return it.cat !== "move" && it.coordSrc !== "gmap" && (it.lat == null || it.lon == null) && (it.loc || it.name);
    });

    if (targets.length === 0) {
      // ジオコーディングが必要な項目は無いが、既に座標を持つ項目への gmap 自動入力はここでも行う
      if (backfillAutoGmap(day)) {
        saveState();
        render();
      }
      showToast(t("map.updateDone"));
      return;
    }

    isGeoRunning = true;
    el.mapUpdateBtn.disabled = true;
    el.routeBtn.disabled = true;
    var originalLabel = el.mapUpdateBtnLabel.textContent;

    var notFound = [];
    var chain = Promise.resolve();
    targets.forEach(function (item, index) {
      chain = chain.then(function () {
        el.mapUpdateBtnLabel.textContent = t("timeline.routeSearching", { cur: index + 1, total: targets.length });
        var query = item.loc || item.name;
        // 位置解決は resolveStopCoords（6d の統一チェーン: 既存座標 → Nominatim → Places API (New)）に任せる
        return resolveStopCoords(item, day).then(function (result) {
          if (!result) notFound.push(query);
        });
      });
    });

    chain
      .then(function () {
        backfillAutoGmap(day);
        saveState();
        render();

        var uniqueNotFound = uniq(notFound);
        if (uniqueNotFound.length > 0) {
          showToast(t("timeline.notFound", { list: uniqueNotFound.join(", ") }), "error");
        } else {
          showToast(t("map.updateDone"));
        }
      })
      .catch(function () {
        showToast(t("toast.geocodeNetworkError"), "error");
      })
      .then(function () {
        isGeoRunning = false;
        el.mapUpdateBtn.disabled = false;
        el.routeBtn.disabled = false;
        el.mapUpdateBtnLabel.textContent = originalLabel;
      });
  }

  /* =========================================================
   * 地図（Leaflet）
   * マップ本体は1つだけ生成し、日の切替や項目編集のたびに
   * 作り直すのではなくマーカー/線レイヤーだけを更新する。
   * ========================================================= */
  function initMap() {
    if (typeof window.L === "undefined") {
      console.warn("Leaflet is not available; map disabled");
      return;
    }
    try {
      leafletMap = window.L.map(el.mapContainer, {
        attributionControl: true,
        scrollWheelZoom: true
      }).setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM);

      window.L.tileLayer(MAP_TILE_URL, {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(leafletMap);

      mapLineLayer = window.L.polyline([], {
        color: MAP_LINE_COLOR,
        weight: 3,
        opacity: 0.6,
        dashArray: "8 8"
      }).addTo(leafletMap);

      mapMarkersLayer = window.L.layerGroup().addTo(leafletMap);

      mapReady = true;
    } catch (e) {
      console.warn("map init failed", e);
      mapReady = false;
    }
  }

  function buildMarkerIcon(cat, number) {
    var wrap = document.createElement("div");
    wrap.className = "map-pin cat-" + cat;
    var span = document.createElement("span");
    span.textContent = String(number);
    wrap.appendChild(span);
    return window.L.divIcon({
      className: "map-pin-wrap",
      html: wrap.outerHTML,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -16]
    });
  }

  function buildPopupContent(item, startMin, endMin) {
    var wrap = document.createElement("div");
    wrap.className = "map-popup";

    var nameEl = document.createElement("div");
    nameEl.className = "map-popup-name";
    nameEl.textContent = localizedStopName(item);
    wrap.appendChild(nameEl);

    var timeEl = document.createElement("div");
    timeEl.className = "map-popup-time";
    timeEl.textContent = minutesToTimeStr(startMin) + t("timeline.timeSep") + minutesToTimeStr(endMin);
    wrap.appendChild(timeEl);

    return wrap;
  }

  function updateMap() {
    if (!mapReady) return;
    var day = trip.days[currentDayIndex];
    if (!day) return;

    // Leaflet はマップ生成時のコンテナ寸法を内部キャッシュするため、
    // 生成時に非表示(0×0)だった場合やレイアウト変化後は fitBounds のズーム計算が壊れる。
    // 描画のたびに現在の寸法で再計算してから配置する
    if (el.mapContainer.offsetWidth > 0) {
      leafletMap.invalidateSize({ animate: false });
    }

    var timed = getDayTimedItems(day);
    var numMap = getItineraryNumberMap(day);
    var stops = timed.filter(function (x) {
      return x.item.cat !== "move" && typeof x.item.lat === "number" && typeof x.item.lon === "number";
    });

    mapMarkersLayer.clearLayers();

    var latlngs = [];
    stops.forEach(function (x) {
      var item = x.item;
      var latlng = [item.lat, item.lon];
      latlngs.push(latlng);

      // 地図ピンの番号は行程番号をそのまま使う（座標の無い項目を挟むと欠番になるのが正しい挙動）
      var marker = window.L.marker(latlng, { icon: buildMarkerIcon(item.cat, numMap[item.id]) });
      marker.bindPopup(buildPopupContent(item, x.startMin, x.endMin));
      marker.addTo(mapMarkersLayer);
    });

    mapLineLayer.setLatLngs(latlngs);

    // ズームアニメーションは rAF 依存で、非アクティブタブでは完了せず表示が崩れるため無効化
    if (latlngs.length === 0) {
      leafletMap.setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, { animate: false });
      el.mapNoCoordsMsg.classList.remove("hidden");
    } else {
      el.mapNoCoordsMsg.classList.add("hidden");
      if (latlngs.length === 1) {
        leafletMap.setView(latlngs[0], 15, { animate: false });
      } else {
        leafletMap.fitBounds(window.L.latLngBounds(latlngs), { padding: [28, 28], animate: false });
      }
    }
  }

  function updateMapStickyOffset() {
    if (!el.appHeader) return;
    var height = el.appHeader.offsetHeight || 0;
    document.documentElement.style.setProperty("--map-sticky-top", height + 12 + "px");
  }

  function isMapPanelOpen() {
    try {
      return localStorage.getItem(MAP_OPEN_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setMapPanelOpen(open) {
    try {
      localStorage.setItem(MAP_OPEN_KEY, open ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }

  function applyMapPanelState() {
    var open = isMapPanelOpen();
    el.mapPanel.classList.toggle("collapsed", !open);
    el.mapToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function toggleMapPanel() {
    var open = !isMapPanelOpen();
    setMapPanelOpen(open);
    applyMapPanelState();
    if (open && mapReady) {
      // 閉じている間はコンテナ寸法が0のため、開いた直後に再描画（サイズ再計算は updateMap 内で行う）
      updateMap();
    }
  }

  /* =========================================================
   * 複数しおりの管理（9）
   * ========================================================= */
  function renderTripsList() {
    el.tripsList.innerHTML = "";
    tripsStore.forEach(function (entry) {
      var isActive = entry.id === currentTripId;
      var item = document.createElement("div");
      item.className = "trip-list-item" + (isActive ? " active" : "");
      item.dataset.id = entry.id;

      var info = document.createElement("div");
      info.className = "trip-list-item-info";

      var titleEl = document.createElement("div");
      titleEl.className = "trip-list-item-title";
      titleEl.textContent = tripDisplayTitle(entry.data) || t("trips.untitled");
      info.appendChild(titleEl);

      var metaEl = document.createElement("div");
      metaEl.className = "trip-list-item-meta";
      metaEl.textContent = t("trips.dayCount", { n: entry.data.days.length });
      info.appendChild(metaEl);

      item.appendChild(info);

      if (isActive) {
        var badge = document.createElement("span");
        badge.className = "trip-list-item-badge";
        badge.textContent = t("trips.currentBadge");
        item.appendChild(badge);
      }

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "trip-list-item-delete";
      delBtn.textContent = "🗑";
      delBtn.setAttribute("aria-label", t("trips.deleteAria"));
      delBtn.dataset.id = entry.id;
      item.appendChild(delBtn);

      el.tripsList.appendChild(item);
    });
  }

  function openTripsModal() {
    renderTripsList();
    openModal(el.tripsModal);
  }

  function switchTrip(id) {
    if (id === currentTripId) {
      closeModal(el.tripsModal);
      return;
    }
    var entry = tripsStore.find(function (e) {
      return e.id === id;
    });
    if (!entry) return;
    currentTripId = id;
    trip = entry.data;
    currentDayIndex = 0;
    saveState();
    closeModal(el.tripsModal);
    render();
  }

  function createNewTrip() {
    var data = normalizeTrip(createBlankTripData());
    var id = genId();
    tripsStore.push({ id: id, data: data });
    currentTripId = id;
    trip = data;
    currentDayIndex = 0;
    saveState();
    closeModal(el.tripsModal);
    render();
  }

  function requestDeleteTrip(id) {
    if (tripsStore.length <= 1) {
      showToast(t("trips.cannotDeleteLast"), "error");
      return;
    }
    var entry = tripsStore.find(function (e) {
      return e.id === id;
    });
    if (!entry) return;
    var title = tripDisplayTitle(entry.data) || t("trips.untitled");
    showConfirm(t("trips.deleteConfirmTitle"), t("trips.deleteConfirmBody", { title: title }), function () {
      var idx = tripsStore.findIndex(function (e) {
        return e.id === id;
      });
      if (idx === -1) return;
      tripsStore.splice(idx, 1);
      if (currentTripId === id) {
        var nextEntry = tripsStore[Math.min(idx, tripsStore.length - 1)];
        currentTripId = nextEntry.id;
        trip = nextEntry.data;
        currentDayIndex = 0;
      }
      saveState();
      render();
      if (!el.tripsModal.classList.contains("hidden")) renderTripsList();
    });
  }

  /* =========================================================
   * 共有機能（URLハッシュ）
   * ========================================================= */
  function toBase64Url(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = "";
    bytes.forEach(function (b) {
      binary += String.fromCharCode(b);
    });
    var b64 = btoa(binary);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(b64url) {
    var b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function openSettingsModal() {
    el.settingsApiKeyInput.value = getGmapsKey();
    openModal(el.settingsModal);
  }

  function openShareModal() {
    var json = JSON.stringify(trip);
    var encoded = toBase64Url(json);
    var url = window.location.origin + window.location.pathname + "#d=" + encoded;
    el.shareUrl.value = url;
    openModal(el.shareModal);
  }

  function checkSharedHash() {
    var hash = window.location.hash;
    if (!hash || hash.indexOf("#d=") !== 0) return;
    var encoded = hash.slice(3);

    history.replaceState(null, "", window.location.pathname + window.location.search);

    var json;
    try {
      json = fromBase64Url(encoded);
    } catch (e) {
      return;
    }
    var parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return;
    }
    if (!parsed || !Array.isArray(parsed.days)) return;

    showConfirm(t("share.loadSharedTitle"), t("share.loadSharedBody"), function () {
      // 複数しおりの管理（9）: 共有リンクは上書きではなく新しいしおりとして追加して切り替える
      var data = normalizeTrip(parsed);
      var id = genId();
      tripsStore.push({ id: id, data: data });
      currentTripId = id;
      trip = data;
      currentDayIndex = 0;
      saveState();
      render();
    });
  }

  /* =========================================================
   * CSV 入出力（SPEC 8）
   * ヘッダー行固定: day,date,start,category,mode,name,minutes,note,gmap
   * RFC4180 準拠の引用符処理（, " 改行を含むフィールドは "..." で囲み、" は "" にエスケープ）を
   * 出力・パース両方で行う。単純な split(",") は使わない
   * ========================================================= */
  var CSV_COLUMNS = ["day", "date", "start", "category", "mode", "name", "minutes", "note", "gmap"];

  // RFC4180: フィールドに , " 改行のいずれかを含む場合のみ "..." で囲み、内部の " は "" にエスケープする
  function csvEscapeField(value) {
    var str = value == null ? "" : String(value);
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function csvFormatRow(fields) {
    return fields.map(csvEscapeField).join(",");
  }

  // RFC4180 準拠のCSV全文パーサ（文字単位の状態機械）。引用フィールド内の , " 改行、
  // "" によるエスケープを正しく扱う。戻り値は行の配列、各行はフィールド文字列の配列
  function parseCsvRows(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var str = String(text == null ? "" : text);
    var len = str.length;
    var i = 0;

    function pushField() {
      row.push(field);
      field = "";
    }
    function pushRow() {
      pushField();
      rows.push(row);
      row = [];
    }

    while (i < len) {
      var c = str.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (str.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i += 1;
          }
        } else {
          field += c;
          i += 1;
        }
        continue;
      }
      if (c === '"' && field === "") {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (c === ",") {
        pushField();
        i += 1;
        continue;
      }
      if (c === "\r") {
        if (str.charAt(i + 1) === "\n") i += 1;
        pushRow();
        i += 1;
        continue;
      }
      if (c === "\n") {
        pushRow();
        i += 1;
        continue;
      }
      field += c;
      i += 1;
    }
    // 末尾に改行が無い最後のフィールド/行を回収する（末尾が改行済みの場合の余分な空行は追加しない）
    if (field !== "" || row.length > 0) {
      pushRow();
    }
    return rows;
  }

  function exportTripCsv() {
    var L = lang();
    var rows = [CSV_COLUMNS.slice()];
    trip.days.forEach(function (day, dayIdx) {
      var dayNum = dayIdx + 1;
      day.items.forEach(function (item) {
        var catLabel = window.I18N.CAT_NAMES[L][item.cat] || "";
        var modeLabel = item.cat === "move" ? window.I18N.MODE_NAMES[L][item.mode] || "" : "";
        var gmapVal = item.cat !== "move" ? item.gmap || "" : "";
        rows.push([
          String(dayNum),
          day.date || "",
          day.startTime || "",
          catLabel,
          modeLabel,
          item.name || "",
          String(item.dur || 0),
          item.note || "",
          gmapVal
        ]);
      });
    });
    return rows.map(csvFormatRow).join("\r\n") + "\r\n";
  }

  // ファイル名として不正な文字を無難な文字に置き換える
  function fileSafeName(name) {
    return String(name || "trip").replace(/[\\/:*?"<>|]/g, "_").trim() || "trip";
  }

  function downloadTripCsv() {
    var csv = el.textioArea.value;
    var BOM = "﻿";
    var blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileSafeName(tripDisplayTitle(trip)) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function openCsvFileIntoTextarea(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      el.textioArea.value = String(e.target.result || "");
    };
    reader.readAsText(file);
  }

  // 1行分のCSVレコード(フィールド配列)を item に変換する。パースできない場合は null を返す
  function parseCsvItemRow(fields, colIndex) {
    var catWord = fields[colIndex.category];
    var cat = window.I18N.resolveCategory(catWord);
    if (!cat) return null;

    var name = (fields[colIndex.name] || "").trim();
    if (!name) return null;

    var minutesStr = fields[colIndex.minutes] || "";
    var durMatch = /(\d+(?:\.\d+)?)/.exec(minutesStr);
    var dur = durMatch ? Math.round(parseFloat(durMatch[1])) : 0;

    var note = fields[colIndex.note] || "";
    var gmap = fields[colIndex.gmap] || "";

    var item = {
      id: genId(),
      cat: cat,
      name: name,
      loc: "",
      dur: dur,
      note: note,
      lat: null,
      lon: null,
      coordSrc: null
    };
    if (cat === "move") {
      var modeWord = fields[colIndex.mode];
      item.mode = window.I18N.resolveMode(modeWord) || "other";
      item.distKm = null;
      item.auto = false;
    } else {
      item.gmap = gmap;
      item.names = {};
      if (gmap) {
        var coords = extractGmapCoords(gmap);
        if (coords) {
          item.lat = coords.lat;
          item.lon = coords.lon;
          item.coordSrc = "gmap";
        }
      }
    }
    return item;
  }

  function parseTripCsv(text) {
    var rows = parseCsvRows(text);
    var warnings = [];
    var newTrip = { v: 1, title: trip.title, titles: Object.assign({}, trip.titles), lang: trip.lang, days: [] };

    if (rows.length === 0) {
      newTrip.days.push({ date: "", startTime: "09:00", items: [] });
      return { trip: normalizeTrip(newTrip), warnings: [1] };
    }

    var header = rows[0].map(function (h) {
      return (h || "").trim();
    });
    var colIndex = {};
    header.forEach(function (name, idx) {
      colIndex[name] = idx;
    });
    var missingRequired = CSV_COLUMNS.some(function (c) {
      return !Object.prototype.hasOwnProperty.call(colIndex, c);
    });

    if (missingRequired) {
      newTrip.days.push({ date: "", startTime: "09:00", items: [] });
      return { trip: normalizeTrip(newTrip), warnings: [1] };
    }

    var maxColIdx = Math.max.apply(
      null,
      CSV_COLUMNS.map(function (c) {
        return colIndex[c];
      })
    );

    var dayMap = {};
    var dayOrder = [];

    for (var i = 1; i < rows.length; i++) {
      var lineNo = i + 1;
      var fields = rows[i];

      // 完全な空行（フィールド1つで空文字）は警告なしで無視する
      if (fields.length === 1 && fields[0].trim() === "") continue;

      if (fields.length <= maxColIdx) {
        warnings.push(lineNo);
        continue;
      }

      var dayNum = parseInt(fields[colIndex.day], 10);
      if (isNaN(dayNum)) {
        warnings.push(lineNo);
        continue;
      }

      var item = parseCsvItemRow(fields, colIndex);
      if (!item) {
        warnings.push(lineNo);
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(dayMap, dayNum)) {
        dayMap[dayNum] = {
          date: fields[colIndex.date] || "",
          startTime: fields[colIndex.start] || "09:00",
          items: []
        };
        dayOrder.push(dayNum);
      }
      dayMap[dayNum].items.push(item);
    }

    newTrip.days = dayOrder.map(function (dn) {
      return dayMap[dn];
    });
    if (newTrip.days.length === 0) {
      newTrip.days.push({ date: "", startTime: "09:00", items: [] });
    }

    return { trip: normalizeTrip(newTrip), warnings: warnings };
  }

  function applyTextImport(text) {
    var result = parseTripCsv(text);
    trip = result.trip;
    // 複数しおりの管理（9）: trip は新しいオブジェクトに差し替わるため、
    // tripsStore 側の現在エントリの参照も更新する（CSV読込は「現在のしおりの置換」であり新規追加ではない）
    getCurrentEntry().data = trip;
    currentDayIndex = 0;
    saveState();
    render();
    closeModal(el.textioModal);
    if (result.warnings.length) {
      showToast(t("textio.parseWarning", { lines: result.warnings.join(", ") }), "error");
    }
  }

  function openTextioModal() {
    el.textioArea.value = exportTripCsv();
    openModal(el.textioModal);
  }

  /* =========================================================
   * モーダル & トースト
   * ========================================================= */
  function openModal(modal) {
    modal.classList.remove("hidden");
  }

  function closeModal(modal) {
    if (modal) modal.classList.add("hidden");
  }

  function showConfirm(title, body, onOk) {
    el.confirmTitle.textContent = title || "";
    el.confirmBody.textContent = body || "";
    el.confirmBody.style.display = body ? "" : "none";
    confirmCallback = onOk;
    openModal(el.confirmModal);
  }

  function showToast(message, type) {
    var toast = document.createElement("div");
    toast.className = "toast" + (type === "error" ? " toast-error" : "");
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add("toast-show");
    });
    setTimeout(function () {
      toast.classList.remove("toast-show");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3600);
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  /* =========================================================
   * イベント登録
   * ========================================================= */
  function bindEvents() {
    el.tripTitle.addEventListener("blur", function () {
      // しおりデータの多言語タイトル（6e）: 現在言語の titles に保存する。
      // title は後方互換のフォールバックとして、ja 編集時のみ同期更新する
      var newTitle = el.tripTitle.textContent.trim();
      // 表示されていた値から変わっていなければ何もしない（6e追記）。
      // ここで無条件に titles[lang] へ保存すると、例えば英語表示中にクリック→変更せず
      // フォーカスを外しただけで titles.en に日本語のベースタイトルがそのまま書き込まれ、
      // 自動翻訳のスキップ条件（titles[L]が非空）に引っかかって翻訳されなくなるバグがあった
      if (newTitle === tripDisplayTitle(trip)) return;
      if (!trip.titles) trip.titles = {};
      trip.titles[lang()] = newTitle;
      if (lang() === "ja") trip.title = newTitle;
      saveState();
      render();
    });
    el.tripTitle.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        el.tripTitle.blur();
      }
    });

    el.langSelect.addEventListener("change", function () {
      trip.lang = el.langSelect.value;
      saveState();
      render();
      // スポット名の多言語表示（3c）・タイトルの自動翻訳（6e）: 言語切替のたびに未取得の項目をバックグラウンドで補う。
      // Places/Translation の「未有効化」トーストは、この1回の言語切替（＝1実行）につき各1回に制限する
      resetPlacesApiErrorFlag();
      resetTranslateApiErrorFlag();
      fetchLocalizedNames(trip.lang);
      fetchLocalizedTitle(trip.lang);
    });

    el.addDayBtn.addEventListener("click", function () {
      trip.days.push({ date: "", startTime: "09:00", items: [] });
      currentDayIndex = trip.days.length - 1;
      saveState();
      render();
    });

    el.dayTabs.addEventListener("click", function (e) {
      var closeBtn = e.target.closest(".day-tab-close");
      if (closeBtn) {
        requestDeleteDay(parseInt(closeBtn.dataset.index, 10));
        return;
      }
      var tab = e.target.closest(".day-tab");
      if (tab) {
        currentDayIndex = parseInt(tab.dataset.index, 10);
        render();
      }
    });

    var pressTimer = null;
    el.dayTabs.addEventListener("pointerdown", function (e) {
      var tab = e.target.closest(".day-tab");
      if (!tab || e.target.closest(".day-tab-close")) return;
      var idx = parseInt(tab.dataset.index, 10);
      pressTimer = setTimeout(function () {
        pressTimer = null;
        requestDeleteDay(idx);
      }, 650);
    });
    ["pointerup", "pointerleave", "pointercancel", "pointermove"].forEach(function (evt) {
      el.dayTabs.addEventListener(evt, function () {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      });
    });

    el.dayDateInput.addEventListener("change", function () {
      trip.days[currentDayIndex].date = el.dayDateInput.value;
      saveState();
    });
    el.dayStartTimeInput.addEventListener("change", function () {
      trip.days[currentDayIndex].startTime = el.dayStartTimeInput.value || "09:00";
      saveState();
      render();
    });

    el.addFormCats.addEventListener("click", function (e) {
      var btn = e.target.closest(".cat-btn");
      if (!btn) return;
      addFormCat = btn.dataset.cat;
      renderAddForm();
    });

    el.addBtn.addEventListener("click", addItemFromForm);
    [el.addName, el.addDur, el.addNote].forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          addItemFromForm();
        }
      });
    });

    el.routeBtn.addEventListener("click", function () {
      runRouteCalculation(currentDayIndex);
    });

    el.mapToggleBtn.addEventListener("click", toggleMapPanel);
    el.mapUpdateBtn.addEventListener("click", runMapUpdate);

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      updateMapStickyOffset();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (mapReady) leafletMap.invalidateSize();
      }, 150);
    });

    el.tripsBtn.addEventListener("click", openTripsModal);
    el.tripsNewBtn.addEventListener("click", createNewTrip);
    el.tripsList.addEventListener("click", function (e) {
      var delBtn = e.target.closest(".trip-list-item-delete");
      if (delBtn) {
        e.stopPropagation();
        requestDeleteTrip(delBtn.dataset.id);
        return;
      }
      var row = e.target.closest(".trip-list-item");
      if (row) switchTrip(row.dataset.id);
    });

    el.settingsBtn.addEventListener("click", openSettingsModal);
    el.settingsSaveBtn.addEventListener("click", function () {
      var key = el.settingsApiKeyInput.value.trim();
      setGmapsKey(key);
      showToast(t("settings.saved"));
    });
    el.settingsDeleteBtn.addEventListener("click", function () {
      setGmapsKey("");
      el.settingsApiKeyInput.value = "";
      showToast(t("settings.deleted"));
    });

    el.shareBtn.addEventListener("click", openShareModal);
    el.shareCopyBtn.addEventListener("click", function () {
      copyToClipboard(el.shareUrl.value);
      showToast(t("share.copied"));
    });

    el.textioBtn.addEventListener("click", openTextioModal);
    el.textioCopyBtn.addEventListener("click", function () {
      copyToClipboard(el.textioArea.value);
      showToast(t("textio.copied"));
    });
    el.textioLoadBtn.addEventListener("click", function () {
      var text = el.textioArea.value;
      showConfirm(t("textio.confirmTitle"), "", function () {
        applyTextImport(text);
      });
    });
    el.textioDownloadBtn.addEventListener("click", downloadTripCsv);
    el.textioOpenFileBtn.addEventListener("click", function () {
      el.textioFileInput.click();
    });
    el.textioFileInput.addEventListener("change", function () {
      var file = el.textioFileInput.files && el.textioFileInput.files[0];
      if (file) openCsvFileIntoTextarea(file);
      el.textioFileInput.value = "";
    });

    document.querySelectorAll(".modal-close").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeModal(document.getElementById(btn.dataset.close));
      });
    });
    document.querySelectorAll(".modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) {
          closeModal(overlay);
          if (overlay === el.confirmModal) confirmCallback = null;
        }
      });
    });

    el.confirmCancelBtn.addEventListener("click", function () {
      closeModal(el.confirmModal);
      confirmCallback = null;
    });
    el.confirmOkBtn.addEventListener("click", function () {
      var cb = confirmCallback;
      closeModal(el.confirmModal);
      confirmCallback = null;
      if (cb) cb();
    });

    el.timeline.addEventListener("pointerdown", onDragHandlePointerDown);
  }

  /* =========================================================
   * 初期化
   * ========================================================= */
  function init() {
    cacheDom();

    // 複数しおりの管理（9）: v2 ストレージ（無ければ v1 からの移行）を試み、
    // どちらも無ければサンプルしおり1件だけの新規ストアを作る
    var store = loadState();
    if (!store) {
      var sampleId = genId();
      store = { currentId: sampleId, trips: [{ id: sampleId, data: createSampleTrip() }] };
    }
    tripsStore = store.trips;
    currentTripId = store.currentId;
    trip = getCurrentEntry().data;
    if (!trip.lang) trip.lang = "ja";
    currentDayIndex = 0;

    initMap();
    applyMapPanelState();
    bindEvents();
    checkSharedHash();
    render();

    // 起動時の移行・正規化結果を必ず永続化する（v1→v2移行の直後にリロードされても再移行されないように）
    saveState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
