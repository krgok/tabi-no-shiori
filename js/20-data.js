/**
 * 20-data.js — ストレージ・データ正規化・公開用サニタイズ・共同編集マージ
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

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
        // editId（18）: 編集できる共有リンクを発行していたら Firestore の editTrips ドキュメントID。未発行は null
        return {
          id: e.id,
          data: e.data,
          archived: !!e.archived,
          cloudId: e.cloudId || null,
          updatedAt: e.updatedAt || 0,
          publicId: e.publicId || null,
          editId: e.editId || null
        };
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
// 編集できる共有リンク（18）: collabMode 中は localStorage・自分のクラウド（trips）のどちらにも一切触れず、
// 代わりに editTrips/{editId} へのデバウンス書き込み（scheduleCollabPush）を行う。
// ほぼ全ての編集操作の末尾がこの saveState() を呼ぶ設計のため、ここ1箇所の分岐だけで
// 「共同編集者の変更は editTrips に飛ばす／ローカルには残さない」を実現できる
function saveState() {
  if (viewOnly) return;
  if (collabMode) {
    scheduleCollabPush();
    return;
  }
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
          publicId: typeof entry.publicId === "string" && entry.publicId ? entry.publicId : null,
          // 編集できる共有リンク（18）
          editId: typeof entry.editId === "string" && entry.editId ? entry.editId : null
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
      result = { currentId: id, trips: [{ id: id, data: normalizeTrip(parsed), archived: false, cloudId: null, updatedAt: 0, publicId: null, editId: null }] };
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
// 2つの文字列が「実質同じ」か。空白・改行の違いを無視して比較する。
// 翻訳APIは原文と同じ言語へ訳そうとすると、記号や空白だけが正規化された
// ほぼ同一の文字列を返す。それを翻訳結果として保存・表示すると、原文の真下に
// ほぼ同じ文が重複して出てしまうため、この判定で弾く
function isEffectivelySameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  var norm = function (s) {
    return s.replace(/\s+/g, "").trim();
  };
  return norm(a) === norm(b);
}

// names / noteNames の正規化。source（原文）を渡すと、原文と実質同じ値は
// 「翻訳不要」とみなして null に落とす（過去に保存された重複データもここで自動的に直る）
function normalizeNames(raw, source) {
  var names = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    window.I18N.LANGUAGES.forEach(function (Lc) {
      if (Object.prototype.hasOwnProperty.call(raw, Lc)) {
        var v = raw[Lc];
        if (typeof v === "string" || v === null) {
          names[Lc] = typeof v === "string" && isEffectivelySameText(v, source) ? null : v;
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
    todos: normalizeChecklist(raw.todos),
    // 非公開マーク（14拡張）: リスト全体まるごと非公開。既定 false。boolean 以外は防御的にフォールバック
    packingPriv: !!raw.packingPriv,
    todosPriv: !!raw.todosPriv
  };
  var days = Array.isArray(raw.days) ? raw.days : [];
  if (days.length === 0) {
    days = [{ date: "", startTime: "09:00", items: [] }];
  }
  days.forEach(function (d) {
    var day = {
      // 編集できる共有リンク（18）: マージ時のアンカー（「直前の日のid」）に使う安定id。
      // 旧データ（この機能より前に作られたしおり）には無いため、無ければ発行する
      id: typeof d.id === "string" && d.id ? d.id : genId(),
      // "2026/7/24" のようなスラッシュ区切り・1桁の月日も "2026-07-24" に正規化する。
      // <input type="date"> は "YYYY-MM-DD" しか受け付けず、他の形式だと表示が空になるため
      date: normalizeDateStr(d.date),
      // "7:00" のような1桁の時も "07:00" に正規化する（date と同じ理由。
      // <input type="time"> は "HH:MM" しか受け付けず、他の形式だと表示が空になる）。
      // 解釈できない値は既定の "09:00" にフォールバックする
      startTime: normalizeFixedStart(d.startTime) || "09:00",
      // 時差対応（13）: IANAタイムゾーン文字列。既定 ""＝時差計算なし。文字列のみ許容する防御的正規化
      tz: typeof d.tz === "string" ? d.tz : "",
      // 非公開マーク（14拡張）: その日を丸ごと非公開。既定 false。boolean 以外は防御的にフォールバック
      priv: !!d.priv,
      // 日付の自動連番（2）: true なら日付をユーザーが手動で確定した日（自動再計算の対象外）。
      // index 0（Day1）はこのフラグに関わらず常にアンカー（recalcAutoDates の対象外）として扱われる。
      // 旧データ移行: この機能より前に作られたしおりは dateManual を持たない。そこに既に日付が
      // 入っているなら、それはユーザーが手で入力したものなので true とみなす。false にしてしまうと
      // Day1 の編集で既存の日付（意図的に飛ばした日など）を黙って上書きしてしまうため。
      // boolean が明示されている場合はその値を尊重する（既定 false の新規日は自動連番の対象）
      dateManual:
        typeof d.dateManual === "boolean" ? d.dateManual : !!(typeof d.date === "string" && d.date),
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
        notePriv: !!it.notePriv,
        // 開始時刻の手動固定（17）: move含む全カテゴリー共通。既定 null（未固定）。
        // "HH:MM" 形式以外・範囲外の値は normalizeFixedStart が防御的に null にフォールバックする
        fixedStart: normalizeFixedStart(it.fixedStart),
        // 実績記録（フェーズ1）: move含む全カテゴリー共通。既定 null（未記録）。
        // actualStart は "✓" ボタンを押した時点の端末ローカル時刻（"HH:MM"）。
        // fixedStart と同じ検証経路（normalizeFixedStart）を通し、不正値は防御的に null にする
        actualStart: normalizeFixedStart(it.actualStart),
        // actualLat/actualLon: 記録時に navigator.geolocation が取得できた場合のみの座標（省略可）。
        // lat/lon と同じ防御的正規化（number かつ有限値のみ許容、それ以外は null）
        actualLat: typeof it.actualLat === "number" && isFinite(it.actualLat) ? it.actualLat : null,
        actualLon: typeof it.actualLon === "number" && isFinite(it.actualLon) ? it.actualLon : null,
        // 実績の端末間マージ（23追記）: actualStart/actualLat/actualLon のいずれかを変更するたびに
        // 端末ローカル時刻（epoch ms）を記録する。複数端末で別々の項目に実績を記録した場合の
        // マージ（mergeTripActuals）で「どちらが新しいか」を項目単位で判定するための基準時刻。
        // number かつ有限値のみ許容、それ以外（未記録・旧データ）は null
        actualAt: typeof it.actualAt === "number" && isFinite(it.actualAt) ? it.actualAt : null,
        // メモの端末間マージ（23追記・実績と同様の不具合修正）: note を変更（入力・修正・クリア）
        // するたびに端末ローカル時刻（epoch ms）を記録する。actualAt と同じ役割・同じ防御的正規化。
        // CSVには追加しない（内部管理用。インポート項目は null になる）
        noteAt: typeof it.noteAt === "number" && isFinite(it.noteAt) ? it.noteAt : null
      };
      if (item.lat == null || item.lon == null) {
        item.coordSrc = null;
      }
      // 実績記録: 片方だけ有効値でもう片方が欠けているのは不完全なデータのため、両方揃わなければ捨てる
      if (item.actualLat == null || item.actualLon == null) {
        item.actualLat = null;
        item.actualLon = null;
      }
      // スポット名の多言語表示（3c 追記）: move も含む全カテゴリー共通で names を持つ。
      // move は「前後スポットから組み立てる A → B」表示を優先するが、それが組み立てられない
      // 手入力の move 名（例:「タクシー移動」）を翻訳して保存する先として使う
      // 第2引数に原文を渡すことで、原文と実質同じ値（＝同言語への無意味な翻訳結果）は null に落とす
      item.names = normalizeNames(it.names, item.loc || item.name);
      // メモの多言語表示（3c 追記）: names と同じ構造。メモ欄の下に控えめに翻訳文を出すためのキャッシュ
      item.noteNames = normalizeNames(it.noteNames, item.note);
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
// - day.priv: true の日は days 配列から丸ごと削除する（14拡張・日単位）
// - trip.packingPriv / trip.todosPriv: true のリストは丸ごと空配列にする（14拡張・リスト単位）
// - priv: true の行程項目・持ち物/やること要素を削除する
// - notePriv: true の項目は note を空文字にする（項目自体は残す）
// - 非公開項目の削除で隣接スポットを失う自動生成 move（auto: true）も一緒に削除する
//   （手動追加の move (auto: false) は隣接スポットが消えても残す。日ごと削除の場合は
//   日全体が消えるため、その日に属す move も自動的に一緒に消える）
// - 結果から priv / notePriv / packingPriv / todosPriv フラグ自体を取り除く（公開データに痕跡を残さない）
// - 境界条件: 全ての日が非公開だと days が空配列になり得るが、これは意図した結果として返す。
//   受け取り側は必ず normalizeTrip を通す設計になっており、normalizeTrip は空 days を
//   1つの空の日にフォールバックするため、閲覧側・共有リンク経由の読み込みはクラッシュしない
//   （openPublicPreviewModal など sanitize結果を直接 forEach するだけの画面も、空配列なら
//   何も描画しないだけでエラーにはならない）
function sanitizeTripForPublic(tripData) {
  var clone = JSON.parse(JSON.stringify(tripData || {}));

  // 0. day.priv:true の日を丸ごと削除する（14拡張・日単位）。以降の処理は残った日にのみ及ぶ
  if (Array.isArray(clone.days)) {
    clone.days = clone.days.filter(function (day) {
      return !(day && day.priv);
    });
  }

  if (Array.isArray(clone.days)) {
    clone.days.forEach(function (day) {
      delete day.priv;
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

      // 3. notePriv:true の項目（削除されないもの）は note を空にする。
      // メモの多言語表示（3c 追記）: noteNames は翻訳済みメモそのものなので、note と同様に空にしないと
      // 非公開にした意味が無い（noteNames 経由でメモ内容が公開コピーに漏れてしまう）
      // メモの端末間マージ（23追記）: noteAt も note と揃えて削除する。note が空の理由が
      // 「本当に未記入」なのか「非公開で隠している」なのかをマージ側が誤って区別できてしまう
      // （＝非公開のはずのメモの有無や更新時刻が noteAt 経由で推測できてしまう）のを防ぐため。
      // note が残る項目（notePriv でない項目）では noteAt もそのまま残す（マージ判断に使うため）
      items.forEach(function (it) {
        if (it && it.notePriv) {
          it.note = "";
          it.noteNames = {};
          it.noteAt = null;
        }
      });

      // 4. 削除対象を取り除き、priv/notePriv フラグ自体も消す。
      // 実績記録（フェーズ1）: actualLat/actualLon（記録時のGPS座標）は「実際にいた場所」そのものを
      // 表す座標のため、予定の座標(lat/lon)より機微な個人情報として扱う。共有・公開・編集リンクの
      // いずれにも一切流さず、ここで必ず削除する。actualStart（到着時刻）は座標を含まず、
      // 家族との共同編集で実績時刻を共有する価値があるため残す（削除しない）。
      // actualAt（実績の最終更新時刻、23追記）も座標を含まない上、共同編集マージ（mergeDayItems）や
      // 端末間マージ（mergeTripActuals）が「どちらの実績が新しいか」を判断する材料として使うため残す
      day.items = items
        .filter(function (it) {
          return !removedIds[it.id];
        })
        .map(function (it) {
          delete it.priv;
          delete it.notePriv;
          it.actualLat = null;
          it.actualLon = null;
          return it;
        });
    });
  }

  // 1. リスト全体が非公開（packingPriv/todosPriv）なら中身を丸ごと空配列にする（14拡張・リスト単位）。
  //    そうでなければ従来どおり要素単位の priv で個別に間引く
  ["packing", "todos"].forEach(function (key) {
    if (!Array.isArray(clone[key])) return;
    var listPrivKey = key + "Priv"; // "packingPriv" | "todosPriv"
    if (clone[listPrivKey]) {
      clone[key] = [];
    } else {
      clone[key] = clone[key]
        .filter(function (it) {
          return !(it && it.priv);
        })
        .map(function (it) {
          delete it.priv;
          return it;
        });
    }
  });
  delete clone.packingPriv;
  delete clone.todosPriv;

  return clone;
}

// sanitizeTripForPublic の適用前後で除外された件数（行程項目＋持ち物＋やること合計）を数える。
// 公開プレビュー（14）の「非公開のため n 件を除外しました」表示に使う。
// 総数の差分で数えるだけの単純な実装のため、14拡張（日単位・リスト単位の非公開）で
// 丸ごと消えた日に含まれていた項目数・リスト全体非公開で消えた件数も自動的に含まれる
// （消えた日の items、空になった packing/todos の要素数がそのまま original 側の総数との差分になるため）
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
 * 編集できる共有リンク（18）: 受信した公開用データ（非公開項目が抜けたもの）を
 * オーナーの完全データへマージする純粋関数群（Firestore呼び出しを含まないため単体テスト可能）。
 * 「アンカー方式」: どの非公開要素も、オーナーの現在の完全データ（ownerTrip）と、
 * それを今この瞬間に sanitizeTripForPublic した結果（ownerPublic）を比較するだけで
 * 「どれが非公開で隠れているか」「隠れている要素の直前にあった、共同編集者にも見えているはずの要素は何か」
 * を都度再計算できる。そのため非公開要素の位置情報を別途永続化しておく必要はない
 * （＝アンカーは公開データには一切含まれず、オーナー側のこの計算だけに存在する）。
 * ========================================================= */

