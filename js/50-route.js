/**
 * 50-route.js — ルート計算・位置解決・多言語名・Routes API・地図
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

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

// 実行（言語切替の名前補完・タイトル翻訳）開始時に呼ぶ。「APIキー未設定」案内トーストの1回制限をリセットする（3c/6e追記）
function resetNoKeyNoticeFlag() {
  noKeyNoticeShown = false;
}

// APIキー未設定のために翻訳をスキップした項目があったとき、言語切替1回につき1度だけ案内トーストを出す（3c/6e追記）。
// targetLang === "ja" は翻訳対象外のためここでも常に何もしない（fetchLocalizedNames は ja 切替時にも
// OSM取得自体は試みるため、この呼び出し側だけでなくここでも二重にガードしておく）
function showNoKeyNoticeIfNeeded(targetLang) {
  if (targetLang === "ja") return;
  if (noKeyNoticeShown) return;
  noKeyNoticeShown = true;
  showToast(t("toast.noKeyNotice"));
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

// 言語切替時に、全日の項目を対象に名前とメモの翻訳を逐次解決する（3c 追記のフォールバックチェーン）。
// ルート検討/地図更新（isGeoRunning）の実行中は開始しない。以前の name-fetch が実行中なら
// （連打対策として）中断してから新しいバッチを開始する。
// 対象は「名前があり names[新言語] が未取得の項目」（move も含む）と「メモがあり
// noteNames[新言語] が未取得の項目」（cat問わず）の和集合。1項目が両方に該当することもある
function fetchLocalizedNames(targetLang) {
  abortNameFetch();
  if (isGeoRunning) return; // ルート検討/地図更新と競合させない

  var targets = [];
  trip.days.forEach(function (day, dayIdx) {
    day.items.forEach(function (item) {
      if (!item.names) item.names = {};
      if (!item.noteNames) item.noteNames = {};

      // names[targetLang] が非空文字列のときだけ取得済みとしてスキップする。
      // null（取得を試みたが見つからなかった）はキー追加後の再試行対象として残す
      var nameQuery = (item.loc || item.name || "").trim();
      var needsName = !!nameQuery && !(typeof item.names[targetLang] === "string" && item.names[targetLang]);

      // メモの多言語表示（3c 追記）: noteNames も同じ「非空文字列だけ取得済み」ルール
      var noteQuery = (item.note || "").trim();
      var needsNote = !!noteQuery && !(typeof item.noteNames[targetLang] === "string" && item.noteNames[targetLang]);

      if (!needsName && !needsNote) return;
      targets.push({ item: item, day: day, dayIdx: dayIdx, needsName: needsName, needsNote: needsNote });
    });
  });
  if (targets.length === 0) return;

  // 表示中の日のスポットを先に処理する。OSMのレート制限（1.1秒/件）があるため、
  // 上から順だと画面に見えている日の反映が最後になることがある
  targets.sort(function (a, b) {
    var aCur = a.dayIdx === currentDayIndex ? 0 : 1;
    var bCur = b.dayIdx === currentDayIndex ? 0 : 1;
    return aCur - bCur;
  });

  isNameFetchRunning = true;
  var myToken = (nameFetchToken += 1);
  var total = targets.length;
  var completed = 0;

  var chain = Promise.resolve();
  targets.forEach(function (pair) {
    var item = pair.item;
    var day = pair.day;
    var needsName = pair.needsName;
    var needsNote = pair.needsNote;
    chain = chain.then(function () {
      if (myToken !== nameFetchToken) return; // 中断済み：新規開始しない
      completed += 1;
      showNameFetchProgress(t("timeline.nameFetchProgress", { cur: completed, total: total }));

      // move（手入力の移動名）は場所ではないため OSM/Places 検索が無意味。
      // Translation API のみを使う（1. OSM は完全スキップ、2. Places もスキップ）
      var isMove = item.cat === "move";

      // 1. OSM namedetails（全言語一括保存のため、names にいずれかのキーが既にある項目はスキップ）。
      // move / 名前翻訳が不要な項目はそもそも呼ばない
      var hasAnyOsmKey = Object.keys(item.names).length > 0;
      var osmStep = !needsName || isMove || hasAnyOsmKey
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

      var nameStep = osmStep.then(function () {
        if (!needsName) return;
        if (typeof item.names[targetLang] === "string" && item.names[targetLang]) return; // OSMで解決済み

        var apiKey = getGmapsKey();
        if (!apiKey) {
          showNoKeyNoticeIfNeeded(targetLang); // キー未設定ならここまで（従来どおり null のまま）
          return;
        }

        if (isMove) {
          // move: Places はスキップし Translation のみ
          return translateText(nameQueryOf(item), apiKey, targetLang).then(function (translated) {
            item.names[targetLang] = translated || null;
          });
        }

        // 2. Places Text Search を対象言語で照会
        return placesDisplayNameSearch(item, day, targetLang, apiKey).then(function (placeName) {
          if (placeName) {
            item.names[targetLang] = placeName;
            return;
          }
          // 3. Cloud Translation API で機械翻訳
          var nameSrc = nameQueryOf(item);
          return translateText(nameSrc, apiKey, targetLang).then(function (translated) {
            // メモ側と同じ理由で、原文と実質同じ訳（＝同言語への翻訳）は保存しない
            item.names[targetLang] =
              translated && !isEffectivelySameText(translated, nameSrc) ? translated : null;
          });
        });
      });

      // メモの翻訳（3c 追記）: メモは自由文で場所ではないため、OSM/Places は使わず Translation のみ
      var noteStep = nameStep.then(function () {
        if (!needsNote) return;
        if (typeof item.noteNames[targetLang] === "string" && item.noteNames[targetLang]) return;

        var apiKey = getGmapsKey();
        if (!apiKey) {
          showNoKeyNoticeIfNeeded(targetLang); // キー未設定ならここまで（従来どおり null のまま）
          return;
        }

        var noteSrc = (item.note || "").trim();
        return translateText(noteSrc, apiKey, targetLang).then(function (translated) {
          // 原文と実質同じなら「翻訳不要」として null にする。メモが既に対象言語で
          // 書かれている場合（例: 日本語表示中の日本語メモ）、翻訳APIは空白だけが
          // 正規化されたほぼ同一の文字列を返す。それを保存すると原文の真下に
          // ほぼ同じ文が重複表示されてしまう
          item.noteNames[targetLang] =
            translated && !isEffectivelySameText(translated, noteSrc) ? translated : null;
        });
      });

      return noteStep.then(function () {
        // 1件ごとに画面へ反映する。スポットが多いと OSM のレート制限（1.1秒/件）で
        // 全件完了まで数十秒かかり、最後にまとめて描画すると「切り替えても何も変わらない」
        // ように見えてしまうため、取得できたものから順に表示する
        if (myToken !== nameFetchToken) return; // 中断済み
        var nameUpdated = needsName && typeof item.names[targetLang] === "string" && item.names[targetLang];
        var noteUpdated = needsNote && typeof item.noteNames[targetLang] === "string" && item.noteNames[targetLang];
        if (nameUpdated || noteUpdated) render();
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

// fetchLocalizedNames 内: 名前翻訳に使うクエリ文字列（loc優先、無ければname）
function nameQueryOf(item) {
  return (item.loc || item.name || "").trim();
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

  // titles[L] が「非空」かつ「ベースタイトルと異なる」かつ「新規しおりの初期値でない」場合のみ
  // 翻訳済みとみなしてスキップする。
  // - titles[L] === base: 未翻訳（タイトルblurハンドラが変更なしで現在の表示文字列を
  //   保存してしまった名残）
  // - titles[L] が NEW_TRIP_TITLES と一致: しおり作成時に自動で入った初期値（例: "New Trip"）で
  //   あってユーザーが決めた訳ではない。ベースタイトルを付けた後もこれが残り、
  //   「翻訳済み」と誤判定されて永久に翻訳されない状態になっていた
  var current = trip.titles[targetLang];
  var isDefaultTitle = current === window.I18N.NEW_TRIP_TITLES[targetLang];
  if (typeof current === "string" && current && current !== base && !isDefaultTitle) return;

  if (!base) return; // 翻訳できるベースタイトルが無ければ何もしない（APIキー未設定案内も出さない）

  var apiKey = getGmapsKey();
  if (!apiKey) {
    showNoKeyNoticeIfNeeded(targetLang); // キー未設定のため翻訳をスキップ（3c/6e追記の案内トースト）
    return;
  }

  var myTrip = trip; // 翻訳完了までにしおりが切り替わっていた場合、誤って別のしおりに保存しない
  translateText(base, apiKey, targetLang).then(function (translated) {
    if (!translated) return;
    if (trip !== myTrip) return; // しおり切替後は保存しない
    // 翻訳を待っている間に手動編集された場合は上書きしない。ただし冒頭のスキップ判定と
    // 同じ基準にすること（初期値 "New Trip" 等が残っているだけの状態は「手動編集」ではないので、
    // ここで弾いてしまうと翻訳結果が永久に保存されない）
    var latest = myTrip.titles[targetLang];
    var latestIsDefault = latest === window.I18N.NEW_TRIP_TITLES[targetLang];
    if (typeof latest === "string" && latest && latest !== base && !latestIsDefault) return;
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
    if (it.cat === "move" && it.auto && !it.fixedStart) {
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
        fixedStart: null,
        lat: null,
        lon: null,
        mode: mode,
        distKm: distKm,
        auto: true,
        approx: !!approx,
        unresolved: !!unresolved,
        arriveTz: "",
        names: {},
        noteNames: {}
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
