#!/usr/bin/env node
/**
 * tests/test-asset-hash.js の判定ロジック（evaluate、純関数）を、
 * 実ファイル（sw.js / js/* など）に一切触れずに検証する。
 * evaluate() はファイル読み書き・git実行を行わないので、入力を作り込んで分岐を網羅できる。
 */
const { evaluate, diffFiles, buildMismatchMessage } = require("./test-asset-hash.js");

let pass = 0;
let fail = 0;
function ok(cond, label, detail) {
  if (cond) {
    pass++;
    console.log("  PASS  " + label);
  } else {
    fail++;
    console.log("  FAIL  " + label);
    if (detail !== undefined) console.log("          -> " + JSON.stringify(detail));
  }
}
function section(title) {
  console.log("\n=== " + title + " ===");
}

const computedSample = { hash: "HASH_A", files: { "./js/00-core.js": "aaa", "./js/40-ui.js": "bbb" } };

section("分岐3: スナップショットが無い");
{
  const local = evaluate({
    currentVersion: "v9",
    snapshot: null,
    computed: computedSample,
    bumpInProgress: false,
    isCI: false
  });
  ok(local.ok === true, "ローカルでスナップショット無し -> 合格（新規作成）", local);
  ok(local.action === "create", "action が create", local.action);

  const ci = evaluate({
    currentVersion: "v9",
    snapshot: null,
    computed: computedSample,
    bumpInProgress: false,
    isCI: true
  });
  ok(ci.ok === false, "CIでスナップショット無し -> 失敗", ci);
  ok(/npm test/.test(ci.message) && /コミット/.test(ci.message), "失敗メッセージに対処法が書かれている", ci.message);
}

section("分岐4: CACHE_VERSION がスナップショットと異なる");
{
  const snapshot = { cacheVersion: "v8", hash: "OLD_HASH", files: {} };

  const local = evaluate({
    currentVersion: "v9",
    snapshot,
    computed: computedSample,
    bumpInProgress: false,
    isCI: false
  });
  ok(local.ok === true, "ローカルで版数が変わった -> 合格（更新）", local);
  ok(local.action === "update", "action が update", local.action);

  const ci = evaluate({
    currentVersion: "v9",
    snapshot,
    computed: computedSample,
    bumpInProgress: false,
    isCI: true
  });
  ok(ci.ok === false, "CIで版数が変わった -> 失敗（スナップショット未更新のままpush）", ci);
}

section("分岐5: 版数一致・ハッシュも一致");
{
  const snapshot = { cacheVersion: "v9", hash: "HASH_A", files: computedSample.files };
  const r = evaluate({
    currentVersion: "v9",
    snapshot,
    computed: computedSample,
    bumpInProgress: false,
    isCI: true
  });
  ok(r.ok === true, "版数・ハッシュとも一致 -> 合格（CIでも）", r);
  ok(r.action === "match", "action が match", r.action);
}

section("分岐6a: 版数一致・ハッシュ不一致・bumpInProgress（ローカルで版上げ後さらに編集）");
{
  const snapshot = { cacheVersion: "v9", hash: "OLD_HASH_DIFFERENT", files: { "./js/00-core.js": "old" } };
  const r = evaluate({
    currentVersion: "v9",
    snapshot,
    computed: computedSample,
    bumpInProgress: true,
    isCI: false
  });
  ok(r.ok === true, "bumpInProgress -> 合格（更新して通す）", r);
  ok(r.action === "update", "action が update", r.action);

  // bumpInProgress は CI でも通す設計（版上げのコミット後、CIチェックアウト時点では
  // git diff HEAD が空になるため通常CIでは発生しないが、念のため関数としての挙動を確認）
  const rCi = evaluate({
    currentVersion: "v9",
    snapshot,
    computed: computedSample,
    bumpInProgress: true,
    isCI: true
  });
  ok(rCi.ok === true, "bumpInProgress は isCI に関わらず合格", rCi);
}

section("分岐6b: 版数一致・ハッシュ不一致・bumpInProgressでない（上げ忘れ本命ケース）");
{
  const oldFiles = { "./js/00-core.js": "aaa", "./js/40-ui.js": "OLD_bbb" };
  const snapshot = { cacheVersion: "v9", hash: "OLD_HASH_DIFFERENT", files: oldFiles };
  const r = evaluate({
    currentVersion: "v9",
    snapshot,
    computed: computedSample,
    bumpInProgress: false,
    isCI: false
  });
  ok(r.ok === false, "版数を上げ忘れたまま中身が変わった -> 失敗（ローカルでも）", r);
  ok(r.action === "content-changed-fail", "action が content-changed-fail", r.action);
  ok(/js\/40-ui\.js/.test(r.message), "失敗メッセージに変更ファイル名が含まれる", r.message);
  ok(/CACHE_VERSION/.test(r.message) && /APP_VERSION/.test(r.message), "失敗メッセージに対処法（版数を上げる）が書かれている", r.message);

  const rCi = evaluate({
    currentVersion: "v9",
    snapshot,
    computed: computedSample,
    bumpInProgress: false,
    isCI: true
  });
  ok(rCi.ok === false, "CIでも同様に失敗", rCi);
}

section("補助関数: diffFiles");
{
  const a = { x: "1", y: "2" };
  const b = { x: "1", y: "3", z: "4" };
  const d = diffFiles(a, b);
  ok(d.indexOf("y") !== -1, "変更されたキーを検出する", d);
  ok(d.indexOf("z") !== -1, "追加されたキーを検出する", d);
  ok(d.indexOf("x") === -1, "変わっていないキーは含めない", d);
}

section("補助関数: buildMismatchMessage");
{
  ok(/js\/foo\.js/.test(buildMismatchMessage(["js/foo.js"])), "ファイル名が含まれる");
  ok(/不明/.test(buildMismatchMessage([])), "空配列でも壊れない");
}

console.log("\n================================");
console.log("PASS: " + pass + "   FAIL: " + fail);
console.log("================================");
process.exitCode = fail > 0 ? 1 : 0;