// fullList（オーナー視点の完全な配列。items配列 or days配列）のうち、
// survivingIdSet に id が含まれないもの（＝非公開で隠れている要素）を、
// 元の並び順のまま [{ item, afterId }] で返す。afterId は「直前の、隠れていない要素のid」
// （先頭から隠れている場合は null）。同じ afterId を持つ複数要素は元の相対順序を保つ
function computeHiddenWithAnchors(fullList, survivingIdSet) {
  var hidden = [];
  var lastSurvivingId = null;
  (fullList || []).forEach(function (item) {
    if (survivingIdSet[item.id]) {
      lastSurvivingId = item.id;
    } else {
      hidden.push({ item: item, afterId: lastSurvivingId });
    }
  });
  return hidden;
}

// computeHiddenWithAnchors が返した非公開要素を、baseList（共同編集者側の最新の並び）に
// アンカー位置で挿し戻す。afterId が null なら先頭、afterId が baseList に見当たらなければ
// （＝アンカーごと共同編集者に削除された）末尾に追加する。同じ挿入先が複数あっても元の順序を保つ
function insertByAnchor(baseList, hiddenEntries) {
  var result = baseList.slice();
  var insertedCountAfter = {};
  (hiddenEntries || []).forEach(function (h) {
    var key = h.afterId == null ? "__head__" : h.afterId;
    var already = insertedCountAfter[key] || 0;
    var idx;
    if (h.afterId == null) {
      idx = already;
    } else {
      var anchorIdx = result.findIndex(function (x) {
        return x.id === h.afterId;
      });
      idx = anchorIdx === -1 ? result.length : anchorIdx + 1 + already;
    }
    result.splice(idx, 0, h.item);
    insertedCountAfter[key] = already + 1;
  });
  return result;
}

