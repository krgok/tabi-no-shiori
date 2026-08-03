/**
 * 30-cloud.js — Firebase 認証・クラウド同期・公開層/編集リンクの発行
 *
 * 旅のしおり app.js を役割ごとに分割したファイルの1つ。
 * ビルド不要のまま扱えるよう、各ファイルは index.html から順に読み込まれ、
 * 同じグローバルスコープを共有する（元は1つのIIFE内にあったコードをそのまま切り出している）。
 * 相互参照があるため読み込み順は index.html / tests/harness.js / sw.js の並びに従うこと。
 */
"use strict";

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
  renderSyncStatus();
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
// クラウド同期の状態表示（"…同期中" / "保存済み HH:MM" / エラー）。
// クラウドに保存されているか画面から分からないと不安なので、控えめに出す
var syncState = { kind: "idle", at: null };

function setSyncState(kind) {
  syncState.kind = kind;
  if (kind === "saved") syncState.at = new Date();
  renderSyncStatus();
}

function renderSyncStatus() {
  if (!el.syncStatus) return;
  // ログインしていない/クラウド未使用のときは何も出さない（未ログインでも普通に使えるため）
  if (!authUser || !firebaseReady || viewOnly || collabMode) {
    el.syncStatus.classList.add("hidden");
    el.syncStatus.textContent = "";
    return;
  }
  var text = "";
  if (syncState.kind === "syncing") text = t("sync.syncing");
  else if (syncState.kind === "error") text = t("sync.error");
  else if (syncState.kind === "saved" && syncState.at) {
    text = t("sync.saved", { time: pad2(syncState.at.getHours()) + ":" + pad2(syncState.at.getMinutes()) });
  }
  if (!text) {
    el.syncStatus.classList.add("hidden");
    el.syncStatus.textContent = "";
    return;
  }
  el.syncStatus.textContent = text;
  el.syncStatus.classList.toggle("sync-status-error", syncState.kind === "error");
  el.syncStatus.classList.remove("hidden");
}

function handleCloudError(err) {
  console.warn("cloud sync failed", err && err.code);
  setSyncState("error");
  if (!cloudSyncErrorShown) {
    cloudSyncErrorShown = true;
    showToast(t("auth.syncError"), "error");
  }
}
function handleCloudSuccess() {
  cloudSyncErrorShown = false;
  setSyncState("saved");
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
// 編集できる共有リンク（18）: collabMode 中は saveState() 側で既に迂回されているため通常ここには来ないが、
// 念のための多層ガードとして collabMode も見る
function scheduleCloudSync() {
  if (!authUser || !firebaseReady || collabMode) return;
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(function () {
    cloudSyncTimer = null;
    cloudUpsertEntry(getCurrentEntry());
  }, CLOUD_SYNC_DEBOUNCE_MS);
}

// 1件の trips エントリを Firestore に書き込む（新規なら作成して cloudId を採番、既存なら更新）。即時実行。
// trip 本体は JSON 文字列にして保存する（ネスト構造のまま入れると型制約で事故りやすいため）
// 公開層と公開URL（16）: publicId も併せて書き込み、端末間で公開状態を引き継げるようにする。
// 公開コピー（publicTrips）はここでは更新しない（16 スナップショット方式）: 公開URLは
// 作成/明示更新した時点の内容で固定する仕様のため、オーナーの編集を自動反映すると
// 「渡した後に手直ししたら公開版から消えた」といった意図しない事故につながる。
// 更新したい場合は共有モーダルの「🔄 公開版を今の状態に更新」ボタン（syncPublicCopyIfPublished を手動呼び出し）を使う
// 編集できる共有リンク（18）: editTrips（共同編集用コピー）は従来どおり常時同期する（syncEditCopyIfEnabled）。
// こちらは「今まさに一緒に編集している相手に見せる」用途のため、公開URLとは逆に常時同期が正しい仕様
// 編集できる共有リンク（18）: collabMode 中は自分の trips には一切書き込まない（多層ガード）
function cloudUpsertEntry(entry) {
  if (!firebaseReady || !fbDb || !authUser || !entry || collabMode) return;
  setSyncState("syncing");
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
    publicId: entry.publicId || null,
    // 編集できる共有リンク（18）: editId も端末間で引き継ぐ
    editId: entry.editId || null
  };
  if (entry.cloudId) {
    fbDb
      .collection(CLOUD_TRIPS_COLLECTION)
      .doc(entry.cloudId)
      .set(payload, { merge: true })
      .then(function () {
        entry.updatedAt = updatedAt;
        handleCloudSuccess();
        syncEditCopyIfEnabled(entry);
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
        syncEditCopyIfEnabled(entry);
      })
      .catch(handleCloudError)
      .then(function () {
        // 成功・失敗いずれでも実行中フラグは必ず解除する（待機中の書き込みを進ませる）
        delete cloudAddInFlight[entry.id];
      });
  }
}

