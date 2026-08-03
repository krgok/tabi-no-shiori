/**
 * 今回の3修正の検証テスト:
 * 1) move（手入力の移動名）の翻訳対象化・OSM/Placesスキップ・Translationのみ
 * 2) CSVタイトル行（往復・後方互換）
 * 3) メモ(note)の翻訳・表示・notePrivでの非公開伝播（sanitize/merge）
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで検証する。
 */
const fs = require("fs");
const { boot, tick, ok, section, results } = require("./harness");

const REAL_CSV_PATH = "C:/Users/hiro/Claude/Projects/チェンマイ旅提案/タイ家族旅行2026年 (1)import用1648.csv";

function sightItem(id, name, extra) {
  return Object.assign(
    {
      id, cat: "sight", name, loc: "", dur: 30, note: "", lat: null, lon: null, coordSrc: null,
      priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {}, noteNames: {}
    },
    extra || {}
  );
}
function moveItem(id, name, extra) {
  return Object.assign(
    {
      id, cat: "move", name, loc: "", dur: 10, note: "", lat: null, lon: null, coordSrc: null,
      priv: false, notePriv: false, fixedStart: null, mode: "car", distKm: null, auto: false,
      approx: false, unresolved: false, arriveTz: "", names: {}, noteNames: {}
    },
    extra || {}
  );
}
function day(id, items, extra) {
  return Object.assign({ id, date: "2026-08-01", startTime: "09:00", tz: "", priv: false, dateManual: false, items }, extra || {});
}
function baseTrip(days, extra) {
  return Object.assign(
    { v: 1, title: "旅", titles: { ja: "旅" }, lang: "ja", days, packing: [], todos: [], packingPriv: false, todosPriv: false },
    extra || {}
  );
}

function makeFetchStub(callLog) {
  return function (url, opts) {
    var urlStr = String(url);
    if (urlStr.indexOf("nominatim.openstreetmap.org") !== -1) {
      callLog.push({ type: "osm", url: urlStr });
      return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
    }
    if (urlStr.indexOf("places.googleapis.com") !== -1) {
      callLog.push({ type: "places", url: urlStr, body: opts && opts.body });
      return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
    }
    if (urlStr.indexOf("translation.googleapis.com") !== -1) {
      var body = JSON.parse(opts.body);
      callLog.push({ type: "translate", url: urlStr, q: body.q, target: body.target });
      var translated = "[" + String(body.target).toUpperCase() + "]" + body.q;
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve({ data: { translations: [{ translatedText: translated }] } }); }
      });
    }
    callLog.push({ type: "other", url: urlStr });
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
  };
}

async function waitUntil(cond, timeoutMs, stepMs) {
  var waited = 0;
  stepMs = stepMs || 40;
  while (!cond() && waited < timeoutMs) {
    await new Promise(function (r) { setTimeout(r, stepMs); });
    waited += stepMs;
  }
  return cond();
}

