/**
 * 「旅のしおり」公開層（16）検証ハーネス
 * 実物の index.html / i18n.js / app.js を jsdom で読み込み、Firestore をスタブして挙動を確認する。
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP_DIR = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(APP_DIR, f), "utf8");

// ---- Firestore スタブ -------------------------------------------------
// 編集できる共有リンク（18）検証のため、set/delete/add が docsById を実際に変更し、
// onSnapshot 購読者へ通知するようにした（従来は calls への記録のみで状態を持たなかった）。
// 既存テスト（16など）は calls 配列と get() の戻り値だけを見ているため後方互換。
function makeFirebaseStub(opts) {
  opts = opts || {};
  const calls = [];
  const autoIds = opts.autoIds || ["AUTOPUB1", "AUTOPUB2", "AUTOPUB3"];
  let autoIdx = 0;
  // id だけをキーにしたミュータブルな状態ストア。既存テストはcollを跨いでidを衝突させない前提で
  // 作られているため（例: publicId="PUB123" のように衝突しない命名）、その前提を踏襲する
  const docsById = Object.assign({}, opts.docs || {});
  const listenersById = {}; // id -> [{ onNext, onError }]
  let authCb = null;

  function notify(id) {
    const d = docsById[id];
    const arr = listenersById[id] || [];
    arr.slice().forEach((l) => {
      try {
        l.onNext({ exists: !!d, data: () => d, id });
      } catch (e) {
        /* ignore */
      }
    });
  }

  function collection(name) {
    return {
      _name: name,
      doc(id) {
        return {
          set(payload, opt) {
            calls.push({ op: "set", coll: name, id, payload, opt });
            if (opt && opt.merge) {
              docsById[id] = Object.assign({}, docsById[id] || {}, payload);
            } else {
              docsById[id] = Object.assign({}, payload);
            }
            const ms = (opts.setLatency || {})[name] || 0;
            if (ms) {
              return new Promise((r) => setTimeout(() => { notify(id); r(); }, ms));
            }
            notify(id);
            return Promise.resolve();
          },
          delete() {
            calls.push({ op: "delete", coll: name, id });
            delete docsById[id];
            notify(id);
            return Promise.resolve();
          },
          get() {
            calls.push({ op: "get", coll: name, id });
            const d = docsById[id];
            return Promise.resolve({ exists: !!d, data: () => d });
          },
          // 編集できる共有リンク（18）: onSnapshot(onNext, onError) → unsubscribe関数 を返す。
          // 実際のFirestoreと同様、購読直後に現在の状態で1回非同期にコールバックする
          onSnapshot(onNext, onError) {
            calls.push({ op: "onSnapshot:subscribe", coll: name, id });
            listenersById[id] = listenersById[id] || [];
            const entry = { onNext, onError };
            listenersById[id].push(entry);
            const d = docsById[id];
            setTimeout(() => onNext({ exists: !!d, data: () => d, id }), 0);
            return function unsubscribe() {
              calls.push({ op: "onSnapshot:unsubscribe", coll: name, id });
              const arr = listenersById[id];
              if (!arr) return;
              const idx = arr.indexOf(entry);
              if (idx !== -1) arr.splice(idx, 1);
            };
          }
        };
      },
      add(payload) {
        const id = autoIds[autoIdx++] || "AUTO" + autoIdx;
        calls.push({ op: "add", coll: name, id, payload });
        docsById[id] = Object.assign({}, payload);
        // opts.addLatency[collection] で解決を遅らせ、レース条件を再現できるようにする
        const ms = (opts.addLatency || {})[name] || 0;
        if (ms) {
          return new Promise((r) => setTimeout(() => { notify(id); r({ id }); }, ms));
        }
        notify(id);
        return Promise.resolve({ id });
      },
      where() {
        return {
          get() {
            calls.push({ op: "query", coll: name });
            return Promise.resolve({ forEach: () => {} });
          }
        };
      }
    };
  }

  const firebase = {
    initializeApp() {},
    auth: Object.assign(
      () => ({
        onAuthStateChanged(cb) {
          authCb = cb;
        },
        signInWithPopup: () => Promise.resolve(),
        signOut: () => Promise.resolve()
      }),
      { GoogleAuthProvider: function () {} }
    ),
    firestore: () => ({ collection })
  };
  return {
    firebase,
    calls,
    login: (u) => authCb && authCb(u),
    autoIdsLeft: () => autoIdx,
    docsById,
    // テストヘルパー: 「別セッション（他の共同編集者やオーナー）からの書き込み/削除」をシミュレートする。
    // アプリ自身の set()/delete() と同じ通知経路（notify）を通すため、onSnapshot購読者に届く
    remoteSet(coll, id, payload, opt) {
      if (opt && opt.merge) {
        docsById[id] = Object.assign({}, docsById[id] || {}, payload);
      } else {
        docsById[id] = Object.assign({}, payload);
      }
      notify(id);
    },
    remoteDelete(coll, id) {
      delete docsById[id];
      notify(id);
    }
  };
}

