# 将棋のルールを核とした和風ターン制3Dバトル

将棋の合法手・持ち駒・成り・王手・詰みをそのまま使い、盤上の駒を
和風デフォルメ3Dキャラクターとして表示する、スマートフォン向けの一人用ゲーム。

将棋のルールは一切変更しない。同じ局面から得られる合法手と勝敗は、
通常の将棋と完全に一致する。

## 状態

開発中。まだ遊べる状態ではありません。

## 構成

```
src/
  shogi.js         ルール層。盤面・合法手・終局判定。依存なし
  engine.js        NPC の探索と評価。shogi.js のみに依存
  npc.js           本体側から NPC を呼ぶ窓口（退避処理つき）
  npc.worker.js    NPC を別スレッドで動かす受け口
test/
  shogi.test.mjs   ルール層の検証（perft と禁じ手）
  engine.test.mjs  NPC の検証（戦術・合法性・時間）
lab/
  idle-test.html    待機モーションの方式比較
  capture-test.html 駒取り演出の方式比較
```

## テスト

```bash
node test/shogi.test.mjs           # 数秒
node test/shogi.test.mjs --full    # perft 深さ5まで。約40秒
node test/engine.test.mjs          # 約1分
node test/engine.test.mjs --games  # 自己対局も実行。数分
```

`shogi.js` を変更したら `--full` まで通すこと。
perft の値が1つでも合わなければ、合法手生成が壊れている。

## 動かし方

ES モジュールと Worker を使うため、ファイルを直接開いても動きません。
ローカルで見るときは簡易サーバーを立ててください。

```bash
python3 -m http.server 8000
# → http://localhost:8000/lab/idle-test.html
```

## 表記

局面は SFEN、指し手は USI 形式。

- 局面 `lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1`
- 移動 `7g7f` / 成り `8h2b+` / 打つ `P*5e`
