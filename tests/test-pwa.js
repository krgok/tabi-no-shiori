/**
 * PWA（オフライン対応）の検証
 * ブラウザの Service Worker 実行そのものは jsdom で再現できないため、
 * 「オフラインで壊れる原因になる不整合」を静的に検査する:
 *  - index.html が読み込む同一オリジンの資産が、すべて sw.js のプリキャッシュ対象に入っているか
 *    （1つでも漏れるとオフライン起動が失敗する）
 *  - プリキャッシュに書かれたファイルが実在するか（存在しないURLはキャッシュ登録に失敗する）
 *  - manifest の必須項目とアイコンの実在
 *  - 外部リソースをキャッシュしない方針が保たれているか
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
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

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));

// sw.js のプリキャッシュ配列を取り出す
const precacheBlock = /var PRECACHE_URLS = \[([\s\S]*?)\];/.exec(sw);
const precache = precacheBlock
  ? precacheBlock[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s && !s.startsWith("//"))
      .map((s) => s.replace(/^\.\//, ""))
  : [];

section("1. index.html の資産がすべてプリキャッシュされている");
{
  ok(precache.length > 0, "sw.js からプリキャッシュ一覧を読める", precache.length);

  const refs = [];
  const reScript = /<script[^>]+src="([^"]+)"/g;
  const reLink = /<link[^>]+href="([^"]+)"/g;
  let m;
  while ((m = reScript.exec(html))) refs.push(m[1]);
  while ((m = reLink.exec(html))) refs.push(m[1]);

  const localRefs = refs.filter((r) => !/^https?:\/\//.test(r));
  ok(localRefs.length >= 6, "index.html がローカル資産を読み込んでいる", localRefs.length);

  localRefs.forEach((ref) => {
    const clean = ref.replace(/^\.\//, "").split("?")[0];
    ok(precache.indexOf(clean) !== -1, "プリキャッシュに含まれる: " + clean, precache);
  });
}

section("2. プリキャッシュ対象のファイルが実在する");
{
  precache.forEach((url) => {
    if (url === "" || url === "./") return; // ルート自体はファイルではない
    const p = path.join(ROOT, url);
    ok(fs.existsSync(p), "実在する: " + url);
  });
}

section("3. Leaflet の画像（地図ピン）もオフラインで出る");
{
  const imgs = ["vendor/leaflet/images/marker-icon.png", "vendor/leaflet/images/marker-shadow.png"];
  imgs.forEach((i) => ok(precache.indexOf(i) !== -1, "プリキャッシュに含まれる: " + i));
}

section("4. 外部リソースはキャッシュしない方針が保たれている");
{
  ok(
    /url\.origin !== self\.location\.origin/.test(sw),
    "同一オリジン以外はキャッシュ処理を通さない（古い地図やAPI応答を握らない）"
  );
  ok(!/tile\.openstreetmap|googleapis|gstatic/.test(precache.join(" ")), "外部URLをプリキャッシュしていない");
}

section("5. キャッシュのバージョン管理");
{
  ok(/var CACHE_VERSION = "/.test(sw), "CACHE_VERSION が定義されている");
  ok(/caches\.delete\(/.test(sw), "古いキャッシュを削除する処理がある（更新が届かなくなるのを防ぐ）");
  ok(/skipWaiting\(\)/.test(sw), "skipWaiting で新版がすぐ有効になる");
}

section("6. manifest の内容とアイコン");
{
  ok(manifest.name === "旅のしおり", "name", manifest.name);
  ok(manifest.start_url === "./", "start_url が相対（GitHub Pages のサブパスで動く）", manifest.start_url);
  ok(manifest.scope === "./", "scope が相対", manifest.scope);
  ok(manifest.display === "standalone", "display: standalone（ホーム画面から単体アプリとして開く）");
  ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3, "アイコンが複数定義されている", manifest.icons && manifest.icons.length);
  (manifest.icons || []).forEach((ic) => {
    ok(fs.existsSync(path.join(ROOT, ic.src)), "アイコンが実在する: " + ic.src);
  });
  ok(
    (manifest.icons || []).some((ic) => ic.purpose === "maskable"),
    "maskable アイコンがある（Androidでアイコンが欠けない）"
  );
  ok(/rel="manifest"/.test(html), "index.html から manifest を読み込んでいる");
  ok(/name="theme-color"/.test(html), "theme-color がある");
  ok(/rel="apple-touch-icon"/.test(html), "iOS 用のアイコン指定がある");
}

section("7. Service Worker の登録");
{
  // Service Worker の登録は分割後 js/90-main.js にある
  const app = fs.readFileSync(path.join(ROOT, "js", "90-main.js"), "utf8");
  ok(/navigator\.serviceWorker[\s\S]{0,80}\.register\("sw\.js"\)/.test(app), "アプリが sw.js を登録する");
  ok(/serviceWorker" in navigator/.test(app), "非対応ブラウザを判定している");
  ok(/location\.protocol !== "http:"/.test(app), "file:// で開いた場合は登録しない（例外を避ける）");
  ok(/pwa\.updated/.test(app), "新しい版が来たら通知する");
}

console.log("\n================================");
console.log("PASS: " + pass + "   FAIL: " + fail);
console.log("================================");
process.exitCode = fail > 0 ? 1 : 0;
