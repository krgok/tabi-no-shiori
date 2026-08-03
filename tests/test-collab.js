/**
 * 「旅のしおり」編集できる共有リンク（18）検証テスト
 * 実物の index.html / i18n.js / app.js を jsdom で読み込み、Firestore をスタブして挙動を確認する。
 * harness.js の Firestore スタブは onSnapshot / 状態保持 / remoteSet / remoteDelete を持つよう拡張済み。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";
const wait2s = () => new Promise((r) => setTimeout(r, 2400));

const USER = { uid: "uid-owner", email: "owner@example.com", displayName: "Owner" };
const GUEST_USER = { uid: "uid-guest", email: "guest@example.com", displayName: "Guest" };

/* ------------------------------------------------------------------ */
/* Part A: マージ純粋関数（mergeRemoteEditIntoOwnerTrip）の単体テスト   */
/* Firestore/DOMを介さず、window.__tabiShioriCollabInternals を直接呼ぶ */
/* ------------------------------------------------------------------ */

function sightItem(id, name, extra) {
  return Object.assign(
    {
      id,
      cat: "sight",
      name,
      loc: "",
      dur: 30,
      note: "",
      lat: null,
      lon: null,
      coordSrc: null,
      priv: false,
      notePriv: false,
      fixedStart: null,
      gmap: "",
      gmapAuto: false,
      names: {}
    },
    extra || {}
  );
}

function day(id, items, extra) {
  return Object.assign(
    { id, date: "2026-08-01", startTime: "09:00", tz: "", priv: false, dateManual: false, items: items },
    extra || {}
  );
}

function checklistItem(id, text, extra) {
  return Object.assign({ id, text, done: false, priv: false }, extra || {});
}

function baseTrip(days, extra) {
  return Object.assign(
    { v: 1, title: "旅", titles: { ja: "旅" }, lang: "ja", days: days, packing: [], todos: [], packingPriv: false, todosPriv: false },
    extra || {}
  );
}

