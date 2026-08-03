/**
 * 60-share.js — 複数しおり・共有リンク・公開URL/編集リンクの受信
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

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

  // 編集できる共有リンク（18）: 発行中のしおりに✏️バッジを表示する
  if (entry.editId) {
    var editBadge = document.createElement("span");
    editBadge.className = "trip-list-item-edit";
    editBadge.textContent = "✏️";
    editBadge.title = t("share.editBadge");
    editBadge.setAttribute("aria-label", t("share.editBadge"));
    item.appendChild(editBadge);
  }

  var dupBtn = document.createElement("button");
  dupBtn.type = "button";
  dupBtn.className = "trip-list-item-duplicate";
  dupBtn.textContent = "⧉";
  dupBtn.setAttribute("aria-label", t("trips.duplicateAria"));
  dupBtn.title = t("trips.duplicateAria");
  dupBtn.dataset.id = entry.id;
  item.appendChild(dupBtn);

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
  // 公開URL閲覧（16）・編集できる共有リンク（18）: しおり一覧はローカルの自分のしおりを扱うため、
  // 閲覧モード中／共同編集モード中は開かない（ヘッダーの tripsBtn 自体も非表示にしているが、念のための二重ガード）
  if (viewOnly || collabMode) return;
  tripsArchivedOpen = false;
  renderTripsList();
  openModal(el.tripsModal);
}

function switchTrip(id) {
  if (viewOnly || collabMode) return;
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
  syncEditListenerForCurrentTrip();
}

// しおりを丸ごと複製する（前回の旅行をテンプレートに次を作る用途）。
// 共有・編集リンク（publicId/editId）とクラウドID は引き継がない。
// 引き継ぐと複製が元の共有先に混ざってしまうため、複製は必ず「未共有の新しいしおり」になる
function duplicateTrip(id) {
  if (viewOnly || collabMode) return;
  var src = tripsStore.find(function (e) {
    return e.id === id;
  });
  if (!src) return;
  var copy = normalizeTrip(JSON.parse(JSON.stringify(src.data)));
  // タイトルに「のコピー」を付けて元と区別できるようにする（表示中の言語のタイトルに付ける）
  var L = lang();
  var baseTitle = tripDisplayTitle(src.data) || "";
  if (!copy.titles) copy.titles = {};
  copy.titles[L] = t("trips.copySuffix", { title: baseTitle });
  if (L === "ja") copy.title = copy.titles[L];
  var newId = genId();
  tripsStore.push({
    id: newId,
    data: copy,
    archived: false,
    cloudId: null,
    updatedAt: Date.now(),
    publicId: null,
    editId: null
  });
  currentTripId = newId;
  trip = copy;
  currentDayIndex = 0;
  saveState();
  closeModal(el.tripsModal);
  render();
  syncEditListenerForCurrentTrip();
  showToast(t("trips.duplicated"));
}

function createNewTrip() {
  if (viewOnly || collabMode) return;
  var data = normalizeTrip(createBlankTripData());
  var id = genId();
  tripsStore.push({ id: id, data: data, archived: false, cloudId: null, updatedAt: Date.now(), publicId: null, editId: null });
  currentTripId = id;
  trip = data;
  currentDayIndex = 0;
  saveState();
  closeModal(el.tripsModal);
  render();
  syncEditListenerForCurrentTrip();
}

// 「アーカイブされていないしおりが1つだけのとき、そのしおりは削除不可」（11で「最後の1つは削除不可」ガードを整合）
function requestDeleteTrip(id) {
  if (viewOnly || collabMode) return;
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
    // 編集できる共有リンク（18）: 発行中のまま削除された場合は editTrips 側も削除する
    if (entry.editId && authUser && firebaseReady && fbDb) {
      fbDb.collection(CLOUD_EDIT_TRIPS_COLLECTION).doc(entry.editId).delete().catch(function () {});
    }
    // 公開層と公開URL（16）: 共有中のまま削除された場合は publicTrips 側も削除する。
    // これが無いと、しおりを消しても共有URLを知っている人から旅程が見え続けてしまう
    if (entry.publicId && authUser && firebaseReady && fbDb) {
      fbDb.collection(CLOUD_PUBLIC_TRIPS_COLLECTION).doc(entry.publicId).delete().catch(function () {});
    }
    var switched = false;
    if (currentTripId === id) {
      // アーカイブされていないしおりを優先して切り替え先にする
      var nextEntry =
        tripsStore.find(function (e) {
          return !e.archived;
        }) || tripsStore[0];
      currentTripId = nextEntry.id;
      trip = nextEntry.data;
      currentDayIndex = 0;
      switched = true;
    }
    saveState();
    render();
    if (switched) syncEditListenerForCurrentTrip();
    if (!el.tripsModal.classList.contains("hidden")) renderTripsList();
  });
}

// しおりのアーカイブ（11）: 確認ダイアログ不要。現在編集中のしおりをアーカイブする場合は
// アーカイブされていない他のしおりへ自動的に切り替える。他に無ければアーカイブ不可
function requestArchiveTrip(id) {
  if (viewOnly || collabMode) return;
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
    syncEditListenerForCurrentTrip();
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
  if (viewOnly || collabMode) return;
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
  var dupBtn2 = e.target.closest(".trip-list-item-duplicate");
  if (dupBtn2) {
    e.stopPropagation();
    duplicateTrip(dupBtn2.dataset.id);
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

// 共有（7・16統合）: 「共有リンク」と「🌐 公開する」を1つの『共有』機能に統合し、内部方式は
// ログイン有無で自動切替する（ログイン済み→#p= のクラウド短縮URL・固定スナップショット、
// 未ログイン→#d= のURL埋め込み）。ユーザーは方式の違いを意識しない1本のリンク欄として使う
function openShareModal() {
  // 編集できる共有リンク（18）: collabMode 中は共有モーダルを開かない（自分のしおりではないため。
  // getCurrentEntry() が別人のローカルしおりを指しかねない多層ガード）
  if (viewOnly || collabMode) return;
  renderShareUrlForCurrentState();
  renderShareModalEditSection();
  openModal(el.shareModal);
}

// 非公開マークと公開用データ（14）: 共有リンクに埋め込むのは trip 全体そのままではなく、
// sanitizeTripForPublic の結果（priv/notePriv を反映した公開コピー）にする。
// これにより非公開マークを付けた部分は共有リンクを渡しても見えなくなる
function buildEmbeddedShareUrl() {
  var publicData = sanitizeTripForPublic(trip);
  var json = JSON.stringify(publicData);
  var encoded = toBase64Url(json);
  return window.location.origin + window.location.pathname + "#d=" + encoded;
}

// 共有（7・16統合）: 現在の authUser / publicId に応じて、共有モーダル冒頭のリンク欄（shareUrl）を
// 埋め込み式（#d=）とクラウド短縮式（#p=）のどちらで満たすか決める中核関数。
// 未ログイン時: 従来どおり #d= を即座に生成して表示する
// ログイン時かつ未発行: その場で publishCurrentTrip を自動実行し、完了を待って #p= を表示する
//   （＝共有＝クラウド発行が既定。ユーザーは「公開する/しない」を意識しない）
// ログイン時かつ発行済み: 既存の publicId から #p= を組み立てて即表示する
function renderShareUrlForCurrentState() {
  if (!authUser || !firebaseReady) {
    el.shareUrl.value = buildEmbeddedShareUrl();
    if (el.sharePublicSection) el.sharePublicSection.classList.add("hidden");
    if (el.shareLoginHint) el.shareLoginHint.classList.remove("hidden");
    if (el.shareCopyBtn) el.shareCopyBtn.disabled = false;
    return;
  }
  if (el.shareLoginHint) el.shareLoginHint.classList.add("hidden");

  var entry = getCurrentEntry();
  if (entry && entry.publicId) {
    renderShareModalPublicSection();
    if (el.shareCopyBtn) el.shareCopyBtn.disabled = false;
    return;
  }

  // ログイン済みだが未発行: その場で自動的に共有リンクを発行する
  if (el.sharePublicSection) el.sharePublicSection.classList.add("hidden");
  el.shareUrl.value = t("share.generating");
  if (el.shareCopyBtn) el.shareCopyBtn.disabled = true;
  publishCurrentTrip(function (ok) {
    // 発行完了までの間にモーダルが閉じられていたら、閉じた後のUIを上書きしない
    if (!el.shareModal || el.shareModal.classList.contains("hidden")) return;
    if (el.shareCopyBtn) el.shareCopyBtn.disabled = false;
    if (ok) {
      renderShareModalPublicSection();
    } else {
      // 発行に失敗した場合は埋め込み式（#d=）にフォールバックする（未ログイン時と同じ経路）
      el.shareUrl.value = buildEmbeddedShareUrl();
    }
  });
}

// 共有（7・16統合）: 共有モーダルの補足セクション（固定方式の説明・除外件数・更新/停止ボタン）を、
// 現在の authUser / publicId に合わせて更新する。リンク本体は shareUrl（共通欄）に書き込む。
// 未ログイン時は「ログインすると短いリンクを発行できます」の案内のみ表示する
function renderShareModalPublicSection() {
  if (!el.sharePublicSection) return;
  if (!authUser || !firebaseReady) {
    el.sharePublicSection.classList.add("hidden");
    if (el.shareLoginHint) el.shareLoginHint.classList.remove("hidden");
    return;
  }
  if (el.shareLoginHint) el.shareLoginHint.classList.add("hidden");

  var entry = getCurrentEntry();
  var isPublished = !!(entry && entry.publicId);
  el.sharePublicSection.classList.toggle("hidden", !isPublished);

  if (isPublished) {
    var url = window.location.origin + window.location.pathname + "#p=" + encodeURIComponent(entry.publicId);
    el.shareUrl.value = url;
    var sanitized = sanitizeTripForPublic(entry.data);
    var excluded = countSanitizedExclusions(entry.data, sanitized);
    el.sharePublicExcluded.textContent =
      excluded > 0 ? t("publicPreview.excludedCount", { n: excluded }) : t("publicPreview.noneExcluded");
    el.sharePublicExcluded.classList.remove("hidden");
  } else {
    el.sharePublicExcluded.classList.add("hidden");
  }
}

// 公開層と公開URL（16・スナップショット方式）: 共有モーダルの「🔄 今の状態に更新」ボタン。
// 共有リンクは作成/明示更新した時点の内容で固定される仕様のため、オーナーが後から行程を編集・
// 🔒トグルを付け外ししても自動反映されない。最新化したいときはこのボタンで
// 明示的に syncPublicCopyIfPublished を呼び、今この瞬間の sanitizeTripForPublic 結果で上書きする
function onSharePublicRefreshClick() {
  if (viewOnly || collabMode || !authUser || !firebaseReady) return;
  var entry = getCurrentEntry();
  if (!entry || !entry.publicId) return;
  if (el.sharePublicRefreshBtn) el.sharePublicRefreshBtn.disabled = true;
  syncPublicCopyIfPublished(entry, function (ok) {
    if (el.sharePublicRefreshBtn) el.sharePublicRefreshBtn.disabled = false;
    if (ok) {
      showToast(t("share.publicRefreshed"));
      renderShareModalPublicSection(); // 除外件数の表示も現在の内容に合わせて更新する
    }
  });
}

// 共有（7・16統合）: 共有モーダルの「共有を停止」ボタン。publicTrips のクラウドコピーを削除し、
// 停止後は未ログイン時と同じ埋め込み式（#d=）にフォールバック表示する（プライバシー上の取り消し導線。
// 再度クラウド短縮リンクが欲しければモーダルを開き直せば自動的にまた発行される）
function onSharePublicStopClick() {
  if (viewOnly || collabMode || !authUser || !firebaseReady) return;
  var entry = getCurrentEntry();
  if (!entry || !entry.publicId) return;
  if (el.sharePublicStopBtn) el.sharePublicStopBtn.disabled = true;
  unpublishCurrentTrip(function (ok) {
    if (el.sharePublicStopBtn) el.sharePublicStopBtn.disabled = false;
    if (ok) {
      if (el.sharePublicSection) el.sharePublicSection.classList.add("hidden");
      el.shareUrl.value = buildEmbeddedShareUrl();
      if (el.tripsModal && !el.tripsModal.classList.contains("hidden")) renderTripsList();
    }
  });
}

// 編集できる共有リンク（18）: 共有モーダルの「✏️ 編集できるリンクを発行」セクションを、
// 現在の authUser / editId に合わせて更新する。未ログイン時は案内のみ表示する
function renderShareModalEditSection() {
  if (!el.shareEditSection) return;
  if (!authUser || !firebaseReady) {
    el.shareEditSection.classList.add("hidden");
    if (el.shareEditLoginHint) el.shareEditLoginHint.classList.remove("hidden");
    return;
  }
  if (el.shareEditLoginHint) el.shareEditLoginHint.classList.add("hidden");
  el.shareEditSection.classList.remove("hidden");

  var entry = getCurrentEntry();
  var isEnabled = !!(entry && entry.editId);
  el.shareEditToggle.checked = isEnabled;
  el.shareEditBadge.classList.toggle("hidden", !isEnabled);
  el.shareEditUrlWrap.classList.toggle("hidden", !isEnabled);

  if (isEnabled) {
    var url = window.location.origin + window.location.pathname + "#e=" + encodeURIComponent(entry.editId);
    el.shareEditUrl.value = url;
  }
}

// 編集できる共有リンク（18）: 共有モーダルの「✏️ 編集できるリンクを発行」トグル操作。
// 二重送信防止のため通信中はトグルを一時的に無効化する
function onShareEditToggleChange() {
  if (viewOnly || collabMode || !authUser || !firebaseReady) return;
  var wantOn = el.shareEditToggle.checked;
  el.shareEditToggle.disabled = true;
  var onDone = function () {
    el.shareEditToggle.disabled = false;
    renderShareModalEditSection();
    if (el.tripsModal && !el.tripsModal.classList.contains("hidden")) renderTripsList();
  };
  if (wantOn) {
    publishEditLink(onDone);
  } else {
    unpublishEditLink(onDone);
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
    tripsStore.push({ id: id, data: data, archived: false, cloudId: null, updatedAt: 0, publicId: null, editId: null });
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
 * 編集できる共有リンク（18）: #e=<editId> の共同編集（ログイン不要・双方向リアルタイム同期）
 * ========================================================= */