// 1件のリスト（持ち物 or やること）をマージする。
// listPriv（リスト全体が非公開）なら共同編集者はこのリストを一切見ていない（常に空を受信する）ため、
// オーナーの元リストをそのまま保つ。そうでなければ要素単位の priv をアンカー方式で挿し戻す
function mergeChecklistList(ownerList, ownerPublicList, receivedList, listPriv) {
  if (listPriv) {
    return (ownerList || []).slice();
  }
  var publicIds = {};
  (ownerPublicList || []).forEach(function (it) {
    publicIds[it.id] = true;
  });
  var hidden = computeHiddenWithAnchors(ownerList, publicIds);
  var visible = (receivedList || []).map(function (rit) {
    var c = Object.assign({}, rit);
    c.priv = false;
    return c;
  });
  return insertByAnchor(visible, hidden);
}

// 1日分の items をマージする。ownerDay/ownerPublicDay は同じ日（id一致）のオーナー側完全データ／
// 今しがた計算した公開ビュー。receivedDay は共同編集者から届いた最新の日データ
function mergeDayItems(ownerDay, ownerPublicDay, receivedDay) {
  var publicItemIds = {};
  (ownerPublicDay.items || []).forEach(function (it) {
    publicItemIds[it.id] = true;
  });
  var hiddenItems = computeHiddenWithAnchors(ownerDay.items, publicItemIds);

  var ownerItemById = {};
  (ownerDay.items || []).forEach(function (it) {
    ownerItemById[it.id] = it;
  });

  var mergedVisibleItems = (receivedDay.items || []).map(function (rit) {
    var ownerIt = ownerItemById[rit.id];
    var merged = Object.assign({}, rit);
    // 受信データは常に priv:false（sanitize済み）だが、念のため明示しておく
    merged.priv = false;
    // notePriv:true だった項目は、共同編集者には空メモしか見えていない。
    // 受信の空メモで上書きせず、オーナーの元メモを保持する（notePriv フラグ自体も復元する）。
    // メモの多言語表示（3c 追記）: noteNames も同様に公開コピーでは空にされているため、
    // note と合わせてオーナー側の翻訳キャッシュを復元する（受信データで上書きして消さない）
    if (ownerIt && ownerIt.notePriv) {
      merged.notePriv = true;
      merged.note = ownerIt.note;
      merged.noteNames = ownerIt.noteNames;
      merged.noteAt = ownerIt && typeof ownerIt.noteAt === "number" ? ownerIt.noteAt : null;
    } else {
      merged.notePriv = false;
      // メモの端末間マージ（23追記・実績と同様の不具合修正）: notePriv でない項目に限り、
      // note を「常に受信値で無条件採用」ではなく noteAt（更新時刻）比較で新しい方を採用する。
      // ロジックは actualStart の noteAt 版（同値なら note が非空の側を優先）で、notePriv 項目の
      // 上の保護（オーナー側のメモを常に保持）は一切変えない
      var ownerNoteAt = ownerIt && typeof ownerIt.noteAt === "number" ? ownerIt.noteAt : 0;
      var receivedNoteAt = typeof rit.noteAt === "number" ? rit.noteAt : 0;
      var receivedNoteWins;
      if (receivedNoteAt !== ownerNoteAt) {
        receivedNoteWins = receivedNoteAt > ownerNoteAt;
      } else {
        var ownerHasNote = !!(ownerIt && ownerIt.note);
        var receivedHasNote = !!rit.note;
        receivedNoteWins = !ownerHasNote && receivedHasNote;
      }
      if (receivedNoteWins) {
        merged.note = typeof rit.note === "string" ? rit.note : "";
        merged.noteAt = typeof rit.noteAt === "number" ? rit.noteAt : null;
        merged.noteNames = rit.noteNames && typeof rit.noteNames === "object" ? rit.noteNames : {};
      } else {
        merged.note = ownerIt ? ownerIt.note : typeof rit.note === "string" ? rit.note : "";
        merged.noteAt = ownerIt && typeof ownerIt.noteAt === "number" ? ownerIt.noteAt : null;
        merged.noteNames = ownerIt && ownerIt.noteNames && typeof ownerIt.noteNames === "object" ? ownerIt.noteNames : {};
      }
    }
    // 実績の端末間マージ（23追記）: actualStart を常に受信値で無条件採用すると、共同編集者側の
    // 古いコピー（オーナーが実績記録した後、まだそれを見ていない状態で編集して送り返してきたもの）が
    // オーナーの新しい実績時刻を巻き戻してしまう。actualAt（実績の最終更新時刻）を比較し、
    // 新しい方の実績一式（actualStart/actualAt、場合により座標）を採用する。
    // 実績記録（フェーズ1）: actualLat/actualLon は sanitizeTripForPublic で必ず除去されるため、
    // 受信データ（rit）は常に null しか持たない。受信側が勝った場合でも rit.actualLat/actualLon は
    // null のままなので、座標が共有リンク経由でオーナー側に紛れ込むことは絶対に無い
    // （この保証は sanitizeTripForPublic 側で担保されており、ここでの分岐によらず常に成立する）
    var ownerActualAt = ownerIt && typeof ownerIt.actualAt === "number" ? ownerIt.actualAt : 0;
    var receivedActualAt = typeof rit.actualAt === "number" ? rit.actualAt : 0;
    var receivedWins;
    if (receivedActualAt !== ownerActualAt) {
      receivedWins = receivedActualAt > ownerActualAt;
    } else {
      // 同値（両方 0/未記録を含む）の場合は actualStart が non-null の側を優先する
      var ownerHasStart = !!(ownerIt && ownerIt.actualStart != null);
      var receivedHasStart = rit.actualStart != null;
      receivedWins = !ownerHasStart && receivedHasStart;
    }
    if (receivedWins) {
      merged.actualStart = rit.actualStart != null ? rit.actualStart : null;
      merged.actualAt = typeof rit.actualAt === "number" ? rit.actualAt : null;
      merged.actualLat = null;
      merged.actualLon = null;
    } else {
      merged.actualStart = ownerIt ? ownerIt.actualStart : null;
      merged.actualAt = ownerIt && typeof ownerIt.actualAt === "number" ? ownerIt.actualAt : null;
      merged.actualLat = ownerIt ? ownerIt.actualLat : null;
      merged.actualLon = ownerIt ? ownerIt.actualLon : null;
    }
    return merged;
  });

  var mergedItems = insertByAnchor(mergedVisibleItems, hiddenItems);

  return {
    id: ownerDay.id,
    date: receivedDay.date,
    startTime: receivedDay.startTime,
    tz: receivedDay.tz,
    priv: false,
    dateManual: receivedDay.dateManual,
    items: mergedItems
  };
}

