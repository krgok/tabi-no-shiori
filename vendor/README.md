# vendor/ — 同梱している外部ライブラリ

CDN は使わず、配布元の npm パッケージのファイルをそのまま置いています（改変なし）。
更新するときは、ここの版・ハッシュ・`SPEC.md` の記述（先頭の構成の節）・`sw.js` の `CACHE_VERSION` を一緒に更新してください。

| ライブラリ | 版 | ライセンス | 入手元 | 置いてあるファイル |
|---|---|---|---|---|
| Leaflet | 1.9.4 | BSD-2-Clause（`leaflet/LICENSE`） | npm `leaflet@1.9.4` の `dist/` | `leaflet/leaflet.js` `leaflet/leaflet.css` `leaflet/images/*.png` |
| Firebase JS SDK（compat 版） | 12.16.0 | Apache-2.0 ＋ protobuf 部分は BSD-3-Clause（`firebase/LICENSE`） | npm `firebase@12.16.0` の `firebase-{app,auth,firestore}-compat.js` | `firebase/*.js` |

## 配布元との一致の確認（2026-10-24）

`npm i firebase@12.16.0 leaflet@1.9.4` で取得したファイルと比較し、`leaflet.css` を除いてバイト単位で一致することを確認済みです
（`leaflet.css` は改行コードの違いだけで、内容は同じ）。

SHA-256（先頭16桁）:

| ファイル | SHA-256 |
|---|---|
| `firebase/firebase-app-compat.js` | `23f8d2a2275557fb` |
| `firebase/firebase-auth-compat.js` | `961c9419300b0dd9` |
| `firebase/firebase-firestore-compat.js` | `c09eca018607c244` |
| `leaflet/leaflet.js` | `db49d009c841f5ca` |

## 既知の脆弱性

- Leaflet 1.9.4: 公開されている既知の脆弱性なし（1.9.x の最終版）。
- Firebase 12.16.0: `npm audit` は `@grpc/grpc-js` の古い範囲を理由に警告を出しますが、`grpc-js` は
  サーバー（Node.js）用で、ブラウザ用に同梱しているこの3ファイルには含まれていません（`grep grpc` で 0 件）。
  最新は 13.1.0（メジャー更新）。更新は、Google ログインとクラウド同期を実機で確認できるときにまとめて行う想定です
  （`docs/audit-2026-10.md` 参照）。