// editTrips/{editId} の購読を解除する。オーナー側のpull-sync・共同編集側のpull-syncの両方で共用するため、
// どちらの用途で張った購読でも安全に解除できる
function unsubscribeEditListener() {
  if (editListenerUnsub) {
    try {
      editListenerUnsub();
    } catch (e) {
      /* ignore */
    }
  }
  editListenerUnsub = null;
  editListenerEditId = null;
}

// オーナー側: 現在のしおり（currentTripId のエントリ）が editId を持つときだけ editTrips/{editId} を購読する。
// しおり切替のたびに呼び直すことで、以前の購読を確実に解除してから必要なら新しい購読を張る。
// viewOnly・collabMode 中は（自分のしおりを見ていない、または他人のしおりを編集中のため）購読しない
function syncEditListenerForCurrentTrip() {
  if (viewOnly || collabMode) {
    unsubscribeEditListener();
    return;
  }
  var entry = getCurrentEntry();
  var editId = entry && entry.editId ? entry.editId : null;
  if (editListenerEditId === editId) return; // 変化なし（同じ購読を維持、またはどちらも未発行）
  unsubscribeEditListener();
  if (!editId || !firebaseReady || !fbDb) return;
  editListenerEditId = editId;
  editListenerUnsub = fbDb
    .collection(CLOUD_EDIT_TRIPS_COLLECTION)
    .doc(editId)
    .onSnapshot(function (doc) {
      handleOwnerEditSnapshot(editId, doc);
    }, handleCloudError);
}