// 公開層と公開URL（16・スナップショット方式）: entry.publicId があるときだけ、公開コピー
// （publicTrips/{publicId}）を今この瞬間のサニタイズ済みデータで上書きする。
// cloudUpsertEntry の成功ハンドラからはもう自動で呼ばれない（公開URLは「作成/明示更新した時点の
// 内容で固定」が仕様のため）。呼び出し元は共有モーダルの「🔄 公開版を今の状態に更新」ボタン
// （onSharePublicRefreshClick）のみ。公開トグルON時の初回作成は publishCurrentTrip が
// 別途自前でスナップショットを書き込む（publicId 未採番のため add() が必要なのと、
// 成功後に publicId をローカル・プライベート層へ保存する処理を伴うため、この関数とは別実装）
function syncPublicCopyIfPublished(entry, onDone) {
  if (!entry || !entry.publicId || !firebaseReady || !fbDb || !authUser) {
    if (typeof onDone === "function") onDone(false);
    return;
  }
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
    .then(function () {
      handleCloudSuccess();
      if (typeof onDone === "function") onDone(true);
    })
    .catch(function (err) {
      handleCloudError(err);
      if (typeof onDone === "function") onDone(false);
    });
}

// JSON文字列のUTF-8バイト長を返す（Firestoreルールの data.size() 判定に合わせる）
function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}

