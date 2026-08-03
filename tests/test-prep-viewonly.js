/**
 * 変更2の検証: 閲覧モード（#p=）でも🧳準備ボタンを使えるようにする
 * - #prepBtn は body.view-only-mode の非表示リストから除外されたこと（静的CSS照合）
 * - 他の非表示対象セレクタ（.checklist-priv-toggle 等）は引き続き残っていること（回帰確認）
 * - #prepBtn クリックで準備モーダルが開くこと
 * - モーダル内のチェックボックス/テキスト欄が読み取り専用であること
 * - モーダル内で編集を強行しても localStorage が一切変化しないこと（絶対条件）
 * - 準備モーダルのサイズ記憶（savePrepModalSize）も viewOnly 中は書き込まれないこと
 */
const { boot, tick, ok, section, read, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";
const PREP_SIZE_KEY = "tabi-prep-size";

function fixtureTrip() {
  return {
    v: 1,
    title: "自分の旅",
    titles: { ja: "自分の旅" },
    lang: "ja",
    days: [{ date: "2026-08-01", startTime: "09:00", tz: "", items: [] }],
    packing: [],
    todos: []
  };
}

function fixtureStore() {
  return {
    [STORAGE_KEY]: JSON.stringify({
      currentId: "loc1",
      trips: [{ id: "loc1", data: fixtureTrip(), archived: false, cloudId: null, updatedAt: 0, publicId: null, editId: null }]
    })
  };
}

const publicDoc = {
  ownerUid: "someone-else",
  title: "他人の旅",
  updatedAt: 5000,
  schema: 2,
  data: JSON.stringify({
    v: 1,
    title: "他人の旅",
    titles: { ja: "他人の旅" },
    lang: "ja",
    days: [{ date: "2026-09-01", startTime: "10:00", tz: "", items: [{ id: "x1", cat: "sight", name: "京都駅", dur: 30, note: "メモ" }] }],
    // priv/notePriv フラグ自体は公開コピーには存在しない（sanitizeTripForPublic 済み想定）
    packing: [
      { id: "q1", text: "傘", done: false },
      { id: "q2", text: "着替え", done: true }
    ],
    todos: [{ id: "r1", text: "両替", done: false }]
  })
};

(async () => {
  /* ================================================================ */
  section("A. 静的CSS照合: #prepBtn は非表示リストから除外・他は維持");
  {
    const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const block = css.split("body.view-only-mode").slice(1).join("body.view-only-mode");
    const rule = block.split("display: none !important;")[0];
    const selectors = ("body.view-only-mode" + rule)
      .split("{")[0]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace("body.view-only-mode", "").trim());

    ok(!selectors.includes("#prepBtn"), "#prepBtn は非表示対象から除外されている", selectors);
    [
      ".checklist-add-row",
      ".checklist-priv-toggle",
      ".checklist-list-priv-toggle",
      ".checklist-delete",
      ".checklist-drag-handle",
      "#shareBtn",
      "#textioBtn",
      "#tripsBtn",
      "#settingsBtn",
      "#authBtn"
    ].forEach((need) => {
      ok(selectors.includes(need), "非表示対象に引き続き " + need + " が含まれる（回帰確認）", selectors);
    });
  }

  /* ================================================================ */
  section("B. 閲覧モードで #prepBtn クリック → 準備モーダルが開く");
  let env;
  {
    env = boot({ hash: "#p=PUB1", localStorage: fixtureStore(), docs: { PUB1: publicDoc } });
    await tick();
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(env.doc.body.classList.contains("view-only-mode"), "閲覧モードで起動している");

    const prepBtn = env.doc.getElementById("prepBtn");
    ok(!!prepBtn, "#prepBtn がDOMに存在する");
    ok(env.doc.getElementById("prepModal").classList.contains("hidden"), "最初は準備モーダルが閉じている");

    prepBtn.click();
    ok(!env.doc.getElementById("prepModal").classList.contains("hidden"), "クリックで準備モーダルが開く");
    ok(env.doc.querySelectorAll("#prepPackingItems .checklist-item").length === 2, "公開データの持ち物2件が表示される");
    ok(env.doc.querySelectorAll("#prepTodosItems .checklist-item").length === 1, "公開データのやること1件が表示される");
  }

  /* ================================================================ */
  section("C. 準備モーダル内は読み取り専用（チェック・テキスト欄）");
  {
    const cb = env.doc.querySelector("#prepModal .checklist-checkbox");
    ok(!!cb, "モーダル内にチェックボックスがある");
    ok(cb.disabled, "モーダル内のチェックボックスが disabled");

    const textInput = env.doc.querySelector("#prepModal .checklist-text-input");
    ok(!!textInput, "モーダル内にテキスト欄がある");
    ok(textInput.readOnly, "モーダル内のテキスト欄が readOnly");
  }

  /* ================================================================ */
  section("D. 準備モーダル内で編集を強行しても localStorage は一切変化しない（絶対条件）");
  {
    const before = JSON.stringify(env.store);

    // チェックを強行
    const cb = env.doc.querySelector("#prepModal .checklist-checkbox");
    cb.checked = true;
    cb.dispatchEvent(new env.win.Event("change"));

    // テキスト編集を強行
    const textInput = env.doc.querySelector("#prepModal .checklist-text-input");
    textInput.value = "侵入テキスト";
    textInput.dispatchEvent(new env.win.Event("change"));

    // 🔒トグル・削除・追加を強行（CSSでは隠れる想定の操作。JS側の多層防御を確認）
    const privToggle = env.doc.querySelector("#prepModal .checklist-priv-toggle");
    if (privToggle) privToggle.click();
    const listPrivToggle = env.doc.getElementById("prepPackingListPrivToggle");
    if (listPrivToggle) listPrivToggle.click();
    const delBtn = env.doc.querySelector("#prepModal .checklist-delete");
    if (delBtn) delBtn.click();
    env.doc.getElementById("prepPackingAddInput").value = "侵入項目";
    env.doc.getElementById("prepPackingAddBtn").click();

    await tick();

    ok(JSON.stringify(env.store) === before, "各種編集操作を強行しても localStorage は起動時のまま不変", {
      writes: env.writeLog.map((w) => w.k)
    });
    ok(env.writeLog.filter((w) => w.k === STORAGE_KEY).length === 0, "しおりストアへの書き込みが1回も発生していない");
    // 削除だけは JS 側にも明示的な viewOnly ガードがあるため、件数も変化していないはず（多層防御の確認）
    ok(env.doc.querySelectorAll("#prepPackingItems .checklist-item").length === 2, "強行削除しても表示件数は変わらない（deleteChecklistItemのviewOnlyガード）");
  }

  /* ================================================================ */
  section("E. 準備モーダルのサイズ記憶（savePrepModalSize）も viewOnly 中は書き込まれない");
  {
    // jsdomはレイアウトを持たないため getBoundingClientRect は常に0を返す。
    // savePrepModalSize 自体の「幅10px未満は保存しない」早期リターンと区別するため、
    // 大きめの矩形を返すようモックしてから viewOnly ガードが効くかを検証する
    const card = env.doc.querySelector("#prepModal .modal-prep");
    ok(!!card, ".modal-prep 要素が存在する");
    card.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 });

    const beforeWrites = env.writeLog.length;
    const closeBtn = env.doc.querySelector('#prepModal .modal-close[data-close="prepModal"]');
    ok(!!closeBtn, "準備モーダルの閉じるボタンが存在する");
    closeBtn.click();
    await tick();

    const prepSizeWrites = env.writeLog.slice(beforeWrites).filter((w) => w.k === PREP_SIZE_KEY);
    ok(prepSizeWrites.length === 0, "viewOnly中はモーダルを閉じてもサイズ記憶(" + PREP_SIZE_KEY + ")が書き込まれない", env.writeLog.slice(beforeWrites));
    ok(env.doc.getElementById("prepModal").classList.contains("hidden"), "閉じるボタンでモーダル自体は閉じる");
  }

  /* ================================================================ */
  section("F. 対照実験: 通常モード（viewOnlyでない）では同じ操作でサイズ記憶が書き込まれる");
  {
    // Eで使った「大きな矩形をモックすれば書き込まれる」という前提が正しいことを、
    // 閲覧モードでない通常のセッションで確認する（Eのnegativeな結果が「ガードのおかげ」だと裏付ける対照群）
    const env2 = boot({ localStorage: fixtureStore() });
    await tick();
    env2.doc.getElementById("prepBtn").click();
    const card2 = env2.doc.querySelector("#prepModal .modal-prep");
    card2.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 });
    const closeBtn2 = env2.doc.querySelector('#prepModal .modal-close[data-close="prepModal"]');
    closeBtn2.click();
    await tick();
    const prepSizeWrites2 = env2.writeLog.filter((w) => w.k === PREP_SIZE_KEY);
    ok(prepSizeWrites2.length > 0, "通常モードでは同じ操作でサイズ記憶が書き込まれる（対照群、モック手法の妥当性を裏付け）", prepSizeWrites2);
  }

  /* ================================================================ */
  section("G. 「自分のしおりに戻る」後は #prepBtn がふつうに編集可能なモーダルを開ける（回帰）");
  {
    env.doc.getElementById("viewOnlyBackBtn").click();
    await tick();
    ok(!env.doc.body.classList.contains("view-only-mode"), "通常モードに復帰");
    const cb = env.doc.querySelector("#prepModal .checklist-checkbox, #prepPackingEmptyMsg");
    // 自分のしおりは持ち物が空なので空メッセージが出る想定。編集可能であることのみ確認する
    ok(env.doc.getElementById("prepPackingAddInput") && !env.doc.getElementById("prepPackingAddInput").disabled, "戻った後は追加欄が編集可能");
  }

  const r = results();
  console.log("\n================================");
  console.log("PASS: " + r.pass + "   FAIL: " + r.fail);
  console.log("================================");
  process.exit(r.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exitCode = 1; });