(async () => {
  /* ================================================================ */
  section("Part 1. 純粋関数（internals）: noteNames の sanitize / merge");
  {
    const env = boot({});
    await tick();
    const internals = env.win.__tabiShioriCollabInternals;
    const sanitize = internals.sanitizeTripForPublic;
    const merge = internals.mergeRemoteEditIntoOwnerTrip;
    const normalize = internals.normalizeTrip;

    // notePriv:true の項目は note も noteNames も空にする
    const ownerTrip = normalize(
      baseTrip([
        day("d1", [
          sightItem("a", "浅草寺", { note: "雷門で写真", noteNames: { en: "Photo at Kaminarimon" } }),
          sightItem("b", "秘密の店", {
            priv: false,
            notePriv: true,
            note: "実は苦手な店",
            noteNames: { en: "A place I secretly dislike" }
          })
        ])
      ])
    );
    const sanitized = sanitize(ownerTrip);
    const secretItem = sanitized.days[0].items.find((it) => it.id === "b");
    const normalItem = sanitized.days[0].items.find((it) => it.id === "a");
    ok(secretItem.note === "", "notePriv項目: noteが空になる");
    ok(JSON.stringify(secretItem.noteNames) === "{}", "notePriv項目: noteNamesも空になる（翻訳文が漏れない）", secretItem.noteNames);
    ok(normalItem.note === "雷門で写真", "notePrivでない項目: noteは残る");
    ok(normalItem.noteNames.en === "Photo at Kaminarimon", "notePrivでない項目: noteNamesも残る");

    // マージ: notePriv項目は共同編集者からの空メモで上書きされず、noteNamesも復元される
    const received = normalize(sanitize(ownerTrip));
    received.title = "編集後";
    const merged = merge(ownerTrip, received);
    const mergedSecret = merged.days[0].items.find((it) => it.id === "b");
    ok(mergedSecret.notePriv === true, "マージ後もnotePrivが復元される");
    ok(mergedSecret.note === "実は苦手な店", "マージ後、オーナーの元メモが復元される");
    ok(
      mergedSecret.noteNames && mergedSecret.noteNames.en === "A place I secretly dislike",
      "マージ後、オーナーのnoteNamesも復元される（受信側の空で消えない）",
      mergedSecret.noteNames
    );

    // normalizeTrip は move にも names/noteNames を持たせる
    const withMove = normalize(baseTrip([day("d2", [moveItem("m1", "タクシー移動")])]));
    const mv = withMove.days[0].items[0];
    ok(typeof mv.names === "object" && mv.names !== null, "moveにもnamesが正規化される", mv.names);
    ok(typeof mv.noteNames === "object" && mv.noteNames !== null, "moveにもnoteNamesが正規化される", mv.noteNames);
  }

  /* ================================================================ */
  section("Part 2. CSVタイトル行: 新規インポートでタイトルが引き継がれる");
  {
    const env = boot({});
    await tick();
    const doc = env.doc;

    // 現在のタイトルを確認（サンプルは「東京旅行」）
    doc.getElementById("textioBtn").click();
    const exported = doc.getElementById("textioArea").value;
    const firstLine = exported.split(/\r?\n/)[0];
    ok(firstLine.indexOf("title,") === 0, "エクスポートしたCSVの1行目がtitle行", firstLine);
    ok(firstLine === "title,東京旅行", "1行目の値がtripDisplayTitle(trip)と一致", firstLine);

    // 別タイトルに書き換えたCSVをインポート
    const rewritten = exported.replace(/^title,.*/, "title,タイ家族旅行2026年");
    doc.getElementById("textioArea").value = rewritten;
    doc.getElementById("textioLoadBtn").click();
    let okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();

    let st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    let cur = st.trips.find((t) => t.id === st.currentId).data;
    ok(cur.title === "タイ家族旅行2026年", "CSVのtitle行でtitleが更新される", cur.title);
    ok(cur.titles.ja === "タイ家族旅行2026年", "現在言語(ja)のtitlesも更新される", cur.titles);
    ok(doc.getElementById("tripTitle").textContent === "タイ家族旅行2026年", "画面表示にも反映される");

    // 往復: 再エクスポートしても同じタイトル行になる
    doc.getElementById("textioBtn").click();
    const reExported = doc.getElementById("textioArea").value;
    ok(reExported.split(/\r?\n/)[0] === "title,タイ家族旅行2026年", "再エクスポートでも同じtitle行が出る");

    // 往復: そのまま再インポートしてもタイトルは変わらない
    doc.getElementById("textioArea").value = reExported;
    doc.getElementById("textioLoadBtn").click();
    okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();
    st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    cur = st.trips.find((t) => t.id === st.currentId).data;
    ok(cur.title === "タイ家族旅行2026年", "同じCSVを再インポートしてもタイトルは変わらない（冪等）");
  }

  /* ================================================================ */
  section("Part 3. CSVタイトル行: 後方互換（旧CSV・壊れた行）");
  {
    const env = boot({});
    await tick();
    const doc = env.doc;

    doc.getElementById("textioBtn").click();
    const exported = doc.getElementById("textioArea").value;
    const lines = exported.split(/\r?\n/);
    ok(lines[0].indexOf("title,") === 0, "前提: 1行目はtitle行");

    // 旧CSV: title行を取り除いたもの（day,date,...から始まる）
    const oldCsv = lines.slice(1).join("\r\n");
    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = oldCsv;
    doc.getElementById("textioLoadBtn").click();
    let okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();
    let st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    let cur = st.trips.find((t) => t.id === st.currentId).data;
    ok(cur.title === "東京旅行", "title行なしの旧CSVはタイトルを変更しない（既存タイトル維持）", cur.title);
    const itin = cur.days.reduce((a, d) => a + d.items.length, 0);
    ok(itin === 5, "title行なしの旧CSVも行程は正しく読める", itin);
    const errs = [...doc.querySelectorAll(".toast")].map((t) => t.textContent.trim()).filter((x) => x.includes("行目"));
    ok(errs.length === 0, "title行なしの旧CSVで警告が出ない", errs);

    // 壊れたtitle行: 値が空
    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = "title,\n" + oldCsv;
    doc.getElementById("textioLoadBtn").click();
    okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();
    st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    cur = st.trips.find((t) => t.id === st.currentId).data;
    ok(cur.title === "東京旅行", "title行の値が空でもクラッシュせずタイトル維持", cur.title);

    // 壊れたtitle行: フィールド数が2でない（3フィールド）
    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = "title,a,b\n" + oldCsv;
    doc.getElementById("textioLoadBtn").click();
    okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();
    const errs2 = [...doc.querySelectorAll(".toast")].map((t) => t.textContent.trim());
    ok(true, "title行が3フィールドでもクラッシュしない（トースト: " + JSON.stringify(errs2) + "）");
  }

  /* ================================================================ */
  section("Part 4. 実ファイル: 旧CSV（タイトル行なし）とタイトル行つき");
  {
    const env = boot({});
    await tick();
    const doc = env.doc;
    const realCsv = fs.readFileSync(REAL_CSV_PATH, "utf8").replace(/^﻿/, "");

    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = realCsv;
    doc.getElementById("textioLoadBtn").click();
    let okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();

    let st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    let cur = st.trips.find((t) => t.id === st.currentId).data;
    ok(cur.title === "東京旅行", "実ファイル(タイトル行なし)はタイトルを変更しない", cur.title);
    ok(cur.days.length === 6, "実ファイル: 6日");
    const itin = cur.days.reduce((a, d) => a + d.items.length, 0);
    ok(itin === 72, "実ファイル: 行程72件", itin);
    const errs = [...doc.querySelectorAll(".toast")].map((t) => t.textContent.trim()).filter((x) => x.includes("行目"));
    ok(errs.length === 0, "実ファイルで警告が出ない");

    // タイトル行つき版（「新規しおり相当」のシナリオ）: title行を先頭に足して読み込む
    const withTitle = "title,タイ家族旅行2026年\n" + realCsv;
    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = withTitle;
    doc.getElementById("textioLoadBtn").click();
    okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();
    st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    cur = st.trips.find((t) => t.id === st.currentId).data;
    ok(cur.title === "タイ家族旅行2026年", "実ファイル+title行: New Tripのままにならずタイトルが引き継がれる", cur.title);
    const itin2 = cur.days.reduce((a, d) => a + d.items.length, 0);
    ok(itin2 === 72, "実ファイル+title行でも行程は変わらず72件", itin2);
    ok(cur.days.length === 6, "実ファイル+title行でも6日のまま");

    // 実データの中の代表的な move の名前が保持されている（後段のPart 6でこれらの翻訳対象化を検証）
    const moveNames = cur.days[0].items.filter((it) => it.cat === "move").map((it) => it.name);
    ok(moveNames.indexOf("調布-成田空港第2ビル") !== -1, "実ファイルのmove「調布-成田空港第2ビル」が読み込まれている", moveNames);
    ok(moveNames.indexOf("タクシー移動") !== -1, "実ファイルのmove「タクシー移動」が読み込まれている", moveNames);
  }

  /* ================================================================ */
  section("Part 5. move/メモ翻訳: 現在日優先・逐次描画・メモ編集でnoteNames消去");
  {
    const csv = [
      "title,テスト旅行",
      "day,date,start,category,mode,name,minutes,note,gmap,tz,arriveTz,private,notePrivate,dayPrivate,fixedStart",
      "1,2026-07-24,09:00,観光,,浅草寺,90,雷門で写真,,,,0,0,0,",
      "1,2026-07-24,09:00,移動,車,浅草寺 → 上野公園,25,,,,,0,0,0,",
      "1,2026-07-24,09:00,観光,,上野公園,60,,,,,0,0,0,",
      "2,2026-07-25,09:00,移動,車,タクシー移動,30,,,,,0,0,0,"
    ].join("\n");

    const env = boot({ localStorage: { "tabi-gmaps-key": "test-key-xyz" } });
    await tick();
    const doc = env.doc;

    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = csv;
    doc.getElementById("textioLoadBtn").click();
    let okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();

    // Day2（タクシー移動のみ）を表示中の日として選択する
    const tabs = [...doc.querySelectorAll(".day-tab")];
    ok(tabs.length === 2, "テスト用CSVが2日分読み込まれている", tabs.length);
    tabs[1].click();
    await tick();

    const callLog = [];
    env.win.fetch = makeFetchStub(callLog);

    const langSel = doc.getElementById("langSelect");
    langSel.value = "en";
    langSel.dispatchEvent(new env.win.Event("change", { bubbles: true }));

    // 逐次描画の確認: 完了前の早いタイミングで、優先処理されるはずの「タクシー移動」だけ
    // 既に🌐ヒントが付いていて、最後に処理される「上野公園」はまだ、という状態を捉える
    function hintsFor(nameText) {
      const cards = [...doc.querySelectorAll(".item-card")];
      const card = cards.find((c) => {
        const inp = c.querySelector(".item-name");
        return inp && inp.value === nameText;
      });
      if (!card) return null;
      return [...card.querySelectorAll(".item-i18n-hint")].map((h) => h.textContent);
    }

    await new Promise((r) => setTimeout(r, 60));
    const earlyTaxi = hintsFor("タクシー移動");
    ok(earlyTaxi && earlyTaxi.length > 0, "逐次描画: 優先される day2「タクシー移動」が早い段階で既に🌐表示される", earlyTaxi);

    // day1の表示に戻す（sortは既にdispatch時点のcurrentDayIndexで確定済みなので、
    // 表示だけ切り替えても優先順位には影響しない）。day1側の逐次描画も確認する:
    // 「浅草寺」は2番目に処理される（早い）のに対し「上野公園」は最後（OSMレート制限待ちを2回挟む）
    doc.querySelectorAll(".day-tab")[0].click();
    await tick();
    const earlyAsakusa = hintsFor("浅草寺");
    const earlyUeno = hintsFor("上野公園");
    ok(
      earlyAsakusa && earlyAsakusa.length > 0 && (!earlyUeno || earlyUeno.length === 0),
      "逐次描画: 「浅草寺」は早期に🌐表示され、最後に処理される「上野公園」はまだ未表示",
      { earlyAsakusa, earlyUeno }
    );

    // 完了まで待つ（OSM呼び出しが2回あるため1.1秒レート制限×2ぶん含めて余裕を持って待つ）
    await waitUntil(() => callLog.filter((c) => c.type === "translate").length >= 5, 8000, 100);
    await new Promise((r) => setTimeout(r, 200));

    const translateQs = callLog.filter((c) => c.type === "translate").map((c) => c.q);
    ok(
      translateQs[0] === "タクシー移動",
      "現在日優先: day2の「タクシー移動」が最初に翻訳される（day1より前）",
      translateQs
    );
    ok(
      JSON.stringify(translateQs) === JSON.stringify(["タクシー移動", "浅草寺", "雷門で写真", "浅草寺 → 上野公園", "上野公園"]),
      "翻訳の処理順が期待どおり（day優先→各項目内は名前→メモ）",
      translateQs
    );

    const moveOsmOrPlaces = callLog.filter(
      (c) => (c.type === "osm" || c.type === "places") && (c.url + " " + JSON.stringify(c.body || "")).indexOf("タクシー") !== -1
    );
    ok(moveOsmOrPlaces.length === 0, "moveは OSM/Places を一切呼ばない（Translationのみ）", moveOsmOrPlaces);

    let st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    let cur = st.trips.find((t) => t.id === st.currentId).data;
    const asakusa = cur.days[0].items.find((it) => it.name === "浅草寺");
    const moveAU = cur.days[0].items.find((it) => it.name === "浅草寺 → 上野公園");
    const ueno = cur.days[0].items.find((it) => it.name === "上野公園");
    const taxi = cur.days[1].items.find((it) => it.name === "タクシー移動");
    ok(asakusa.names.en === "[EN]浅草寺", "浅草寺のnames.enが翻訳される", asakusa.names);
    ok(asakusa.noteNames.en === "[EN]雷門で写真", "浅草寺のnoteNames.enが翻訳される", asakusa.noteNames);
    ok(moveAU.names.en === "[EN]浅草寺 → 上野公園", "move自身のnames.enも翻訳される（表示には使われない場合でも）", moveAU.names);
    ok(taxi.names.en === "[EN]タクシー移動", "「タクシー移動」のnames.enが翻訳される（move対象化の確認）", taxi.names);

    // 表示: 前後スポットが揃うmoveは「A → B」の組み立てを優先する
    const moveHints = hintsFor("浅草寺 → 上野公園");
    ok(
      moveHints && moveHints.some((h) => h.indexOf("[EN]浅草寺") !== -1 && h.indexOf("[EN]上野公園") !== -1),
      "前後スポットが揃うmoveは組み立てた「A → B」を優先表示する",
      moveHints
    );
    // 表示: メモの🌐ヒント
    const asakusaHints = hintsFor("浅草寺");
    ok(
      asakusaHints && asakusaHints.some((h) => h === "🌐 [EN]雷門で写真"),
      "メモ欄の下に🌐翻訳ヒントが表示される",
      asakusaHints
    );

    // 表示: 前後が特定できないmove（day2の単独move）はnames[L]にフォールバックする
    // （day2タブに切り替えて確認し、確認後day1に戻す）
    doc.querySelectorAll(".day-tab")[1].click();
    await tick();
    const taxiHints = hintsFor("タクシー移動");
    ok(
      taxiHints && taxiHints.some((h) => h === "🌐 [EN]タクシー移動"),
      "前後スポットが無いmoveはnames[L]にフォールバック表示する",
      taxiHints
    );
    doc.querySelectorAll(".day-tab")[0].click();
    await tick();

    // メモを編集したらnoteNamesが全消去される
    const cards = [...doc.querySelectorAll(".item-card")];
    const asakusaCard = cards.find((c) => {
      const inp = c.querySelector(".item-name");
      return inp && inp.value === "浅草寺";
    });
    const noteTextarea = asakusaCard.querySelector(".item-note");
    noteTextarea.value = "雷門で別の写真";
    noteTextarea.dispatchEvent(new env.win.Event("change", { bubbles: true }));
    await tick();

    st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    cur = st.trips.find((t) => t.id === st.currentId).data;
    const asakusaAfterEdit = cur.days[0].items.find((it) => it.id === asakusa.id);
    ok(asakusaAfterEdit.note === "雷門で別の写真", "メモの編集内容自体は保存される");
    ok(JSON.stringify(asakusaAfterEdit.noteNames) === "{}", "メモを編集するとnoteNamesが全消去される", asakusaAfterEdit.noteNames);
    const hintsAfterEdit = hintsFor("浅草寺");
    ok(
      !hintsAfterEdit || !hintsAfterEdit.some((h) => h.indexOf("雷門で写真") !== -1),
      "メモ編集後、再描画で古いメモ翻訳ヒントが消える",
      hintsAfterEdit
    );
  }

  /* ================================================================ */
  section("Part 6. 実データ（day1抜粋）: move翻訳の実例確認");
  {
    const realCsv = fs.readFileSync(REAL_CSV_PATH, "utf8").replace(/^﻿/, "");
    const lines = realCsv.split(/\r?\n/).filter((l) => l.trim() !== "");
    const header = lines[0];
    const day1Lines = lines.filter((l, idx) => idx > 0 && l.split(",")[0] === "1");
    ok(day1Lines.length === 6, "実データDay1の抽出行数（前提確認）", day1Lines.length);
    const day1Csv = [header].concat(day1Lines).join("\n");

    const env = boot({ localStorage: { "tabi-gmaps-key": "test-key-xyz" } });
    await tick();
    const doc = env.doc;

    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = day1Csv;
    doc.getElementById("textioLoadBtn").click();
    let okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await tick();

    let st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    let cur = st.trips.find((t) => t.id === st.currentId).data;
    ok(cur.days.length === 1 && cur.days[0].items.length === 6, "実データDay1抜粋が6件で読み込まれている", cur.days[0].items.length);

    const callLog = [];
    env.win.fetch = makeFetchStub(callLog);
    const langSel = doc.getElementById("langSelect");
    langSel.value = "en";
    langSel.dispatchEvent(new env.win.Event("change", { bubbles: true }));

    // 期待される翻訳件数: 全6件が名前翻訳対象（インポート直後でnames未取得）+ メモがある4件
    // （調布-成田空港第2ビル/成田空港/成田空港T2→ドンムアン空港T1/ドンムアン空港）がメモ翻訳対象 = 10件。
    // saveState()はチェーン全体の完了後に1回だけ呼ばれるため、閾値ちょうどで判定を打ち切らず
    // 十分なバッファを取ってから localStorage を読む
    await waitUntil(() => callLog.filter((c) => c.type === "translate").length >= 10, 15000, 100);
    await new Promise((r) => setTimeout(r, 500));

    st = JSON.parse(env.win.localStorage.getItem("tabi-shiori-v2"));
    cur = st.trips.find((t) => t.id === st.currentId).data;
    const items = cur.days[0].items;
    const chofu = items.find((it) => it.name === "調布-成田空港第2ビル");
    const taxiMove = items.find((it) => it.name === "タクシー移動");
    const t2dmk = items.find((it) => it.name === "成田空港T2→ドンムアン空港T1");
    const narita = items.find((it) => it.name === "成田空港");
    const donMueang = items.find((it) => it.name === "ドンムアン空港");

    ok(chofu && chofu.names.en === "[EN]調布-成田空港第2ビル", "「調布-成田空港第2ビル」のnames.enが翻訳される（move対象化）", chofu && chofu.names);
    ok(taxiMove && taxiMove.names.en === "[EN]タクシー移動", "「タクシー移動」のnames.enが翻訳される（move対象化）", taxiMove && taxiMove.names);
    ok(t2dmk && t2dmk.names.en === "[EN]成田空港T2→ドンムアン空港T1", "「成田空港T2→ドンムアン空港T1」のnames.enが翻訳される", t2dmk && t2dmk.names);
    ok(
      narita && narita.noteNames.en && narita.noteNames.en.indexOf("[EN]") === 0,
      "「成田空港」のメモが翻訳される（noteNames.en）",
      narita && narita.noteNames
    );
    ok(
      donMueang && donMueang.noteNames.en && donMueang.noteNames.en.indexOf("[EN]") === 0,
      "「ドンムアン空港」のメモが翻訳される（noteNames.en）",
      donMueang && donMueang.noteNames
    );

    const moveQueryStrings = ["調布-成田空港第2ビル", "成田空港T2→ドンムアン空港T1", "タクシー移動"];
    function osmQueryOf(url) {
      const m = /[?&]q=([^&]*)/.exec(url);
      return m ? decodeURIComponent(m[1]) : null;
    }
    const leakedOsmOrPlaces = callLog.filter((c) => {
      if (c.type === "osm") {
        return moveQueryStrings.indexOf(osmQueryOf(c.url)) !== -1;
      }
      if (c.type === "places") {
        var body = {};
        try { body = JSON.parse(c.body || "{}"); } catch (e) {}
        return moveQueryStrings.indexOf(body.textQuery) !== -1;
      }
      return false;
    });
    ok(leakedOsmOrPlaces.length === 0, "実データのmove名がOSM/Placesへ渡っていない（Translationのみで処理）", leakedOsmOrPlaces);

    // 前後スポットが特定できないmove（Day1先頭の move。直前に項目が無い）はA→B組み立てができず
    // names[L]へフォールバック表示する
    const cards = [...doc.querySelectorAll(".item-card")];
    const chofuCard = cards.find((c) => {
      const inp = c.querySelector(".item-name");
      return inp && inp.value === "調布-成田空港第2ビル";
    });
    const chofuHints = chofuCard ? [...chofuCard.querySelectorAll(".item-i18n-hint")].map((h) => h.textContent) : null;
    ok(
      chofuHints && chofuHints.some((h) => h === "🌐 [EN]調布-成田空港第2ビル"),
      "先頭moveは前後スポットが揃わずnames[L]にフォールバック表示される",
      chofuHints
    );
  }

  const r = results();
  console.log("\n==== 合計: PASS=" + r.pass + " FAIL=" + r.fail + " ====");
  if (r.fail > 0) process.exitCode = 1;
})().catch((e) => {
  console.log("ERR", e.stack);
  process.exitCode = 1;
});
