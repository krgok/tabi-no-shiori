#!/usr/bin/env node
/**
 * tests/ 配下の全テストファイルを順に実行し、1つでも失敗したら非0の exit code で終了するランナー。
 * 各テストファイルは個別の Node プロセスとして実行するため、あるテストの状態（require キャッシュや
 * グローバル汚染）が他のテストへ漏れることがない。
 */
const path = require("path");
const { spawnSync } = require("child_process");

const TEST_FILES = [
  "test-public.js",
  "test-collab.js",
  "test-css-xss.js",
  "test-fixed-start.js",
  "test-new-features.js",
  "test-fix3-verify.js",
  "csvfix-test.js",
  "titlerow-variants.js",
  "no-key-notice-test.js",
  "print-i18n-test.js",
  "test-prep-viewonly.js",
  "test-safety.js",
  "test-phase3.js",
  "test-pwa.js",
  "privtest.js",
  "test-copy-fixedstart.js",
  "test-actual.js"
];

let overallFail = false;
const summary = [];

for (const file of TEST_FILES) {
  const full = path.join(__dirname, file);
  console.log("\n\n########## " + file + " ##########\n");
  const result = spawnSync(process.execPath, [full], {
    stdio: "inherit",
    cwd: __dirname,
    env: process.env
  });
  const failed = result.status !== 0 || result.error;
  if (failed) overallFail = true;
  summary.push({ file, status: result.error ? "ERROR" : result.status });
}

console.log("\n\n================ サマリー ================");
for (const s of summary) {
  const okLabel = s.status === 0;
  console.log((okLabel ? "  OK  " : "  NG  ") + s.file + " (exit=" + s.status + ")");
}
console.log("==========================================");

process.exitCode = overallFail ? 1 : 0;
