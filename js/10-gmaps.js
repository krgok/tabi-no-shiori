/**
 * 10-gmaps.js — Google Maps 連携（座標抽出・リンク生成）
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

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
