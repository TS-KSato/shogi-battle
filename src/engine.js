/**
 * engine.js — NPC（思考部）
 *
 * shogi.js のルール層だけに依存する。3D・演出・UI は参照しない。
 * 単スレッドのアルファベータ探索。評価関数はコードに埋め込む方式で、
 * 外部データファイルを持たない（配信容量を増やさないため）。
 *
 * 強さは「探索の深さ」ではなく「思考時間の上限」で決める。
 * 深さで決めると、端末の速さがそのまま強さの差になってしまう。
 */

import {
  FU, KY, KE, GI, KI, KA, HI, OU, TO, NY, NK, NG, UM, RY,
  EMPTY, BLACK, WHITE,
  colorOf, typeOf, baseOf, isProm, col, row,
  pseudoMoves, doMove, undoMove, inCheck, hasLegalMove,
  moveTo, moveFrom, movePro, isDrop, dropType,
  moveToUsi, parseSfen, toSfen,
} from './shogi.js';

/* ───────── 評価 ─────────
   駒の価値は、一般的な将棋ソフトの値を丸めたもの。
   絶対値に意味はなく、比だけが効く。                        */

const VAL = [];
VAL[FU]=90;  VAL[KY]=315; VAL[KE]=405; VAL[GI]=495; VAL[KI]=540;
VAL[KA]=855; VAL[HI]=990; VAL[OU]=30000;
VAL[TO]=540; VAL[NY]=540; VAL[NK]=540; VAL[NG]=540;
VAL[UM]=945; VAL[RY]=1395;

/* 持ち駒は盤上より少し高く見る（どこにでも打てるぶん） */
const HAND_VAL = [];
[FU,KY,KE,GI,KI,KA,HI].forEach(t => HAND_VAL[t] = Math.round(VAL[t] * 1.10));

/* 成る価値＝成った後との差。取る手より成る手を軽く見積もる。 */
const PROMO_GAIN = [];
PROMO_GAIN[FU]=VAL[TO]-VAL[FU]; PROMO_GAIN[KY]=VAL[NY]-VAL[KY];
PROMO_GAIN[KE]=VAL[NK]-VAL[KE]; PROMO_GAIN[GI]=VAL[NG]-VAL[GI];
PROMO_GAIN[KA]=VAL[UM]-VAL[KA]; PROMO_GAIN[HI]=VAL[RY]-VAL[HI];

/* 位置の補正。表を81マス分持つ代わりに、段と中央寄りで計算する。
   初級者相手には十分で、コード量が増えない。                 */
function placement(type, c, r, color){
  const adv = color === BLACK ? (8 - r) : r;     // 0=自陣最奥 … 8=敵陣最奥
  const center = 4 - Math.abs(c - 4);            // 0=端 … 4=中央
  switch (type){
    case FU:  return adv * 6 + center;
    case KY:  return adv * 2;
    case KE:  return adv * 4 + center;
    case GI:  return adv * 3 + center * 2;
    case KI:  return adv * 2 + center * 2;
    case KA: case UM: return center * 3 + adv;
    case HI: case RY: return center * 2 + adv * 2;
    case OU:  return -adv * 12 - center * 4;     // 玉は自陣の端へ
    default:  return adv * 2 + center * 2;       // 成金の類
  }
}

export function evaluate(pos){
  let s = 0;
  const bd = pos.board;

  for (let sq = 0; sq < 81; sq++){
    const p = bd[sq];
    if (p === EMPTY) continue;
    const c = colorOf(p), t = typeOf(p);
    const v = VAL[t] + placement(t, col(sq), row(sq), c);
    s += c === BLACK ? v : -v;
  }
  for (let t = FU; t <= HI; t++){
    s += pos.hands[BLACK][t] * HAND_VAL[t];
    s -= pos.hands[WHITE][t] * HAND_VAL[t];
  }

  /* 玉の周りに自分の駒がいると少し加点。利きを数えるより桁違いに安い。 */
  for (const c of [BLACK, WHITE]){
    const k = pos.kingSq[c];
    if (k < 0) continue;
    const kc = col(k), kr = row(k);
    let guard = 0;
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++){
        const x = kc + dc, y = kr + dr;
        if (x < 0 || x > 8 || y < 0 || y > 8) continue;
        const q = bd[y * 9 + x];
        if (q !== EMPTY && colorOf(q) === c) guard += 14;
      }
    s += c === BLACK ? guard : -guard;
  }

  return pos.turn === BLACK ? s : -s;            // 手番側から見た点
}