// オーナー側のpull-sync本体。共同編集者からの更新を受信し、非公開項目を失わずにマージして反映する
function handleOwnerEditSnapshot(editId, doc) {
  if (viewOnly || collabMode) return;
  // 購読が既に別の editId に切り替わった後に届いた古いコールバックは無視する
  if (editListenerEditId !== editId) return;
  var entry = tripsStore.find(function (e) {
    return e.editId === editId;
  });
  if (!entry) return; // ローカルからこの編集リンクの対応関係を見失っている（念のためのガード）
  if (!doc || !doc.exists) return; // 自分で停止した直後の残響など。何もしない
  var d = doc.data() || {};
  if (d.writerId === SESSION_WRITER_ID) return; // 自分自身の書き込みのエコーは無視（ループ防止）
  var parsed = safeParseTripJSON(d.data);
  if (!parsed || !Array.isArray(parsed.days)) return;

  applyingRemoteEditUpdate = true;
  try {
    entry.data = mergeRemoteEditIntoOwnerTrip(entry.data, parsed);
    if (entry.id === currentTripId) {
      trip = entry.data;
      if (currentDayIndex >= trip.days.length) currentDayIndex = Math.max(0, trip.days.length - 1);
    }
    // マージ適用自体が editTrips への push を誘発しないよう、saveState() ではなく
    // persistLocalOnly() を直接呼ぶ（scheduleCloudSync/scheduleCollabPush のどちらも起動しない）
    persistLocalOnly();
    render();
    // 相手の変更が黙って画面に反映されると気づけないため、控えめに知らせる。
    // 連続更新でトーストが溜まらないよう、直前の通知から一定時間は出さない
    var now = Date.now();
    if (now - lastCollabNoticeAt > COLLAB_NOTICE_MIN_INTERVAL_MS) {
      lastCollabNoticeAt = now;
      showToast(t("collab.remoteUpdated"));
    }
  } finally {
    applyingRemoteEditUpdate = false;
  }
}