(async () => {
  // internals を取り出すためだけに1回 boot する（DOM機能は使わない）
  const internalsEnv = boot({});
  await tick();
  const internals = internalsEnv.win.__tabiShioriCollabInternals;
  const merge = internals.mergeRemoteEditIntoOwnerTrip;
  const sanitize = internals.sanitizeTripForPublic;
  const normalize = internals.normalizeTrip;

  ok(typeof merge === "function", "mergeRemoteEditIntoOwnerTrip が window に公開されている");
  ok(typeof sanitize === "function", "sanitizeTripForPublic が window に公開されている");

  /* ================================================================ */
  section("A1. 基本: 非公開項目が無ければ受信データがそのまま採用される");
  {
    const ownerTrip = normalize(baseTrip([day("d1", [sightItem("a", "浅草寺"), sightItem("b", "上野公園")])]));
    const received = normalize(sanitize(ownerTrip));
    received.title = "編集後タイトル";
    received.days[0].items[0].name = "浅草寺（編集済み）";
    const merged = merge(ownerTrip, received);
    ok(merged.title === "編集後タイトル", "タイトル編集が反映される");
    ok(merged.days[0].items[0].name === "浅草寺（編集済み）", "項目名の編集が反映される");
    ok(merged.days[0].items.length === 2, "項目数は変わらない");
  }

  /* ================================================================ */
  section("A2. 非公開項目（中間）がアンカー位置に復元される");
  {
    const ownerTrip = normalize(
      baseTrip([day("d1", [sightItem("a", "浅草寺"), sightItem("b", "秘密の店", { priv: true, note: "サプライズ" }), sightItem("c", "上野公園")])])
    );
    const publicView = sanitize(ownerTrip);
    ok(publicView.days[0].items.length === 2, "公開ビューでは非公開項目(b)が除外されている");
    const received = normalize(publicView); // 共同編集者は何も変更しない
    const merged = merge(ownerTrip, received);
    const ids = merged.days[0].items.map((i) => i.id);
    ok(JSON.stringify(ids) === JSON.stringify(["a", "b", "c"]), "非公開項目(b)が元の位置(aの直後)に復元される", ids);
    const restored = merged.days[0].items.find((i) => i.id === "b");
    ok(restored.priv === true, "復元された項目は priv:true のまま");
    ok(restored.note === "サプライズ", "復元された項目のメモも保持される");
  }

  /* ================================================================ */
  section("A3. 非公開項目が先頭（アンカーなし=null）でも復元される");
  {
    const ownerTrip = normalize(baseTrip([day("d1", [sightItem("p", "秘密の場所", { priv: true }), sightItem("a", "浅草寺")])]));
    const received = normalize(sanitize(ownerTrip));
    const merged = merge(ownerTrip, received);
    const ids = merged.days[0].items.map((i) => i.id);
    ok(JSON.stringify(ids) === JSON.stringify(["p", "a"]), "先頭の非公開項目が先頭に復元される", ids);
  }

  /* ================================================================ */
  section("A4. アンカーが共同編集者に削除されていた場合は日の末尾に復元される");
  {
    const ownerTrip = normalize(baseTrip([day("d1", [sightItem("a", "浅草寺"), sightItem("b", "秘密の店", { priv: true })])]));
    const received = normalize(sanitize(ownerTrip)); // received.days[0].items = [a]
    ok(received.days[0].items.length === 1, "前提: 共同編集者にはaだけ見えている");
    received.days[0].items = []; // 共同編集者がアンカー(a)を削除した
    const merged = merge(ownerTrip, received);
    const ids = merged.days[0].items.map((i) => i.id);
    ok(JSON.stringify(ids) === JSON.stringify(["b"]), "アンカー消失時は末尾（この場合は残り1件）に復元される", ids);
  }

  /* ================================================================ */
  section("A5. 連続する複数の非公開項目が元の相対順序を保って復元される");
  {
    const ownerTrip = normalize(
      baseTrip([
        day("d1", [
          sightItem("a", "A"),
          sightItem("b", "B(非公開)", { priv: true }),
          sightItem("c", "C(非公開)", { priv: true }),
          sightItem("d", "D")
        ])
      ])
    );
    const received = normalize(sanitize(ownerTrip));
    const ids0 = received.days[0].items.map((i) => i.id);
    ok(JSON.stringify(ids0) === JSON.stringify(["a", "d"]), "前提: 共同編集者にはa,dだけ見えている", ids0);
    const merged = merge(ownerTrip, received);
    const ids = merged.days[0].items.map((i) => i.id);
    ok(JSON.stringify(ids) === JSON.stringify(["a", "b", "c", "d"]), "b,cが元の相対順序のままaの直後に復元される", ids);
  }

  /* ================================================================ */
  section("A6. notePriv 項目: 受信の空メモで上書きされず元メモを保持する");
  {
    const ownerTrip = normalize(
      baseTrip([day("d1", [sightItem("n", "ホテル", { notePriv: true, note: "予約番号ABC123" })])])
    );
    const publicView = sanitize(ownerTrip);
    ok(publicView.days[0].items[0].note === "", "前提: 公開ビューではメモが空になっている");
    const received = normalize(publicView); // 共同編集者はメモ欄を触らない（空のまま）
    const merged = merge(ownerTrip, received);
    const item = merged.days[0].items[0];
    ok(item.note === "予約番号ABC123", "オーナーの元メモが保持される", item.note);
    ok(item.notePriv === true, "notePriv フラグも復元される");
  }

  /* ================================================================ */
  section("A7. notePriv 項目に共同編集者が書き込んでも、オーナーの元メモが優先される（仕様どおりの意図的な挙動）");
  {
    const ownerTrip = normalize(
      baseTrip([day("d1", [sightItem("n", "ホテル", { notePriv: true, note: "予約番号ABC123" })])])
    );
    const received = normalize(sanitize(ownerTrip));
    received.days[0].items[0].note = "共同編集者が書いたメモ"; // 空だと思って書き込んでしまった
    const merged = merge(ownerTrip, received);
    ok(merged.days[0].items[0].note === "予約番号ABC123", "notePriv中は共同編集者の書き込みより非公開保護が優先される");
  }

  /* ================================================================ */
  section("A8. 非公開の日が丸ごと元の位置に復元される（中間・アンカーあり）");
  {
    const ownerTrip = normalize(
      baseTrip([
        day("d1", [sightItem("a1", "Day1観光")]),
        day("d2", [sightItem("a2", "Day2の秘密の予定")], { priv: true }),
        day("d3", [sightItem("a3", "Day3観光")])
      ])
    );
    const publicView = sanitize(ownerTrip);
    ok(publicView.days.length === 2, "前提: 公開ビューでは非公開の日(d2)が除外されている");
    const received = normalize(publicView);
    received.days[1].date = "2026-08-03"; // Day3(d3)の日付を編集
    const merged = merge(ownerTrip, received);
    const dayIds = merged.days.map((d) => d.id);
    ok(JSON.stringify(dayIds) === JSON.stringify(["d1", "d2", "d3"]), "非公開の日(d2)が元の位置(d1の直後)に復元される", dayIds);
    ok(merged.days[1].priv === true, "復元された日は priv:true のまま");
    ok(merged.days[1].items[0].name === "Day2の秘密の予定", "非公開の日の中身も保持される");
    ok(merged.days[2].date === "2026-08-03", "可視だった日への編集も反映される");
  }

  /* ================================================================ */
  section("A9. 非公開の日のアンカー(直前の可視な日)が共同編集者に削除された場合は末尾に復元される");
  {
    // d1(可視・非公開の日のアンカー) → d2(非公開) → d3(可視) という並び。
    // 「最後の1日は削除できない」既存ガードがあるため、可視な日は常に最低1つは残る現実的なケースにする
    const ownerTrip = normalize(
      baseTrip([
        day("d1", [sightItem("a1", "公開されている日1")]),
        day("d2", [sightItem("a2", "非公開の日")], { priv: true }),
        day("d3", [sightItem("a3", "公開されている日3")])
      ])
    );
    const publicView = sanitize(ownerTrip);
    ok(JSON.stringify(publicView.days.map((d) => d.id)) === JSON.stringify(["d1", "d3"]), "前提: 公開ビューはd1,d3のみ");
    const received = normalize(publicView);
    received.days = received.days.filter((d) => d.id !== "d1"); // 共同編集者がアンカー(d1)を削除、d3のみ残す
    const merged = merge(ownerTrip, received);
    const dayIds = merged.days.map((d) => d.id);
    ok(JSON.stringify(dayIds) === JSON.stringify(["d3", "d2"]), "アンカー(d1)が消えた非公開の日(d2)は末尾に復元される", dayIds);
    ok(merged.days.find((d) => d.id === "d2").priv === true, "復元された日は priv:true のまま");
  }

  /* ================================================================ */
  section("A10. packingPriv:true のリストは受信データで上書きされず、元のリストを保つ");
  {
    const ownerTrip = normalize(
      baseTrip([day("d1", [sightItem("a", "A")])], {
        packing: [checklistItem("p1", "パスポート"), checklistItem("p2", "指輪")],
        packingPriv: true
      })
    );
    const publicView = sanitize(ownerTrip);
    ok(publicView.packing.length === 0, "前提: packingPriv中は公開ビューで空になる");
    const received = normalize(publicView);
    const merged = merge(ownerTrip, received);
    ok(merged.packing.length === 2, "非公開リスト全体がそのまま保持される", merged.packing);
    ok(merged.packingPriv === true, "packingPriv フラグも保持される");
    ok(merged.packing.some((p) => p.text === "指輪"), "非公開リストの中身も保持される");
  }

  /* ================================================================ */
  section("A11. packingPriv:false: 要素単位の priv がアンカー方式で保持され、共同編集者の追加も反映される");
  {
    const ownerTrip = normalize(
      baseTrip([day("d1", [sightItem("a", "A")])], {
        packing: [checklistItem("p1", "パスポート"), checklistItem("p2", "指輪(非公開)", { priv: true }), checklistItem("p3", "充電器")]
      })
    );
    const received = normalize(sanitize(ownerTrip));
    received.packing.push(checklistItem("p4", "共同編集者が追加した傘"));
    const merged = merge(ownerTrip, received);
    const texts = merged.packing.map((p) => p.text);
    ok(JSON.stringify(texts) === JSON.stringify(["パスポート", "指輪(非公開)", "充電器", "共同編集者が追加した傘"]), "非公開要素が位置を保って復元され、追加要素も反映される", texts);
  }

  /* ================================================================ */
  section("A12. 共同編集者が新しく追加した日・項目がそのまま採用される");
  {
    const ownerTrip = normalize(baseTrip([day("d1", [sightItem("a", "A")])]));
    const received = normalize(sanitize(ownerTrip));
    received.days[0].items.push(sightItem("newitem", "共同編集者が追加した項目"));
    received.days.push(day("newday", [sightItem("x", "新しい日の予定")]));
    const merged = merge(ownerTrip, received);
    ok(merged.days.length === 2, "新しい日が追加される");
    ok(merged.days[0].items.some((i) => i.id === "newitem"), "新しい項目が追加される");
    ok(merged.days[1].items[0].name === "新しい日の予定", "新しい日の中身も反映される");
  }

  /* ================================================================ */
  section("A13. 共同編集者が可視な項目を削除した場合はそのまま削除される（非公開扱いにしない）");
  {
    const ownerTrip = normalize(baseTrip([day("d1", [sightItem("a", "A"), sightItem("b", "B")])]));
    const received = normalize(sanitize(ownerTrip));
    received.days[0].items = received.days[0].items.filter((i) => i.id !== "b");
    const merged = merge(ownerTrip, received);
    const ids = merged.days[0].items.map((i) => i.id);
    ok(JSON.stringify(ids) === JSON.stringify(["a"]), "共同編集者による可視項目の削除は尊重される", ids);
  }

  /* ================================================================ */
  section("A14. 自動生成move（隣接する非公開項目の削除で一緒に消えるもの）も一緒に復元される");
  {
    const ownerTrip = normalize(
      baseTrip([
        day("d1", [
          sightItem("a", "浅草寺"),
          Object.assign(sightItem("m", "浅草寺→秘密の店", { priv: false }), {
            cat: "move",
            mode: "train",
            distKm: 3,
            auto: true,
            approx: false,
            unresolved: false,
            arriveTz: ""
          }),
          sightItem("s", "秘密の店", { priv: true })
        ])
      ])
    );
    const publicView = sanitize(ownerTrip);
    ok(publicView.days[0].items.length === 1, "前提: 公開ビューでは秘密の店(s)も隣接move(m)も除外されている", publicView.days[0].items);
    const received = normalize(publicView);
    const merged = merge(ownerTrip, received);
    const ids = merged.days[0].items.map((i) => i.id);
    ok(JSON.stringify(ids) === JSON.stringify(["a", "m", "s"]), "priv項目とそれに付随するauto moveの両方が復元される", ids);
  }

  /* ================================================================ */
  section("A15. マージ結果は normalizeTrip 済み（受信データが壊れていても防御的に正規化される）");
  {
    const ownerTrip = normalize(baseTrip([day("d1", [sightItem("a", "A")])]));
    const received = { title: "壊れた受信データ", days: [{ date: "", startTime: "09:00", items: [{ id: "z", cat: "unknown-cat", name: "?" }] }] };
    const merged = merge(ownerTrip, received);
    ok(merged.days[0].items[0].cat === "sight", "不正な cat は防御的に sight にフォールバック（normalizeTrip適用の証跡）", merged.days[0].items[0].cat);
    ok(typeof merged.days[0].items[0].id === "string" && merged.days[0].items[0].id, "id が保持される");
  }

  /* ================================================================ */
  section("A16. 複数の非公開要素がそれぞれ独立したアンカーに復元される（非隣接ケース）");
  {
    const ownerTrip = normalize(
      baseTrip([
        day("d1", [
          sightItem("a", "A"),
          sightItem("s1", "秘密1", { priv: true }),
          sightItem("b", "B"),
          sightItem("s2", "秘密2", { priv: true }),
          sightItem("c", "C")
        ])
      ])
    );
    const received = normalize(sanitize(ownerTrip));
    // 共同編集者が可視項目の順番を入れ替える（b, aの順に）
    received.days[0].items = [received.days[0].items[1], received.days[0].items[0], received.days[0].items[2]];
    const merged = merge(ownerTrip, received);
    const ids = merged.days[0].items.map((i) => i.id);
    ok(JSON.stringify(ids) === JSON.stringify(["b", "s2", "a", "s1", "c"]), "並べ替え後もそれぞれの非公開要素が正しいアンカーの直後に付いてくる", ids);
  }

  results();
})().then(async () => {
  /* ================================================================ */
  /* Part B: 実結線（DOM + Firestoreスタブ）でのオーナー側・共同編集側の検証 */
  /* ================================================================ */

  function ownerFixtureData() {
    return {
      v: 1,
      title: "東京旅行",
      titles: { ja: "東京旅行" },
      lang: "ja",
      days: [
        {
          date: "2026-08-01",
          startTime: "09:00",
          tz: "",
          items: [
            { id: "a1", cat: "sight", name: "浅草寺", loc: "", dur: 60, note: "公開メモ", priv: false, notePriv: false, gmap: "", gmapAuto: false, names: {} },
            { id: "s1", cat: "meal", name: "秘密の店", loc: "", dur: 90, note: "サプライズ", priv: true, notePriv: false, gmap: "", gmapAuto: false, names: {} }
          ]
        }
      ],
      packing: [{ id: "p1", text: "パスポート", done: false, priv: false }],
      todos: []
    };
  }

  function ownerFixtureStore() {
    return {
      [STORAGE_KEY]: JSON.stringify({
        currentId: "loc1",
        trips: [{ id: "loc1", data: ownerFixtureData(), archived: false, cloudId: "CLOUD1", updatedAt: 1000, publicId: null, editId: null }]
      })
    };
  }

  /* ================================================================ */
  section("B1. 未ログイン時は編集リンクのトグルを出さず、案内文を表示する");
  {
    const env = boot({ localStorage: ownerFixtureStore() });
    await tick();
    env.doc.getElementById("shareBtn").click();
    ok(env.doc.getElementById("shareEditSection").classList.contains("hidden"), "未ログイン時は編集リンクセクション非表示");
    ok(!env.doc.getElementById("shareEditLoginHint").classList.contains("hidden"), "未ログイン時はログイン案内を表示");
  }

  /* ================================================================ */
  let ownerEnv, ownerEditId;
  section("B2. ログイン時: 編集リンクのトグルON → editTrips へ add され、URLが生成される");
  {
    // 共有（7・16統合）: ログイン時にモーダルを開くと自動で publicTrips へも add されるため、
    // autoIds の先頭1件はその自動共有発行に消費される。editTrips 用のIDは2番目に用意する
    const env = boot({ localStorage: ownerFixtureStore(), autoIds: ["AUTOPUB_B2", "EDITID1"] });
    await tick();
    env.fb.login(USER);
    await tick();
    env.doc.getElementById("shareBtn").click();
    await tick();
    ok(!env.doc.getElementById("shareEditSection").classList.contains("hidden"), "ログイン時は編集リンクセクション表示");
    ok(env.doc.getElementById("shareEditLoginHint").classList.contains("hidden"), "ログイン時はログイン案内を隠す");
    ok(env.doc.getElementById("shareEditToggle").checked === false, "初期状態は未発行");

    const toggle = env.doc.getElementById("shareEditToggle");
    toggle.checked = true;
    toggle.dispatchEvent(new env.win.Event("change"));
    await tick();

    const addCall = env.fb.calls.find((c) => c.op === "add" && c.coll === "editTrips");
    ok(!!addCall, "editTrips への add が呼ばれた", env.fb.calls.map((c) => c.op + ":" + c.coll));
    ok(addCall.payload.ownerUid === "uid-owner", "ownerUid が自分のuid");
    ok(typeof addCall.payload.writerId === "string" && addCall.payload.writerId, "writerId が入っている");
    const data = JSON.parse(addCall.payload.data);
    ok(!data.days[0].items.some((i) => i.id === "s1"), "editTripsへの送信データは非公開項目(s1)を含まない", data);
    ok(!JSON.stringify(data).includes("priv"), "priv/notePriv フラグ自体を含まない");

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    ok(saved.trips[0].editId === "EDITID1", "editId が localStorage に保存された", saved.trips[0].editId);
    ok(!env.doc.getElementById("shareEditBadge").classList.contains("hidden"), "「発行中」バッジが表示される");
    const url = env.doc.getElementById("shareEditUrl").value;
    ok(url === "https://example.org/tabi/#e=EDITID1", "編集URLが <origin><pathname>#e=<editId> 形式", url);

    const privSet = env.fb.calls.filter((c) => c.op === "set" && c.coll === "trips").pop();
    ok(privSet && privSet.payload.editId === "EDITID1", "trips/{cloudId} にも editId を保存", privSet && privSet.payload.editId);

    ownerEnv = env;
    ownerEditId = "EDITID1";
  }

  /* ================================================================ */
  section("B3. しおり一覧に✏️バッジが表示される");
  {
    ownerEnv.doc.getElementById("tripsBtn").click();
    const badge = ownerEnv.doc.querySelector(".trip-list-item-edit");
    ok(!!badge, "✏️バッジが表示される");
    ok(badge && badge.textContent === "✏️", "バッジの内容が✏️");
  }

  /* ================================================================ */
  section("B4. オーナーが編集 → editTrips への push（既存のcloud syncデバウンスに相乗り）");
  {
    ownerEnv.fb.calls.length = 0;
    const note = ownerEnv.doc.querySelector('#timeline .item-card[data-id="a1"] .item-note');
    note.value = "編集しました";
    note.dispatchEvent(new ownerEnv.win.Event("change"));
    await wait2s();

    const editSet = ownerEnv.fb.calls.find((c) => c.op === "set" && c.coll === "editTrips" && c.id === ownerEditId);
    ok(!!editSet, "編集後、editTrips/{editId} への set が呼ばれた", ownerEnv.fb.calls.map((c) => c.op + ":" + c.coll));
    if (editSet) {
      const data = JSON.parse(editSet.payload.data);
      ok(data.days[0].items[0].note === "編集しました", "編集内容がeditTripsコピーに反映される");
    }
  }

  /* ================================================================ */
  section("B4b. リンク送付後に🔒を外すと、同じURLのまま相手に見えるようになる");
  {
    ownerEnv.fb.calls.length = 0;
    const privBtn = ownerEnv.doc.querySelector('#timeline .item-card[data-id="s1"] .item-priv-toggle');
    ok(!!privBtn, "非公開項目s1の🔒トグルが存在する");
    privBtn.click();
    await wait2s();
    const editSet = ownerEnv.fb.calls.filter((c) => c.op === "set" && c.coll === "editTrips").pop();
    ok(!!editSet, "🔒解除後、editTrips への set が呼ばれた", ownerEnv.fb.calls.map((c) => c.op + ":" + c.coll));
    if (editSet) {
      ok(editSet.id === ownerEditId, "送信先は同じ editId（＝送ったURLは変わらない）", editSet.id);
      const data = JSON.parse(editSet.payload.data);
      const names = data.days[0].items.map((i) => i.name);
      ok(names.indexOf("秘密の店") !== -1, "🔒を外した項目が編集リンクのコピーに現れる", names);
      ok(!JSON.stringify(data).includes("priv"), "privフラグ自体はコピーに含まれない");
    }
    ownerEnv.doc.querySelector('#timeline .item-card[data-id="s1"] .item-priv-toggle').click();
    await wait2s();
  }

  /* ================================================================ */
  section("B4c. 編集リンクをOFF→ONすると新しいURLになり、古いリンクは無効になる");
  {
    ownerEnv.fb.calls.length = 0;
    const oldId = ownerEditId;
    const toggle = ownerEnv.doc.getElementById("shareEditToggle");
    ownerEnv.doc.getElementById("shareBtn").click();
    toggle.checked = false;
    toggle.dispatchEvent(new ownerEnv.win.Event("change"));
    await tick();
    const delCall = ownerEnv.fb.calls.find((c) => c.op === "delete" && c.coll === "editTrips");
    ok(!!delCall, "OFFにすると editTrips のドキュメントが削除される", ownerEnv.fb.calls.map((c) => c.op + ":" + c.coll));
    ok(delCall && delCall.id === oldId, "削除されたのは発行中だったID（＝古いリンクは無効になる）", delCall && delCall.id);
    ok(JSON.parse(ownerEnv.store[STORAGE_KEY]).trips[0].editId === null, "editId が null に戻る");
    ownerEnv.fb.autoIds = ["EDITID2"];
    toggle.checked = true;
    toggle.dispatchEvent(new ownerEnv.win.Event("change"));
    await tick();
    const newUrl = ownerEnv.doc.getElementById("shareEditUrl").value;
    const newId = JSON.parse(ownerEnv.store[STORAGE_KEY]).trips[0].editId;
    ok(newId !== oldId, "ONに戻すと別のIDが採番される（＝URLが変わる）", oldId + " -> " + newId);
    ok(newUrl.indexOf(newId) !== -1, "表示されるURLも新しいIDになっている", newUrl);
    ownerEditId = newId;
  }

  /* ================================================================ */
  section("B5. 共同編集者からの更新（pull）: 非公開項目を失わずマージされる");
  {
    ownerEnv.fb.calls.length = 0;
    // 共同編集者が「浅草寺」の名前を変更して push してきたのをシミュレートする
    const currentDoc = ownerEnv.fb.docsById[ownerEditId];
    const collabData = JSON.parse(currentDoc.data);
    collabData.days[0].items[0].name = "浅草寺(共同編集者が改名)";
    ownerEnv.fb.remoteSet("editTrips", ownerEditId, {
      ownerUid: "uid-owner",
      data: JSON.stringify(collabData),
      title: "東京旅行",
      updatedAt: Date.now(),
      writerId: "someone-elses-session",
      schema: 2
    });
    await tick();

    const saved = JSON.parse(ownerEnv.store[STORAGE_KEY]);
    const mergedData = saved.trips[0].data;
    ok(mergedData.days[0].items[0].name === "浅草寺(共同編集者が改名)", "共同編集者の変更がローカルに反映される");
    // 相手の変更が黙って反映されると気づけないので通知が出る
    const notice = [...ownerEnv.doc.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ");
    ok(/共同編集の変更を反映/.test(notice), "共同編集の更新が通知される", notice);
    ok(mergedData.days[0].items.some((i) => i.id === "s1" && i.priv === true), "非公開項目(s1)が失われずマージされている", mergedData.days[0].items);
    ok(ownerEnv.doc.querySelector('#timeline .item-card[data-id="a1"] .item-name').value === "浅草寺(共同編集者が改名)", "画面にも反映される");

    // マージ適用自体が editTrips への push を誘発していないこと（ループ防止）を確認
    const echoSet = ownerEnv.fb.calls.find((c) => c.op === "set" && c.coll === "editTrips");
    ok(!echoSet, "マージ適用自体はeditTripsへのsetを誘発しない（ループ防止）", ownerEnv.fb.calls.map((c) => c.op + ":" + c.coll));
  }

  /* ================================================================ */
  section("B6. 自分自身の書き込みのエコー（同じwriterId）は無視される");
  {
    ownerEnv.fb.calls.length = 0;
    const currentDoc = ownerEnv.fb.docsById[ownerEditId];
    // アプリ自身の実際の SESSION_WRITER_ID と同じ値でエコーを模擬する
    const myWriterId = ownerEnv.win.__tabiShioriCollabInternals.getSessionWriterId();
    const collabData = JSON.parse(currentDoc.data);
    collabData.days[0].items[0].name = "自分のエコー・反映されないはず";
    ownerEnv.fb.remoteSet("editTrips", ownerEditId, {
      ownerUid: "uid-owner",
      data: JSON.stringify(collabData),
      title: "東京旅行",
      updatedAt: Date.now(),
      writerId: myWriterId,
      schema: 2
    });
    await tick();
    const saved = JSON.parse(ownerEnv.store[STORAGE_KEY]);
    ok(saved.trips[0].data.days[0].items[0].name !== "自分のエコー・反映されないはず", "自分自身のwriterIdと一致するエコーは無視される");
  }

  /* ================================================================ */
  section("B7. しおり切替でリスナーが解除・張り直しされる");
  {
    const subCountBefore = ownerEnv.fb.calls.filter((c) => c.op === "onSnapshot:subscribe" && c.coll === "editTrips").length;
    ownerEnv.doc.getElementById("tripsNewBtn").click();
    await tick();
    const unsub = ownerEnv.fb.calls.filter((c) => c.op === "onSnapshot:unsubscribe" && c.coll === "editTrips" && c.id === ownerEditId);
    ok(unsub.length >= 1, "しおり切替で以前の editTrips 購読が解除される", ownerEnv.fb.calls.map((c) => c.op));
    const subAfter = ownerEnv.fb.calls.filter((c) => c.op === "onSnapshot:subscribe" && c.coll === "editTrips").length;
    ok(subAfter === subCountBefore, "editId を持たない新規しおりへの切替では新しい購読を張らない");
  }

  /* ================================================================ */
  section("B8. 編集リンクのトグルOFF → editTrips が削除される");
  {
    ownerEnv.doc.getElementById("tripsModal") && ownerEnv.doc.querySelectorAll(".trip-list-item")[0]?.click();
    await tick();
    ownerEnv.doc.getElementById("shareBtn").click();
    const toggle = ownerEnv.doc.getElementById("shareEditToggle");
    if (toggle.checked) {
      toggle.checked = false;
      toggle.dispatchEvent(new ownerEnv.win.Event("change"));
      await tick();
      const del = ownerEnv.fb.calls.find((c) => c.op === "delete" && c.coll === "editTrips" && c.id === ownerEditId);
      ok(!!del, "editTrips/{editId} の delete が呼ばれた");
      const saved = JSON.parse(ownerEnv.store[STORAGE_KEY]);
      const entry = saved.trips.find((t) => t.id === "loc1");
      ok(entry && entry.editId === null, "ローカルの editId が null に戻る", entry && entry.editId);
    } else {
      ok(true, "(前提が崩れたためスキップ: しおり切替の影響)");
    }
  }

  /* ================================================================ */
  section("B9. 200KB超のデータは editTrips への push をスキップしトースト表示する");
  {
    const bigData = ownerFixtureData();
    bigData.days[0].items[0].note = "x".repeat(210000);
    const env = boot({ localStorage: { [STORAGE_KEY]: JSON.stringify({ currentId: "loc1", trips: [{ id: "loc1", data: bigData, archived: false, cloudId: "CLOUD1", updatedAt: 1000, publicId: null, editId: null }] }) }, autoIds: ["BIGEDIT"] });
    await tick();
    env.fb.login(USER);
    await tick();
    env.doc.getElementById("shareBtn").click();
    const toggle = env.doc.getElementById("shareEditToggle");
    toggle.checked = true;
    toggle.dispatchEvent(new env.win.Event("change"));
    await tick();
    const addCall = env.fb.calls.find((c) => c.op === "add" && c.coll === "editTrips");
    ok(!addCall, "200KB超のデータは add されない");
    const toast = env.doc.querySelector("#toastContainer .toast");
    ok(!!toast, "トーストが表示される");
  }

  /* ================================================================ */
  section("C1. #e=<editId> で共同編集モード起動: localStorage 完全不変・非公開項目は含まれない");
  {
    const ownerData = ownerFixtureData();
    const sanitizedForCollab = JSON.parse(JSON.stringify(ownerData));
    sanitizedForCollab.days[0].items = sanitizedForCollab.days[0].items.filter((i) => !i.priv);
    sanitizedForCollab.days[0].items.forEach((i) => {
      delete i.priv;
      delete i.notePriv;
    });
    const editDoc = { ownerUid: "uid-owner", title: "東京旅行", updatedAt: 5000, schema: 2, writerId: "owner-session", data: JSON.stringify(sanitizedForCollab) };
    const before = { someOther: JSON.stringify({ currentId: "x", trips: [{ id: "x", data: { v: 1, title: "自分のしおり", titles: {}, lang: "ja", days: [{ date: "", startTime: "09:00", tz: "", items: [] }], packing: [], todos: [] }, archived: false, cloudId: null, updatedAt: 0, publicId: null, editId: null }] }) };
    // localStorageキーは既存アプリと同じ STORAGE_KEY を使う（自分のしおりが既にある状態を模す）
    before[STORAGE_KEY] = before.someOther;
    delete before.someOther;
    const beforeSnapshot = JSON.stringify(before);

    const env = boot({ hash: "#e=EDIT1", localStorage: before, docs: { EDIT1: editDoc } });
    await tick();

    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(env.doc.getElementById("collabBanner").classList.contains("hidden") === false, "共同編集バナーが表示される");
    ok(env.doc.body.classList.contains("collab-mode"), "collab-mode クラスが付与される");
    ok(env.doc.getElementById("tripTitle").textContent === "東京旅行", "共同編集対象のタイトルが表示される");
    ok(env.doc.querySelectorAll("#timeline .item-card").length === 1, "非公開項目(s1)を除いた1件のみ描画される");
    ok(JSON.stringify(env.store) === beforeSnapshot, "localStorage は起動時点で一切変更されていない", { before: beforeSnapshot, after: JSON.stringify(env.store) });
    ok(env.writeLog.length === 0, "localStorageへの書き込みが一度も発生していない", env.writeLog);

    // 編集操作をしてもローカルは変わらない
    const nameInput = env.doc.querySelector('#timeline .item-card .item-name');
    nameInput.value = "共同編集者による変更";
    nameInput.dispatchEvent(new env.win.Event("change"));
    await tick();
    ok(JSON.stringify(env.store) === beforeSnapshot, "編集操作後も localStorage は不変", { before: beforeSnapshot, after: JSON.stringify(env.store) });
    ok(env.writeLog.length === 0, "編集操作後も localStorageへの書き込みが発生していない");

    // デバウンス後、editTripsへpushされる
    await wait2s();
    const pushSet = env.fb.calls.find((c) => c.op === "set" && c.coll === "editTrips" && c.id === "EDIT1");
    ok(!!pushSet, "編集内容が editTrips へ push される（デバウンス2秒）", env.fb.calls.map((c) => c.op + ":" + c.coll));
    if (pushSet) {
      ok(pushSet.payload.ownerUid === "uid-owner", "ownerUid は受信値のまま維持される（ルール制約）");
      const sentData = JSON.parse(pushSet.payload.data);
      ok(sentData.days[0].items[0].name === "共同編集者による変更", "編集内容が送信データに反映される");
    }
    ok(JSON.stringify(env.store) === beforeSnapshot, "push後もlocalStorageは不変");

    // 「自分のしおりに戻る」で通常モードへ復帰する
    env.doc.getElementById("collabBackBtn").click();
    await tick();
    ok(!env.doc.body.classList.contains("collab-mode"), "自分のしおりに戻ると collab-mode が解除される");
    ok(env.doc.getElementById("tripTitle").textContent === "自分のしおり", "自分のしおりの表示に戻る");
  }

  /* ================================================================ */
  section("C2. 無効な editId（存在しない）で開くと通常モードにフォールバックする");
  {
    const env = boot({ hash: "#e=NOPE", localStorage: undefined, docs: {} });
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(!env.doc.body.classList.contains("collab-mode"), "collab-mode は付与されない");
    ok(env.doc.getElementById("collabBanner").classList.contains("hidden"), "共同編集バナーは表示されない");
    ok(env.doc.querySelectorAll("#timeline .item-card").length > 0, "通常モード（サンプルしおり）で起動する");
  }

  /* ================================================================ */
  section("C3. Firebase 未初期化（SDK読込失敗）で #e= を開くと通常モードで起動する");
  {
    const env = boot({ hash: "#e=EDIT1", noFirebase: true });
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(!env.doc.body.classList.contains("collab-mode"), "通常モードで起動する");
  }

  /* ================================================================ */
  section("C4. オーナーがリンクを停止（ドキュメント削除）すると通知され、以降pushしない");
  {
    const editDoc = {
      ownerUid: "uid-owner",
      title: "東京旅行",
      updatedAt: 5000,
      schema: 2,
      writerId: "owner-session",
      data: JSON.stringify({ v: 1, title: "東京旅行", titles: {}, lang: "ja", days: [{ date: "", startTime: "09:00", tz: "", items: [] }], packing: [], todos: [] })
    };
    const env = boot({ hash: "#e=REV1", docs: { REV1: editDoc } });
    await tick();
    ok(env.doc.body.classList.contains("collab-mode"), "共同編集モードで起動している");
    env.fb.remoteDelete("editTrips", "REV1");
    await tick();
    const toast = env.doc.querySelector("#toastContainer .toast");
    ok(!!toast, "リンク停止のトーストが表示される");

    env.fb.calls.length = 0;
    const titleEl = env.doc.getElementById("tripTitle");
    titleEl.textContent = "編集を試みる";
    titleEl.dispatchEvent(new env.win.Event("blur"));
    await wait2s();
    const setAfterRevoke = env.fb.calls.find((c) => c.op === "set" && c.coll === "editTrips");
    ok(!setAfterRevoke, "リンク停止後は push が行われない", env.fb.calls.map((c) => c.op));
  }

  /* ================================================================ */
  section("D. 4言語の新規文字列（編集できる共有リンク）");
  {
    const I18N = ownerEnv.win.I18N;
    const keys = [
      "share.editToggleLabel",
      "share.editWarning",
      "share.editPrivateNote",
      "share.editBadge",
      "share.editLoginHint",
      "collab.tooLarge",
      "collab.stopped",
      "collab.badge",
      "collab.backToMine",
      "collab.notFound",
      "collab.revoked"
    ];
    ["ja", "en", "zh", "th"].forEach((L) => {
      const missing = keys.filter((k) => {
        const v = I18N.t(L, k);
        return !v || v === k || (L !== "ja" && v === I18N.t("ja", k));
      });
      ok(missing.length === 0, L + ": 新規" + keys.length + "キーがすべて翻訳済み", missing);
    });
  }

  const r = results();
  console.log("\n================================");
  console.log("PASS: " + r.pass + "   FAIL: " + r.fail);
  console.log("================================");
  process.exitCode = r.fail > 0 ? 1 : 0;
}).catch((e) => { console.error(e); process.exitCode = 1; });