// ---- 環境構築 --------------------------------------------------------
function boot(opts) {
  opts = opts || {};
  const html = read("index.html")
    .replace(/<script src="vendor\/[^"]*"><\/script>/g, "")
    .replace(/<script src="i18n.js"><\/script>/, "")
    .replace(/<script src="app.js"><\/script>/, "")
    .replace(/<link[^>]*>/g, "");

  // スクリプト内の例外・console.error を漏れなく拾う（コンソールエラー検査のため）
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
  virtualConsole.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  virtualConsole.on("warn", () => {}); // Leaflet未読込の警告は想定内なので無視

  const dom = new JSDOM(html, {
    url: "https://example.org/tabi/" + (opts.hash || ""),
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole
  });
  const win = dom.window;

  // localStorage: 起動前後の完全一致を検査したいので手製のバッキングストアに差し替える。
  // jsdom の Storage は内部スロット実装のためメソッド代入では乗っ取れない。プロパティごと再定義する
  const store = Object.assign({}, opts.localStorage || {});
  const writeLog = [];
  const fakeStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      writeLog.push({ k, v: String(v) });
      store[k] = String(v);
    },
    removeItem: (k) => {
      writeLog.push({ k, v: null });
      delete store[k];
    },
    clear: () => {
      writeLog.push({ k: "*clear*", v: null });
      Object.keys(store).forEach((k) => delete store[k]);
    },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    }
  };
  Object.defineProperty(win, "localStorage", { value: fakeStorage, configurable: true, writable: true });

  const fb = makeFirebaseStub(opts);
  if (!opts.noFirebase) win.firebase = fb.firebase;
  win.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
  win.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

  win.addEventListener("error", (e) => errors.push(String(e.message)));

  // 実際のブラウザと同じく <script> として window スコープで実行する
  const runScript = (code, label) => {
    const s = win.document.createElement("script");
    s.textContent = code;
    try {
      win.document.head.appendChild(s);
    } catch (e) {
      errors.push(label + ": " + e.message);
    }
  };
  runScript(read("i18n.js"), "i18n.js");
  runScript(read("app.js"), "app.js");

  return { dom, win, fb, store, writeLog, errors, doc: win.document };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

// ---- アサーション -----------------------------------------------------
let pass = 0,
  fail = 0;
function ok(cond, label, extra) {
  if (cond) {
    pass++;
    console.log("  PASS  " + label);
  } else {
    fail++;
    console.log("  FAIL  " + label + (extra !== undefined ? "\n          -> " + JSON.stringify(extra) : ""));
  }
}
function section(t) {
  console.log("\n=== " + t + " ===");
}

module.exports = { boot, tick, ok, section, read, results: () => ({ pass, fail }) };
