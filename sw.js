/**
 * sw.js — 旅のしおり の Service Worker（PWA・オフライン対応）
 *
 * このアプリの価値は旅先（機内・電波の弱い場所）で発揮されるため、
 * アプリ本体を端末にキャッシュしてオフラインでも起動できるようにする。
 *
 * 設計方針:
 * - アプリ本体（HTML/JS/CSS/同梱ライブラリ/アイコン）は「キャッシュ優先」。オフラインで確実に開ける
 * - 地図タイル・Google/Firebase などの外部通信は**一切キャッシュしない**（常にネットワーク）。
 *   古い地図やAPI応答を握り続けると害の方が大きく、認証まわりは特に危険なため
 * - HTML だけは「ネットワーク優先・失敗したらキャッシュ」。新しい版があれば即座に反映しつつ、
 *   オフラインでも前回の版で起動できる
 * - CACHE_VERSION を上げると古いキャッシュを全て捨てて入れ替える。
 *   アプリのファイルを更新したらこの値を上げること
 */

var CACHE_VERSION = "v3";
var CACHE_NAME = "tabi-shiori-" + CACHE_VERSION;

// オフラインで起動するために必要な、同一オリジンのファイル一式
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./js/00-core.js",
  "./js/10-gmaps.js",
  "./js/20-data.js",
  "./js/30-cloud.js",
  "./js/40-ui.js",
  "./js/50-route.js",
  "./js/60-share.js",
  "./js/70-csv.js",
  "./js/80-print.js",
  "./js/90-main.js",
  "./i18n.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon.svg",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/images/layers.png",
  "./vendor/leaflet/images/layers-2x.png",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png",
  "./vendor/firebase/firebase-app-compat.js",
  "./vendor/firebase/firebase-auth-compat.js",
  "./vendor/firebase/firebase-firestore-compat.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 1つでも失敗すると全体が失敗する addAll ではなく、個別に入れて
      // 一部が取れなくてもインストールを成功させる（オフライン起動の確実性を優先）
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () {
            /* この1件は諦める */
          });
        })
      );
    })
  );
  // 新しい SW をすぐ有効化する（更新が1回のリロードで届くように）
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            // 旧バージョンのキャッシュを破棄する
            return k !== CACHE_NAME && k.indexOf("tabi-shiori-") === 0 ? caches.delete(k) : null;
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // 外部（地図タイル・Nominatim・Google/Firebase 等）はキャッシュに触れず素通しする。
  // 古い応答を返すと地図がずれたり認証が壊れるため、オフライン時は素直に失敗させる
  if (url.origin !== self.location.origin) return;

  // HTML はネットワーク優先（新しい版をすぐ反映しつつ、オフラインでは前回の版で起動）
  var isHtml = req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1;
  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) {
            c.put(req, copy);
          });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match("./index.html");
          });
        })
    );
    return;
  }

  // それ以外の同一オリジン資産はキャッシュ優先（オフラインで確実に動く）。
  // 未キャッシュのものは取得して次回のために保存する
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req)
        .then(function (res) {
          if (res && res.status === 200 && res.type === "basic") {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function (c) {
              c.put(req, copy);
            });
          }
          return res;
        })
        .catch(function () {
          return hit;
        });
    })
  );
});
