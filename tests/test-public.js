const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

// 非公開マークを含むしおり（priv項目 / notePriv項目 / auto move）
function fixtureTrip() {
  return {
    v: 1,
    title: "東京旅行",
    titles: { ja: "東京旅行", en: "Tokyo Trip" },
    lang: "ja",
    days: [
      {
        date: "2026-08-01",
        startTime: "09:00",
        tz: "Asia/Tokyo",
        items: [
          { id: "a1", cat: "sight", name: "浅草寺", loc: "", dur: 60, note: "公開メモ", lat: 35.71, lon: 139.79, coordSrc: "geo", priv: false, notePriv: false, gmap: "", gmapAuto: false, names: {} },
          { id: "m1", cat: "move", name: "浅草寺 → 秘密の店", loc: "", dur: 20, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, mode: "train", distKm: 3, auto: true, approx: false, unresolved: false, arriveTz: "" },
          { id: "s1", cat: "meal", name: "秘密の店", loc: "", dur: 90, note: "サプライズ", lat: 35.7, lon: 139.7, coordSrc: "geo", priv: true, notePriv: false, gmap: "", gmapAuto: false, names: {} },
          { id: "n1", cat: "stay", name: "三井ガーデンホテル上野", loc: "", dur: 0, note: "予約番号 ABC123", lat: 35.71, lon: 139.77, coordSrc: "geo", priv: false, notePriv: true, gmap: "", gmapAuto: false, names: {} }
        ]
      }
    ],
    packing: [
      { id: "p1", text: "パスポート", done: false, priv: false },
      { id: "p2", text: "指輪", done: false, priv: true }
    ],
    todos: [{ id: "t1", text: "両替", done: false, priv: false }]
  };
}

function fixtureStore(extra) {
  return {
    [STORAGE_KEY]: JSON.stringify({
      currentId: "loc1",
      trips: [Object.assign({ id: "loc1", data: fixtureTrip(), archived: false, cloudId: "CLOUD1", updatedAt: 1000 }, extra || {})]
    })
  };
}

const USER = { uid: "uid-me", email: "me@example.com", displayName: "Me" };

// sanitize済みかを検証する共通アサーション
function assertSanitized(label, dataStr) {
  const d = JSON.parse(dataStr);
  const items = d.days[0].items;
  const ids = items.map((i) => i.id);
  ok(!ids.includes("s1"), label + ": priv:true の項目(s1)が除外されている", ids);
  ok(!ids.includes("m1"), label + ": 隣接スポットを失った auto move(m1)も除外されている", ids);
  const stay = items.find((i) => i.id === "n1");
  ok(stay && stay.note === "", label + ": notePriv:true の項目のメモが空", stay && stay.note);
  ok(stay && stay.name === "三井ガーデンホテル上野", label + ": notePriv 項目自体は残る");
  const flagLeak = JSON.stringify(d).includes('"priv"') || JSON.stringify(d).includes('"notePriv"');
  ok(!flagLeak, label + ": priv/notePriv フラグ自体が公開データに残っていない");
  ok(d.packing.length === 1 && d.packing[0].id === "p1", label + ": priv の持ち物(p2)が除外されている", d.packing);
  ok(!JSON.stringify(d).includes("指輪"), label + ": 非公開持ち物のテキストが含まれない");
  ok(!JSON.stringify(d).includes("サプライズ"), label + ": 非公開項目のメモが含まれない");
  ok(!JSON.stringify(d).includes("ABC123"), label + ": notePriv のメモ本文が含まれない");
  return d;
}

