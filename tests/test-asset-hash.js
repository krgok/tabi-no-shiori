#!/usr/bin/env node
/**
 * CACHE_VERSION / APP_VERSION の「両方とも上げ忘れ」を検知するテスト。
 *
 * tests/test-pwa.js は「APP_VERSION と CACHE_VERSION が一致しているか」しか見ないため、
 * JS/CSS 等のアセットを変更したのに版数を1つも上げなかった場合（＝2つとも一致したまま
 * 上げ忘れる）を検知できない。このテストは sw.js の PRECACHE_URLS 対象ファイル（HTML除く）の
 * 内容ハッシュを tests/asset-hash.json に記録しておき、
 *   - CACHE_VERSION が変わっていないのに中身が変わっていたら FAIL（上げ忘れ）
 *   - CACHE_VERSION を上げた（またはローカルで作業中）ならスナップショットを更新して合格
 * という形で運用する。
 *
 * 判定ロジックは purely functional な evaluate() に分離してあり、
 * tests/test-asset-hash-logic.js から実ファイルに触れずに全分岐を検証できる。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_PATH = path.join(__dirname, "asset-hash.json");

/* =========================================================
 * 純関数群（tests/test-asset-hash-logic.js からも require される）
 * ========================================================= */

// sw.js の PRECACHE_URLS からハッシュ対象ファイルを取り出す（"./" と "./index.html" は除く。
// HTML はネットワーク優先配信のため版上げ不要）
function getPrecacheFiles(sw) {
  const block = /var PRECACHE_URLS = \[([\s\S]*?)\];/.exec(sw);
  if (!block) return [];
  return block[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s && !s.startsWith("//"))
    .filter((s) => s !== "./" && s !== "./index.html");
}

function getCurrentVersion(sw) {
  const m = /var CACHE_VERSION = "([^"]+)"/.exec(sw);
  return m ? m[1] : null;
}

function sha256(data) {
  // data が Buffer ならそのまま、文字列なら utf8 としてハッシュする
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"))
    .digest("hex");
}

// テキストとして改行正規化しても安全な拡張子（PNG 等のバイナリはここに含めない）
const TEXT_ASSET_EXTENSIONS = [".js", ".css", ".json", ".webmanifest", ".svg", ".html", ".txt"];

function isTextAsset(filePath) {
  return TEXT_ASSET_EXTENSIONS.indexOf(path.extname(filePath).toLowerCase()) !== -1;
}

// 改行コードの違いで揺れないよう \r\n を \n に正規化してから読む（テキストファイル専用）
function readNormalized(absPath) {
  return fs.readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
}

// テキストファイルは改行正規化した文字列、それ以外（png 等のバイナリ）は
// Buffer をそのまま返す（utf8 文字列化すると非可逆に壊れるため）
function readAssetForHash(absPath) {
  return isTextAsset(absPath) ? readNormalized(absPath) : fs.readFileSync(absPath);
}

// 各ファイルの sha256 と、全体を結合したハッシュを計算する
function computeSnapshot(root, files) {
  const fileHashes = {};
  files.forEach((f) => {
    fileHashes[f] = sha256(readAssetForHash(path.join(root, f)));
  });
  // ファイル一覧順（= sw.js に書かれた順）で連結してから全体ハッシュを取る
  const combined = files.map((f) => f + ":" + fileHashes[f]).join("|");
  return { hash: sha256(combined), files: fileHashes };
}

// git diff HEAD -- sw.js の追加行に CACHE_VERSION が含まれるか（= ローカルで版上げ作業中）
function getBumpInProgress(root) {
  let diff = "";
  try {
    diff = execSync("git diff HEAD -- sw.js", { cwd: root, encoding: "utf8" });
  } catch (e) {
    diff = "";
  }
  return diff
    .split("\n")
    .some((line) => line.startsWith("+") && !line.startsWith("+++") && /CACHE_VERSION/.test(line));
}

// スナップショットの files と、今計算した files を比較して差分のあるキーを返す
function diffFiles(oldFiles, newFiles) {
  oldFiles = oldFiles || {};
  newFiles = newFiles || {};
  const keys = new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)]);
  const changed = [];
  keys.forEach((k) => {
    if (oldFiles[k] !== newFiles[k]) changed.push(k);
  });
  changed.sort();
  return changed;
}

function buildMismatchMessage(changedFiles) {
  return (
    "CACHE_VERSION を上げないままアセットの中身が変わっています。変更されたファイル: " +
    (changedFiles.length ? changedFiles.join(", ") : "(不明)") +
    " / sw.js の CACHE_VERSION と js/00-core.js の APP_VERSION を次の版に上げてから npm test を再実行してください。"
  );
}