// 共同編集側（collabMode）: 現在編集中のデータをデバウンス（2秒）して editTrips/{editId} へ書き込む
function scheduleCollabPush() {
  if (!collabMode || !collabEditId || collabRevoked) return;
  if (collabPushTimer) clearTimeout(collabPushTimer);
  collabPushTimer = setTimeout(function () {
    collabPushTimer = null;
    pushCollabEdit();
  }, CLOUD_SYNC_DEBOUNCE_MS);
}

function pushCollabEdit() {
  if (!collabMode || !collabEditId || !firebaseReady || !fbDb || collabRevoked) return;
  var sanitized = sanitizeTripForPublic(trip);
  var json = JSON.stringify(sanitized);
  if (utf8ByteLength(json) >= EDIT_TRIP_MAX_BYTES) {
    if (!editTripTooLargeShown) {
      editTripTooLargeShown = true;
      showToast(t("collab.tooLarge"), "error");
    }
    return;
  }
  editTripTooLargeShown = false;
  fbDb
    .collection(CLOUD_EDIT_TRIPS_COLLECTION)
    .doc(collabEditId)
    .set(
      {
        // Firestoreルール上 ownerUid は変更不可のため、受信時に控えておいた値をそのまま送り返す
        ownerUid: collabOwnerUid,
        data: json,
        title: tripDisplayTitle(trip) || "",
        updatedAt: Date.now(),
        writerId: SESSION_WRITER_ID,
        schema: 2
      },
      { merge: true }
    )
    .then(handleCloudSuccess)
    .catch(handleCloudError);
}

