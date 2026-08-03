const { boot } = require("./harness");

(async () => {
  const { win } = await boot();
  const doc = win.document;

  // UI経由でリストに項目を追加（アプリの正規ルート）
  const addTo = (inputId, btnSel, text) => {
    const inp = doc.getElementById(inputId);
    inp.value = text;
    inp.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };
  addTo("packingAddInput", null, "パスポート");
  addTo("packingAddInput", null, "充電器");
  addTo("todosAddInput", null, "オンラインチェックイン");
  await new Promise(r => setTimeout(r, 100));
  console.log("仕込み: 持ち物", doc.querySelectorAll("#packingItems .checklist-item").length, "件 / やること", doc.querySelectorAll("#todosItems .checklist-item").length, "件\n");

  doc.getElementById("textioBtn").click();
  const base = doc.getElementById("textioArea").value;
  const all = base.split("\n");
  const blankPos = all.findIndex(l => l.trim() === "");
  const main = all.slice(0, blankPos);
  const list = all.slice(blankPos + 1).filter(l => l.trim() !== "");
  const nCols = main[0].split(",").length;
  const newRow = "1,2026-07-20,09:00,観光,,東京タワー,60,手書き追記,,,,0,0,0,";

  const variants = {
    "A: 出力そのまま（対照）":            base,
    "B: 空行がカンマ埋め（Excel保存）":   [...main, ",".repeat(nCols-1), ...list].join("\n"),
    "C: 空行に空白混入（手書き）":        [...main, "   ", ...list].join("\n"),
    "D: 空行なしで詰めた":                [...main, ...list].join("\n"),
    "E: 行程を手書き追記＋空行":          [...main, newRow, "", ...list].join("\n"),
    "F: 行程を手書き追記＋カンマ埋め空行": [...main, newRow, ",".repeat(nCols-1), ...list].join("\n"),
    "G: CRLF改行で追記":                  [...main, newRow, "", ...list].join("\r\n"),
    "H: 旧CSV（リストのテーブル自体なし）": main.join("\n"),
  };

  let pass = 0, fail = 0;
  for (const [name, csv] of Object.entries(variants)) {
    doc.getElementById("textioBtn").click();
    doc.getElementById("textioArea").value = csv;
    doc.getElementById("textioLoadBtn").click();
    const okBtn = doc.getElementById("confirmOkBtn");
    if (okBtn && !doc.getElementById("confirmModal").classList.contains("hidden")) okBtn.click();
    await new Promise(r => setTimeout(r, 120));

    const errs = [...doc.querySelectorAll(".toast")].map(t => t.textContent.trim()).filter(x => x.includes("行目"));
    const st = JSON.parse(win.localStorage.getItem("tabi-shiori-v2"));
    const cur = st.trips.find(t => t.id === st.currentId).data;
    const p = cur.packing.map(x => x.text), td = cur.todos.map(x => x.text);
    const expectItin = name.includes("追記") ? 6 : 5;
    const itin = cur.days.reduce((a,d)=>a+d.items.length,0);
    const good = errs.length === 0 && p.length === 2 && td.length === 1 && itin === expectItin;
    console.log((good ? "OK  " : "NG  ") + name);
    if (!good) console.log("      err:", JSON.stringify(errs), "持ち物:", JSON.stringify(p), "やること:", JSON.stringify(td), "行程:", itin, "(期待", expectItin + ")");
    good ? pass++ : fail++;
  }
  console.log("\n==== PASS: " + pass + "  FAIL: " + fail + " ====");
  process.exitCode = fail > 0 ? 1 : 0;
})().catch(e => { console.log("ERR", e.stack); process.exitCode = 1; });
