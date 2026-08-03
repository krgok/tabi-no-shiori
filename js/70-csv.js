/**
 * 70-csv.js — CSV入出力・バックアップ/復元
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

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
// 非公開マーク（14拡張）: dayPrivate（day列と同様に行ごと。同一dayの最初の行の値を採用）も任意列として追加する
// 開始時刻の手動固定（17）: fixedStart（"HH:MM" または空。move含む全カテゴリー共通）も任意列として追加する。
// 旧CSV（列が無い）では null 扱いになり後方互換を保つ
var CSV_OPTIONAL_COLUMNS = ["tz", "arriveTz", "private", "notePrivate", "dayPrivate", "fixedStart"];
// 持ち物リスト・やることリスト（10）: 行程CSVの後に空行を1行挟んだ第2テーブルのヘッダー（必須列）
var CHECKLIST_CSV_COLUMNS = ["list", "text", "done"];
// 非公開マークと公開用データ（14）: 第2テーブルの任意列（旧CSVには無いため false 扱いで後方互換）。
// listPrivate（14拡張）: リスト全体単位の非公開フラグ。行ごとに出力し、同一list（持ち物/やること）の
// 最初の行の値を採用する。既知の制限: リストが空 かつ listPrivate=true の場合は行が存在しないため
// CSV往復でフラグが失われる（空の非公開リストは実害が無いため許容。SPEC 14参照）
var CHECKLIST_CSV_OPTIONAL_COLUMNS = ["private", "listPrivate"];

// 「空行」の判定。アプリの出力は1フィールドの空行だが、手作業やExcelでの編集を経ると
// ",,,,,," や " "（空白のみ）になりうるため、全フィールドが空白のみなら空行とみなす
function isBlankCsvRow(fields) {
  return fields.every(function (f) {
    return (f || "").trim() === "";
  });
}

// その行が持ち物・やることリスト（第2テーブル）のヘッダー行かどうか。
// 空行が失われたCSVでも第2テーブルを見つけられるようにするために使う
function isChecklistHeaderRow(fields) {
  var names = {};
  fields.forEach(function (f) {
    names[(f || "").trim()] = true;
  });
  return CHECKLIST_CSV_COLUMNS.every(function (c) {
    return names[c] === true;
  });
}

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
  // CSVタイトル行（8 追記）: 本文の1行目に "title,<タイトル>" の2フィールド行を出力する。
  // タイトルはCSVにこれまで一切含まれておらず、新規しおりへのインポートでタイトルが
  // 引き継がれず既定の「新しい旅行」等のままになる問題があったための対応。
  // 値は tripDisplayTitle(trip)（titles[現在言語] || title）。旧バージョンの本アプリは
  // この行を「day」で始まらない＝ヘッダー行不一致として扱い読み込めなくなるため、
  // 後方互換のためインポート側で明示的に検出する（parseTripCsv参照）
  var rows = [["title", tripDisplayTitle(trip)], CSV_COLUMNS.concat(CSV_OPTIONAL_COLUMNS)];
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
        item.notePriv ? "1" : "0",
        // 非公開マーク（14拡張）: dayPrivate は日単位のフラグを行ごとに繰り返し出力する（tz と同様）
        day.priv ? "1" : "0",
        // 開始時刻の手動固定（17）: 未固定は空文字
        item.fixedStart || ""
      ]);
    });
  });
  var mainCsv = rows.map(csvFormatRow).join("\r\n") + "\r\n";

  // 持ち物リスト・やることリスト（10）: 行程CSVの後に空行を1行挟み、第2テーブルとして出力する。
  // 非公開マークと公開用データ（14）: private（1/0）列を追加する。
  // listPrivate（14拡張）: リスト全体単位のフラグを行ごとに繰り返し出力する
  var listRows = [CHECKLIST_CSV_COLUMNS.concat(CHECKLIST_CSV_OPTIONAL_COLUMNS)];
  var listLabels = window.I18N.LIST_NAMES[L];
  trip.packing.forEach(function (it) {
    listRows.push([listLabels.packing, it.text || "", it.done ? "1" : "0", it.priv ? "1" : "0", trip.packingPriv ? "1" : "0"]);
  });
  trip.todos.forEach(function (it) {
    listRows.push([listLabels.todos, it.text || "", it.done ? "1" : "0", it.priv ? "1" : "0", trip.todosPriv ? "1" : "0"]);
  });
  var listCsv = listRows.map(csvFormatRow).join("\r\n") + "\r\n";

  return mainCsv + "\r\n" + listCsv;
}

// ファイル名として不正な文字を無難な文字に置き換える
function fileSafeName(name) {
  return String(name || "trip").replace(/[\\/:*?"<>|]/g, "_").trim() || "trip";
}

/* =========================================================
 * 全しおりのバックアップ／復元
 * 未ログイン利用者はブラウザのデータ消去で全て失う。ログインしていても
 * Firestore 無料プランに自動バックアップは無いため、手動の保険を用意する。
 * しおりデータのみを対象とし、APIキー・地名キャッシュは含めない
 * ========================================================= */