/* ───────── 指し手の並べ替え ─────────
   良さそうな手を先に調べるほど枝刈りが効く。ここが探索速度の大半。 */

function scoreMove(pos, mv){
  if (isDrop(mv)) return 0;
  const to = moveTo(mv), from = moveFrom(mv);
  const cap = pos.board[to];
  let s = 0;
  if (cap !== EMPTY)
    s = 1_000_000 + VAL[typeOf(cap)] * 16 - VAL[typeOf(pos.board[from])];
  if (movePro(mv)) s += PROMO_GAIN[baseOf(typeOf(pos.board[from]))] * 4 || 200;
  return s;
}

function ordered(pos, moves, killer){
  const arr = moves.map(mv => {
    let s = scoreMove(pos, mv);
    if (mv === killer) s += 900_000;
    return { mv, s };
  });
  arr.sort((a, b) => b.s - a.s);
  return arr.map(x => x.mv);
}

/* ───────── 合法手の絞り込み ─────────
   探索中は legalMoves() を使わず、指してから王手を確認する。
   同じ処理を二度しないぶん速い。                            */

function isLegalAfter(pos, mv, me){
  if (inCheck(pos, me)) return false;
  if (isDrop(mv) && dropType(mv) === FU && inCheck(pos, 1 - me))
    return hasLegalMove(pos, false);             // 打ち歩詰めの確認
  return true;
}

/* ───────── 探索 ───────── */

const MATE = 100000;
const INF  = 1e9;

class Searcher {
  constructor(){
    this.nodes = 0;
    this.deadline = Infinity;
    this.stopped = false;
    this.killers = [];
  }

  timeUp(){
    if (this.stopped) return true;
    if ((this.nodes & 1023) === 0 && Date.now() >= this.deadline) this.stopped = true;
    return this.stopped;
  }

  /* 静止探索：取る手だけを読み進める。
     これが無いと、読みの終わりで駒を取られる形を平気で作る。 */
  quiesce(pos, alpha, beta, depth){
    this.nodes++;
    if (this.timeUp()) return alpha;

    const me = pos.turn;
    const checked = inCheck(pos, me);

    /* 王手されている間は「取る手だけ」では逃げ道を見落とす。
       この場合は全ての手を調べる。                          */
    if (!checked){
      const stand = evaluate(pos);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
    }
    if (depth <= 0) return checked ? evaluate(pos) : alpha;

    const all = pseudoMoves(pos);
    const caps = checked ? all
      : all.filter(mv => !isDrop(mv) && pos.board[moveTo(mv)] !== EMPTY);

    let legal = 0;
    for (const mv of ordered(pos, caps, -1)){
      const u = doMove(pos, mv);
      if (!isLegalAfter(pos, mv, me)){ undoMove(pos, mv, u); continue; }
      legal++;
      const v = -this.quiesce(pos, -beta, -alpha, depth - 1);
      undoMove(pos, mv, u);
      if (this.stopped) return alpha;
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    if (checked && legal === 0) return -MATE + 40;   // 詰み
    return alpha;
  }

  search(pos, depth, alpha, beta, ply){
    this.nodes++;
    if (this.timeUp()) return alpha;
    if (depth <= 0) return this.quiesce(pos, alpha, beta, 6);

    const me = pos.turn;
    const checked = inCheck(pos, me);
    if (checked) depth++;                        // 王手はもう一手読む

    let best = -INF, legal = 0;
    const killer = this.killers[ply];

    for (const mv of ordered(pos, pseudoMoves(pos), killer)){
      const u = doMove(pos, mv);
      if (!isLegalAfter(pos, mv, me)){ undoMove(pos, mv, u); continue; }
      legal++;
      const v = -this.search(pos, depth - 1, -beta, -alpha, ply + 1);
      undoMove(pos, mv, u);
      if (this.stopped) return best > -INF ? best : alpha;

      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta){
        if (isDrop(mv) || pos.board[moveTo(mv)] === EMPTY) this.killers[ply] = mv;
        break;
      }
    }

    /* 将棋では、王手の有無にかかわらず指す手が無ければ負け。 */
    if (legal === 0) return -MATE + ply;
    return best;
  }