/**
 * 判定の中核。副作用（ファイル読み書き・git実行）を一切行わない純関数。
 * @param {object} p
 * @param {string} p.currentVersion  sw.js の現在の CACHE_VERSION
 * @param {object|null} p.snapshot   tests/asset-hash.json の内容（無ければ null）
 * @param {object} p.computed        computeSnapshot() の戻り値 { hash, files }
 * @param {boolean} p.bumpInProgress git diff 上で CACHE_VERSION が追加行に含まれるか
 * @param {boolean} p.isCI           CI環境かどうか
 * @returns {{ok: boolean, action: string, message: string}}
 */
function evaluate({ currentVersion, snapshot, computed, bumpInProgress, isCI }) {
  if (!snapshot) {
    if (isCI) {
      return {
        ok: false,
        action: "no-snapshot-fail",
        message:
          "tests/asset-hash.json がありません。ローカルで npm test を実行して tests/asset-hash.json をコミットしてください。"
      };
    }
    return {
      ok: true,
      action: "create",
      message: "tests/asset-hash.json を作成しました。コミットに含めてください。"
    };
  }

  if (currentVersion !== snapshot.cacheVersion) {
    if (isCI) {
      return {
        ok: false,
        action: "version-changed-fail",
        message:
          "tests/asset-hash.json のスナップショットが古いです（記録: " +
          snapshot.cacheVersion +
          " / 現在: " +
          currentVersion +
          "）。ローカルで npm test を実行してコミットしてください。"
      };
    }
    return {
      ok: true,
      action: "update",
      message: "tests/asset-hash.json を更新しました。コミットに含めてください。"
    };
  }

  if (computed.hash === snapshot.hash) {
    return { ok: true, action: "match", message: "スナップショットと一致しています。" };
  }

  // CACHE_VERSION は変わっていないのに中身のハッシュが変わっている
  if (bumpInProgress) {
    // ローカルで版を上げる作業中（コミット前にさらに編集した等）とみなし、
    // スナップショットを書き直して合格させる
    return {
      ok: true,
      action: "update",
      message: "tests/asset-hash.json を更新しました。コミットに含めてください。"
    };
  }

  return {
    ok: false,
    action: "content-changed-fail",
    message: buildMismatchMessage(diffFiles(snapshot.files, computed.files))
  };
}

/* =========================================================
 * ここから実行部分（require されたときは走らない）
 * ========================================================= */
if (require.main === module) {
  let pass = 0;
  let fail = 0;
  function ok(cond, label, detail) {
    if (cond) {
      pass++;
      console.log("  PASS  " + label);
    } else {
      fail++;
      console.log("  FAIL  " + label);
      if (detail !== undefined) console.log("          -> " + detail);
    }
  }
  function section(title) {
    console.log("\n=== " + title + " ===");
  }

  section("1. sw.js から CACHE_VERSION とハッシュ対象ファイル一覧を読む");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const currentVersion = getCurrentVersion(sw);
  const files = getPrecacheFiles(sw);
  ok(!!currentVersion, "CACHE_VERSION を読めた", currentVersion);
  ok(files.length > 0, "ハッシュ対象ファイルを読めた（" + files.length + "件）");
  ok(files.indexOf("./") === -1 && files.indexOf("./index.html") === -1, "HTML はハッシュ対象から除外されている");

  section("2. アセットのハッシュを計算する");
  const computed = computeSnapshot(ROOT, files);
  ok(!!computed.hash, "全体ハッシュを計算できた", computed.hash);

  section("3. スナップショット（tests/asset-hash.json）と比較する");
  let snapshot = null;
  if (fs.existsSync(SNAPSHOT_PATH)) {
    snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  }
  const isCI = !!process.env.CI;
  const bumpInProgress = getBumpInProgress(ROOT);
  const result = evaluate({ currentVersion, snapshot, computed, bumpInProgress, isCI });

  if (result.action === "create" || result.action === "update") {
    fs.writeFileSync(
      SNAPSHOT_PATH,
      JSON.stringify({ cacheVersion: currentVersion, hash: computed.hash, files: computed.files }, null, 2) + "\n"
    );
    console.log(result.message);
  }

  ok(result.ok, result.action + (result.ok ? "" : ": " + result.message));
  if (!result.ok) console.log("          -> " + result.message);

  console.log("\n================================");
  console.log("PASS: " + pass + "   FAIL: " + fail);
  console.log("================================");
  process.exitCode = fail > 0 ? 1 : 0;
}

module.exports = {
  getPrecacheFiles,
  getCurrentVersion,
  sha256,
  isTextAsset,
  readNormalized,
  readAssetForHash,
  computeSnapshot,
  getBumpInProgress,
  diffFiles,
  buildMismatchMessage,
  evaluate
};
