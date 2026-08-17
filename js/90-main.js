/**
 * 90-main.js — イベント登録・初期化・PWA
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

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
    resetNoKeyNoticeFlag();
    fetchLocalizedNames(trip.lang);
    fetchLocalizedTitle(trip.lang);
  });

  el.addDayBtn.addEventListener("click", function () {
    if (viewOnly) return;
    trip.days.push({ id: genId(), date: "", startTime: "09:00", tz: "", priv: false, dateManual: false, items: [] });
    currentDayIndex = trip.days.length - 1;
    // 日付の自動連番（2）: 新しい日は既定 dateManual:false のため、直前の日の日付+1日で自動的に埋まる
    recalcAutoDates();
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
    var day = trip.days[currentDayIndex];
    day.date = el.dayDateInput.value;
    // 日付の自動連番（2）: index 0（Day1）は常にアンカーのため dateManual を触らない。
    // index >= 1 は、空でない値を入力したら手動固定（自動対象外）、空にしたら自動へ戻す
    if (currentDayIndex >= 1) {
      day.dateManual = !!day.date;
    }
    recalcAutoDates();
    saveState();
    render();
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
  // 非公開マーク（14拡張）: 日単位の🔓/🔒トグル。表示/非表示はCSSの .view-only-mode スコープで制御する
  if (el.dayPrivToggle) {
    el.dayPrivToggle.addEventListener("click", function () {
      var day = trip.days[currentDayIndex];
      day.priv = !day.priv;
      saveState();
      render();
    });
  }

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
  // 非公開マーク（14拡張）: リスト全体単位の🔓/🔒トグル（メイン）。
  // 表示/非表示はCSSの .view-only-mode スコープで制御する
  if (el.packingListPrivToggle) {
    el.packingListPrivToggle.addEventListener("click", function () {
      toggleListPriv("packing");
    });
  }
  if (el.todosListPrivToggle) {
    el.todosListPrivToggle.addEventListener("click", function () {
      toggleListPriv("todos");
    });
  }

  // 準備リストへのクイックアクセス（11）: ヘッダー🧳ボタン・準備モーダル
  el.prepBtn.addEventListener("click", openPrepModal);

  // 準備モーダルのサイズ変更を保存する（次回開いたときに同じ大きさで開く）。
  // ResizeObserver は環境によってはコールバックが配送されない（このプロジェクトでは
  // requestAnimationFrame でも同様の問題があった）ため、フレームに依存しない
  // 「つまみのドラッグが終わった時（pointerup）」と「モーダルを閉じた時」に保存する
  var prepCard = el.prepModal.querySelector(".modal-prep");
  if (prepCard) {
    prepCard.addEventListener("pointerup", savePrepModalSize);
    prepCard.addEventListener("pointercancel", savePrepModalSize);
  }
  el.prepModal.addEventListener("click", function (e) {
    // 閉じる操作（×ボタン・オーバーレイのクリック）の前に現在のサイズを控える
    if (e.target === el.prepModal || (e.target.dataset && e.target.dataset.close)) savePrepModalSize();
  });
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
  // 非公開マーク（14拡張）: リスト全体単位の🔓/🔒トグル（準備モーダル）
  if (el.prepPackingListPrivToggle) {
    el.prepPackingListPrivToggle.addEventListener("click", function () {
      toggleListPriv("packing");
    });
  }
  if (el.prepTodosListPrivToggle) {
    el.prepTodosListPrivToggle.addEventListener("click", function () {
      toggleListPriv("todos");
    });
  }

  // 持ち物・やることリストの並べ替え（10 拡張）: main（タイムライン下）・prepModal（🧳）の
  // 4つの一覧すべてでドラッグ並べ替えを有効にする（ハンドルからのみ開始）
  [el.packingItems, el.todosItems, el.prepPackingItems, el.prepTodosItems].forEach(function (container) {
    if (container) container.addEventListener("pointerdown", onChecklistDragPointerDown);
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

  if (el.settingsBackupBtn) {
    el.settingsBackupBtn.addEventListener("click", backupAllTrips);
  }
  if (el.settingsRestoreBtn && el.settingsRestoreInput) {
    el.settingsRestoreBtn.addEventListener("click", function () {
      el.settingsRestoreInput.click();
    });
    el.settingsRestoreInput.addEventListener("change", function () {
      var f = el.settingsRestoreInput.files && el.settingsRestoreInput.files[0];
      restoreAllTripsFromFile(f);
      el.settingsRestoreInput.value = ""; // 同じファイルを続けて選べるようにする
    });
  }

  el.shareBtn.addEventListener("click", openShareModal);
  el.shareCopyBtn.addEventListener("click", function () {
    copyToClipboard(el.shareUrl.value);
    showToast(t("share.copied"));
  });
  el.sharePreviewBtn.addEventListener("click", openPublicPreviewModal);

  // 共有（7・16統合）: リンク本体は shareCopyBtn/shareUrl（共通欄）を共用する。
  // ここでは固定方式の更新・停止のみを扱う
  if (el.sharePublicRefreshBtn) el.sharePublicRefreshBtn.addEventListener("click", onSharePublicRefreshClick);
  if (el.sharePublicStopBtn) el.sharePublicStopBtn.addEventListener("click", onSharePublicStopClick);
  if (el.viewOnlyBackBtn) el.viewOnlyBackBtn.addEventListener("click", exitViewOnlyMode);

  // 編集できる共有リンク（18）
  if (el.shareEditToggle) el.shareEditToggle.addEventListener("change", onShareEditToggleChange);
  if (el.shareEditCopyBtn) {
    el.shareEditCopyBtn.addEventListener("click", function () {
      copyToClipboard(el.shareEditUrl.value);
      showToast(t("share.copied"));
    });
  }
  if (el.collabBackBtn) el.collabBackBtn.addEventListener("click", exitCollabMode);

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
    store = { currentId: sampleId, trips: [{ id: sampleId, data: createSampleTrip(), archived: false, cloudId: null, updatedAt: 0, publicId: null, editId: null }] };
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
  // 公開層と公開URL（16）・編集できる共有リンク（18）: #p= / #e= / #d= はハッシュの接頭辞が異なるため排他。
  // checkPublicHash / checkCollabHash が viewOnly=true / collabMode=true を同期的に立てた場合、
  // 直後の render()/saveState() は自動的に無害化される
  checkPublicHash();
  checkCollabHash();
  checkSharedHash();
  render();
  // 編集できる共有リンク（18）: オーナー側は、現在のしおりが editId を持つなら editTrips の購読を開始する。
  // viewOnly / collabMode 中は関数内部のガードで何もしない
  syncEditListenerForCurrentTrip();

  // 起動時の移行・正規化結果を必ず永続化する（v1→v2移行の直後にリロードされても再移行されないように）
  // viewOnly 中（公開URL閲覧）・collabMode 中（共同編集）は saveState() が no-op のため、
  // ローカルデータは一切書き換わらない
  if (!viewOnly && !collabMode) saveState();
}

// 編集できる共有リンク（18）: マージロジック（mergeRemoteEditIntoOwnerTrip とその補助関数）は
// Firestore呼び出しを含まない純粋関数として切り出してあり、自動テストから直接呼べるようここに公開する。
// 実行時の挙動には一切影響しない（読み取り専用の関数参照を window に生やすだけ）
window.__tabiShioriCollabInternals = {
  mergeRemoteEditIntoOwnerTrip: mergeRemoteEditIntoOwnerTrip,
  computeHiddenWithAnchors: computeHiddenWithAnchors,
  insertByAnchor: insertByAnchor,
  // テストでの「共同編集者が受け取るはずのデータ」の組み立てに、本物のロジックをそのまま使えるように
  sanitizeTripForPublic: sanitizeTripForPublic,
  normalizeTrip: normalizeTrip,
  // 自己エコー無視（writerIdの一致判定）をテストから正確に再現するために公開する
  getSessionWriterId: function () {
    return SESSION_WRITER_ID;
  },
  // 実績の端末間マージ（23追記）: computeTripsMergePlan/applyCloudMergePlan は tripsStore 等の
  // グローバル状態を扱うため、Firestore の実ログインフローを介さずテストから直接呼べるように公開する
  mergeTripActuals: mergeTripActuals,
  computeTripsMergePlan: computeTripsMergePlan,
  applyCloudMergePlan: applyCloudMergePlan
};

/* =========================================================
 * PWA（オフライン対応）
 * このアプリの価値は旅先（機内・電波の弱い場所）で発揮されるため、
 * Service Worker でアプリ本体をキャッシュしてオフラインでも起動できるようにする。
 * 登録に失敗しても通常のWebアプリとしてそのまま動く（機能の必須要件ではない）
 * ========================================================= */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // file:// で開いた場合は Service Worker を使えない（登録しようとすると例外になる）
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;
  try {
    navigator.serviceWorker
      .register("sw.js")
      .then(function (reg) {
        // 新しい版が来たら知らせる。黙って古いまま使い続けるのを防ぐ
        reg.addEventListener("updatefound", function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", function () {
            // controller があるとき = 既に旧版で動いていた ＝ これは「更新」
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              showActionToast(t("pwa.updated"), t("pwa.reload"), function () {
                window.location.reload();
              });
            }
          });
        });
      })
      .catch(function () {
        /* 登録できなくても通常動作に支障はない */
      });
  } catch (e) {
    /* 同上 */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
registerServiceWorker();