// 編集できる共有リンク（18）の中核: 共同編集者から届いた最新データ（receivedRaw、非公開項目が
// 抜けたもの）を、オーナーの完全データ（ownerTrip）へマージした結果を返す純粋関数。
// 引数はどちらも変更しない。戻り値は normalizeTrip 済みの新しい trip オブジェクト
function mergeRemoteEditIntoOwnerTrip(ownerTrip, receivedRaw) {
  var received = normalizeTrip(receivedRaw);
  // 「オーナーが今この完全データを共有したら共同編集者にはどう見えるはずか」を都度計算する。
  // これと ownerTrip 自体を比較するだけで、非公開要素とそのアンカー（直前の可視要素）が求まる
  var ownerPublic = sanitizeTripForPublic(ownerTrip);

  var publicDayIds = {};
  ownerPublic.days.forEach(function (d) {
    publicDayIds[d.id] = true;
  });
  var hiddenDays = computeHiddenWithAnchors(ownerTrip.days, publicDayIds);

  var ownerDayById = {};
  ownerTrip.days.forEach(function (d) {
    ownerDayById[d.id] = d;
  });
  var ownerPublicDayById = {};
  ownerPublic.days.forEach(function (d) {
    ownerPublicDayById[d.id] = d;
  });

  var mergedVisibleDays = received.days.map(function (rd) {
    var ownerDay = ownerDayById[rd.id];
    var ownerPublicDay = ownerPublicDayById[rd.id];
    if (!ownerDay || !ownerPublicDay) {
      // オーナー側に存在しない日＝共同編集者が新しく追加した日。そのまま採用する
      return {
        id: rd.id,
        date: rd.date,
        startTime: rd.startTime,
        tz: rd.tz,
        priv: false,
        dateManual: rd.dateManual,
        items: rd.items.map(function (it) {
          var c = Object.assign({}, it);
          c.priv = false;
          c.notePriv = false;
          return c;
        })
      };
    }
    return mergeDayItems(ownerDay, ownerPublicDay, rd);
  });

  var mergedDays = insertByAnchor(mergedVisibleDays, hiddenDays);

  var merged = {
    v: 1,
    title: received.title,
    titles: received.titles,
    lang: received.lang,
    days: mergedDays,
    packing: mergeChecklistList(ownerTrip.packing, ownerPublic.packing, received.packing, !!ownerTrip.packingPriv),
    todos: mergeChecklistList(ownerTrip.todos, ownerPublic.todos, received.todos, !!ownerTrip.todosPriv),
    packingPriv: !!ownerTrip.packingPriv,
    todosPriv: !!ownerTrip.todosPriv
  };
  // 受信データは他人（共同編集者）が作った可能性がある前提のため、最終結果も必ず normalizeTrip を通す
  return normalizeTrip(merged);
}

