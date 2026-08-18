/**
 * 00-core.js — 定数・状態・ユーティリティ
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

/* =========================================================
 * 定数
 * ========================================================= */
// ⚙️設定モーダルに表示する版数（サポート時に「更新が端末に届いたか」を確認する手掛かり）。
// sw.js の CACHE_VERSION と常に同じ値にすること。一致は tests/test-pwa.js がCIで検知する
var APP_VERSION = "v7";
var STORAGE_KEY_V1 = "tabi-shiori-v1";
var STORAGE_KEY = "tabi-shiori-v2"; // v2: { currentId, trips: [{ id, data: <trip> }] }（複数しおりの管理 9）
var GEO_CACHE_KEY = "tabi-geo-cache";
var MAP_OPEN_KEY = "tabi-map-open";
// 準備モーダル（持ち物・やること）のサイズ。ユーザーが変えた大きさを次回も再現する
var PREP_SIZE_KEY = "tabi-prep-size";
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
// 編集できる共有リンク（18）: ログイン不要で誰でも編集できるコレクション。ドキュメントIDはFirestore自動採番（editId＝合言葉）。
// Firestoreルール上 update は未認証でも通るが、ownerUid は変更不可・data は200KB未満の文字列という制約がある
var CLOUD_EDIT_TRIPS_COLLECTION = "editTrips";
// ルールの200KB制限（data.size() < 200000）に対し余裕を持たせた閾値。UTF-8バイト長で判定する
var EDIT_TRIP_MAX_BYTES = 190000;
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
// APIキー未設定時の案内（3c/6e 追記）: 「キーが無いために翻訳をスキップした」項目が1件でもあれば
// 1回の言語切替につき1回だけ案内トーストを出す。Places/Translation の「未有効化」トーストとは別事象
// （こちらはキー自体が未設定のケース）なので専用フラグで管理する
var noKeyNoticeShown = false;
// スポット名の多言語表示（3c）: ルート検討/地図更新（isGeoRunning）とは別フラグで管理する。
// nameFetchToken は実行中バッチの識別用。中断時にインクリメントし、進行中のループに「もう古い」と伝える
var isNameFetchRunning = false;
var nameFetchToken = 0;
var nameFetchToastEl = null;
var confirmCallback = null;
// しおりのアーカイブ（11）: しおり一覧モーダルの「アーカイブ済みを見る」トグルの開閉状態。
// モーダルを開き直すたびにリセットする（既定は閉じた状態）
var tripsArchivedOpen = false;
// 開始時刻の手動固定（17）: タイムラインで <input type="time"> をインライン編集中の項目id。
// 描画のたびに全カード再構築される都合上、この編集状態は render() をまたいで保持する必要があるため
// trip状態（保存対象）ではなくUI一時状態としてここに持つ。item.id はグローバルに一意（genId()）なため、
// 日/しおりの切り替えでリセットしなくても別項目のカードに誤って表示されることはない
var fixedStartEditingId = null;
// 実績記録（フェーズ1）: fixedStartEditingId と同じ理由・同じ運用（タイムラインで
// <input type="time"> をインライン編集中の項目id。render() をまたいで保持する必要があるためUI一時状態として持つ）
var actualStartEditingId = null;
var dragState = null;
// 持ち物・やることリストの並べ替え（10 拡張）: タイムラインのドラッグ（dragState）とは
// 別のDOMサブツリー・別の対象配列（trip.packing/trip.todos）を扱うため、状態も分けて持つ
var checklistDragState = null;
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

/* =========================================================
 * 編集できる共有リンク（18）
 * #e=<editId> で起動したときの共同編集モード（collabMode）の状態。
 * viewOnly とは独立（両立しない: ハッシュの接頭辞が排他のため同時に true にはならない）。
 * collabMode 中は編集操作は通常どおり可能だが、ローカルストレージ・自分のクラウド（trips）には
 * 一切書き込まない。代わりに editTrips/{editId} へデバウンス書き込みする（scheduleCollabPush）。
 * ========================================================= */
