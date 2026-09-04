# 鬼謀

9×9の戦場で兵を動かし、敵の大将を追い詰めるスマートフォン向けの一人用
3Dボードゲーム。盤上の兵は和風デフォルメの3Dキャラクターで表示される。

遊ぶ: https://TS-KSato.github.io/shogi-battle/

## 土台

ルール層は将棋そのもの。同じ局面から得られる合法手と勝敗は通常の将棋と
完全に一致する。土台に将棋を選んだのは、ルールの設計と検証の工程を
短縮するため（perft で既知の値と照合できる）。

**ただしプレイヤー向けの画面と文書では将棋として紹介しない。** 世界観は
独自の3Dボードゲームで、用語もそれに合わせてある。

| 内部・開発者向け | プレイヤー向け |
|---|---|
| 盤・駒 | 戦場・兵 |
| 先手・後手 | 先攻・後攻 |
| 手番 | 自軍の行動・敵軍の行動 |
| 成る・成り駒 | 進化する・「歩兵（進化）」 |
| 王手 | 大将に迫る／大将が危ない |
| 詰み | 大将を追い詰めた |
| 持ち駒 | 控え |
| 棋譜 | 戦闘ログ |
| 千日手 | 同じ配置が4回くり返された |

兵の呼び名は 歩兵・槍兵・忍者・侍・近衛兵・僧兵・鉄砲兵・大将。
画面に将棋の用語を足さないこと。

## 構成

```
index.html         タイトル。全画面の背景絵、ロゴ、順番と強さの選択、
                   ガイドの入口。開いた時点で兵のGLBを先読みする
play3d.html        対局画面
guide.html         ガイド（兵・ルール・操作・困ったとき）。対局画面からは
                   iframe で重ねて開く
src/
  name.js          ゲーム名の定数。index と play3d と guide が参照する
  shogi.js         ルール層。盤面・合法手・終局判定・千日手。依存なし
  engine.js        NPC の探索と評価。shogi.js のみに依存
  npc.js           本体側から NPC を呼ぶ窓口（退避処理つき）
  npc.worker.js    NPC を別スレッドで動かす受け口
assets/
  title.jpg        タイトルの背景絵
  logo.png         ロゴ
  stage/honjin.jpg 対局画面の舞台絵。下部が地面（平均色 #aa884b）
  guide/           ガイドの兵の絵（PNG 10枚）とルールの実写（JPEG 6枚）
  *.glb            3Dモデル25個。兵（陣営別の待機16・進化後4）、幟2、
                   大砲1、モデルを読めないときの退避用2
test/
  shogi.test.mjs   ルール層の検証（perft・禁じ手・千日手）
  engine.test.mjs  NPC の検証（戦術・合法性・時間・終局）
tools/
  guide-icons.mjs  ガイドの兵の絵を GLB から生成する
```

## テスト

```bash
node test/shogi.test.mjs           # 数秒
node test/shogi.test.mjs --full    # perft 深さ5まで。約40秒
node test/engine.test.mjs          # 約1分
node test/engine.test.mjs --games  # 自己対局で難易度の順序も確認。数分
```

`shogi.js` を変更したら `--full` まで通すこと。
perft の値が1つでも合わなければ、合法手生成が壊れている。


## ローカルで動かす

ES モジュールと Worker を使うため、ファイルを直接開いても動かない。
簡易サーバーを立てる。

```bash
python3 -m http.server 8000
# → http://localhost:8000/
```

`play3d.html?sfen=<SFEN>` で任意の局面から開ける。ガイドの実写もこれで
撮っている。

## 内部表記

局面は SFEN、指し手は USI 形式。ログや画面には出さない。

- 局面 `lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1`
- 移動 `7g7f` / 進化 `8h2b+` / 投入 `P*5e`

## 配信の状態

対局画面が初回に読むファイルの合計は約 5.1 MB で、8割が兵の GLB（4.2 MB）。
4G 相当で対局画面を直接開くと盤が出るまで約12秒かかるが、タイトルを
経由すると先読みが効いて約3秒になる（タイトル側の絵とロゴが 1.2 MB あるので、
先読みが終わるまでには 4G で12秒ほどかかる）。

## 素材の出所

| 素材 | 作り方 |
|---|---|
| 兵の3Dモデル（`assets/*.glb`） | Magnific で画像を生成 → Magnific 内の Tripo V3.1 で3D化 → Mixamo でリグとモーションを付与 → Blender で調整 |
| 舞台絵 `assets/stage/honjin.jpg`、タイトル絵 `assets/title.jpg`、ロゴ `assets/logo.png` | Magnific で生成 |

- Magnific は Premium+（年払い）契約で利用。生成物の商用利用は契約プランの
  規約による
- Mixamo は Adobe のアカウント登録のみで、商用・非商用を問わずロイヤリティ
  フリーで利用可
- 外部ライブラリは three.js r128（MIT）を CDN から読む

## 実装していないもの

持将棋、詰将棋モード、進化や決着の演出（討ち取りの演出だけ実装済み）、音。
iOS Safari での Worker の動作は未検証。

開発者向けの詳細は `CLAUDE.md` を参照。