/* =========================================================
 * 実績の端末間マージ（23追記）: ログイン時のクラウド同期（computeTripsMergePlan /
 * applyCloudMergePlan、30-cloud.js）は元々「updatedAt が新しい方のしおりを丸ごと採用」する設計だった。
 * これは行程表本体の編集（項目の追加・並べ替え等）には妥当だが、実績記録（✓ボタン）は
 * 複数端末で同時期に少しずつ書き込まれる典型ケースのため、丸ごと採用では
 * 「携帯で項目Aに実績✓、PCで項目Bに実績✓」のような操作で片方の実績が丸ごと消えてしまう。
 * そこで実績4フィールド（actualStart/actualLat/actualLon/actualAt）だけは、採用するしおり
 * （updatedAtが新しい方）に、もう一方のしおりの実績を項目id単位で拾い上げてから使う。
 * ========================================================= */

// trip（days/items構造）から、項目idをキーにした items のフラットな索引を作る。
// 項目は編集で別の日へ移動できるため、マージは日をまたいで id だけで照合する
function buildItemIndexById(t) {
  var index = {};
  (t && Array.isArray(t.days) ? t.days : []).forEach(function (d) {
    (d && Array.isArray(d.items) ? d.items : []).forEach(function (it) {
      if (it && typeof it.id === "string") index[it.id] = it;
    });
  });
  return index;
}