// 共同編集側のpull-sync本体。オーナーや他の共同編集者からの更新を受信する。
// 共同編集側のローカルコピーはもともとサニタイズ済みデータそのもの（非公開項目を一切持たない）なので、
// オーナー側のような「非公開項目を守るマージ」は不要で、常に受信データへの全置換でよい
function subscribeCollabListener(editId) {
  unsubscribeEditListener();
  editListenerEditId = editId;
  editListenerUnsub = fbDb
    .collection(CLOUD_EDIT_TRIPS_COLLECTION)
    .doc(editId)
    .onSnapshot(function (doc) {
      if (!doc || !doc.exists) {
        // オーナーが編集リンクを停止した（ドキュメントが削除された）
        if (!collabRevoked) {
          collabRevoked = true;
          showToast(t("collab.revoked"), "error");
        }
        return;
      }
      var d = doc.data() || {};
      if (d.writerId === SESSION_WRITER_ID) return; // 自分自身の書き込みのエコーは無視（ループ防止）
      // onSnapshot登録直後には（Firestoreの仕様上）現在の状態が1回必ず届く。これは checkCollabHash の
      // get() で取得済みの内容と同一のことが多く、その間にローカルで編集していた場合に上書きしてしまう
      // 競合を避けるため、既に適用済みの生データと完全一致するなら何もしない
      if (typeof d.data === "string" && d.data === collabLastAppliedRaw) return;
      var parsed = safeParseTripJSON(d.data);
      if (!parsed || !Array.isArray(parsed.days)) return;
      // 受信データは他人（オーナーや他の共同編集者）が作った可能性がある前提のため、必ず normalizeTrip を通す
      applyingRemoteEditUpdate = true;
      try {
        trip = normalizeTrip(parsed);
        collabLastAppliedRaw = d.data;
        if (currentDayIndex >= trip.days.length) currentDayIndex = Math.max(0, trip.days.length - 1);
        render();
      } finally {
        applyingRemoteEditUpdate = false;
      }
    }, handleCloudError);
}

