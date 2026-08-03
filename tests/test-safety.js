/**
 * データ安全性の検証（Phase2）
 * - しおり削除時に publicTrips / editTrips の両方を削除する（プライバシーバグの回帰防止）
 * - 項目・チェックリストの削除 → 「元に戻す」で同じ位置に復元される
 * - 全しおりのバックアップ／復元
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";
const USER = { uid: "uid-owner", email: "owner@example.com", displayName: "Owner" };

function sightItem(id, name) {
  return {
    id: id, cat: "sight", name: name, loc: "", dur: 30, note: "", lat: null, lon: null,
    coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false,
    names: {}, noteNames: {}
  };
}

function tripData(items, packing) {
  return {
    v: 1, title: "テスト旅行", titles: { ja: "テスト旅行" }, lang: "ja",
    packing: packing || [], todos: [], packingPriv: false, todosPriv: false,
    days: [{ date: "2026-07-24", startTime: "09:00", tz: "", priv: false, dateManual: true, items: items }]
  };
}

function storeWith(entries) {
  return { [STORAGE_KEY]: JSON.stringify({ currentId: entries[0].id, trips: entries }) };
}

(async () => {
  /* ================================================================ */
  section("1. しおり削除時に publicTrips と editTrips の両方を削除する");
  {
    const env = boot({
      localStorage: storeWith([
        { id: "t1", data: tripData([sightItem("a1", "浅草寺")]), archived: false, cloudId: "CLOUD1", updatedAt: 1, publicId: "PUB1", editId: "EDIT1" },
        { id: "t2", data: tripData([sightItem("b1", "上野公園")]), archived: false, cloudId: "CLOUD2", updatedAt: 1, publicId: null, editId: null }
      ])
    });
    await tick();
    env.fb.login(USER);
    await tick();
    env.fb.calls.length = 0;

    env.doc.getElementById("tripsBtn").click();
    const delBtn = env.doc.querySelector(".trip-list-item-delete");
    ok(!!delBtn, "しおり一覧に削除ボタンがある");
    delBtn.click();
    const okBtn = env.doc.getElementById("confirmOkBtn");
    ok(okBtn && !env.doc.getElementById("confirmModal").classList.contains("hidden"), "削除の確認ダイアログが出る");
    okBtn.click();
    await tick();

    const deletes = env.fb.calls.filter((c) => c.op === "delete");
    const delColls = deletes.map((c) => c.coll + "/" + c.id);
    ok(deletes.some((c) => c.coll === "trips"), "trips のドキュメントが削除される", delColls);
    ok(deletes.some((c) => c.coll === "editTrips" && c.id === "EDIT1"), "editTrips も削除される", delColls);
    ok(
      deletes.some((c) => c.coll === "publicTrips" && c.id === "PUB1"),
      "publicTrips も削除される（消したしおりが共有URLから見え続けない）",
      delColls
    );
  }

  /* ================================================================ */
  section("2. 項目削除 → 元に戻すで同じ位置に復元される");
  {
    for (const [label, targetIdx] of [["先頭", 0], ["中間", 1], ["末尾", 2]]) {
      const env = boot({
        localStorage: storeWith([
          { id: "t1", data: tripData([sightItem("a1", "A"), sightItem("a2", "B"), sightItem("a3", "C")]), archived: false, cloudId: null, updatedAt: 1, publicId: null, editId: null }
        ])
      });
      await tick();
      const doc = env.doc;
      const cards = [...doc.querySelectorAll("#timeline .item-card")];
      const targetId = ["a1", "a2", "a3"][targetIdx];
      cards[targetIdx].querySelector(".item-delete").click();
      await tick();

      let cur = JSON.parse(env.store[STORAGE_KEY]).trips[0].data;
      ok(cur.days[0].items.length === 2, label + ": 削除で2件になる", cur.days[0].items.length);

      const undoBtn = doc.querySelector(".toast-action-btn");
      ok(!!undoBtn, label + ": 元に戻すボタンが出る");
      undoBtn.click();
      await tick();

      cur = JSON.parse(env.store[STORAGE_KEY]).trips[0].data;
      const names = cur.days[0].items.map((i) => i.id);
      ok(cur.days[0].items.length === 3, label + ": 復元で3件に戻る", names);
      ok(names[targetIdx] === targetId, label + ": 元の位置に戻る", names);
    }
  }

  /* ================================================================ */
  section("3. 元に戻すは1回だけ効く（連打で二重復元しない）");
  {
    const env = boot({
      localStorage: storeWith([
        { id: "t1", data: tripData([sightItem("a1", "A"), sightItem("a2", "B")]), archived: false, cloudId: null, updatedAt: 1, publicId: null, editId: null }
      ])
    });
    await tick();
    const doc = env.doc;
    doc.querySelector("#timeline .item-card .item-delete").click();
    await tick();
    const undoBtn = doc.querySelector(".toast-action-btn");
    undoBtn.click();
    undoBtn.click();
    undoBtn.click();
    await tick();
    const cur = JSON.parse(env.store[STORAGE_KEY]).trips[0].data;
    ok(cur.days[0].items.length === 2, "連打しても2件のまま（二重復元しない）", cur.days[0].items.length);
  }

  /* ================================================================ */
  section("4. 持ち物リストの削除 → 元に戻す");
  {
    const env = boot({
      localStorage: storeWith([
        {
          id: "t1",
          data: tripData([sightItem("a1", "A")], [
            { id: "p1", text: "パスポート", done: false, priv: false },
            { id: "p2", text: "充電器", done: false, priv: false }
          ]),
          archived: false, cloudId: null, updatedAt: 1, publicId: null, editId: null
        }
      ])
    });
    await tick();
    const doc = env.doc;
    const rows = [...doc.querySelectorAll("#packingItems .checklist-item")];
    ok(rows.length === 2, "持ち物が2件ある", rows.length);
    rows[0].querySelector(".checklist-delete").click();
    await tick();
    let cur = JSON.parse(env.store[STORAGE_KEY]).trips[0].data;
    ok(cur.packing.length === 1, "削除で1件になる", cur.packing.map((p) => p.text));

    const undoBtn = doc.querySelector(".toast-action-btn");
    ok(!!undoBtn, "元に戻すボタンが出る");
    undoBtn.click();
    await tick();
    cur = JSON.parse(env.store[STORAGE_KEY]).trips[0].data;
    ok(cur.packing.length === 2, "復元で2件に戻る", cur.packing.map((p) => p.text));
    ok(cur.packing[0].id === "p1", "元の位置（先頭）に戻る", cur.packing.map((p) => p.id));
  }

  /* ================================================================ */
  section("5. バックアップ: 内容とAPIキー非混入");
  {
    const env = boot({
      localStorage: Object.assign(
        storeWith([
          { id: "t1", data: tripData([sightItem("a1", "浅草寺")]), archived: false, cloudId: "C1", updatedAt: 5, publicId: "PUB1", editId: null },
          { id: "t2", data: tripData([sightItem("b1", "上野")]), archived: true, cloudId: null, updatedAt: 6, publicId: null, editId: null }
        ]),
        { "tabi-gmaps-key": "AIzaSecretKeyShouldNotLeak" }
      )
    });
    await tick();

    let captured = null;
    env.win.Blob = function (parts) {
      captured = String(parts[0]);
      return { __blob: true };
    };
    env.win.URL.createObjectURL = () => "blob:test";
    env.win.URL.revokeObjectURL = () => {};

    env.doc.getElementById("settingsBtn").click();
    const backupBtn = env.doc.getElementById("settingsBackupBtn");
    ok(!!backupBtn, "設定にバックアップボタンがある");
    backupBtn.click();
    await tick();

    ok(!!captured, "バックアップ内容が生成される");
    const payload = JSON.parse(captured);
    ok(payload.store && payload.store.trips.length === 2, "全しおり（2件）が含まれる", payload.store && payload.store.trips.length);
    ok(payload.store.trips[1].archived === true, "アーカイブ状態などのメタも保たれる");
    ok(payload.store.trips[0].publicId === "PUB1", "publicId も保たれる");
    ok(captured.indexOf("AIzaSecretKeyShouldNotLeak") === -1, "APIキーはバックアップに含まれない");
  }

  /* ================================================================ */
  section("6. 復元: 置換される／壊れたファイルでは既存データが無傷");
  {
    const env = boot({
      localStorage: storeWith([
        { id: "t1", data: tripData([sightItem("a1", "元のしおり")]), archived: false, cloudId: null, updatedAt: 1, publicId: null, editId: null }
      ])
    });
    await tick();
    const doc = env.doc;
    const before = env.store[STORAGE_KEY];

    // 壊れたファイル → 何も変わらない
    env.win.FileReader = function () {
      this.readAsText = () => {
        this.onload({ target: { result: "{ broken json" } });
      };
    };
    doc.getElementById("settingsBtn").click();
    const input = doc.getElementById("settingsRestoreInput");
    Object.defineProperty(input, "files", { value: [{ name: "x.json" }], configurable: true });
    input.dispatchEvent(new env.win.Event("change"));
    await tick();
    ok(env.store[STORAGE_KEY] === before, "壊れたファイルでは既存データが変更されない");

    // 正常なバックアップ → 置換される
    const backup = {
      app: "tabi-no-shiori", kind: "backup", schema: 2,
      store: {
        currentId: "r1",
        trips: [
          { id: "r1", data: tripData([sightItem("z1", "復元されたしおり")]), archived: false, cloudId: null, updatedAt: 9, publicId: null, editId: null },
          { id: "r2", data: tripData([sightItem("z2", "2つ目")]), archived: false, cloudId: null, updatedAt: 9, publicId: null, editId: null }
        ]
      }
    };
    env.win.FileReader = function () {
      this.readAsText = () => {
        this.onload({ target: { result: JSON.stringify(backup) } });
      };
    };
    Object.defineProperty(input, "files", { value: [{ name: "b.json" }], configurable: true });
    input.dispatchEvent(new env.win.Event("change"));
    await tick();
    const confirmOk = doc.getElementById("confirmOkBtn");
    ok(confirmOk && !doc.getElementById("confirmModal").classList.contains("hidden"), "復元前に確認ダイアログが出る");
    confirmOk.click();
    await tick();

    const after = JSON.parse(env.store[STORAGE_KEY]);
    ok(after.trips.length === 2, "復元で2件のしおりに置き換わる", after.trips.length);
    ok(after.trips[0].data.days[0].items[0].name === "復元されたしおり", "中身が復元される");
    ok(after.trips[0].updatedAt === 9, "updatedAt が保たれる（クラウドとのマージ判定のため）", after.trips[0].updatedAt);
  }

  /* ================================================================ */
  section("7. 4言語の文言");
  {
    const env = boot({
      localStorage: storeWith([
        { id: "t1", data: tripData([sightItem("a1", "A"), sightItem("a2", "B")]), archived: false, cloudId: null, updatedAt: 1, publicId: null, editId: null }
      ])
    });
    await tick();
    const doc = env.doc;
    const expect = {
      ja: { undo: "元に戻す", backup: "💾 全データをファイルに保存" },
      en: { undo: "Undo", backup: "💾 Save all data to a file" },
      zh: { undo: "撤销", backup: "💾 将全部数据保存到文件" },
      th: { undo: "เลิกทำ", backup: "💾 บันทึกข้อมูลทั้งหมดลงไฟล์" }
    };
    for (const lang of ["ja", "en", "zh", "th"]) {
      const sel = doc.getElementById("langSelect");
      sel.value = lang;
      sel.dispatchEvent(new env.win.Event("change", { bubbles: true }));
      await tick();
      // 前の言語で出たトーストが残っていると古い文言を拾うので消してから測る
      doc.querySelectorAll(".toast").forEach((el) => el.remove());
      doc.querySelector("#timeline .item-card .item-delete").click();
      await tick();
      const btn = doc.querySelector(".toast-action-btn");
      ok(btn && btn.textContent === expect[lang].undo, lang + ": 元に戻すの文言", btn && btn.textContent);
      if (btn) btn.click();
      await tick();
      const bk = doc.getElementById("settingsBackupBtn");
      ok(bk && bk.textContent === expect[lang].backup, lang + ": バックアップボタンの文言", bk && bk.textContent);
    }
  }

  const r = results();
  console.log("\n================================");
  console.log("PASS: " + r.pass + "   FAIL: " + r.fail);
  console.log("================================");
  process.exitCode = r.fail > 0 ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