// a・b（同じidの項目 or どちらかが未定義）のうち、実績としてどちらを採用すべきかを選ぶ。
// (actualAt||0) が大きい方を優先し、同値（両方 未記録=0 を含む）なら actualStart が
// non-null の側を優先する。どちらも決め手が無ければ a（= adoptedTrip 側）を残す
function pickWinningActualItem(a, b) {
  var atA = a && typeof a.actualAt === "number" ? a.actualAt : 0;
  var atB = b && typeof b.actualAt === "number" ? b.actualAt : 0;
  if (atA !== atB) return atA > atB ? a : b;
  var aHasStart = !!(a && a.actualStart != null);
  var bHasStart = !!(b && b.actualStart != null);
  if (!aHasStart && bHasStart) return b;
  return a || b;
}

// メモの端末間マージ（23追記・実績と同様の不具合修正）: a・b のうち、メモとしてどちらを採用すべきかを
// 選ぶ。ロジックは pickWinningActualItem と同型: (noteAt||0) が大きい方を優先し、同値（両方 0 を含む）
// なら note が非空の側を優先する（過去データは両方 noteAt=0 のため、このタイブレークで
// 「片方にしか無いメモ」が救出される）。どちらも決め手が無ければ a（= adoptedTrip 側）を残す
function pickWinningNoteItem(a, b) {
  var atA = a && typeof a.noteAt === "number" ? a.noteAt : 0;
  var atB = b && typeof b.noteAt === "number" ? b.noteAt : 0;
  if (atA !== atB) return atA > atB ? a : b;
  var aHasNote = !!(a && a.note);
  var bHasNote = !!(b && b.note);
  if (!aHasNote && bHasNote) return b;
  return a || b;
}

