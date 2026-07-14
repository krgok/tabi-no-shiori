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

  // Google ログイン＋Firestore クラウド保存（15）
  // このプロジェクトの Firebase 設定値。クライアントに埋め込む前提の公開値（APIキーではなくプロジェクト識別子）のため
  // ソースへの直書きで問題ない（Firestoreセキュリティルール側でアクセス制御する）
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyD3b2pBgjErPhUBk5BDOCCoptmviLF-_w4",
    authDomain: "tabi-no-shiori-71b24.firebaseapp.com",
    projectId: "tabi-no-shiori-71b24",
    storageBucket: "tabi-no-shiori-71b24.firebasestorage.app",
    messagingSenderId: "475792958330",
    appId: "1:475792958330:web:eca398575e7aca68126cc3"
  };
  var CLOUD_TRIPS_COLLECTION = "trips";
  // 公開層と公開URL（16）: 誰でも読める公開コピー用コレクション。ドキュメントIDはFirestore自動採番（publicId）
  var CLOUD_PUBLIC_TRIPS_COLLECTION = "publicTrips";
  var CLOUD_SYNC_DEBOUNCE_MS = 2000;
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
  // しおりのアーカイブ（11）: しおり一覧モーダルの「アーカイブ済みを見る」トグルの開閉状態。
  // モーダルを開き直すたびにリセットする（既定は閉じた状態）
  var tripsArchivedOpen = false;
  var dragState = null;
  var leafletMap = null;
  var mapMarkersLayer = null;
  var mapLineLayer = null;
  var mapReady = false;

  // Google ログイン＋Firestore クラウド保存（15）
  var firebaseReady = false; // SDK読み込み＋初期化に成功したか（失敗時はログイン機能を静かに無効化する）
  var fbAuth = null;
  var fbDb = null;
  var authUser = null; // 未ログインは null。ログイン時は { uid, email, displayName, photoURL }
  var cloudSyncTimer = null;
  var cloudSyncErrorShown = false; // 書き込みエラーのトーストは連続失敗時に1回だけ出す
  var cloudMergeInProgress = false;
  // trips への add（cloudId 採番）実行中のエントリ: entry.id -> Promise。
  // 採番の完了を待たずに同じエントリを再度書き込むと add が二重に走り、
  // クラウド上にしおりが重複作成されてしまうため、実行中は後続の書き込みを待たせる
  var cloudAddInFlight = {};

  // 公開層と公開URL（16）: #p=<publicId> で起動したときの読み取り専用モード。
  // true の間は saveState() が完全に no-op になり、ローカルストレージ・クラウドへの書き込みは一切発生しない。
  // trip 変数は一時的に「他人の公開コピー」を指すが、tripsStore/currentTripId は自分のローカルデータのまま変更しない
  var viewOnly = false;

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
    if (viewOnly) return;
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
  // localStorage への書き込みのみを行う（クラウド同期はここでは行わない）。
  // Google ログイン＋Firestore クラウド保存（15）のマージ処理など、クラウド書き込みを誘発したくない
  // 内部更新から呼ぶための下請け関数
  function persistLocalOnly() {
    try {
      var storeObj = {
        currentId: currentTripId,
        trips: tripsStore.map(function (e) {
          // しおりのアーカイブ（11）: archived は trips エントリ側のフィールド（trip データ本体には含めない）
          // cloudId/updatedAt（15）も同様に trips エントリ側のフィールド
          // publicId（16）: 公開層に発行されたら Firestore の publicTrips ドキュメントID。未公開は null
          return { id: e.id, data: e.data, archived: !!e.archived, cloudId: e.cloudId || null, updatedAt: e.updatedAt || 0, publicId: e.publicId || null };
        })
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storeObj));
    } catch (e) {
      console.warn("save failed", e);
    }
  }

  // 通常の保存経路。ローカル保存は従来どおり即時。
  // ログイン中は、現在のしおりの変更をデバウンス（2秒）してクラウドにも書き込む（15）
  // 公開URL閲覧（16）: viewOnly 中は何もしない。読み取り専用モードでローカルデータを汚染しないための最重要ガード
  function saveState() {
    if (viewOnly) return;
    var entry = getCurrentEntry();
    if (entry) entry.updatedAt = Date.now();
    persistLocalOnly();
    scheduleCloudSync();
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
          // しおりのアーカイブ（11）: archived は防御的に正規化（既定 false）
          // cloudId/updatedAt（15）: クラウド同期用の対応付け。無ければ null/0（未同期）
          // publicId（16）: 公開層のドキュメントID。無ければ null（未公開）
          return {
            id: id,
            data: normalizeTrip(entry.data),
            archived: !!entry.archived,
            cloudId: typeof entry.cloudId === "string" && entry.cloudId ? entry.cloudId : null,
            updatedAt: typeof entry.updatedAt === "number" && isFinite(entry.updatedAt) ? entry.updatedAt : 0,
            publicId: typeof entry.publicId === "string" && entry.publicId ? entry.publicId : null
          };
        })
        .filter(Boolean);
      if (trips.length === 0) return null;
      var currentId = parsed.currentId;
      var hasCurrent = trips.some(function (e) {
        return e.id === currentId;
      });
      if (!hasCurrent) {
        // 可能ならアーカイブされていないしおりへフォールバックする
        var firstActive = trips.find(function (e) {
          return !e.archived;
        });
        currentId = firstActive ? firstActive.id : trips[0].id;
      }
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
        result = { currentId: id, trips: [{ id: id, data: normalizeTrip(parsed), archived: false, cloudId: null, updatedAt: 0, publicId: null }] };
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

  // 持ち物リスト・やることリスト（10）: [{id, text, done, priv}] の配列を防御的に正規化する。
  // text は文字列、done/priv は boolean、id が無ければ genId() で発行する。
  // priv（非公開マーク。既定 false）は 14 参照
  function normalizeChecklist(raw) {
    var list = [];
    if (Array.isArray(raw)) {
      raw.forEach(function (it) {
        if (!it || typeof it !== "object") return;
        list.push({
          id: typeof it.id === "string" && it.id ? it.id : genId(),
          text: typeof it.text === "string" ? it.text : "",
          done: !!it.done,
          priv: !!it.priv
        });
      });
    }
    return list;
  }

  function normalizeTrip(raw) {
    var out = {
      v: 1,
      title: typeof raw.title === "string" ? raw.title : "",
      titles: normalizeTitles(raw.titles),
      lang: window.I18N.LANGUAGES.indexOf(raw.lang) !== -1 ? raw.lang : lang(),
      days: [],
      // 持ち物リスト・やることリスト（10）: しおり単位（日ごとではない）。共有リンク・localStorageに含まれる
      packing: normalizeChecklist(raw.packing),
      todos: normalizeChecklist(raw.todos)
    };
    var days = Array.isArray(raw.days) ? raw.days : [];
    if (days.length === 0) {
      days = [{ date: "", startTime: "09:00", items: [] }];
    }
    days.forEach(function (d) {
      var day = {
        date: typeof d.date === "string" ? d.date : "",
        startTime: typeof d.startTime === "string" && d.startTime ? d.startTime : "09:00",
        // 時差対応（13）: IANAタイムゾーン文字列。既定 ""＝時差計算なし。文字列のみ許容する防御的正規化
        tz: typeof d.tz === "string" ? d.tz : "",
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
          coordSrc: it.coordSrc === "gmap" || it.coordSrc === "geo" ? it.coordSrc : null,
          // 非公開マーク（14）: priv=項目まるごと非公開、notePriv=メモのみ非公開。既定 false。
          // move含む全カテゴリー共通。boolean 以外の型は防御的に既定値へフォールバック
          priv: !!it.priv,
          notePriv: !!it.notePriv
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
          // 時差対応（13）: 到着地のIANAタイムゾーン文字列（任意）。既定 ""＝時差なし
          item.arriveTz = typeof it.arriveTz === "string" ? it.arriveTz : "";
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
   * 非公開マークと公開用データ（14）
   * Google ログイン＋Firestore 連携（15、後続実装）の土台。
   * 「本人だけが読める完全データ」と「誰でも読める公開コピー」の2層に分ける設計のうち、
   * 公開コピーを作る側（priv/notePriv フラグに基づくサニタイズ）をここで実装する。
   * ========================================================= */

  // day.items（フィルタ前の元配列）内で idx の move の前後の非move項目を探す。
  // findAdjacentStops と同じロジックだが、サニタイズ時は任意の items 配列に対して使えるよう
  // day 引数を取らず items 配列を直接受け取る形にしている
  function findAdjacentStopsInItems(items, idx) {
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

  // 公開用サニタイズ（14の中核）。引数を一切変更しない純粋関数。
  // - priv: true の行程項目・持ち物/やること要素を削除する
  // - notePriv: true の項目は note を空文字にする（項目自体は残す）
  // - 非公開項目の削除で隣接スポットを失う自動生成 move（auto: true）も一緒に削除する
  //   （手動追加の move (auto: false) は隣接スポットが消えても残す）
  // - 結果から priv / notePriv フラグ自体を取り除く（公開データに痕跡を残さない）
  function sanitizeTripForPublic(tripData) {
    var clone = JSON.parse(JSON.stringify(tripData || {}));

    if (Array.isArray(clone.days)) {
      clone.days.forEach(function (day) {
        var items = Array.isArray(day.items) ? day.items : [];

        // 1. priv:true の項目（moveも含む）を「削除対象」として記録する
        var removedIds = {};
        items.forEach(function (it) {
          if (it && it.priv) removedIds[it.id] = true;
        });

        // 2. 削除対象ではない auto move のうち、削除前の隣接スポット（prev/next）のいずれかが
        //    削除対象だったものも、あわせて削除対象にする（手動 move はここで対象にしない）
        items.forEach(function (it, idx) {
          if (it && it.cat === "move" && it.auto && !removedIds[it.id]) {
            var neighbors = findAdjacentStopsInItems(items, idx);
            var prevRemoved = neighbors.prev && removedIds[neighbors.prev.id];
            var nextRemoved = neighbors.next && removedIds[neighbors.next.id];
            if (prevRemoved || nextRemoved) {
              removedIds[it.id] = true;
            }
          }
        });

        // 3. notePriv:true の項目（削除されないもの）は note を空にする
        items.forEach(function (it) {
          if (it && it.notePriv) it.note = "";
        });

        // 4. 削除対象を取り除き、priv/notePriv フラグ自体も消す
        day.items = items
          .filter(function (it) {
            return !removedIds[it.id];
          })
          .map(function (it) {
            delete it.priv;
            delete it.notePriv;
            return it;
          });
      });
    }

    ["packing", "todos"].forEach(function (key) {
      if (!Array.isArray(clone[key])) return;
      clone[key] = clone[key]
        .filter(function (it) {
          return !(it && it.priv);
        })
        .map(function (it) {
          delete it.priv;
          return it;
        });
    });

    return clone;
  }

  // sanitizeTripForPublic の適用前後で除外された件数（行程項目＋持ち物＋やること合計）を数える。
  // 公開プレビュー（14）の「非公開のため n 件を除外しました」表示に使う
  function countSanitizedExclusions(original, sanitized) {
    function countItems(data) {
      var n = 0;
      (data.days || []).forEach(function (d) {
        n += (d.items || []).length;
      });
      return n + (data.packing || []).length + (data.todos || []).length;
    }
    return countItems(original) - countItems(sanitized);
  }

  /* =========================================================
   * Google ログイン＋Firestore クラウド保存（15、プライベート層）
   * 「本人だけが読める完全データ」を Firestore に保存する。公開層（publicTrips・公開URL）は次段階で実装する。
   * Firebase SDKが読み込めない・初期化に失敗した場合はここから先の関数が呼ばれても静かに何もせず、
   * アプリはローカル動作のみで完全に機能する（この節の関数は必ず firebaseReady / fbAuth / fbDb / authUser を確認する）
   * ========================================================= */

  // Firebase SDK（vendor/firebase、compat版）の初期化。失敗しても例外を外に漏らさない
  function initFirebase() {
    try {
      if (!window.firebase || typeof window.firebase.initializeApp !== "function") return;
      window.firebase.initializeApp(FIREBASE_CONFIG);
      fbAuth = window.firebase.auth();
      fbDb = window.firebase.firestore();
      firebaseReady = true;
      fbAuth.onAuthStateChanged(handleAuthStateChanged);
    } catch (e) {
      // SDK未読み込み・設定不正などはすべてここに落ちる。ログイン機能を無効化するだけでアプリ自体は継続する
      firebaseReady = false;
      fbAuth = null;
      fbDb = null;
    }
  }

  function handleAuthStateChanged(user) {
    var wasLoggedIn = !!authUser;
    authUser = user
      ? { uid: user.uid, email: user.email || "", displayName: user.displayName || "", photoURL: user.photoURL || "" }
      : null;
    renderAuthUI();
    if (authUser && !wasLoggedIn) {
      cloudSyncErrorShown = false;
      runCloudMerge();
    }
  }

  function loginWithGoogle() {
    if (!firebaseReady || !fbAuth || !window.firebase.auth) return;
    var provider = new window.firebase.auth.GoogleAuthProvider();
    fbAuth.signInWithPopup(provider).catch(function (err) {
      // ポップアップがブロックされた場合はリダイレクト方式にフォールバックする
      if (err && err.code === "auth/popup-blocked") {
        fbAuth.signInWithRedirect(provider).catch(function () {
          /* リダイレクトも失敗した場合は静かに諦める */
        });
      }
    });
  }

  function logoutFromGoogle() {
    if (!firebaseReady || !fbAuth) return;
    fbAuth.signOut();
  }

  // 書き込み/読み込みエラーは静かに握りつぶすが、連続失敗時はトーストを1回だけ出す。成功したらフラグを戻す
  function handleCloudError(err) {
    console.warn("cloud sync failed", err && err.code);
    if (!cloudSyncErrorShown) {
      cloudSyncErrorShown = true;
      showToast(t("auth.syncError"), "error");
    }
  }
  function handleCloudSuccess() {
    cloudSyncErrorShown = false;
  }

  // JSON文字列を安全にパースする（壊れたデータ・型不正は null）
  function safeParseTripJSON(str) {
    try {
      var parsed = JSON.parse(str);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  // 現在のしおりをデバウンス（2秒）してクラウドへ書き込む。ログインしていなければ何もしない
  function scheduleCloudSync() {
    if (!authUser || !firebaseReady) return;
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(function () {
      cloudSyncTimer = null;
      cloudUpsertEntry(getCurrentEntry());
    }, CLOUD_SYNC_DEBOUNCE_MS);
  }

  // 1件の trips エントリを Firestore に書き込む（新規なら作成して cloudId を採番、既存なら更新）。即時実行。
  // trip 本体は JSON 文字列にして保存する（ネスト構造のまま入れると型制約で事故りやすいため）
  // 公開層と公開URL（16）: publicId も併せて書き込み、端末間で公開状態を引き継げるようにする。
  // 書き込み成功後、publicId を持つエントリなら公開コピー（publicTrips）もあわせて更新する（syncPublicCopyIfPublished）
  function cloudUpsertEntry(entry) {
    if (!firebaseReady || !fbDb || !authUser || !entry) return;
    // 同じエントリの add（cloudId 採番）が実行中なら、完了を待ってから書き込み直す。
    // 待たずに進むと cloudId が未設定のまま再度 add され、クラウド上でしおりが重複する
    // （例: ログイン直後のマージによるアップロードが完了する前に公開トグルを押した場合）
    if (!entry.cloudId && cloudAddInFlight[entry.id]) {
      cloudAddInFlight[entry.id].then(function () {
        cloudUpsertEntry(entry);
      });
      return;
    }
    var updatedAt = Date.now();
    var payload = {
      ownerUid: authUser.uid,
      data: JSON.stringify(entry.data),
      title: tripDisplayTitle(entry.data) || "",
      archived: !!entry.archived,
      updatedAt: updatedAt,
      schema: 2,
      publicId: entry.publicId || null
    };
    if (entry.cloudId) {
      fbDb
        .collection(CLOUD_TRIPS_COLLECTION)
        .doc(entry.cloudId)
        .set(payload, { merge: true })
        .then(function () {
          entry.updatedAt = updatedAt;
          handleCloudSuccess();
          syncPublicCopyIfPublished(entry);
        })
        .catch(handleCloudError);
    } else {
      cloudAddInFlight[entry.id] = fbDb
        .collection(CLOUD_TRIPS_COLLECTION)
        .add(payload)
        .then(function (docRef) {
          entry.cloudId = docRef.id;
          entry.updatedAt = updatedAt;
          persistLocalOnly(); // cloudId の採番結果を保存する（クラウド書き込みは誘発しない）
          if (el.tripsModal && !el.tripsModal.classList.contains("hidden")) renderTripsList();
          handleCloudSuccess();
          syncPublicCopyIfPublished(entry);
        })
        .catch(handleCloudError)
        .then(function () {
          // 成功・失敗いずれでも実行中フラグは必ず解除する（待機中の書き込みを進ませる）
          delete cloudAddInFlight[entry.id];
        });
    }
  }

  // 公開層と公開URL（16）: entry.publicId があるときだけ、公開コピー（publicTrips/{publicId}）を
  // 常にサニタイズ済みデータで上書きする。既存の cloud sync デバウンス処理（scheduleCloudSync → cloudUpsertEntry）に
  // 相乗りするため、公開中のしおりを編集すれば自動的に公開コピーも更新される
  function syncPublicCopyIfPublished(entry) {
    if (!entry || !entry.publicId || !firebaseReady || !fbDb || !authUser) return;
    var sanitized = sanitizeTripForPublic(entry.data);
    fbDb
      .collection(CLOUD_PUBLIC_TRIPS_COLLECTION)
      .doc(entry.publicId)
      .set(
        {
          ownerUid: authUser.uid,
          data: JSON.stringify(sanitized),
          title: tripDisplayTitle(entry.data) || "",
          updatedAt: Date.now(),
          schema: 2
        },
        { merge: true }
      )
      .then(handleCloudSuccess)
      .catch(handleCloudError);
  }

  // 1件の trips エントリを Firestore から削除する（cloudId が無ければ何もしない）
  function cloudDeleteEntry(entry) {
    if (!firebaseReady || !fbDb || !authUser || !entry || !entry.cloudId) return;
    fbDb
      .collection(CLOUD_TRIPS_COLLECTION)
      .doc(entry.cloudId)
      .delete()
      .then(handleCloudSuccess)
      .catch(handleCloudError);
  }

  /* =========================================================
   * 公開層と公開URL（16）
   * ログイン時のみ、しおりのサニタイズ済みコピーを誰でも読める publicTrips/{publicId} に書き出す。
   * publicId は Firestore 自動採番のドキュメントID（推測されにくい）。
   * ========================================================= */

  // 共有モーダルの「🌐 公開する」トグルON。新規公開なら publicTrips に自動IDで作成し、
  // 既存の publicId があれば（多くはここには来ないが念のため）上書き更新する。
  // 成功後は publicId をローカル・プライベート層（trips/{cloudId}）の両方へ保存する
  function publishCurrentTrip(onDone) {
    if (viewOnly || !authUser || !firebaseReady || !fbDb) return;
    var entry = getCurrentEntry();
    if (!entry) return;
    var sanitized = sanitizeTripForPublic(entry.data);
    var payload = {
      ownerUid: authUser.uid,
      data: JSON.stringify(sanitized),
      title: tripDisplayTitle(entry.data) || "",
      updatedAt: Date.now(),
      schema: 2
    };
    var ref = entry.publicId
      ? fbDb.collection(CLOUD_PUBLIC_TRIPS_COLLECTION).doc(entry.publicId).set(payload, { merge: true }).then(function () {
          return entry.publicId;
        })
      : fbDb
          .collection(CLOUD_PUBLIC_TRIPS_COLLECTION)
          .add(payload)
          .then(function (docRef) {
            return docRef.id;
          });
    ref
      .then(function (publicId) {
        entry.publicId = publicId;
        persistLocalOnly();
        cloudUpsertEntry(entry); // publicId をプライベート層（trips/{cloudId}）にも即時反映する
        handleCloudSuccess();
        if (typeof onDone === "function") onDone(true);
      })
      .catch(function (err) {
        handleCloudError(err);
        if (typeof onDone === "function") onDone(false);
      });
  }

  // 共有モーダルの「🌐 公開する」トグルOFF。publicTrips のドキュメントを削除し、
  // ローカル・プライベート層両方の publicId を null に戻す
  function unpublishCurrentTrip(onDone) {
    if (viewOnly || !authUser || !firebaseReady || !fbDb) return;
    var entry = getCurrentEntry();
    if (!entry || !entry.publicId) return;
    var publicIdToDelete = entry.publicId;
    fbDb
      .collection(CLOUD_PUBLIC_TRIPS_COLLECTION)
      .doc(publicIdToDelete)
      .delete()
      .then(function () {
        entry.publicId = null;
        persistLocalOnly();
        cloudUpsertEntry(entry);
        handleCloudSuccess();
        showToast(t("share.unpublished"));
        if (typeof onDone === "function") onDone(true);
      })
      .catch(function (err) {
        handleCloudError(err);
        if (typeof onDone === "function") onDone(false);
      });
  }

  // ログイン直後のマージ計画を組み立てる純粋関数（Firestore呼び出しを含まないため、スタブ無しで単体テスト可能）。
  // - cloudId を持つローカルエントリ: 対応するクラウド文書と updatedAt を比較し、新しい方を採用する
  //   （クラウドが新しければローカルを更新対象に、ローカルが新しい/同値ならアップロード対象にする。
  //   対応する文書が見当たらない場合＝クラウド側で消えた場合も、アップロードして復元する）
  // - cloudId を持たないローカルエントリ（ログイン前に作成したしおり）: 常にアップロード対象にする
  // - どのローカルエントリにも対応しないクラウド文書: 新規ローカルエントリとして追加する対象にする
  function computeTripsMergePlan(localTrips, cloudDocs) {
    var uploads = [];
    var localUpdates = [];
    var newLocalEntries = [];
    var usedCloudIds = {};

    (localTrips || []).forEach(function (entry) {
      if (entry.cloudId) {
        var match = null;
        for (var i = 0; i < cloudDocs.length; i++) {
          if (cloudDocs[i].id === entry.cloudId) {
            match = cloudDocs[i];
            break;
          }
        }
        if (match) {
          usedCloudIds[match.id] = true;
          var localUpdatedAt = entry.updatedAt || 0;
          var cloudUpdatedAt = match.updatedAt || 0;
          if (cloudUpdatedAt > localUpdatedAt) {
            localUpdates.push({ entry: entry, cloudDoc: match });
          } else {
            uploads.push(entry);
          }
        } else {
          uploads.push(entry);
        }
      } else {
        uploads.push(entry);
      }
    });

    (cloudDocs || []).forEach(function (doc) {
      if (!usedCloudIds[doc.id]) newLocalEntries.push(doc);
    });

    return { uploads: uploads, localUpdates: localUpdates, newLocalEntries: newLocalEntries };
  }

  // マージ計画（computeTripsMergePlan）を実際の tripsStore に適用し、ローカル更新・追加を反映してから
  // アップロード対象をクラウドへ書き込む。最後にマージ内容をトーストで通知する
  function applyCloudMergePlan(plan) {
    plan.localUpdates.forEach(function (u) {
      var parsed = safeParseTripJSON(u.cloudDoc.data);
      if (parsed) {
        u.entry.data = normalizeTrip(parsed);
        // 公開URL閲覧（16）: viewOnly 中は trip が他人の公開コピーを指しているため上書きしない
        if (!viewOnly && u.entry.id === currentTripId) trip = u.entry.data;
      }
      u.entry.archived = !!u.cloudDoc.archived;
      u.entry.updatedAt = u.cloudDoc.updatedAt || 0;
      // 公開層と公開URL（16）: publicId も端末間で引き継ぐ
      u.entry.publicId = u.cloudDoc.publicId || null;
    });

    plan.newLocalEntries.forEach(function (doc) {
      var parsed = safeParseTripJSON(doc.data);
      tripsStore.push({
        id: genId(),
        data: normalizeTrip(parsed || createBlankTripData()),
        archived: !!doc.archived,
        cloudId: doc.id,
        updatedAt: doc.updatedAt || 0,
        publicId: doc.publicId || null
      });
    });

    persistLocalOnly();
    render();

    plan.uploads.forEach(function (entry) {
      cloudUpsertEntry(entry);
    });

    var total = plan.uploads.length + plan.localUpdates.length + plan.newLocalEntries.length;
    if (total > 0) {
      showToast(t("auth.syncDone", { n: total }));
    }
  }

  // ログイン直後に1回だけ実行する、クラウドとローカルの突き合わせ処理
  function runCloudMerge() {
    if (!firebaseReady || !fbDb || !authUser || cloudMergeInProgress) return;
    cloudMergeInProgress = true;
    fbDb
      .collection(CLOUD_TRIPS_COLLECTION)
      .where("ownerUid", "==", authUser.uid)
      .get()
      .then(function (snapshot) {
        var cloudDocs = [];
        snapshot.forEach(function (doc) {
          var d = doc.data() || {};
          cloudDocs.push({
            id: doc.id,
            data: typeof d.data === "string" ? d.data : "",
            archived: !!d.archived,
            updatedAt: typeof d.updatedAt === "number" && isFinite(d.updatedAt) ? d.updatedAt : 0,
            publicId: typeof d.publicId === "string" && d.publicId ? d.publicId : null
          });
        });
        var plan = computeTripsMergePlan(tripsStore, cloudDocs);
        applyCloudMergePlan(plan);
        cloudMergeInProgress = false;
      })
      .catch(function (err) {
        cloudMergeInProgress = false;
        handleCloudError(err);
      });
  }

  // ヘッダーの認証ボタン・アカウントモーダルの表示を、現在の authUser / firebaseReady に合わせて更新する
  function renderAuthUI() {
    if (!el.authBtn) return;
    if (!firebaseReady) {
      // SDK読み込み・初期化に失敗: ログイン機能自体を静かに隠す（トースト等は出さない）
      el.authBtn.classList.add("hidden");
      return;
    }
    el.authBtn.classList.remove("hidden");
    if (authUser) {
      el.authBtn.classList.add("auth-btn-loggedin");
      var initial = (authUser.displayName || authUser.email || "?").trim().charAt(0).toUpperCase();
      el.authBtnContent.textContent = initial || "👤";
      el.authBtn.title = authUser.email || "";
      el.authBtn.setAttribute("aria-label", authUser.email || t("auth.menuTitle"));
      if (el.authEmail) el.authEmail.textContent = authUser.email || "";
    } else {
      el.authBtn.classList.remove("auth-btn-loggedin");
      el.authBtnContent.textContent = t("auth.login");
      el.authBtn.title = t("auth.login");
      el.authBtn.setAttribute("aria-label", t("auth.login"));
      if (!el.authModal.classList.contains("hidden")) closeModal(el.authModal);
    }
    if (el.tripsSyncStatus) el.tripsSyncStatus.classList.toggle("hidden", !authUser);
  }

  function onAuthBtnClick() {
    if (!firebaseReady) return;
    if (authUser) {
      openModal(el.authModal);
    } else {
      loginWithGoogle();
    }
  }

  /* =========================================================
   * サンプルデータ
   * ========================================================= */
  function createSampleTrip() {
    var items = [
      { id: genId(), cat: "sight", name: "浅草寺", loc: "", dur: 90, note: "雷門で写真", priv: false, notePriv: false, lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {} },
      { id: genId(), cat: "move", name: "浅草寺 → 上野公園", loc: "", dur: 25, note: "", priv: false, notePriv: false, lat: null, lon: null, coordSrc: null, mode: "train", distKm: 6.2, auto: true, arriveTz: "" },
      { id: genId(), cat: "sight", name: "上野公園", loc: "", dur: 60, note: "散策", priv: false, notePriv: false, lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {} },
      { id: genId(), cat: "meal", name: "上野でランチ", loc: "", dur: 60, note: "", priv: false, notePriv: false, lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {} },
      { id: genId(), cat: "stay", name: "三井ガーデンホテル上野", loc: "", dur: 0, note: "チェックイン15:00", priv: false, notePriv: false, lat: null, lon: null, coordSrc: null, gmap: "", gmapAuto: false, names: {} }
    ];
    return {
      v: 1,
      title: "東京旅行",
      titles: Object.assign({}, window.I18N.SAMPLE_TRIP_TITLES),
      lang: "ja",
      days: [{ date: "2026-07-20", startTime: "09:00", tz: "", items: items }],
      packing: [],
      todos: []
    };
  }

  // 複数しおりの管理（9）: 「＋ 新しいしおり」で作成する空のしおり。タイトルは現在言語のデフォルトを4言語プリセット
  function createBlankTripData() {
    return {
      v: 1,
      title: window.I18N.NEW_TRIP_TITLES.ja,
      titles: Object.assign({}, window.I18N.NEW_TRIP_TITLES),
      lang: lang(),
      days: [{ date: "", startTime: "09:00", tz: "", items: [] }],
      packing: [],
      todos: []
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
    el.dayTzSelect = document.getElementById("dayTzSelect");
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
    el.packingItems = document.getElementById("packingItems");
    el.packingEmptyMsg = document.getElementById("packingEmptyMsg");
    el.packingProgress = document.getElementById("packingProgress");
    el.packingAddInput = document.getElementById("packingAddInput");
    el.packingAddBtn = document.getElementById("packingAddBtn");
    el.todosItems = document.getElementById("todosItems");
    el.todosEmptyMsg = document.getElementById("todosEmptyMsg");
    el.todosProgress = document.getElementById("todosProgress");
    el.todosAddInput = document.getElementById("todosAddInput");
    el.todosAddBtn = document.getElementById("todosAddBtn");

    // 準備リストへのクイックアクセス（11）: ヘッダーの🧳ボタン・準備モーダル内の同UI
    el.prepBtn = document.getElementById("prepBtn");
    el.prepBadge = document.getElementById("prepBadge");
    el.prepModal = document.getElementById("prepModal");
    el.prepPackingItems = document.getElementById("prepPackingItems");
    el.prepPackingEmptyMsg = document.getElementById("prepPackingEmptyMsg");
    el.prepPackingProgress = document.getElementById("prepPackingProgress");
    el.prepPackingAddInput = document.getElementById("prepPackingAddInput");
    el.prepPackingAddBtn = document.getElementById("prepPackingAddBtn");
    el.prepTodosItems = document.getElementById("prepTodosItems");
    el.prepTodosEmptyMsg = document.getElementById("prepTodosEmptyMsg");
    el.prepTodosProgress = document.getElementById("prepTodosProgress");
    el.prepTodosAddInput = document.getElementById("prepTodosAddInput");
    el.prepTodosAddBtn = document.getElementById("prepTodosAddBtn");

    el.shareModal = document.getElementById("shareModal");
    el.shareUrl = document.getElementById("shareUrl");
    el.shareCopyBtn = document.getElementById("shareCopyBtn");
    // 非公開マークと公開用データ（14）: 公開プレビューモーダル
    el.sharePreviewBtn = document.getElementById("sharePreviewBtn");
    el.publicPreviewModal = document.getElementById("publicPreviewModal");
    el.publicPreviewContent = document.getElementById("publicPreviewContent");
    el.publicPreviewExcluded = document.getElementById("publicPreviewExcluded");

    // 公開層と公開URL（16）: 共有モーダルの「🌐 公開する」セクション（ログイン時のみ）
    el.sharePublicSection = document.getElementById("sharePublicSection");
    el.sharePublicToggle = document.getElementById("sharePublicToggle");
    el.sharePublicBadge = document.getElementById("sharePublicBadge");
    el.sharePublicExcluded = document.getElementById("sharePublicExcluded");
    el.sharePublicUrlWrap = document.getElementById("sharePublicUrlWrap");
    el.sharePublicUrl = document.getElementById("sharePublicUrl");
    el.sharePublicCopyBtn = document.getElementById("sharePublicCopyBtn");
    el.shareLoginHint = document.getElementById("shareLoginHint");

    // 公開層と公開URL（16）: #p=<publicId> 読み取り専用モードのヘッダー表示
    el.viewOnlyBanner = document.getElementById("viewOnlyBanner");
    el.viewOnlyBackBtn = document.getElementById("viewOnlyBackBtn");

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
    populateTzSelect(el.dayTzSelect, t("day.tzNone"));
    el.dayTzSelect.value = day.tz || "";
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
  // day.items との1:1マッピングは崩さない（行程番号・地図・印刷ビューが依存するため）
  function getDayTimedItems(day) {
    var cursor = parseTimeToMinutes(day.startTime || "09:00");
    var baseDate = dayBaseDate(day);
    var curTz = typeof day.tz === "string" ? day.tz : "";
    var pendingLocalNote = false;
    return day.items.map(function (item) {
      var startMin = cursor;
      var endMin = cursor + (item.dur || 0);
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
      return { item: item, startMin: startMin, endMin: endMin, localTimeNote: localTimeNote, moveTzDiff: moveTzDiff };
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
      el.timeline.appendChild(buildItemCard(timed.item, timed.startMin, timed.endMin, day, idx, numMap, timed));
    });
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
    timeText.textContent = minutesToTimeStr(startMin) + t("timeline.timeSep") + minutesToTimeStr(endMin);
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

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "item-name";
    nameInput.value = item.name;
    nameInput.placeholder = t("timeline.namePlaceholder");
    nameInput.readOnly = viewOnly; // 公開URL閲覧（16）: 読み取り専用モードでは編集不可
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
    noteInput.addEventListener("change", function () {
      item.note = noteInput.value;
      saveState();
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

    if (item.notePriv) {
      var notePrivHint = document.createElement("div");
      notePrivHint.className = "item-note-priv-hint";
      notePrivHint.textContent = t("timeline.notePrivHint");
      body.appendChild(notePrivHint);
    }

    card.appendChild(body);

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
    card.appendChild(privBtn);

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

  function checklistEls(kind, target) {
    var isPrep = target === "prep";
    if (kind === "packing") {
      return isPrep
        ? { items: el.prepPackingItems, empty: el.prepPackingEmptyMsg, progress: el.prepPackingProgress, addInput: el.prepPackingAddInput }
        : { items: el.packingItems, empty: el.packingEmptyMsg, progress: el.packingProgress, addInput: el.packingAddInput };
    }
    return isPrep
      ? { items: el.prepTodosItems, empty: el.prepTodosEmptyMsg, progress: el.prepTodosProgress, addInput: el.prepTodosAddInput }
      : { items: el.todosItems, empty: el.todosEmptyMsg, progress: el.todosProgress, addInput: el.todosAddInput };
  }

  function buildChecklistRow(kind, it) {
    var row = document.createElement("div");
    row.className = "checklist-item" + (it.done ? " done" : "") + (it.priv ? " checklist-item-private" : "");
    row.dataset.id = it.id;

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

    var textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "checklist-text-input";
    textInput.value = it.text;
    textInput.placeholder = t("checklist.addPlaceholder");
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
    });

    updatePrepBadge();
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
    list.splice(idx, 1);
    saveState();
    renderChecklistSection(kind);
  }

  function openPrepModal() {
    renderChecklists();
    openModal(el.prepModal);
  }

  /* =========================================================
   * 項目 CRUD
   * ========================================================= */
  function deleteItem(id) {
    if (viewOnly) return;
    var day = trip.days[currentDayIndex];
    day.items = day.items.filter(function (it) {
      return it.id !== id;
    });
    saveState();
    render();
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
      lat: null,
      lon: null,
      coordSrc: null
    };
    if (addFormCat === "move") {
      item.mode = "train";
      item.distKm = null;
      item.auto = false;
      item.arriveTz = "";
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
    if (viewOnly || isGeoRunning) return;
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
          priv: false,
          notePriv: false,
          lat: null,
          lon: null,
          mode: mode,
          distKm: distKm,
          auto: true,
          approx: !!approx,
          unresolved: !!unresolved,
          arriveTz: ""
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
    if (viewOnly || isGeoRunning) return;
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
   * 複数しおりの管理（9・11: しおりのアーカイブ）
   * ========================================================= */
  // 一覧行（アクティブ一覧・アーカイブ済み一覧の両方で共用）を1件分組み立てる
  function buildTripListRow(entry) {
    var isActive = entry.id === currentTripId;
    var item = document.createElement("div");
    item.className = "trip-list-item" + (isActive ? " active" : "") + (entry.archived ? " archived" : "");
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

    // Google ログイン＋Firestore クラウド保存（15）: クラウド同期済みのしおりに控えめな雲アイコンを表示する
    if (entry.cloudId) {
      var cloudBadge = document.createElement("span");
      cloudBadge.className = "trip-list-item-cloud";
      cloudBadge.textContent = "☁";
      cloudBadge.title = t("trips.cloudSynced");
      cloudBadge.setAttribute("aria-label", t("trips.cloudSynced"));
      item.appendChild(cloudBadge);
    }

    // 公開層と公開URL（16）: 公開中のしおりに🌐バッジを表示する
    if (entry.publicId) {
      var publicBadge = document.createElement("span");
      publicBadge.className = "trip-list-item-public";
      publicBadge.textContent = "🌐";
      publicBadge.title = t("share.publicBadge");
      publicBadge.setAttribute("aria-label", t("share.publicBadge"));
      item.appendChild(publicBadge);
    }

    var archiveBtn = document.createElement("button");
    archiveBtn.type = "button";
    archiveBtn.className = "trip-list-item-archive";
    archiveBtn.textContent = entry.archived ? "↩" : "📦";
    archiveBtn.setAttribute("aria-label", t(entry.archived ? "trips.unarchiveAria" : "trips.archiveAria"));
    archiveBtn.title = t(entry.archived ? "trips.unarchiveAria" : "trips.archiveAria");
    archiveBtn.dataset.id = entry.id;
    archiveBtn.dataset.action = entry.archived ? "unarchive" : "archive";
    item.appendChild(archiveBtn);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "trip-list-item-delete";
    delBtn.textContent = "🗑";
    delBtn.setAttribute("aria-label", t("trips.deleteAria"));
    delBtn.dataset.id = entry.id;
    item.appendChild(delBtn);

    return item;
  }

  function renderTripListInto(container, list) {
    container.innerHTML = "";
    list.forEach(function (entry) {
      container.appendChild(buildTripListRow(entry));
    });
  }

  // しおり一覧モーダル: 通常はアーカイブされていないしおりのみを表示し、
  // 「アーカイブ済みを見る（n）」トグルONのときだけアーカイブ済み一覧を表示する
  function renderTripsList() {
    var activeTrips = tripsStore.filter(function (e) {
      return !e.archived;
    });
    var archivedTrips = tripsStore.filter(function (e) {
      return e.archived;
    });

    renderTripListInto(el.tripsList, activeTrips);

    if (archivedTrips.length > 0) {
      el.tripsArchiveToggleBtn.classList.remove("hidden");
      el.tripsArchiveToggleLabel.textContent = t("trips.showArchived", { n: archivedTrips.length });
      el.tripsArchiveToggleBtn.setAttribute("aria-expanded", tripsArchivedOpen ? "true" : "false");
    } else {
      el.tripsArchiveToggleBtn.classList.add("hidden");
      tripsArchivedOpen = false;
    }

    if (tripsArchivedOpen && archivedTrips.length > 0) {
      el.tripsArchivedList.classList.remove("hidden");
      renderTripListInto(el.tripsArchivedList, archivedTrips);
    } else {
      el.tripsArchivedList.classList.add("hidden");
      el.tripsArchivedList.innerHTML = "";
    }
  }

  function openTripsModal() {
    // 公開URL閲覧（16）: しおり一覧はローカルの自分のしおりを扱うため、閲覧モード中は開かない
    // （ヘッダーの tripsBtn 自体も非表示にしているが、念のための二重ガード）
    if (viewOnly) return;
    tripsArchivedOpen = false;
    renderTripsList();
    openModal(el.tripsModal);
  }

  function switchTrip(id) {
    if (viewOnly) return;
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
    if (viewOnly) return;
    var data = normalizeTrip(createBlankTripData());
    var id = genId();
    tripsStore.push({ id: id, data: data, archived: false, cloudId: null, updatedAt: Date.now(), publicId: null });
    currentTripId = id;
    trip = data;
    currentDayIndex = 0;
    saveState();
    closeModal(el.tripsModal);
    render();
  }

  // 「アーカイブされていないしおりが1つだけのとき、そのしおりは削除不可」（11で「最後の1つは削除不可」ガードを整合）
  function requestDeleteTrip(id) {
    if (viewOnly) return;
    var entry = tripsStore.find(function (e) {
      return e.id === id;
    });
    if (!entry) return;
    var activeCount = tripsStore.filter(function (e) {
      return !e.archived;
    }).length;
    if (!entry.archived && activeCount <= 1) {
      showToast(t("trips.cannotDeleteLast"), "error");
      return;
    }
    var title = tripDisplayTitle(entry.data) || t("trips.untitled");
    showConfirm(t("trips.deleteConfirmTitle"), t("trips.deleteConfirmBody", { title: title }), function () {
      var idx = tripsStore.findIndex(function (e) {
        return e.id === id;
      });
      if (idx === -1) return;
      tripsStore.splice(idx, 1);
      // Google ログイン＋Firestore クラウド保存（15）: クラウド同期済みなら文書も削除する
      cloudDeleteEntry(entry);
      if (currentTripId === id) {
        // アーカイブされていないしおりを優先して切り替え先にする
        var nextEntry =
          tripsStore.find(function (e) {
            return !e.archived;
          }) || tripsStore[0];
        currentTripId = nextEntry.id;
        trip = nextEntry.data;
        currentDayIndex = 0;
      }
      saveState();
      render();
      if (!el.tripsModal.classList.contains("hidden")) renderTripsList();
    });
  }

  // しおりのアーカイブ（11）: 確認ダイアログ不要。現在編集中のしおりをアーカイブする場合は
  // アーカイブされていない他のしおりへ自動的に切り替える。他に無ければアーカイブ不可
  function requestArchiveTrip(id) {
    if (viewOnly) return;
    var entry = tripsStore.find(function (e) {
      return e.id === id;
    });
    if (!entry || entry.archived) return;

    if (id === currentTripId) {
      var nextEntry = tripsStore.find(function (e) {
        return e.id !== id && !e.archived;
      });
      if (!nextEntry) {
        showToast(t("trips.cannotArchiveLast"), "error");
        return;
      }
      entry.archived = true;
      currentTripId = nextEntry.id;
      trip = nextEntry.data;
      currentDayIndex = 0;
      saveState();
      // Google ログイン＋Firestore クラウド保存（15）: saveState() は現在（切替後）のしおりしか
      // クラウド同期の対象にしないため、アーカイブしたしおり自体は明示的に反映する
      cloudUpsertEntry(entry);
      render();
      renderTripsList();
      showToast(t("trips.archived"));
      return;
    }

    entry.archived = true;
    saveState();
    cloudUpsertEntry(entry);
    renderTripsList();
    showToast(t("trips.archived"));
  }

  function unarchiveTrip(id) {
    if (viewOnly) return;
    var entry = tripsStore.find(function (e) {
      return e.id === id;
    });
    if (!entry || !entry.archived) return;
    entry.archived = false;
    saveState();
    cloudUpsertEntry(entry);
    renderTripsList();
    showToast(t("trips.unarchived"));
  }

  // しおり一覧・アーカイブ済み一覧の両方で共用するクリックハンドラ
  function onTripsListClick(e) {
    var archiveBtn = e.target.closest(".trip-list-item-archive");
    if (archiveBtn) {
      e.stopPropagation();
      if (archiveBtn.dataset.action === "unarchive") {
        unarchiveTrip(archiveBtn.dataset.id);
      } else {
        requestArchiveTrip(archiveBtn.dataset.id);
      }
      return;
    }
    var delBtn = e.target.closest(".trip-list-item-delete");
    if (delBtn) {
      e.stopPropagation();
      requestDeleteTrip(delBtn.dataset.id);
      return;
    }
    var row = e.target.closest(".trip-list-item");
    if (row) switchTrip(row.dataset.id);
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
    if (viewOnly) return;
    // 非公開マークと公開用データ（14）: 共有リンクに埋め込むのは trip 全体そのままではなく、
    // sanitizeTripForPublic の結果（priv/notePriv を反映した公開コピー）にする。
    // これにより非公開マークを付けた部分は共有リンクを渡しても見えなくなる
    var publicData = sanitizeTripForPublic(trip);
    var json = JSON.stringify(publicData);
    var encoded = toBase64Url(json);
    var url = window.location.origin + window.location.pathname + "#d=" + encoded;
    el.shareUrl.value = url;
    renderShareModalPublicSection();
    openModal(el.shareModal);
  }

  // 公開層と公開URL（16）: 共有モーダルの「🌐 公開する」セクションを、現在の authUser / publicId に合わせて更新する。
  // 未ログイン時は「ログインすると短い公開リンクを発行できます」の案内のみ表示する
  function renderShareModalPublicSection() {
    if (!el.sharePublicSection) return;
    if (!authUser || !firebaseReady) {
      el.sharePublicSection.classList.add("hidden");
      if (el.shareLoginHint) el.shareLoginHint.classList.remove("hidden");
      return;
    }
    if (el.shareLoginHint) el.shareLoginHint.classList.add("hidden");
    el.sharePublicSection.classList.remove("hidden");

    var entry = getCurrentEntry();
    var isPublished = !!(entry && entry.publicId);
    el.sharePublicToggle.checked = isPublished;
    el.sharePublicBadge.classList.toggle("hidden", !isPublished);
    el.sharePublicUrlWrap.classList.toggle("hidden", !isPublished);

    if (isPublished) {
      var url = window.location.origin + window.location.pathname + "#p=" + encodeURIComponent(entry.publicId);
      el.sharePublicUrl.value = url;
      var sanitized = sanitizeTripForPublic(entry.data);
      var excluded = countSanitizedExclusions(entry.data, sanitized);
      el.sharePublicExcluded.textContent =
        excluded > 0 ? t("publicPreview.excludedCount", { n: excluded }) : t("publicPreview.noneExcluded");
      el.sharePublicExcluded.classList.remove("hidden");
    } else {
      el.sharePublicExcluded.classList.add("hidden");
    }
  }

  // 共有モーダルの「🌐 公開する」トグル操作。二重送信防止のため通信中はトグルを一時的に無効化する
  function onSharePublicToggleChange() {
    if (viewOnly || !authUser || !firebaseReady) return;
    var wantOn = el.sharePublicToggle.checked;
    el.sharePublicToggle.disabled = true;
    var onDone = function () {
      el.sharePublicToggle.disabled = false;
      renderShareModalPublicSection();
      if (el.tripsModal && !el.tripsModal.classList.contains("hidden")) renderTripsList();
    };
    if (wantOn) {
      publishCurrentTrip(onDone);
    } else {
      unpublishCurrentTrip(onDone);
    }
  }

  // 非公開マークと公開用データ（14）: 「公開時の見え方を確認」ボタン。
  // sanitizeTripForPublic の結果を、印刷ビュー（12）と同じ組み立て関数
  // （buildPrintDaySection / buildPrintItemRow / buildPrintChecklistSection）を流用して
  // 読み取り専用のテキスト一覧として表示する（textContentベースでDOMを組み立てるため XSS対策は既存のまま）
  function openPublicPreviewModal() {
    var publicData = sanitizeTripForPublic(trip);
    var excluded = countSanitizedExclusions(trip, publicData);

    el.publicPreviewExcluded.textContent =
      excluded > 0 ? t("publicPreview.excludedCount", { n: excluded }) : t("publicPreview.noneExcluded");

    el.publicPreviewContent.innerHTML = "";
    publicData.days.forEach(function (day, idx) {
      el.publicPreviewContent.appendChild(buildPrintDaySection(day, idx));
    });
    var checklistsWrap = document.createElement("div");
    checklistsWrap.className = "print-checklists";
    checklistsWrap.appendChild(buildPrintChecklistSection("checklist.packingTitle", publicData.packing));
    checklistsWrap.appendChild(buildPrintChecklistSection("checklist.todosTitle", publicData.todos));
    el.publicPreviewContent.appendChild(checklistsWrap);

    openModal(el.publicPreviewModal);
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
      // しおりのアーカイブ（11）: 共有リンクで追加されるしおりは archived: false
      var data = normalizeTrip(parsed);
      var id = genId();
      tripsStore.push({ id: id, data: data, archived: false, cloudId: null, updatedAt: 0, publicId: null });
      currentTripId = id;
      trip = data;
      currentDayIndex = 0;
      saveState();
      render();
    });
  }

  /* =========================================================
   * 公開層と公開URL（16）: #p=<publicId> の読み取り専用閲覧
   * ========================================================= */

  // #p=<publicId> があれば読み取り専用モードで起動する。ログイン不要・localStorageは一切変更しない。
  // ハッシュを検出した時点で同期的に viewOnly=true にすることで、この後に呼ばれる init() 末尾の
  // saveState() を含め、以降の保存処理を確実に無効化してからFirestoreへの非同期取得を行う
  function checkPublicHash() {
    var hash = window.location.hash;
    if (!hash || hash.indexOf("#p=") !== 0) return;
    var publicId = decodeURIComponent(hash.slice(3));
    if (!publicId) return;

    viewOnly = true;
    render();

    if (!firebaseReady || !fbDb) {
      finishPublicHashFallback();
      return;
    }

    fbDb
      .collection(CLOUD_PUBLIC_TRIPS_COLLECTION)
      .doc(publicId)
      .get()
      .then(function (doc) {
        if (!doc || !doc.exists) {
          finishPublicHashFallback();
          return;
        }
        var d = doc.data() || {};
        var parsed = safeParseTripJSON(d.data);
        if (!parsed || !Array.isArray(parsed.days)) {
          finishPublicHashFallback();
          return;
        }
        trip = normalizeTrip(parsed);
        currentDayIndex = 0;
        render();
      })
      .catch(function () {
        finishPublicHashFallback();
      });
  }

  // 公開URLの取得に失敗した（存在しない・削除済み・オフライン等）場合のフォールバック。
  // 通常モードで起動し直す。ハッシュを消して再読み込み時の再取得ループを防ぐ
  function finishPublicHashFallback() {
    viewOnly = false;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    showToast(t("viewOnly.notFound"), "error");
    render();
    // init() 末尾の saveState() は viewOnly=true の間スキップされているため、
    // 起動時の移行・正規化結果の永続化をここで肩代わりする
    saveState();
  }

  // ヘッダーの「自分のしおりに戻る」ボタン。viewOnly を解除し、ローカルの現在のしおりの表示に戻す
  function exitViewOnlyMode() {
    if (!viewOnly) return;
    viewOnly = false;
    trip = getCurrentEntry().data;
    currentDayIndex = 0;
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    render();
  }

  /* =========================================================
   * CSV 入出力（SPEC 8）
   * ヘッダー行固定: day,date,start,category,mode,name,minutes,note,gmap
   * RFC4180 準拠の引用符処理（, " 改行を含むフィールドは "..." で囲み、" は "" にエスケープ）を
   * 出力・パース両方で行う。単純な split(",") は使わない
   * ========================================================= */
  var CSV_COLUMNS = ["day", "date", "start", "category", "mode", "name", "minutes", "note", "gmap"];
  // 時差対応（13）: tz（day列と同じく行ごと）・arriveTz（move行のみ）は任意列。
  // 非公開マークと公開用データ（14）: private・notePrivate（1/0）も同様の任意列として追加する。
  // 旧CSV（これらの列が無い）を読み込んでもエラーにならず空/false扱いにする後方互換のため、
  // CSV_COLUMNS（必須列）には含めず、別枠の任意列として扱う。
  // CSVエクスポートは自分用の完全バックアップのため、非公開項目も含めた完全データを出力する（サニタイズ対象外）
  var CSV_OPTIONAL_COLUMNS = ["tz", "arriveTz", "private", "notePrivate"];
  // 持ち物リスト・やることリスト（10）: 行程CSVの後に空行を1行挟んだ第2テーブルのヘッダー（必須列）
  var CHECKLIST_CSV_COLUMNS = ["list", "text", "done"];
  // 非公開マークと公開用データ（14）: 第2テーブルの任意列（旧CSVには無いため false 扱いで後方互換）
  var CHECKLIST_CSV_OPTIONAL_COLUMNS = ["private"];

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
    var rows = [CSV_COLUMNS.concat(CSV_OPTIONAL_COLUMNS)];
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
          gmapVal,
          day.tz || "",
          item.cat === "move" ? item.arriveTz || "" : "",
          item.priv ? "1" : "0",
          item.notePriv ? "1" : "0"
        ]);
      });
    });
    var mainCsv = rows.map(csvFormatRow).join("\r\n") + "\r\n";

    // 持ち物リスト・やることリスト（10）: 行程CSVの後に空行を1行挟み、第2テーブルとして出力する。
    // 非公開マークと公開用データ（14）: private（1/0）列を追加する
    var listRows = [CHECKLIST_CSV_COLUMNS.concat(CHECKLIST_CSV_OPTIONAL_COLUMNS)];
    var listLabels = window.I18N.LIST_NAMES[L];
    trip.packing.forEach(function (it) {
      listRows.push([listLabels.packing, it.text || "", it.done ? "1" : "0", it.priv ? "1" : "0"]);
    });
    trip.todos.forEach(function (it) {
      listRows.push([listLabels.todos, it.text || "", it.done ? "1" : "0", it.priv ? "1" : "0"]);
    });
    var listCsv = listRows.map(csvFormatRow).join("\r\n") + "\r\n";

    return mainCsv + "\r\n" + listCsv;
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

  // 非公開マークと公開用データ（14）: CSVの 1/0（true/false も許容）の任意列を boolean に変換する。
  // 列が無い（colIndex[key] が undefined）旧CSVでは false を返す（後方互換）
  function csvBoolField(fields, colIndex, key) {
    var idx = colIndex[key];
    if (idx == null) return false;
    var v = (fields[idx] || "").trim().toLowerCase();
    return v === "1" || v === "true";
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
      // 非公開マークと公開用データ（14）: private・notePrivate は任意列。旧CSVでは false 扱い
      priv: csvBoolField(fields, colIndex, "private"),
      notePriv: csvBoolField(fields, colIndex, "notePrivate"),
      lat: null,
      lon: null,
      coordSrc: null
    };
    if (cat === "move") {
      var modeWord = fields[colIndex.mode];
      item.mode = window.I18N.resolveMode(modeWord) || "other";
      item.distKm = null;
      item.auto = false;
      // 時差対応（13）: arriveTz は任意列。旧CSV（列が無い）では colIndex.arriveTz が undefined になり、
      // fields[undefined] は undefined になるので "" にフォールバックする（後方互換）
      item.arriveTz = (colIndex.arriveTz != null ? fields[colIndex.arriveTz] : "") || "";
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

  // 持ち物リスト・やることリスト（10）: 第2テーブルの行 [list, text, done] を解析する。
  // list 列は現在言語に限らず4言語いずれの表記も受け付ける（resolveListKind）
  function parseChecklistItemRow(fields, colIndex) {
    var kind = window.I18N.resolveListKind(fields[colIndex.list]);
    if (!kind) return null;
    var text = (fields[colIndex.text] || "").trim();
    if (!text) return null;
    var doneVal = (fields[colIndex.done] || "").trim().toLowerCase();
    var done = doneVal === "1" || doneVal === "true";
    // 非公開マークと公開用データ（14）: private は任意列。旧CSVでは false 扱い
    var priv = csvBoolField(fields, colIndex, "private");
    return { kind: kind, item: { id: genId(), text: text, done: done, priv: priv } };
  }

  function parseTripCsv(text) {
    var rows = parseCsvRows(text);
    var warnings = [];
    // 持ち物リスト・やることリスト（10）: 第2テーブルが無いCSV（旧形式）を読み込んだ場合に備え、
    // 既存の packing/todos をデフォルトとして引き継ぐ（後方互換）。第2テーブルが見つかれば置換する
    var newTrip = {
      v: 1,
      title: trip.title,
      titles: Object.assign({}, trip.titles),
      lang: trip.lang,
      days: [],
      packing: JSON.parse(JSON.stringify(trip.packing)),
      todos: JSON.parse(JSON.stringify(trip.todos))
    };

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

    // 持ち物リスト・やることリスト（10）: 行程CSVの後の最初の空行（フィールド1つで空文字の行）で
    // 第2テーブルと区切る。空行が無ければ第2テーブル無し（従来どおり）
    var blankIdx = -1;
    for (var bi = 1; bi < rows.length; bi++) {
      if (rows[bi].length === 1 && rows[bi][0].trim() === "") {
        blankIdx = bi;
        break;
      }
    }
    var mainEnd = blankIdx === -1 ? rows.length : blankIdx;

    var dayMap = {};
    var dayOrder = [];

    for (var i = 1; i < mainEnd; i++) {
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
          // 時差対応（13）: tz は任意列。旧CSV（列が無い）では colIndex.tz が undefined になり "" にフォールバックする
          tz: (colIndex.tz != null ? fields[colIndex.tz] : "") || "",
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

    // 持ち物リスト・やることリスト（10）: 第2テーブルが見つかり、ヘッダーが list,text,done を
    // 満たしていれば packing/todos を置換する。見つからなければ冒頭で引き継いだ既存値を維持する
    if (blankIdx !== -1 && blankIdx + 1 < rows.length) {
      var listHeader = rows[blankIdx + 1].map(function (h) {
        return (h || "").trim();
      });
      var listColIndex = {};
      listHeader.forEach(function (name, idx) {
        listColIndex[name] = idx;
      });
      var listMissing = CHECKLIST_CSV_COLUMNS.some(function (c) {
        return !Object.prototype.hasOwnProperty.call(listColIndex, c);
      });

      if (!listMissing) {
        var listMaxColIdx = Math.max.apply(
          null,
          CHECKLIST_CSV_COLUMNS.map(function (c) {
            return listColIndex[c];
          })
        );
        var newPacking = [];
        var newTodos = [];
        for (var j = blankIdx + 2; j < rows.length; j++) {
          var listLineNo = j + 1;
          var listFields = rows[j];

          if (listFields.length === 1 && listFields[0].trim() === "") continue;

          if (listFields.length <= listMaxColIdx) {
            warnings.push(listLineNo);
            continue;
          }

          var parsed = parseChecklistItemRow(listFields, listColIndex);
          if (!parsed) {
            warnings.push(listLineNo);
            continue;
          }

          if (parsed.kind === "packing") {
            newPacking.push(parsed.item);
          } else {
            newTodos.push(parsed.item);
          }
        }
        newTrip.packing = newPacking;
        newTrip.todos = newTodos;
      }
    }

    return { trip: normalizeTrip(newTrip), warnings: warnings };
  }

  function applyTextImport(text) {
    if (viewOnly) return;
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
   * PDF出力（印刷 12）
   * 外部ライブラリ不使用のため「印刷用ビュー + window.print()」（ブラウザの「PDFとして保存」）で実現する。
   * #printView は input/select/button を一切使わず textContent ベースの静的要素のみで組み立てる
   * （入力欄の枠線が印刷に出るのを避けるため）。地図はLeafletタイル印刷が不安定なため含めない。
   * ========================================================= */
  function printDateRangeText() {
    var dates = trip.days
      .map(function (d) {
        return d.date;
      })
      .filter(Boolean);
    if (dates.length === 0) return "";
    var first = dates[0];
    var last = dates[dates.length - 1];
    if (first === last) return first;
    return first + " " + t("timeline.timeSep") + " " + last;
  }

  function buildPrintItemRow(item, timed, numMap) {
    var row = document.createElement("div");
    row.className = "print-item cat-" + item.cat;

    var parts = [];
    var timeStr = minutesToTimeStr(timed.startMin) + t("timeline.timeSep") + minutesToTimeStr(timed.endMin);
    if (timed.localTimeNote) timeStr += " " + t("timeline.localTimeNote");
    parts.push(timeStr);

    if (item.cat === "move") {
      var modeLabel = window.I18N.MODE_NAMES[lang()][item.mode] || "";
      var moveStr = modeLabel + " " + (item.dur || 0) + window.I18N.DURATION_UNITS[lang()];
      if (timed.moveTzDiff != null) {
        moveStr += " 🕐 " + tzDiffLabel(timed.moveTzDiff);
      }
      parts.push(moveStr);
    } else {
      var num = numMap[item.id];
      if (num != null) parts.push(String(num));
      var icon = window.I18N.CATEGORY_ICONS[item.cat] || "";
      var nameStr = (icon ? icon + " " : "") + (item.name || "");
      var localized = item.names && typeof item.names[lang()] === "string" ? item.names[lang()] : null;
      if (localized && localized !== item.name) {
        nameStr += "（" + localized + "）";
      }
      parts.push(nameStr);
      parts.push((item.dur || 0) + window.I18N.DURATION_UNITS[lang()]);
    }

    var mainLine = document.createElement("div");
    mainLine.className = "print-item-main";
    mainLine.textContent = parts.join(" / ");
    row.appendChild(mainLine);

    if (item.note) {
      var noteLine = document.createElement("div");
      noteLine.className = "print-item-note";
      noteLine.textContent = item.note;
      row.appendChild(noteLine);
    }

    return row;
  }

  function buildPrintDaySection(day, dayIdx) {
    var section = document.createElement("section");
    section.className = "print-day";

    var heading = document.createElement("h2");
    heading.className = "print-day-heading";
    var headingParts = [t("day.dayLabel", { n: dayIdx + 1 })];
    if (day.date) headingParts.push(day.date);
    if (day.tz) headingParts.push(day.tz);
    heading.textContent = headingParts.join(" | ");
    section.appendChild(heading);

    var numMap = getItineraryNumberMap(day);
    var list = document.createElement("div");
    list.className = "print-day-items";
    getDayTimedItems(day).forEach(function (timed) {
      list.appendChild(buildPrintItemRow(timed.item, timed, numMap));
    });
    section.appendChild(list);

    return section;
  }

  function buildPrintChecklistSection(titleKey, list) {
    var section = document.createElement("section");
    section.className = "print-checklist";
    var h = document.createElement("h2");
    h.textContent = t(titleKey);
    section.appendChild(h);

    var itemsWrap = document.createElement("div");
    itemsWrap.className = "print-checklist-items";
    list.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "print-checklist-item";
      row.textContent = (it.done ? "☑ " : "☐ ") + (it.text || "");
      itemsWrap.appendChild(row);
    });
    section.appendChild(itemsWrap);

    return section;
  }

  // #printView 全体を組み立てる。しおり全体・全日分を対象にする（選択中の日だけではない）。
  // input/select/button は一切使わない（textContentベースの静的要素のみ）
  function buildPrintView() {
    var view = document.createElement("div");
    view.id = "printView";

    var header = document.createElement("div");
    header.className = "print-doc-header";
    var titleEl = document.createElement("h1");
    titleEl.className = "print-title";
    titleEl.textContent = tripDisplayTitle(trip);
    header.appendChild(titleEl);
    var range = printDateRangeText();
    if (range) {
      var rangeEl = document.createElement("p");
      rangeEl.className = "print-date-range";
      rangeEl.textContent = range;
      header.appendChild(rangeEl);
    }
    view.appendChild(header);

    trip.days.forEach(function (day, idx) {
      view.appendChild(buildPrintDaySection(day, idx));
    });

    var checklistsWrap = document.createElement("div");
    checklistsWrap.className = "print-checklists";
    checklistsWrap.appendChild(buildPrintChecklistSection("checklist.packingTitle", trip.packing));
    checklistsWrap.appendChild(buildPrintChecklistSection("checklist.todosTitle", trip.todos));
    view.appendChild(checklistsWrap);

    return view;
  }

  function handlePrintClick() {
    var existing = document.getElementById("printView");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var view = buildPrintView();
    document.body.appendChild(view);
    document.body.classList.add("printing");

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove("printing");
      var pv = document.getElementById("printView");
      if (pv) {
        pv.innerHTML = "";
        if (pv.parentNode) pv.parentNode.removeChild(pv);
      }
      window.removeEventListener("afterprint", cleanup);
    }

    window.addEventListener("afterprint", cleanup);
    window.print();
    // afterprint が発火しない/信頼できないブラウザ向けのフォールバック
    // （window.print() は多くのブラウザでダイアログが閉じるまで処理をブロックするため、
    // 呼び出し直後にタイマーで確実にクリーンアップする）
    setTimeout(cleanup, 1000);
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
      trip.days.push({ date: "", startTime: "09:00", tz: "", items: [] });
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
      // 公開URL閲覧（16）: 長押しでの日削除ジェスチャーは day-tab-close ボタンの表示有無に関係なく
      // 独立して発火するため、明示的にガードする
      if (viewOnly) return;
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
    el.dayTzSelect.addEventListener("change", function () {
      trip.days[currentDayIndex].tz = el.dayTzSelect.value;
      saveState();
      render();
    });

    el.printBtn.addEventListener("click", handlePrintClick);

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

    // 持ち物リスト・やることリスト（10）: タイムライン下（メイン）
    el.packingAddBtn.addEventListener("click", function () {
      addChecklistItem("packing", "main");
    });
    el.packingAddInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addChecklistItem("packing", "main");
      }
    });
    el.todosAddBtn.addEventListener("click", function () {
      addChecklistItem("todos", "main");
    });
    el.todosAddInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addChecklistItem("todos", "main");
      }
    });

    // 準備リストへのクイックアクセス（11）: ヘッダー🧳ボタン・準備モーダル
    el.prepBtn.addEventListener("click", openPrepModal);
    el.prepPackingAddBtn.addEventListener("click", function () {
      addChecklistItem("packing", "prep");
    });
    el.prepPackingAddInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addChecklistItem("packing", "prep");
      }
    });
    el.prepTodosAddBtn.addEventListener("click", function () {
      addChecklistItem("todos", "prep");
    });
    el.prepTodosAddInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addChecklistItem("todos", "prep");
      }
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
    el.tripsList.addEventListener("click", onTripsListClick);
    el.tripsArchivedList.addEventListener("click", onTripsListClick);
    el.tripsArchiveToggleBtn.addEventListener("click", function () {
      tripsArchivedOpen = !tripsArchivedOpen;
      renderTripsList();
    });

    // Google ログイン＋Firestore クラウド保存（15）
    el.authBtn.addEventListener("click", onAuthBtnClick);
    el.authLogoutBtn.addEventListener("click", function () {
      closeModal(el.authModal);
      logoutFromGoogle();
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
    el.sharePreviewBtn.addEventListener("click", openPublicPreviewModal);

    // 公開層と公開URL（16）
    if (el.sharePublicToggle) el.sharePublicToggle.addEventListener("change", onSharePublicToggleChange);
    if (el.sharePublicCopyBtn) {
      el.sharePublicCopyBtn.addEventListener("click", function () {
        copyToClipboard(el.sharePublicUrl.value);
        showToast(t("share.copied"));
      });
    }
    if (el.viewOnlyBackBtn) el.viewOnlyBackBtn.addEventListener("click", exitViewOnlyMode);

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
      store = { currentId: sampleId, trips: [{ id: sampleId, data: createSampleTrip(), archived: false, cloudId: null, updatedAt: 0, publicId: null }] };
    }
    tripsStore = store.trips;
    currentTripId = store.currentId;
    trip = getCurrentEntry().data;
    if (!trip.lang) trip.lang = "ja";
    currentDayIndex = 0;

    initMap();
    applyMapPanelState();
    initFirebase();
    bindEvents();
    // 公開層と公開URL（16）: #p= は #d= と排他（ハッシュの接頭辞が異なる）なので両方呼んでよい。
    // checkPublicHash が viewOnly=true を同期的に立てた場合、直後の render()/saveState() は自動的に無害化される
    checkPublicHash();
    checkSharedHash();
    render();

    // 起動時の移行・正規化結果を必ず永続化する（v1→v2移行の直後にリロードされても再移行されないように）
    // viewOnly 中（公開URL閲覧）は saveState() が no-op のため、ローカルデータは一切書き換わらない
    saveState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