  /* 反復深化。時間切れになるまで1手ずつ深くする。 */
  root(pos, level, history){
    const me = pos.turn;
    this.deadline = Date.now() + level.ms;
    this.stopped = false;
    this.nodes = 0;
    this.killers = [];

    const roots = [];
    for (const mv of pseudoMoves(pos)){
      const u = doMove(pos, mv);
      const ok = isLegalAfter(pos, mv, me);
      undoMove(pos, mv, u);
      if (ok) roots.push({ mv, score: -INF, rep: 0 });
    }

    /* 同じ局面へ戻る手には減点する。千日手の規則そのものは
       ルール層に無いので、ここでくり返しを避けるだけに留める。 */
    if (history && history.size){
      for (const r of roots){
        const u = doMove(pos, r.mv);
        r.rep = history.get(posKey(pos)) || 0;
        undoMove(pos, r.mv, u);
      }
    }
    if (roots.length === 0) return null;

    let done = 0;
    for (let d = 1; d <= level.depth; d++){
      const snap = roots.map(r => ({ mv: r.mv, score: -INF, rep: r.rep }));

      /* 根では窓を狭めない。狭めると、劣る手の点数が上限値に
         貼り付いてしまい、難易度のゆらぎが機能しなくなる。   */
      for (const r of snap){
        const u = doMove(pos, r.mv);
        r.score = -this.search(pos, d - 1, -INF, INF, 1);
        undoMove(pos, r.mv, u);
        if (this.stopped) break;
        if (r.rep) r.score -= r.rep * 300;
      }

      if (this.stopped && d > 1) break;
      snap.sort((a, b) => b.score - a.score);
      roots.length = 0; roots.push(...snap);     // 次の深さは良い手から調べる
      done = d;
      if (Math.abs(roots[0].score) > MATE - 100) break;   // 詰みを見つけた
      if (Date.now() >= this.deadline) break;
    }

    /* 弱い難易度では、点差の小さい手からゆらぎを付けて選ぶ。
       完全な乱択にはしない（明らかな悪手を連発すると不自然なため）。 */
    let pick = roots[0];
    if (level.noise > 0){
      const top = roots[0].score;
      const cand = roots.filter(r => top - r.score <= level.noise);
      pick = cand[Math.floor(Math.random() * cand.length)];
    }

    return { move: pick.mv, usi: moveToUsi(pick.mv), score: pick.score,
             depth: done, nodes: this.nodes };
  }
}

/* ───────── 難易度 ─────────
   ms   … 思考時間の上限。強さの主な決定要因。
   depth… 上限。やさしいでは、時間が余っても深く読ませない。
   noise… この点差以内の手から無作為に選ぶ（歩1枚が90点）。 */

export const LEVELS = {
  easy:   { ms:  200, depth:  2, noise: 260 },
  normal: { ms:  600, depth:  5, noise:  70 },
  hard:   { ms: 1200, depth: 16, noise:   0 },
};

/* ───────── 外向きの入口 ───────── */

/* 手数を除いた局面キー。くり返し判定に使う。 */
export const posKey = pos => toSfen(pos).split(' ').slice(0, 3).join(' ');

/**
 * @param pos       局面（shogi.js の Position）
 * @param levelName 'easy' | 'normal' | 'hard'
 * @param history   Map<posKey, 出現回数>（省略可）
 */
export function think(pos, levelName = 'normal', history = null){
  const level = LEVELS[levelName] || LEVELS.normal;
  return new Searcher().root(pos, level, history);
}

export function thinkSfen(sfen, levelName, history){
  return think(parseSfen(sfen), levelName, history);
}