// 編集できる共有リンク（18）: entry.editId があるときだけ、共同編集用コピー（editTrips/{editId}）を
// サニタイズ済みデータで上書きする。syncPublicCopyIfPublished と同じ経路（cloudUpsertEntry 成功後）に
// 相乗りするため、オーナーがしおりを編集すれば自動的に共同編集用コピーにも反映される（push）。
// writerId には自セッションIDを入れる（共同編集者側の onSnapshot が自分自身の書き込みを無視できるように）
function syncEditCopyIfEnabled(entry) {
  if (!entry || !entry.editId || !firebaseReady || !fbDb || !authUser) return;
  var sanitized = sanitizeTripForPublic(entry.data);
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
    .doc(entry.editId)
    .set(
      {
        ownerUid: authUser.uid,
        data: json,
        title: tripDisplayTitle(entry.data) || "",
        updatedAt: Date.now(),
        writerId: SESSION_WRITER_ID,
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
  if (viewOnly || collabMode || !authUser || !firebaseReady || !fbDb) return;
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
  if (viewOnly || collabMode || !authUser || !firebaseReady || !fbDb) return;
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

/* =========================================================
 * 編集できる共有リンク（18）: オーナー側の発行/停止
 * publishCurrentTrip / unpublishCurrentTrip（16）と対をなす実装。
 * viewOnly・collabMode のいずれの最中も呼ばれてはならない
 * （collabMode 中は getCurrentEntry() が別人のしおりを指しかねないため）
 * ========================================================= */

// 共有モーダルの「✏️ 編集できるリンクを発行」トグルON。新規発行なら editTrips に自動IDで作成し、
// editId をローカル・プライベート層（trips/{cloudId}）の両方へ保存する
function publishEditLink(onDone) {
  if (viewOnly || collabMode || !authUser || !firebaseReady || !fbDb) return;
  var entry = getCurrentEntry();
  if (!entry) return;
  var sanitized = sanitizeTripForPublic(entry.data);
  var json = JSON.stringify(sanitized);
  if (utf8ByteLength(json) >= EDIT_TRIP_MAX_BYTES) {
    showToast(t("collab.tooLarge"), "error");
    if (typeof onDone === "function") onDone(false);
    return;
  }
  var payload = {
    ownerUid: authUser.uid,
    data: json,
    title: tripDisplayTitle(entry.data) || "",
    updatedAt: Date.now(),
    writerId: SESSION_WRITER_ID,
    schema: 2
  };
  var ref = entry.editId
    ? fbDb
        .collection(CLOUD_EDIT_TRIPS_COLLECTION)
        .doc(entry.editId)
        .set(payload, { merge: true })
        .then(function () {
          return entry.editId;
        })
    : fbDb
        .collection(CLOUD_EDIT_TRIPS_COLLECTION)
        .add(payload)
        .then(function (docRef) {
          return docRef.id;
        });
  ref
    .then(function (editId) {
      entry.editId = editId;
      persistLocalOnly();
      cloudUpsertEntry(entry); // editId をプライベート層（trips/{cloudId}）にも即時反映する
      syncEditListenerForCurrentTrip();
      handleCloudSuccess();
      if (typeof onDone === "function") onDone(true);
    })
    .catch(function (err) {
      handleCloudError(err);
      if (typeof onDone === "function") onDone(false);
    });
}

// 共有モーダルの「✏️ 編集できるリンクを発行」トグルOFF。editTrips のドキュメントを削除し、
// ローカル・プライベート層両方の editId を null に戻す
function unpublishEditLink(onDone) {
  if (viewOnly || collabMode || !authUser || !firebaseReady || !fbDb) return;
  var entry = getCurrentEntry();
  if (!entry || !entry.editId) return;
  var editIdToDelete = entry.editId;
  fbDb
    .collection(CLOUD_EDIT_TRIPS_COLLECTION)
    .doc(editIdToDelete)
    .delete()
    .then(function () {
      entry.editId = null;
      persistLocalOnly();
      cloudUpsertEntry(entry);
      syncEditListenerForCurrentTrip();
      handleCloudSuccess();
      showToast(t("collab.stopped"));
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
      // 編集できる共有リンク（18）: collabMode 中も同様に trip は共同編集中の他人のしおりを指すため上書きしない
      if (!viewOnly && !collabMode && u.entry.id === currentTripId) trip = u.entry.data;
    }
    u.entry.archived = !!u.cloudDoc.archived;
    u.entry.updatedAt = u.cloudDoc.updatedAt || 0;
    // 公開層と公開URL（16）: publicId も端末間で引き継ぐ
    u.entry.publicId = u.cloudDoc.publicId || null;
    // 編集できる共有リンク（18）: editId も端末間で引き継ぐ
    u.entry.editId = u.cloudDoc.editId || null;
  });

  plan.newLocalEntries.forEach(function (doc) {
    var parsed = safeParseTripJSON(doc.data);
    tripsStore.push({
      id: genId(),
      data: normalizeTrip(parsed || createBlankTripData()),
      archived: !!doc.archived,
      cloudId: doc.id,
      updatedAt: doc.updatedAt || 0,
      publicId: doc.publicId || null,
      editId: doc.editId || null
    });
  });

  persistLocalOnly();
  render();
  syncEditListenerForCurrentTrip();

  plan.uploads.forEach(function (entry) {
    cloudUpsertEntry(entry);
  });

  var total = plan.uploads.length + plan.localUpdates.length + plan.newLocalEntries.length;
  if (total > 0) {
    showToast(t("auth.syncDone", { n: total }));
  }
}

// ログイン直後に1回だけ実行する、クラウドとローカルの突き合わせ処理
// 編集できる共有リンク（18）: collabMode 中はゲスト自身のアカウントの trips には一切触れない
// （「ログイン/クラウド同期系は collabMode で無効化」）。exitCollabMode() で通常モードに戻った際に再実行する
function runCloudMerge() {
  if (!firebaseReady || !fbDb || !authUser || cloudMergeInProgress || collabMode) return;
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
          publicId: typeof d.publicId === "string" && d.publicId ? d.publicId : null,
          editId: typeof d.editId === "string" && d.editId ? d.editId : null
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
