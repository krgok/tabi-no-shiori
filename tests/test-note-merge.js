/**
 * メモ(note)の端末間マージ・共同編集マージ 検証ハーネス（SPEC 23 追記）
 * 実績記録（actualStart等）で修正した「端末間同期でメモが丸ごと上書きされて消える」バグと同種の
 * 問題が note にもあったための修正。mergeTripActuals（項目単位の端末間マージ）と
 * mergeDayItems（共同編集マージ、mergeRemoteEditIntoOwnerTrip 経由）の両方で、
 * note/noteAt の組を実績4フィールドと同じ考え方でマージする。
 * harness.js（boot/tick/ok/section）を再利用する（test-actual.js と同じ方式）。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

function noteItem(id, name, extra) {
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
      actualStart: null,
      actualLat: null,
      actualLon: null,
      actualAt: null,
      noteAt: null,
      gmap: "",
      gmapAuto: false,
      names: {},
      noteNames: {}
    },
    extra || {}
  );
}
function noteDay(id, date, items) {
  return { id, date, startTime: "09:00", tz: "", priv: false, dateManual: false, items };
}
function noteTrip(days) {
  return { v: 1, title: "旅", titles: { ja: "旅" }, lang: "ja", days, packing: [], todos: [], packingPriv: false, todosPriv: false };
}

function fixtureTripForUi() {
  return {
    v: 1,
    title: "テスト旅行",
    titles: { ja: "テスト旅行" },
    lang: "ja",
    days: [
      {
        date: "2026-08-01",
        startTime: "09:00",
        tz: "",
        items: [
          noteItem("a1", "スポットA"),
          noteItem("a2", "スポットB")
        ]
      }
    ],
    packing: [],
    todos: []
  };
}
function fixtureStore(trip) {
  return {
    [STORAGE_KEY]: JSON.stringify({
      currentId: "loc1",
      trips: [{ id: "loc1", data: trip, archived: false, cloudId: null, updatedAt: 1000, publicId: null }]
    })
  };
}

(async () => {
  /* ================================================================ */
  section("1. normalizeTrip: noteAtの防御的正規化");
  {
    const env = boot({});
    await tick();
    const normalize = env.win.__tabiShioriCollabInternals.normalizeTrip;
    const raw = {
      v: 1,
      title: "t",
      lang: "ja",
      days: [
        {
          date: "",
          startTime: "09:00",
          items: [
            { id: "i1", cat: "sight", name: "A", note: "メモ1", noteAt: 12345 },
            { id: "i2", cat: "sight", name: "B", note: "メモ2", noteAt: "12345" },
            { id: "i3", cat: "sight", name: "C", note: "メモ3", noteAt: NaN },
            { id: "i4", cat: "sight", name: "D", note: "メモ4" },
            { id: "i5", cat: "sight", name: "E", note: "メモ5", noteAt: Infinity }
          ]
        }
      ]
    };
    const t = normalize(raw);
    const items = t.days[0].items;
    ok(items[0].noteAt === 12345, "有効なnoteAt(number)はそのまま保持される", items[0].noteAt);
    ok(items[1].noteAt === null, "noteAtが文字列型は防御的にnullになる", items[1].noteAt);
    ok(items[2].noteAt === null, "noteAtがNaNは防御的にnullになる", items[2].noteAt);
    ok(items[3].noteAt === null, "noteAt未指定は既定でnullになる", items[3].noteAt);
    ok(items[4].noteAt === null, "noteAtがInfinity(有限でない)は防御的にnullになる", items[4].noteAt);
  }

  /* ================================================================ */
  section("2. sanitizeTripForPublic: notePriv項目はnoteAtも一緒に消え、通常項目はnoteAtが残る");
  {
    const env = boot({});
    await tick();
    const T = env.win.__tabiShioriCollabInternals;
    const trip = T.normalizeTrip({
      v: 1,
      title: "t",
      lang: "ja",
      days: [
        {
          date: "",
          startTime: "09:00",
          items: [
            { id: "i1", cat: "sight", name: "A", note: "公開メモ", noteAt: 5000, notePriv: false },
            { id: "i2", cat: "sight", name: "B", note: "非公開メモ", noteAt: 6000, notePriv: true }
          ]
        }
      ]
    });
    const sanitized = T.sanitizeTripForPublic(trip);
    const pub = sanitized.days[0].items.find((i) => i.id === "i1");
    const priv = sanitized.days[0].items.find((i) => i.id === "i2");
    ok(pub.note === "公開メモ" && pub.noteAt === 5000, "notePrivでない項目はnote/noteAtがどちらも公開コピーに残る(マージ判断に使うため)", pub);
    ok(priv.note === "" && priv.noteAt === null, "notePriv項目はnoteと揃えてnoteAtも公開コピーから消える", priv);
  }

  /* ================================================================ */
  section("3. mergeTripActuals: 端末Aが項目1、端末Bが項目2にメモ→合成後に両方残る");
  {
    const env = boot({});
    await tick();
    const T = env.win.__tabiShioriCollabInternals;
    const mergeTripActuals = T.mergeTripActuals;

    // adopted(採用する側=updatedAtが新しい方): 項目1(i1)にだけ端末Aのメモがある
    const adopted = T.normalizeTrip(
      noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "スポット1", { note: "端末Aのメモ", noteAt: 1000 }), noteItem("i2", "スポット2")])])
    );
    // other(もう一方の端末): 項目2(i2)にだけ端末Bのメモがある
    const other = T.normalizeTrip(
      noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "スポット1"), noteItem("i2", "スポット2", { note: "端末Bのメモ", noteAt: 500 })])])
    );

    const merged = mergeTripActuals(adopted, other);
    const items = merged.days[0].items;
    ok(items.find((i) => i.id === "i1").note === "端末Aのメモ", "採用した側(端末A)の項目1のメモが残る", items.find((i) => i.id === "i1"));
    ok(items.find((i) => i.id === "i2").note === "端末Bのメモ", "もう一方(端末B)にしか無かった項目2のメモも拾い上げられて残る", items.find((i) => i.id === "i2"));
  }

  /* ================================================================ */
  section("4. mergeTripActuals: noteAtが新しい方が勝つ／新しいクリアが伝わる");
  {
    const env = boot({});
    await tick();
    const T = env.win.__tabiShioriCollabInternals;
    const mergeTripActuals = T.mergeTripActuals;

    // 4a: 同じ項目に両端末が記録。otherの方がnoteAtが新しい→otherの値が勝つ
    const adoptedOld = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A", { note: "古いメモ", noteAt: 1000 })])]));
    const otherNew = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A", { note: "新しいメモ", noteAt: 2000 })])]));
    const merged1 = mergeTripActuals(adoptedOld, otherNew);
    ok(merged1.days[0].items[0].note === "新しいメモ", "noteAtが新しい方(other)のメモが勝つ", merged1.days[0].items[0].note);
    ok(merged1.days[0].items[0].noteAt === 2000, "noteAtも新しい方の値になる", merged1.days[0].items[0].noteAt);

    // 4b: 新しいクリア(note="")でもnoteAtが新しければ伝わる（クリアもメモの変更として扱われる）
    const adoptedHasValue = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A", { note: "消される前のメモ", noteAt: 1000 })])]));
    const otherCleared = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A", { note: "", noteAt: 3000 })])]));
    const merged2 = mergeTripActuals(adoptedHasValue, otherCleared);
    ok(merged2.days[0].items[0].note === "", "新しい方が空メモ(クリア)なら、クリアの方が伝わる", merged2.days[0].items[0]);
    ok(merged2.days[0].items[0].noteAt === 3000, "noteAtもクリアした側の新しい値になる", merged2.days[0].items[0].noteAt);
  }

  /* ================================================================ */
  section("5. mergeTripActuals: noteAt同値(両方0/null含む)ではnote非空優先(過去データ救出)");
  {
    const env = boot({});
    await tick();
    const T = env.win.__tabiShioriCollabInternals;
    const mergeTripActuals = T.mergeTripActuals;

    // 5a: 両方noteAt未設定(null=0扱い)で、otherだけメモを持つ→otherが優先される
    const adoptedEmpty = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A")])]));
    const otherHasNote = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A", { note: "過去に書いたメモ" })])]));
    const merged1 = mergeTripActuals(adoptedEmpty, otherHasNote);
    ok(merged1.days[0].items[0].note === "過去に書いたメモ", "noteAt同値(共に0)ならnon-nullのメモを持つ側が優先される(過去データ救出)", merged1.days[0].items[0].note);

    // 5b: 逆にadopted側だけメモを持つ場合はadoptedの値が残る
    const adoptedHasNote = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A", { note: "こちらのメモ" })])]));
    const otherEmpty = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A")])]));
    const merged2 = mergeTripActuals(adoptedHasNote, otherEmpty);
    ok(merged2.days[0].items[0].note === "こちらのメモ", "noteAt同値でadopted側だけがnon-nullならadopted側が残る", merged2.days[0].items[0].note);

    // 5c: 両方空のままなら、結果も空のまま
    const bothEmptyA = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A")])]));
    const bothEmptyB = T.normalizeTrip(noteTrip([noteDay("d1", "2026-08-01", [noteItem("i1", "A")])]));
    const merged3 = mergeTripActuals(bothEmptyA, bothEmptyB);
    ok(merged3.days[0].items[0].note === "", "両方とも未記入ならマージ後も空のまま", merged3.days[0].items[0].note);
  }

  /* ================================================================ */
  section("6. mergeDayItems(共同編集マージ): noteAtが新しい方を採用する");
  {
    const env = boot({});
    await tick();
    const T = env.win.__tabiShioriCollabInternals;
    const merge = T.mergeRemoteEditIntoOwnerTrip;
    const sanitize = T.sanitizeTripForPublic;
    const normalize = T.normalizeTrip;

    // 6a: オーナーが先にメモを書いた(noteAt=1000)後、共同編集者がより新しく(noteAt=2000)書き換えて送り返す
    const ownerTrip = normalize(noteTrip([noteDay("d1", "2026-08-01", [noteItem("a", "浅草寺", { note: "オーナーの古いメモ", noteAt: 1000 })])]));
    const publicView = sanitize(ownerTrip);
    const received = normalize(publicView);
    received.days[0].items[0].note = "共同編集者の新しいメモ";
    received.days[0].items[0].noteAt = 2000;
    const merged = merge(ownerTrip, received);
    ok(merged.days[0].items[0].note === "共同編集者の新しいメモ", "共同編集者側のnoteAtが新しければ書き換えたメモが伝わる", merged.days[0].items[0].note);
    ok(merged.days[0].items[0].noteAt === 2000, "noteAtも新しい側の値になる", merged.days[0].items[0].noteAt);

    // 6b: オーナーがさらに後で(noteAt=3000)上書きした後、家族の古いコピー(noteAt=2000)が別の編集と
    // 一緒に送り返されてきても、オーナーの新しいメモが巻き戻らない（actualStartと同じ保護）
    const ownerTrip2 = normalize(noteTrip([noteDay("d1", "2026-08-01", [noteItem("a", "浅草寺", { note: "オーナーの最新メモ", noteAt: 3000 })])]));
    const staleReceived = normalize(publicView);
    staleReceived.days[0].items[0].note = "家族の古いコピーのメモ";
    staleReceived.days[0].items[0].noteAt = 2000;
    const merged2 = merge(ownerTrip2, staleReceived);
    ok(merged2.days[0].items[0].note === "オーナーの最新メモ", "オーナー側のnoteAtの方が新しければ、家族の古いコピーでメモが巻き戻らない", merged2.days[0].items[0].note);
    ok(merged2.days[0].items[0].noteAt === 3000, "noteAtもオーナー側の新しい値のまま", merged2.days[0].items[0].noteAt);
  }

  /* ================================================================ */
  section("7. mergeDayItems(共同編集マージ): notePriv項目のメモは既存保護のまま消えない（回帰）");
  {
    const env = boot({});
    await tick();
    const T = env.win.__tabiShioriCollabInternals;
    const merge = T.mergeRemoteEditIntoOwnerTrip;
    const sanitize = T.sanitizeTripForPublic;
    const normalize = T.normalizeTrip;

    // notePriv項目はサニタイズでnote/noteAtとも消えるため、共同編集者には常に「空メモ・noteAt=null」に
    // 見える。noteAt比較ロジックを導入しても、notePrivの保護（オーナー側のメモを必ず残す）を壊さないことを確認する
    const ownerTrip = normalize(
      noteTrip([noteDay("d1", "2026-08-01", [noteItem("n", "ホテル", { notePriv: true, note: "予約番号ABC123", noteAt: 9999 })])])
    );
    const publicView = sanitize(ownerTrip);
    ok(publicView.days[0].items[0].note === "" && publicView.days[0].items[0].noteAt === null, "前提: 公開ビューではメモもnoteAtも空になっている");

    // 7a: 共同編集者は空メモを受け取ったまま送り返す(noteAt=null=0)→noteAt比較だけならオーナー(9999)が勝つはずだが、
    // notePriv保護はnoteAt比較そのものを行わずオーナーの値を無条件に使う
    const received = normalize(publicView);
    const merged = merge(ownerTrip, received);
    ok(merged.days[0].items[0].note === "予約番号ABC123", "notePriv項目はオーナーの元メモが保持される(受信の空メモで上書きされない)", merged.days[0].items[0].note);
    ok(merged.days[0].items[0].noteAt === 9999, "noteAtもオーナー側の値が保持される", merged.days[0].items[0].noteAt);
    ok(merged.days[0].items[0].notePriv === true, "notePrivフラグも復元される");

    // 7b: 共同編集者が「空だと思って」新しいnoteAtで書き込んできても、notePriv保護が優先される
    const received2 = normalize(publicView);
    received2.days[0].items[0].note = "共同編集者が書いたメモ";
    received2.days[0].items[0].noteAt = 99999; // オーナーより新しいnoteAtでも
    const merged2 = merge(ownerTrip, received2);
    ok(merged2.days[0].items[0].note === "予約番号ABC123", "notePriv中はnoteAtが新しくても共同編集者の書き込みより非公開保護が優先される", merged2.days[0].items[0].note);
  }

  /* ================================================================ */
  section("8. メモ編集UI: メモを変更するとnoteAtが更新される(noteNamesの間接的な再生成では動かない)");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTripForUi()) });
    await tick();

    const before = Date.now();
    const card = env.doc.querySelectorAll("#timeline .item-card")[0];
    const noteInput = card.querySelector(".item-note");
    ok(!!noteInput, "メモ入力欄が存在する");
    noteInput.value = "新しく書いたメモ";
    noteInput.dispatchEvent(new env.win.Event("change"));
    await tick();

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const a1 = saved.trips[0].data.days[0].items.find((i) => i.id === "a1");
    ok(a1.note === "新しく書いたメモ", "メモがsaveStateされる", a1.note);
    ok(typeof a1.noteAt === "number" && a1.noteAt >= before, "メモ変更でnoteAtが現在時刻に更新される", a1.noteAt);

    // 同じ値のまま change が発火しても(=実質変更なし)noteAtは動かさない
    const noteAtAfterFirst = a1.noteAt;
    await new Promise((r) => setTimeout(r, 5));
    const card2 = env.doc.querySelectorAll("#timeline .item-card")[0];
    const noteInput2 = card2.querySelector(".item-note");
    noteInput2.value = "新しく書いたメモ"; // 同じ値
    noteInput2.dispatchEvent(new env.win.Event("change"));
    await tick();
    const saved2 = JSON.parse(env.store[STORAGE_KEY]);
    const a1b = saved2.trips[0].data.days[0].items.find((i) => i.id === "a1");
    ok(a1b.noteAt === noteAtAfterFirst, "値が変わっていないchangeイベントではnoteAtは更新されない", [a1b.noteAt, noteAtAfterFirst]);

    // メモをクリアしてもnoteAtは更新される（クリアも「変更」として扱う）
    await new Promise((r) => setTimeout(r, 5));
    const beforeClear = Date.now();
    const card3 = env.doc.querySelectorAll("#timeline .item-card")[0];
    const noteInput3 = card3.querySelector(".item-note");
    noteInput3.value = "";
    noteInput3.dispatchEvent(new env.win.Event("change"));
    await tick();
    const saved3 = JSON.parse(env.store[STORAGE_KEY]);
    const a1c = saved3.trips[0].data.days[0].items.find((i) => i.id === "a1");
    ok(a1c.note === "", "メモがクリアされる");
    ok(typeof a1c.noteAt === "number" && a1c.noteAt >= beforeClear, "クリアでもnoteAtが更新される", a1c.noteAt);
  }

  /* ================================================================ */
  section("9. applyCloudMergePlan経由: クラウド採用時にローカルのメモが拾われ、アップロード対象に入る");
  {
    const localTrip = noteTrip([
      noteDay("d1", "2026-08-01", [
        noteItem("a1", "スポットA", { note: "ローカルにしか無いメモ", noteAt: 5000 }),
        noteItem("a2", "スポットB")
      ])
    ]);
    const storage = {
      [STORAGE_KEY]: JSON.stringify({
        currentId: "loc1",
        trips: [{ id: "loc1", data: localTrip, archived: false, cloudId: "C1", updatedAt: 1000, publicId: null, editId: null }]
      })
    };
    const env = boot({ localStorage: storage });
    await tick();

    const T = env.win.__tabiShioriCollabInternals;
    env.win.authUser = { uid: "test-uid", email: "t@example.com", displayName: "T", photoURL: "" };
    env.win.firebaseReady = true;
    env.win.fbDb = env.fb.firebase.firestore();

    const entry = env.win.tripsStore.find((e) => e.id === "loc1");

    // クラウド側(他端末が既にアップロード済みのバージョン): 項目a2にだけメモがある。updatedAtはローカルより新しい
    const cloudTrip = noteTrip([
      noteDay("d1", "2026-08-01", [noteItem("a1", "スポットA"), noteItem("a2", "スポットB", { note: "クラウドにしか無いメモ", noteAt: 6000 })])
    ]);
    const plan = {
      uploads: [],
      localUpdates: [{ entry, cloudDoc: { id: "C1", data: JSON.stringify(cloudTrip), updatedAt: 2000, archived: false, publicId: null, editId: null } }],
      newLocalEntries: []
    };

    T.applyCloudMergePlan(plan);
    await tick();

    const items = entry.data.days[0].items;
    const a1 = items.find((i) => i.id === "a1");
    const a2 = items.find((i) => i.id === "a2");
    ok(a1 && a1.note === "ローカルにしか無いメモ", "採用したクラウド版に、ローカルにしか無かった項目a1のメモが拾われる", a1);
    ok(a2 && a2.note === "クラウドにしか無いメモ", "クラウド側にしか無かった項目a2のメモも残る(両方揃う)", a2);
  }

  /* ================================================================ */
  section("10. applyCloudMergePlan経由(uploads方向): クラウド版にしか無いメモが拾われ、アップロード後のデータにもローカルにも残る");
  {
    const localTrip = noteTrip([noteDay("d1", "2026-08-01", [noteItem("x1", "項目X")])]);
    const storage = {
      [STORAGE_KEY]: JSON.stringify({
        currentId: "loc1",
        trips: [{ id: "loc1", data: localTrip, archived: false, cloudId: "C2", updatedAt: 2000, publicId: null, editId: null }]
      })
    };
    const env = boot({ localStorage: storage });
    await tick();

    const T = env.win.__tabiShioriCollabInternals;
    env.win.authUser = { uid: "test-uid", email: "t@example.com", displayName: "T", photoURL: "" };
    env.win.firebaseReady = true;
    env.win.fbDb = env.fb.firebase.firestore();

    const entry = env.win.tripsStore.find((e) => e.id === "loc1");

    // クラウド側: 項目x1に他端末が書いたメモがある。updatedAtはローカルと同値
    // （同値なのでcomputeTripsMergePlanの分岐上はuploads扱いになる）
    const cloudTrip = noteTrip([noteDay("d1", "2026-08-01", [noteItem("x1", "項目X", { note: "他端末が書いたメモ", noteAt: 7000 })])]);
    const cloudDoc = { id: "C2", data: JSON.stringify(cloudTrip), updatedAt: 2000, archived: false, publicId: null, editId: null };
    const plan = T.computeTripsMergePlan([entry], [cloudDoc]);
    ok(plan.uploads.length === 1 && plan.uploads[0].entry === entry && plan.uploads[0].cloudDoc === cloudDoc, "updatedAt同値はuploads対象になり、対応するクラウド文書がcloudDocとして添えられる");

    const callsBefore = env.fb.calls.length;
    T.applyCloudMergePlan(plan);
    await tick();

    const x1 = entry.data.days[0].items.find((i) => i.id === "x1");
    ok(x1 && x1.note === "他端末が書いたメモ", "アップロード前にクラウド版のメモが拾われ、ローカルのentry.dataにも取り込まれる", x1);

    const newCalls = env.fb.calls.slice(callsBefore);
    const uploadCall = newCalls.find((c) => c.op === "set" && c.coll === "trips" && c.id === "C2");
    ok(!!uploadCall, "通常どおりアップロードが実行される");
    if (uploadCall) {
      const uploaded = JSON.parse(uploadCall.payload.data);
      const ux1 = uploaded.days[0].items.find((i) => i.id === "x1");
      ok(ux1 && ux1.note === "他端末が書いたメモ", "アップロードされるデータにもクラウド版のメモが残り、丸ごと上書きで消えない(他端末のメモが消失するバグの再発防止)", ux1);
    }
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