// このタブ/セッションを識別するランダムID。editTrips への書き込み時に writerId として埋め込み、
// onSnapshot で自分自身の書き込みのエコーを受信したときに無視してループを防ぐ（オーナー側・共同編集側で共用）
var SESSION_WRITER_ID = genId() + genId();
// 共同編集の更新通知が連続して溜まらないようにする間隔
var COLLAB_NOTICE_MIN_INTERVAL_MS = 8000;
var lastCollabNoticeAt = 0;
var collabMode = false; // #e=<editId> で起動した共同編集モード中か
var collabEditId = null; // 共同編集中の editTrips ドキュメントID
var collabOwnerUid = null; // 受信した editTrips ドキュメントの ownerUid（push時にそのまま維持する必要がある）
var collabRevoked = false; // オーナーが編集リンクを停止した（ドキュメントが消えた）ことを検知したら true。以降 push しない
var collabPushTimer = null;
// 編集できる共有リンク（18）: 共同編集側でこれまでに適用済みの editTrips ドキュメントの生データ（JSON文字列）。
// checkCollabHash の get() と直後の subscribeCollabListener の onSnapshot初回コールバックは
// 同じ内容を二重に届けてくる（Firestoreの仕様上、onSnapshot登録直後に現在の状態が1回必ず飛んでくるため）。
// この初回コールバックが「get()直後〜購読確立までの間に行ったローカル編集」を巻き戻してしまう競合を防ぐため、
// 受信データがこの値と完全一致するときは何もしない（writerIdでの自己エコー判定と同じ目的の、内容ベースの判定）
var collabLastAppliedRaw = null;
// 編集できる共有リンク（18）: オーナー側のpull-sync・共同編集側のpull-syncの両方で共用する購読ハンドル。
// どちらか一方しか同時に有効にならない（オーナー側は viewOnly/collabMode でないときのみ、共同編集側は collabMode 中のみ）
var editListenerUnsub = null;
var editListenerEditId = null;
// pull（onSnapshotで受信したリモートの変更をローカルに反映する処理）の最中は、
// その反映自体が saveState() 経由で push を誘発しないようにするための抑止フラグ（ループ防止）
var applyingRemoteEditUpdate = false;
// 200KB超過（EDIT_TRIP_MAX_BYTES）のトーストは連続発生時に1回だけ出す
var editTripTooLargeShown = false;

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

// 開始時刻の手動固定（17）: startMin（オーバーフロー込みの絶対分）から、その日付境界内の
// "HH:MM" 表記を得る。<input type="time"> の value にプリセットする用で、
// minutesToTimeStr と違い " (+1)" 等のオーバーフロー表記は含めない
function minutesToHHMM(mins) {
  var wrapped = ((mins % 1440) + 1440) % 1440;
  return pad2(Math.floor(wrapped / 60)) + ":" + pad2(wrapped % 60);
}

// 開始時刻の手動固定（17）: "H:MM" / "HH:MM" 形式のみ許容し、時=0-23・分=0-59の範囲外や
// それ以外の型・書式は防御的に null にフォールバックする。有効な値はゼロ埋め2桁の正規形
// （例 "9:5" -> "09:05"）に変換して返す。normalizeTrip・CSV読込・インライン編集の確定時など
// fixedStart を書き込むすべての箇所でこれを通す（唯一の検証経路）
function normalizeFixedStart(v) {
  if (typeof v !== "string") return null;
  var m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var mi = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return pad2(h) + ":" + pad2(mi);
}

// 日付を "YYYY-MM-DD" に正規化する。<input type="date"> はこの形式しか受け付けず、
// 他の形式を渡すと値が空になって日付が消えたように見えるため、読み込み時に必ず通す。
// Excelや手作業で編集したCSVは "2026/7/24" のようにスラッシュ区切り・月日が1桁になりやすい。
// 日付として解釈できない値は「捨てずにそのまま返す」: 読み込み時にユーザーのデータを
// 黙って消さないことを優先する（表示できないだけで、データは失われない）
function normalizeDateStr(v) {
  if (typeof v !== "string") return "";
  var s = v.trim();
  if (!s) return "";
  var m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return s;
  var y = parseInt(m[1], 10);
  var mo = parseInt(m[2], 10);
  var d = parseInt(m[3], 10);
  if (isNaN(y) || isNaN(mo) || isNaN(d) || mo < 1 || mo > 12 || d < 1 || d > 31) return s;
  return y + "-" + pad2(mo) + "-" + pad2(d);
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// 日付の自動連番（2）: "YYYY-MM-DD" 文字列に1日加算した "YYYY-MM-DD" を返す。
// 必ずUTCベースで加算する（ローカルタイムゾーンのDST切替等で日がずれるのを防ぐため）。
// 形式が不正な文字列は "" を返す（呼び出し側で「連鎖停止」として扱われる）
function addOneDayToDateStr(dateStr) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return "";
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 日付の自動連番（2）の中核: index 0（Day1）は常にユーザー入力のアンカーとして対象外にし、
// index 1以降の日を順に見て、dateManual===false の日を「直前の日の日付 + 1日」で埋める。
// 直前の日の日付が空（または不正な形式）なら、その日も空のまま（連鎖を止める）。
// 「Day1+N日」方式ではなく「直前の日から+1日」方式のため、手動で日付を変えた/飛ばした日の
// 直後からも自然に連番が続く。日付入力の変更・日の追加・日の削除のたびに呼び出す
function recalcAutoDates() {
  for (var i = 1; i < trip.days.length; i++) {
    var day = trip.days[i];
    if (day.dateManual) continue;
    var prevDate = trip.days[i - 1].date;
    day.date = prevDate ? addOneDayToDateStr(prevDate) : "";
  }
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
