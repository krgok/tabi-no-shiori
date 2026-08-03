/**
 * 80-print.js — PDF出力・モーダル・トースト
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

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

function buildPrintItemRow(item, timed, numMap, day, idx) {
  var row = document.createElement("div");
  row.className = "print-item cat-" + item.cat;

  var parts = [];
  // 開始時刻の手動固定（17）: 固定時刻の項目には📌を付けて印刷・PDFでもひと目でわかるようにする
  var timeStr = (item.fixedStart ? "📌 " : "") + minutesToTimeStr(timed.startMin) + t("timeline.timeSep") + minutesToTimeStr(timed.endMin);
  if (timed.localTimeNote) timeStr += " " + t("timeline.localTimeNote");
  parts.push(timeStr);

  if (item.cat === "move") {
    // 移動の区間名も印刷する（従来は手段と所要時間だけで「どこからどこへ」が出ていなかった）。
    // 画面と同じく、前後のスポットから翻訳込みの「A → B」を組み立てられればそれを使う
    var moveName = item.name || "";
    if (day) {
      var nb = findAdjacentStops(day, idx);
      if (nb && nb.prev && nb.next) {
        moveName = localizedStopName(nb.prev) + " → " + localizedStopName(nb.next);
      } else {
        var moveLocalized =
          item.names && typeof item.names[lang()] === "string" ? item.names[lang()] : null;
        if (moveLocalized && !isEffectivelySameText(moveLocalized, item.name)) {
          moveName = item.name + "（" + moveLocalized + "）";
        }
      }
    }
    if (moveName) parts.push(moveName);
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
    // 画面側と同じ判定にする（原文と実質同じ訳は併記しない）
    if (localized && !isEffectivelySameText(localized, item.name)) {
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
    // メモの多言語表示（3c 追記）: 画面と同じく、翻訳があれば原文に併記する。
    // 原文と実質同じ訳（同言語への無意味な翻訳）は出さない
    var noteLocalized =
      item.noteNames && typeof item.noteNames[lang()] === "string" ? item.noteNames[lang()] : null;
    noteLine.textContent =
      noteLocalized && !isEffectivelySameText(noteLocalized, item.note)
        ? item.note + "（" + noteLocalized + "）"
        : item.note;
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
  getDayTimedItems(day).forEach(function (timed, idx) {
    list.appendChild(buildPrintItemRow(timed.item, timed, numMap, day, idx));
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

// アクション付きトースト（削除の「元に戻す」用）。既存の showToast はそのまま残す。
// onAction は1回だけ実行される（連打で二重復元しないこと）
function showActionToast(message, actionLabel, onAction) {
  var toast = document.createElement("div");
  toast.className = "toast toast-action";

  var msgEl = document.createElement("span");
  msgEl.textContent = message;
  toast.appendChild(msgEl);

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "toast-action-btn";
  btn.textContent = actionLabel;
  var used = false;
  var hideTimer = null;
  function close() {
    if (hideTimer) clearTimeout(hideTimer);
    toast.classList.remove("toast-show");
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }
  btn.addEventListener("click", function () {
    if (used) return; // 二重実行の防止
    used = true;
    close();
    if (typeof onAction === "function") onAction();
  });
  toast.appendChild(btn);

  el.toastContainer.appendChild(toast);
  requestAnimationFrame(function () {
    toast.classList.add("toast-show");
  });
  // 取り消しを選ぶ余裕があるよう、通常のトーストより長めに出す
  hideTimer = setTimeout(close, 6000);
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