// #e=<editId> があれば共同編集モードで起動する。ログイン不要・localStorageは一切変更しない。
// ハッシュを検出した時点で同期的に collabMode=true にすることで、この後に呼ばれる init() 末尾の
// saveState() を含め、以降のローカル保存処理を確実に無効化してからFirestoreへの非同期取得を行う
// （viewOnly の checkPublicHash と同じ実装方針）
function checkCollabHash() {
  var hash = window.location.hash;
  if (!hash || hash.indexOf("#e=") !== 0) return;
  var editId = decodeURIComponent(hash.slice(3));
  if (!editId) return;

  collabMode = true;
  render();

  if (!firebaseReady || !fbDb) {
    finishCollabHashFallback();
    return;
  }

  fbDb
    .collection(CLOUD_EDIT_TRIPS_COLLECTION)
    .doc(editId)
    .get()
    .then(function (doc) {
      if (!doc || !doc.exists) {
        finishCollabHashFallback();
        return;
      }
      var d = doc.data() || {};
      var parsed = safeParseTripJSON(d.data);
      if (!parsed || !Array.isArray(parsed.days)) {
        finishCollabHashFallback();
        return;
      }
      collabEditId = editId;
      collabOwnerUid = typeof d.ownerUid === "string" ? d.ownerUid : null;
      trip = normalizeTrip(parsed);
      // subscribeCollabListener の onSnapshot 初回コールバックが同じ内容を再度届けてきても
      // 上書きしないよう、ここで適用済みとして記録しておく（上のコメント参照）
      collabLastAppliedRaw = typeof d.data === "string" ? d.data : null;
      currentDayIndex = 0;
      render();
      subscribeCollabListener(editId);
    })
    .catch(function () {
      finishCollabHashFallback();
    });
}

// 編集リンクの取得に失敗した（存在しない・削除済み・データ破損・オフライン等）場合のフォールバック。
// 通常モードで起動し直す。ハッシュを消して再読み込み時の再取得ループを防ぐ（finishPublicHashFallback と同じ方針）
function finishCollabHashFallback() {
  collabMode = false;
  collabEditId = null;
  collabOwnerUid = null;
  collabLastAppliedRaw = null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  showToast(t("collab.notFound"), "error");
  render();
  // init() 末尾の saveState() は collabMode=true の間スキップされているため、
  // 起動時の移行・正規化結果の永続化をここで肩代わりする
  saveState();
}

// ヘッダーの「自分のしおりに戻る」ボタン。collabMode を解除し、ローカルの現在のしおりの表示に戻す
function exitCollabMode() {
  if (!collabMode) return;
  unsubscribeEditListener();
  if (collabPushTimer) {
    clearTimeout(collabPushTimer);
    collabPushTimer = null;
  }
  collabMode = false;
  collabEditId = null;
  collabOwnerUid = null;
  collabRevoked = false;
  collabLastAppliedRaw = null;
  trip = getCurrentEntry().data;
  currentDayIndex = 0;
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  render();
  // collabMode 中は runCloudMerge() を無効化していたため、ログイン済みなら通常モード復帰時に再開する
  if (authUser) runCloudMerge();
}