(async () => {
  /* ================================================================ */
  section("1. 未ログイン: 共有モーダルを開くと従来どおり #d= の埋め込みリンクが出る");
  {
    const env = boot({ localStorage: fixtureStore() });
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(env.doc.getElementById("viewOnlyBanner").classList.contains("hidden"), "閲覧バナーは非表示");
    ok(!env.doc.body.classList.contains("view-only-mode"), "view-only-mode クラスが付いていない");
    ok(env.doc.getElementById("tripTitle").textContent === "東京旅行", "タイトルが描画される");
    ok(env.doc.querySelectorAll("#timeline .item-card").length === 4, "タイムラインに4件描画");
    // 未ログイン時に共有モーダルを開く（共有＝#d=方式に自動切替）
    env.doc.getElementById("shareBtn").click();
    const url = env.doc.getElementById("shareUrl").value;
    ok(url.startsWith("https://example.org/tabi/#d="), "従来のハッシュ共有リンクが #d= で生成される", url);
    ok(env.doc.getElementById("sharePublicSection").classList.contains("hidden"), "未ログイン時は共有の補足セクション非表示");
    ok(!env.doc.getElementById("shareLoginHint").classList.contains("hidden"), "未ログイン時はログイン案内を表示");
    // ハッシュ共有リンクの中身もサニタイズ済みであること（14の回帰）
    const b64 = decodeURIComponent(url.split("#d=")[1]).replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8");
    assertSanitized("ハッシュ共有", json);
  }

  /* ================================================================ */
  section("2. ログイン時: 共有モーダルを開くと自動で publicId が発行され #p= リンクが出る");
  let publishedEnv;
  {
    const env = boot({ localStorage: fixtureStore() });
    await tick();
    env.fb.login(USER);
    await tick();
    env.doc.getElementById("shareBtn").click();
    // 発行が完了するまでの一瞬は「発行しています…」のプレースホルダになる
    ok(env.doc.getElementById("shareUrl").value === "リンクを発行しています…", "発行中はプレースホルダ文言が表示される", env.doc.getElementById("shareUrl").value);
    ok(env.doc.getElementById("shareCopyBtn").disabled === true, "発行中はコピーボタンが無効化される");
    await tick();
    await tick();

    const addCall = env.fb.calls.find((c) => c.op === "add" && c.coll === "publicTrips");
    ok(!!addCall, "モーダルを開くと自動で publicTrips へ add（自動ID採番）が呼ばれた", env.fb.calls.map((c) => c.op + ":" + c.coll));
    ok(addCall.payload.ownerUid === "uid-me", "ownerUid が自分のuid");
    ok(addCall.payload.schema === 2, "schema: 2");
    ok(typeof addCall.payload.title === "string" && addCall.payload.title === "東京旅行", "title が入る", addCall.payload.title);
    ok(typeof addCall.payload.updatedAt === "number", "updatedAt が数値");
    assertSanitized("publicTrips.add", addCall.payload.data);

    // publicId 保存とURL生成（共通の shareUrl 欄に #p= が表示される）
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    ok(saved.trips[0].publicId === "AUTOPUB1", "publicId が localStorage に保存された", saved.trips[0].publicId);
    ok(env.doc.getElementById("shareCopyBtn").disabled === false, "発行完了後はコピーボタンが再度有効になる");
    ok(!env.doc.getElementById("sharePublicSection").classList.contains("hidden"), "発行後は共有の補足セクション（更新/停止）が表示される");
    const purl = env.doc.getElementById("shareUrl").value;
    ok(purl === "https://example.org/tabi/#p=AUTOPUB1", "共有欄(shareUrl)が <origin><pathname>#p=<publicId> 形式になる", purl);
    const exc = env.doc.getElementById("sharePublicExcluded");
    ok(!exc.classList.contains("hidden") && /3/.test(exc.textContent), "除外件数を表示（priv項目+auto move+priv持ち物=3件）", exc.textContent);

    // publicId がプライベート層 trips にも書かれる（端末間引き継ぎ）
    const privSet = env.fb.calls.filter((c) => c.op === "set" && c.coll === "trips").pop();
    ok(privSet && privSet.payload.publicId === "AUTOPUB1", "trips/{cloudId} にも publicId を保存", privSet && privSet.payload.publicId);
    publishedEnv = env;
  }

  /* ================================================================ */
  section("3. 共有中のしおりを編集しても自動更新されない（固定方式）。🔄ボタンで明示更新できる");
  {
    const env = publishedEnv;
    env.fb.calls.length = 0;
    // メモを編集して change を発火（既存の cloud sync デバウンスに相乗り）
    const note = env.doc.querySelector('#timeline .item-card[data-id="a1"] .item-note');
    note.value = "編集しました";
    note.dispatchEvent(new env.win.Event("change"));
    // デバウンス 2秒 を待つ
    await new Promise((r) => setTimeout(r, 2400));

    const autoSet = env.fb.calls.find((c) => c.op === "set" && c.coll === "publicTrips" && c.id === "AUTOPUB1");
    ok(!autoSet, "編集しても publicTrips への自動 set は発生しない（16のスナップショット方式どおり）", env.fb.calls.map((c) => c.op + ":" + c.coll));

    // 共有モーダルを開き直して「🔄 今の状態に更新」ボタンを押すと明示的に反映される
    env.doc.getElementById("shareBtn").click();
    await tick();
    ok(env.doc.getElementById("shareUrl").value === "https://example.org/tabi/#p=AUTOPUB1", "再度開いても同じ共有URLが表示される（再発行されない）");
    env.doc.getElementById("sharePublicRefreshBtn").click();
    await tick();

    const pubSet = env.fb.calls.find((c) => c.op === "set" && c.coll === "publicTrips" && c.id === "AUTOPUB1");
    ok(!!pubSet, "🔄更新ボタンを押すと publicTrips/{publicId} への set が呼ばれる", env.fb.calls.map((c) => c.op + ":" + c.coll));
    if (pubSet) {
      assertSanitized("🔄更新後の共有コピー", pubSet.payload.data);
      ok(JSON.parse(pubSet.payload.data).days[0].items[0].note === "編集しました", "更新後の編集内容が共有コピーに反映される");
    }
  }

  /* ================================================================ */
  section("4. 「共有を停止」ボタンで publicTrips が削除され、#d= にフォールバックする");
  {
    const env = publishedEnv;
    env.fb.calls.length = 0;
    env.doc.getElementById("shareBtn").click();
    await tick();
    env.doc.getElementById("sharePublicStopBtn").click();
    await tick();

    const del = env.fb.calls.find((c) => c.op === "delete" && c.coll === "publicTrips" && c.id === "AUTOPUB1");
    ok(!!del, "「共有を停止」で publicTrips/{publicId} の delete が呼ばれた", env.fb.calls.map((c) => c.op + ":" + c.coll + ":" + c.id));
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    ok(saved.trips[0].publicId === null, "ローカルの publicId が null に戻る", saved.trips[0].publicId);
    const privSet = env.fb.calls.filter((c) => c.op === "set" && c.coll === "trips").pop();
    ok(privSet && privSet.payload.publicId === null, "trips/{cloudId} の publicId も null に", privSet && privSet.payload.publicId);
    ok(env.doc.getElementById("sharePublicSection").classList.contains("hidden"), "共有の補足セクションが隠れる");
    const url = env.doc.getElementById("shareUrl").value;
    ok(url.startsWith("https://example.org/tabi/#d="), "停止後は埋め込み式(#d=)リンクにフォールバック表示される", url);

    // モーダルを開き直すと、ログイン中なので再び自動発行される
    env.fb.calls.length = 0;
    env.doc.getElementById("shareBtn").click();
    await tick();
    await tick();
    const readdCall = env.fb.calls.find((c) => c.op === "add" && c.coll === "publicTrips");
    ok(!!readdCall, "モーダルを開き直すと再び自動で publicTrips へ add される", env.fb.calls.map((c) => c.op + ":" + c.coll));
    const url2 = env.doc.getElementById("shareUrl").value;
    ok(url2.startsWith("https://example.org/tabi/#p="), "再発行後は再び #p= リンクが表示される", url2);
  }

  /* ================================================================ */
  section("4b. 共有モーダルのユーザー向け文言に「公開」「🌐」が残っていない（「共有」に統一）");
  {
    const env = boot({ localStorage: fixtureStore() });
    await tick();
    env.fb.login(USER);
    await tick();
    env.doc.getElementById("shareBtn").click();
    await tick();
    await tick();

    ["ja", "en", "zh", "th"].forEach((L) => {
      const langSel = env.doc.getElementById("langSelect");
      langSel.value = L;
      langSel.dispatchEvent(new env.win.Event("change"));
      const modalText = env.doc.getElementById("shareModal").textContent;
      // 「非公開」（＝private の意）は維持対象なので、それを除いた残りに「公開」が無いことを見る
      const withoutPrivate = modalText.replace(/非公開/g, "");
      ok(!/公開/.test(withoutPrivate), L + ": 共有モーダルの文言に「公開」が残っていない", modalText);
      ok(!modalText.includes("🌐"), L + ": 共有モーダルの文言に「🌐」が残っていない", modalText);
    });
    // 編集リンクのセクション（18・触ってはいけない）は文言もそのまま無傷であること（日本語表示に戻して確認）
    {
      const langSel = env.doc.getElementById("langSelect");
      langSel.value = "ja";
      langSel.dispatchEvent(new env.win.Event("change"));
      const editSection = env.doc.getElementById("shareEditSection");
      ok(editSection.textContent.includes("編集できるリンクを発行"), "編集リンクセクションの文言はそのまま残っている", editSection.textContent);
    }
  }

  /* ================================================================ */
  section("5. #p=<publicId> 起動: 読み取り専用モード & localStorage 不変");
  {
    const publicDoc = {
      ownerUid: "someone-else",
      title: "他人の旅",
      updatedAt: 5000,
      schema: 2,
      // 他人が作った公開データ（サニタイズ済み想定）
      data: JSON.stringify({
        v: 1,
        title: "他人の旅",
        titles: { ja: "他人の旅" },
        lang: "ja",
        days: [{ date: "2026-09-01", startTime: "10:00", tz: "", items: [{ id: "x1", cat: "sight", name: "京都駅", dur: 30, note: "メモ" }] }],
        packing: [{ id: "q1", text: "傘", done: false }],
        todos: []
      })
    };
    const before = fixtureStore();
    const beforeSnapshot = JSON.stringify(before);
    const env = boot({ hash: "#p=PUB123", localStorage: before, docs: { PUB123: publicDoc } });
    await tick();
    await tick();

    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(env.doc.body.classList.contains("view-only-mode"), "body に view-only-mode が付く");
    ok(!env.doc.getElementById("viewOnlyBanner").classList.contains("hidden"), "「👁 閲覧モード」バナーが表示される");
    ok(env.doc.getElementById("tripTitle").textContent === "他人の旅", "公開しおりのタイトルが表示される", env.doc.getElementById("tripTitle").textContent);
    ok(env.doc.querySelectorAll("#timeline .item-card").length === 1, "公開しおりの項目が描画される");

    // ★ 最重要: localStorage が起動前後で完全一致
    ok(JSON.stringify(env.store) === beforeSnapshot, "localStorage が起動前後で完全一致（汚染なし）", { writes: env.writeLog.map((w) => w.k) });
    ok(env.writeLog.filter((w) => w.k === STORAGE_KEY).length === 0, "しおりストアへの書き込みが1回も発生していない", env.writeLog.map((w) => w.k));

    // 編集UIの無効化
    ok(env.doc.getElementById("tripTitle").getAttribute("contenteditable") === "false", "タイトル編集が無効");
    ok(env.doc.getElementById("dayDateInput").readOnly, "日付入力が readOnly");
    ok(env.doc.getElementById("dayStartTimeInput").readOnly, "開始時刻が readOnly");
    ok(env.doc.getElementById("dayTzSelect").disabled, "タイムゾーン選択が disabled");
    ok(env.doc.querySelector("#timeline .item-name").readOnly, "項目名が readOnly");
    ok(env.doc.querySelector("#timeline .item-note").readOnly, "メモが readOnly");
    ok(env.doc.querySelector("#timeline .item-dur-input").readOnly, "所要時間が readOnly");
    ok(env.doc.querySelector(".checklist-checkbox").disabled, "チェックボックスが disabled（読み取り専用）");
    ok(env.doc.querySelector(".checklist-text-input").readOnly, "チェックリストのテキストが readOnly");
    ok(env.doc.getElementById("addBtn").disabled, "追加ボタンが disabled");
    ok(env.doc.getElementById("addName").readOnly, "追加フォームの名前欄が readOnly");

    // 編集操作を強行してもローカルは汚れない
    const snapBefore = JSON.stringify(env.store);
    env.doc.getElementById("addName").value = "侵入";
    env.doc.getElementById("addBtn").click();
    env.doc.getElementById("routeBtn").click();
    env.doc.getElementById("mapUpdateBtn").click();
    env.doc.getElementById("addDayBtn").click();
    env.doc.getElementById("tripsBtn").click();
    const cb = env.doc.querySelector(".checklist-checkbox");
    cb.checked = true;
    cb.dispatchEvent(new env.win.Event("change"));
    await tick();
    ok(JSON.stringify(env.store) === snapBefore, "編集操作を強行しても localStorage は不変", env.writeLog.map((w) => w.k));
    ok(env.doc.getElementById("tripsModal").classList.contains("hidden"), "しおり一覧モーダルは開かない");

    // 言語切替・PDF・タブ閲覧は使える
    const langSel = env.doc.getElementById("langSelect");
    langSel.value = "en";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    ok(env.doc.documentElement.lang === "en", "言語切替が動作する");
    ok(env.doc.getElementById("viewOnlyBackBtn").textContent === "Back to my itinerary", "バナーが英語化される", env.doc.getElementById("viewOnlyBackBtn").textContent);
    ok(JSON.stringify(env.store) === snapBefore, "言語切替でも localStorage は不変");

    // 「自分のしおりに戻る」
    env.doc.getElementById("viewOnlyBackBtn").click();
    await tick();
    ok(!env.doc.body.classList.contains("view-only-mode"), "戻るボタンで通常モードに復帰");
    ok(env.doc.getElementById("viewOnlyBanner").classList.contains("hidden"), "バナーが消える");
    ok(env.win.location.hash === "", "ハッシュが消える", env.win.location.hash);
    // 閲覧中の言語切替は「他人の公開コピー（一時オブジェクト）」の trip.lang を変えるだけで永続化されない。
    // 戻ると自分のしおりに保存済みの言語(ja)が復帰する = ローカル非汚染の設計どおりの正しい挙動
    ok(env.doc.getElementById("tripTitle").textContent === "東京旅行", "自分のしおりに戻る（自分の保存言語 ja が復帰）", env.doc.getElementById("tripTitle").textContent);
    ok(env.doc.querySelectorAll("#timeline .item-card").length === 4, "自分のしおりの4項目が戻る");
    ok(!env.doc.querySelector("#timeline .item-name").readOnly, "戻った後は項目名が編集可能");
    ok(env.doc.getElementById("tripTitle").getAttribute("contenteditable") === "true", "戻った後はタイトル編集が再び有効");
  }

  /* ================================================================ */
  section("6. 存在しない publicId / 取得失敗");
  {
    const before = fixtureStore();
    const env = boot({ hash: "#p=NOPE", localStorage: before, docs: {} });
    await tick();
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(!env.doc.body.classList.contains("view-only-mode"), "通常モードで起動する");
    ok(env.doc.getElementById("viewOnlyBanner").classList.contains("hidden"), "閲覧バナーは非表示");
    ok(env.doc.getElementById("tripTitle").textContent === "東京旅行", "自分のしおりが表示される");
    const toast = env.doc.querySelector("#toastContainer .toast");
    ok(toast && toast.textContent === "このしおりは公開されていません", "「このしおりは公開されていません」トースト", toast && toast.textContent);
    ok(env.win.location.hash === "", "ハッシュが消える");
    ok(env.doc.querySelectorAll("#timeline .item-card").length === 4, "通常どおり編集可能な状態");
    ok(!env.doc.querySelector("#timeline .item-name").readOnly, "項目名が編集可能に戻っている");
  }

  /* ================================================================ */
  section("7. Firebase 未初期化（SDK読込失敗）で #p= を開く");
  {
    const env = boot({ hash: "#p=PUB123", localStorage: fixtureStore(), noFirebase: true });
    await tick();
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(!env.doc.body.classList.contains("view-only-mode"), "通常モードで起動しアプリは動く");
    ok(env.doc.getElementById("authBtn").classList.contains("hidden"), "ログインボタンは静かに隠れる");
  }

  /* ================================================================ */
  section("8. 既存機能の回帰（未ログイン）");
  {
    const env = boot({ localStorage: fixtureStore() });
    await tick();
    // 準備モーダル
    env.doc.getElementById("prepBtn").click();
    ok(!env.doc.getElementById("prepModal").classList.contains("hidden"), "準備モーダルが開く");
    ok(env.doc.querySelectorAll("#prepPackingItems .checklist-item").length === 2, "持ち物2件");
    // CSV 出力（priv列を含む完全データ）
    env.doc.getElementById("textioBtn").click();
    const csv = env.doc.getElementById("textioArea").value;
    ok(csv.includes("private"), "CSVに private 列がある");
    ok(csv.includes("秘密の店"), "CSVエクスポートは非公開項目も含む完全データ");
    // アーカイブ / しおり一覧
    env.doc.getElementById("tripsBtn").click();
    ok(!env.doc.getElementById("tripsModal").classList.contains("hidden"), "しおり一覧が開く");
    ok(env.doc.querySelectorAll("#tripsList .trip-list-item").length === 1, "しおり1件");
    ok(!!env.doc.querySelector(".trip-list-item-cloud"), "☁ 同期済みバッジ（15）が出る");
    ok(!env.doc.querySelector(".trip-list-item-public"), "未公開なので🌐バッジは出ない");
    // 時差: tz セレクトが値を持つ
    ok(env.doc.getElementById("dayTzSelect").value === "Asia/Tokyo", "時差（tz）が復元される");
    // PDF: jsdom は window.print() 未実装のため、その1件だけは想定内として除外する
    env.doc.getElementById("printBtn").click();
    ok(!!env.doc.getElementById("printView").innerHTML.trim(), "PDF出力: 印刷ビューが組み立てられる");
    ok(env.doc.getElementById("printView").textContent.includes("秘密の店"), "PDF出力は自分用の完全データ（非公開項目も含む）");
    const realErrors = env.errors.filter((e) => !/print\(\) method/.test(e));
    ok(realErrors.length === 0, "コンソールエラーが無い（jsdom未実装のprint()を除く）", realErrors);
  }

  /* ================================================================ */
  section("9. しおり一覧の 🌐 バッジ（公開中）");
  {
    const env = boot({ localStorage: fixtureStore({ publicId: "PUBX" }) });
    await tick();
    env.fb.login(USER);
    await tick();
    env.doc.getElementById("tripsBtn").click();
    const badge = env.doc.querySelector(".trip-list-item-public");
    ok(!!badge, "公開中のしおり行に🌐バッジが表示される");
    ok(badge && badge.textContent === "🌐", "バッジの内容が🌐");
    ok(badge && badge.title === "🌐 公開中", "バッジのツールチップ", badge && badge.title);
    // 公開中のエントリはログイン直後のマージでも publicId を維持
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    ok(saved.trips[0].publicId === "PUBX", "publicId が維持される");
  }

  /* ================================================================ */
  section("10. 4言語の新規文字列");
  {
    const env = boot({ localStorage: fixtureStore() });
    await tick();
    const I18N = env.win.I18N;
    const keys = [
      "share.publicBadge",
      "share.loginHint",
      "share.unpublished",
      "share.publicStopButton",
      "share.generating",
      "viewOnly.badge",
      "viewOnly.backToMine",
      "viewOnly.notFound"
    ];
    ["ja", "en", "zh", "th"].forEach((L) => {
      const missing = keys.filter((k) => {
        const v = I18N.t(L, k);
        return !v || v === k || (L !== "ja" && v === I18N.t("ja", k) && k !== "share.publicBadge");
      });
      ok(missing.length === 0, L + ": 新規8キーがすべて翻訳済み", missing);
    });
  }

  const r = results();
  console.log("\n================================");
  console.log("PASS: " + r.pass + "   FAIL: " + r.fail);
  console.log("================================");
  process.exit(r.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exitCode = 1; });