// mergeTripActuals(adoptedTrip, otherTrip): adoptedTrip（採用する側＝updatedAtが新しい方）の
// 行程構造はそのまま使い、各項目の実績4フィールドと「メモ（note/noteAt）の組」だけを otherTrip
// （もう一方の端末のしおり）と項目id単位で比較して、新しい方の一式に差し替える。otherTrip 側にしか
// 実績/メモが無かった項目にも、それを拾い上げる。どちらの引数も変更しない純粋関数。戻り値は normalizeTrip 済み。
// メモの端末間マージ（23追記）: 関数名は実績記録フェーズ1のまま据え置いているが、実態は
// 「複数端末で同時に少しずつ書き込まれるフィールド（実績4項目＋メモ）」をまとめて項目単位マージする関数
function mergeTripActuals(adoptedTrip, otherTrip) {
  var otherIndex = buildItemIndexById(otherTrip);
  var merged = JSON.parse(JSON.stringify(adoptedTrip || {}));
  (Array.isArray(merged.days) ? merged.days : []).forEach(function (day) {
    (Array.isArray(day.items) ? day.items : []).forEach(function (it) {
      var other = otherIndex[it.id];
      if (!other) return; // 相手側に対応する項目が無ければ adoptedTrip 自身の実績・メモをそのまま残す
      var winner = pickWinningActualItem(it, other);
      it.actualStart = winner && winner.actualStart != null ? winner.actualStart : null;
      it.actualLat = winner && winner.actualLat != null ? winner.actualLat : null;
      it.actualLon = winner && winner.actualLon != null ? winner.actualLon : null;
      it.actualAt = winner && typeof winner.actualAt === "number" ? winner.actualAt : null;

      // メモ（note/noteAt の組）も同じ考え方で項目id単位マージする。noteNames（翻訳キャッシュ）は
      // 採用したメモの側のものを一緒に引き継ぐ（テキストと翻訳文がずれないように）
      var noteWinner = pickWinningNoteItem(it, other);
      it.note = noteWinner && typeof noteWinner.note === "string" ? noteWinner.note : "";
      it.noteAt = noteWinner && typeof noteWinner.noteAt === "number" ? noteWinner.noteAt : null;
      it.noteNames = noteWinner && noteWinner.noteNames && typeof noteWinner.noteNames === "object" ? noteWinner.noteNames : {};
    });
  });
  return normalizeTrip(merged);
}
