const { boot } = require("./harness");
(async () => {
  const { win } = await boot();
  const doc = win.document;
  const H = "day,date,start,category,mode,name,minutes,note,gmap,tz,arriveTz,private,notePrivate,dayPrivate,fixedStart";
  const R = "1,2026-07-20,09:00,観光,,浅草寺,90,メモ,,,,0,0,0,";
  const LH = "list,text,done,private,listPrivate";
  const L1 = "持ち物,パスポート,0,0,0";

  const cases = {
    "A: title行が2フィールド（アプリ出力そのまま）": ["title,テスト旅行", H, R, "", LH, L1].join("\n"),
    "B: title行がカンマ埋め（Excel保存・今回の実ファイル）": ["title,テスト旅行,,,,,,,,,,,,,", H, R, ",,,,,,,,,,,,,,", LH + ",,,,,,,,,,", L1 + ",,,,,,,,,,"].join("\n"),
    "C: 旧CSV（title行なし）": [H, R, "", LH, L1].join("\n"),
    "D: title行の値が空": ["title,,,,,,,,,,,,,,", H, R, "", LH, L1].join("\n"),
    "E: titleという名前のスポットがある紛らわしい旧CSV": [H, "1,2026-07-20,09:00,観光,,title,90,,,,,0,0,0,", "", LH, L1].join("\n"),
  };

  let pass = 0, fail = 0;
  for (const [name, csv] of Object.entries(cases)) {
    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = csv;
    doc.getElementById("textioLoadBtn").click();
    const ok = doc.getElementById("confirmOkBtn");
    if (ok && !doc.getElementById("confirmModal").classList.contains("hidden")) ok.click();
    await new Promise(r => setTimeout(r, 150));
    const errs = [...doc.querySelectorAll(".toast")].map(t => t.textContent.trim()).filter(x => x.includes("行目"));
    const st = JSON.parse(win.localStorage.getItem("tabi-shiori-v2"));
    const cur = st.trips.find(t => t.id === st.currentId).data;
    const title = doc.getElementById("tripTitle").textContent;
    const items = cur.days.reduce((a,d)=>a+d.items.length,0);
    const expectTitle = (name[0] === "A" || name[0] === "B") ? "テスト旅行" : null;
    const good = errs.length === 0 && items === 1 && cur.packing.length === 1 && (!expectTitle || title === expectTitle);
    console.log((good ? "OK  " : "NG  ") + name);
    if (!good) console.log("      err:", JSON.stringify(errs), "title:", title, "items:", items, "packing:", cur.packing.length);
    good ? pass++ : fail++;
  }
  console.log("\n==== PASS: " + pass + "  FAIL: " + fail + " ====");
  process.exitCode = fail > 0 ? 1 : 0;
})().catch(e => { console.log("ERR", e.stack); process.exitCode = 1; });