function backupAllTrips() {
  var payload = {
    app: "tabi-no-shiori",
    kind: "backup",
    schema: 2,
    exportedAt: new Date().toISOString(),
    // v2ストアと同じ形（エントリのメタ情報 archived/publicId/editId 等も保つ）
    store: {
      currentId: currentTripId,
      trips: tripsStore.map(function (e) {
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
    }
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "tabi-shiori-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

// 復元は「現在の全しおりを置き換える」破壊的操作なので必ず確認を挟む。
// 壊れたファイルの場合は何も変更せずエラーを出す（既存データを守る）
function restoreAllTripsFromFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (ev) {
    var parsed = null;
    try {
      parsed = JSON.parse(String(ev.target.result || ""));
    } catch (e) {
      parsed = null;
    }
    var store = parsed && parsed.store;
    if (!store || !Array.isArray(store.trips) || store.trips.length === 0) {
      showToast(t("settings.restoreFailed"), "error");
      return;
    }
    var entries = store.trips
      .map(function (e) {
        if (!e || !e.data || !Array.isArray(e.data.days)) return null;
        return {
          id: typeof e.id === "string" && e.id ? e.id : genId(),
          // 他人が編集した可能性のあるファイルも受け取るため、必ず正規化を通す
          data: normalizeTrip(e.data),
          archived: !!e.archived,
          cloudId: typeof e.cloudId === "string" ? e.cloudId : null,
          // updatedAt はそのまま保つ。ログイン中はクラウド側が新しければ
          // 既存の computeTripsMergePlan がクラウド優先で解決する
          updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : 0,
          publicId: typeof e.publicId === "string" ? e.publicId : null,
          editId: typeof e.editId === "string" ? e.editId : null
        };
      })
      .filter(Boolean);
    if (entries.length === 0) {
      showToast(t("settings.restoreFailed"), "error");
      return;
    }
    showConfirm(t("settings.restoreConfirmTitle"), t("settings.restoreConfirmBody"), function () {
      tripsStore = entries;
      var hasCurrent = entries.some(function (e) {
        return e.id === store.currentId;
      });
      currentTripId = hasCurrent ? store.currentId : entries[0].id;
      trip = getCurrentEntry().data;
      currentDayIndex = 0;
      persistLocalOnly();
      render();
      showToast(t("settings.restored", { n: entries.length }));
    });
  };
  reader.onerror = function () {
    showToast(t("settings.restoreFailed"), "error");
  };
  reader.readAsText(file);
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
    // 開始時刻の手動固定（17）: fixedStart は任意列。旧CSV（列が無い）では colIndex.fixedStart が
    // undefined になり fields[undefined] は undefined になるので null 扱い（後方互換）。
    // 値がある場合も "HH:MM" 形式以外は normalizeFixedStart が防御的に null にする
    fixedStart: normalizeFixedStart(colIndex.fixedStart != null ? fields[colIndex.fixedStart] : null),
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
  // 非公開マーク（14拡張）: listPrivate も任意列。旧CSVでは false 扱い。
  // リスト全体単位のフラグのため item には含めず、呼び出し元（parseTripCsv）で
  // 同一 list の最初の行の値だけを採用する
  var listPriv = csvBoolField(fields, colIndex, "listPrivate");
  return { kind: kind, item: { id: genId(), text: text, done: done, priv: priv }, listPriv: listPriv };
}

// CSVタイトル行（8 追記）: newTrip に importedTitle を適用する。適用先は titles[現在言語]
// （現在言語が ja の場合は title も併せて更新し、ja を「基準」として扱う既存の設計 6e と揃える）。
// 空文字列（壊れた行・値なしの title 行）は何もしない（既存タイトルを不用意に消さない）
function applyImportedTripTitle(newTrip, importedTitle) {
  if (!importedTitle) return;
  if (!newTrip.titles) newTrip.titles = {};
  var curLang = lang();
  newTrip.titles[curLang] = importedTitle;
  if (curLang === "ja") {
    newTrip.title = importedTitle;
  }
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
    todos: JSON.parse(JSON.stringify(trip.todos)),
    // 非公開マーク（14拡張）: 第2テーブルが無い旧CSVでも既存値を引き継ぐ（後方互換）
    packingPriv: trip.packingPriv,
    todosPriv: trip.todosPriv
  };

  // CSVタイトル行（8 追記）: 1行目が "title,<値>" ならタイトル行として取り込み、
  // 2行目以降を従来どおり解析する（headerIdx をそのぶんずらす）。
  // 後方互換: 1行目が day,date,... で始まる旧CSV（タイトル行なし）は headerIdx=0 のまま従来どおり。
  // フィールド数を2に限定しないこと: Excelで保存すると他の行の列数に合わせて
  // "title,タイ家族旅行2026年,,,,,,,,,,,,," のように末尾がカンマ埋めされ2フィールドにならない。
  // 1列目が "title" で2列目に値があればタイトル行とみなし、3列目以降の空フィールドは無視する
  var headerIdx = 0;
  var importedTitle = null;
  if (rows.length > 0 && rows[0].length >= 2 && (rows[0][0] || "").trim() === "title") {
    importedTitle = (rows[0][1] || "").trim();
    headerIdx = 1;
  }

  if (rows.length <= headerIdx) {
    newTrip.days.push({ date: "", startTime: "09:00", items: [] });
    applyImportedTripTitle(newTrip, importedTitle);
    return { trip: normalizeTrip(newTrip), warnings: [1] };
  }

  var header = rows[headerIdx].map(function (h) {
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
    applyImportedTripTitle(newTrip, importedTitle);
    return { trip: normalizeTrip(newTrip), warnings: [1] };
  }

  var maxColIdx = Math.max.apply(
    null,
    CSV_COLUMNS.map(function (c) {
      return colIndex[c];
    })
  );

  // 持ち物リスト・やることリスト（10）: 行程CSVの後の空行で第2テーブルと区切る。
  // 手作業やExcelでの編集を経ると空行は ",,,,,," や " "（空白のみ）になりうるため、
  // 「全フィールドが空白のみの行」を空行とみなす（フィールド1つの完全な空行に限定しない）。
  // さらに、空行が全く無い（詰めて追記された）場合に備え、リストのヘッダー行そのものも
  // 区切りとして探す。どちらも見つからなければ第2テーブル無し（旧CSV・従来どおり）
  // mainEnd: 行程テーブルが終わる位置（この行は含まない）
  // listHeaderIdx: リストのヘッダー行の位置（-1 なら第2テーブル無し）
  var mainEnd = rows.length;
  var listHeaderIdx = -1;
  for (var bi = headerIdx + 1; bi < rows.length; bi++) {
    if (isBlankCsvRow(rows[bi])) {
      mainEnd = bi;
      // 空行の次がリストのヘッダー。空行だけで終わっている場合は第2テーブル無し
      listHeaderIdx = bi + 1 < rows.length ? bi + 1 : -1;
      break;
    }
    if (isChecklistHeaderRow(rows[bi])) {
      // 空行が失われたCSV。ヘッダー行の直前までが行程テーブル
      mainEnd = bi;
      listHeaderIdx = bi;
      break;
    }
  }

  var dayMap = {};
  var dayOrder = [];

  for (var i = headerIdx + 1; i < mainEnd; i++) {
    var lineNo = i + 1;
    var fields = rows[i];

    // 空行（カンマだけの行・空白のみの行を含む）は警告なしで無視する
    if (isBlankCsvRow(fields)) continue;

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
        // 非公開マーク（14拡張）: dayPrivate は任意列。旧CSVでは false 扱い。
        // 同一 day の最初の行の値を採用する（dayMap[dayNum] はここで一度だけ作られるため自然に満たされる）
        priv: csvBoolField(fields, colIndex, "dayPrivate"),
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
  if (listHeaderIdx !== -1) {
    var listHeader = rows[listHeaderIdx].map(function (h) {
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
      // 非公開マーク（14拡張）: listPrivate は同一 list（持ち物/やること）の最初の行の値を採用する。
      // その list に属す行が1つも無ければ（空リスト）既定 false になる（既知の制限。SPEC 14参照）
      var newPackingPriv = false;
      var newTodosPriv = false;
      var packingPrivSet = false;
      var todosPrivSet = false;
      for (var j = listHeaderIdx + 1; j < rows.length; j++) {
        var listLineNo = j + 1;
        var listFields = rows[j];

        if (isBlankCsvRow(listFields)) continue;

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
          if (!packingPrivSet) {
            newPackingPriv = parsed.listPriv;
            packingPrivSet = true;
          }
        } else {
          newTodos.push(parsed.item);
          if (!todosPrivSet) {
            newTodosPriv = parsed.listPriv;
            todosPrivSet = true;
          }
        }
      }
      newTrip.packing = newPacking;
      newTrip.todos = newTodos;
      newTrip.packingPriv = newPackingPriv;
      newTrip.todosPriv = newTodosPriv;
    }
  }

  applyImportedTripTitle(newTrip, importedTitle);
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
