# 技術的要件まとめ

## 全体方針
- ゲーム版 OSM 風の Web アプリを作る
- 主目的は **共同編集**
- 表示は画像タイル前提ではなく、**Node / Way / Relation 的なオブジェクトを返してクライアントで扱う**
- DB は PostgreSQL + PostGIS を使う
- 空間型、空間インデックス、bbox 交差判定、空間検索は **PostGIS 前提** で設計する
- 座標系は **SRID 0**
- 座標は **3軸 (X, Y, Z)** を使う
- **高さは Z で表す**
- ただし **viewport / bbox 判定は 2D (XY)** で行う

---

## データモデル方針
- 正規データの本体は OSM 風
  - `nodes`
  - `ways`
  - `way_nodes`
  - `relations`
  - `relation_members`
- Node は単なる制御点ではなく、**ゲーム属性を持つ実体**
- Way は **Node の順序付き集合**
- Way は **線にも面にも使う**
- Node / Way / Relation は OSM 風の **`tags` を持つ**
- `tags` は **文字列 key / 文字列 value** の拡張属性とする
- `tags` は shape や構造ではなく、柔軟な属性表現に使う
- ただし実装上は Way に
  - `feature_type`
  - `geometry_kind` (`line` / `area`)
  - `is_closed`
  を持たせて明示的に扱う想定
- `feature_type` / `geometry_kind` / `is_closed` / `relation_type` は **第一級カラム** とし、`tags` に重複させない

---

## geometry の扱い
- geometry は使う
- ただし **主データではなく補助データ**
- 真実のデータはあくまで
  - `nodes`
  - `ways`
  - `way_nodes`
  - `relations`
- geometry は正規データから再生成できる **派生データ / キャッシュ**
- 用途
  - viewport と交差する way / area の高速検索
  - 長い線の見落とし防止
  - 空間検索
- geometry 補助テーブルは **同じ DB 内** に置く

---

## 3D 方針
- 3軸で進める
- 高さは Z
- geometry 自体は Z 付きで持つ
- ただし viewport 抽出は 2D
- 方針は
  - **データ表現は 3D**
  - **画面抽出は 2D**

---

## SRID / geometry 型の前提
- SRID はすべて `0`
- 例
  - `nodes.geom = geometry(PointZ, 0)`
  - `way_geometries.geom = geometry(LineStringZ, 0)`
  - 面は必要に応じて `geometry(PolygonZ, 0)` など

---

## 共同編集方針
- 複数人で同じ世界を編集できること
- 必要な概念
  - changeset
  - version
  - 履歴
  - 論理削除
- OSM 本家のような「upload ごとに即反映」より、
  - **保存 / 公開時に changeset を確定**
  する Web アプリ寄りの運用が合いそう
- 各 entity は version を持つ
- 将来的に履歴テーブルを持てる設計にする

---

## viewport 取得方針
- bbox 判定は 2D
- way の選定は **geometry 補助**を使う
- 返却形式は geometry 一本ではなく、編集可能な構造を返す
- 基本の流れ
  1. viewport と交差する `way_geometries` を取得
  2. 対応する `way_id` を得る
  3. `way_nodes` を取得
  4. 必要な `nodes` を取得
  5. 必要なら `relations` / `relation_members` も取得
  6. `nodes + ways + way_nodes (+ relations)` の形で返す

---

## geometry 補助の更新方針
- geometry 補助は shape が変わったときに更新する
- 更新契機
  - `way_nodes` 追加
  - `way_nodes` 削除
  - `seq` 変更
  - `nodes.geom` 変更
  - `geometry_kind` 変更
  - way 削除 / 復活
- 形に無関係な属性更新では geometry 更新不要
- `tags` 更新だけでは geometry 更新不要
- 初期方針としては **保存時に同期更新** が自然

---

## スキーマ要件

### core schema
- `nodes`
- `ways`
- `way_nodes`
- `relations`
- `relation_members`
- `changesets`

### history schema
- `node_versions`
- `way_versions`
- `way_node_versions`
- `relation_versions`
- `relation_member_versions`

### derived schema
- `way_geometries`
- `relation_geometries`

---

## テーブルごとの役割

### nodes
- 地点の本体
- PointZ を持つ
- ゲーム属性を持つ
- version / 作成更新情報 / 論理削除を持つ

### ways
- Node の順序付き集合
- 線 / 面の両方を表現
- `feature_type`, `geometry_kind`, `is_closed` を持つ
- version / 作成更新情報 / 論理削除を持つ

### way_nodes
- way と node の接続順序
- `way_id`, `node_id`, `seq`
- Node の追加 / 挿入 / 並び替えに対応

### relations
- 複合オブジェクト
- 複数 way からなる面やルートなどに使う

### relation_members
- relation のメンバー管理
- `member_type`, `member_id`, `seq`, `role`

### changesets
- 編集のまとまり
- 編集者、状態、コメント、時刻を持つ

### way_geometries
- way から再構築した geometry キャッシュ
- viewport 検索や空間検索に使う
- `geom`, `bbox`, `source_version`, `refreshed_at` を持つ想定

### relation_geometries
- relation 由来の geometry キャッシュ
- multipolygon 等に対応

---

## インデックス要件
- `nodes.geom` に空間インデックス
- `way_geometries.geom` に空間インデックス
- `way_nodes(way_id, seq)`
- `way_nodes(node_id)`
- `relation_members(relation_id, seq)`
- 履歴系は `(entity_id, version)` の索引を想定

---

## 設計思想の一文まとめ
- **編集の真実は Node / Way / Relation**
- **geometry は同一 DB 内の補助キャッシュ**
- **座標は SRID 0 の XYZ**
- **高さは Z**
- **viewport 判定は 2D**
