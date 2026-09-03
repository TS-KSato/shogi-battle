/**
 * shogi.js — ルール層
 *
 * 3D・演出・UI に一切依存しない。盤面と合法手だけを扱う。
 * 局面は SFEN、指し手は USI 形式で外部とやり取りする。
 *
 * 依存なし。Node でもブラウザでもそのまま動く。
 */

/* ───────── 駒の表現 ─────────
   基本種별 0..7。成りは +8。空きマスは -1。
   先手 color=0 / 後手 color=1 は bit4 に持つ。            */

export const FU = 0, KY = 1, KE = 2, GI = 3, KI = 4, KA = 5, HI = 6, OU = 7;
export const TO = 8, NY = 9, NK = 10, NG = 11, UM = 13, RY = 14;
export const EMPTY = -1;

export const BLACK = 0, WHITE = 1;          // 先手 / 後手

export const mkPiece = (color, type) => (color << 4) | type;
export const colorOf = p => p >> 4;
export const typeOf  = p => p & 15;
export const baseOf  = p => p & 7;          // 成り駒 → 元の種
export const isProm  = p => (p & 8) !== 0;

const PROMOTABLE = [true, true, true, true, false, true, true, false];

/* ───────── 方向表 ─────────
   すべて先手視点。dr が負＝前進。後手は dr を反転して使う。
   左右対称なので dc の反転は不要。                         */

const S = {                                  // 1マスの移動
  [FU]: [[0,-1]],
  [KY]: [],
  [KE]: [[-1,-2],[1,-2]],
  [GI]: [[0,-1],[-1,-1],[1,-1],[-1,1],[1,1]],
  [KI]: [[0,-1],[-1,-1],[1,-1],[-1,0],[1,0],[0,1]],
  [KA]: [],
  [HI]: [],
  [OU]: [[0,-1],[-1,-1],[1,-1],[-1,0],[1,0],[0,1],[-1,1],[1,1]],
  [UM]: [[0,-1],[-1,0],[1,0],[0,1]],
  [RY]: [[-1,-1],[1,-1],[-1,1],[1,1]],
};
const L = {                                  // 走り
  [KY]: [[0,-1]],
  [KA]: [[-1,-1],[1,-1],[-1,1],[1,1]],
  [HI]: [[0,-1],[0,1],[-1,0],[1,0]],
  [UM]: [[-1,-1],[1,-1],[-1,1],[1,1]],
  [RY]: [[0,-1],[0,1],[-1,0],[1,0]],
};
const STEPS = [], SLIDES = [];
for (let t = 0; t <= 14; t++){
  STEPS[t]  = S[t] || [];
  SLIDES[t] = L[t] || [];
}
// 成金（と・成香・成桂・成銀）は金と同じ動き
[TO, NY, NK, NG].forEach(t => { STEPS[t] = S[KI]; });

const DIR8 = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];

/* ───────── マス ─────────
   sq = row*9 + col。row 0 = 一段目（SFEN の先頭行）、col 0 = 9筋。
   先手の前進は row-1。                                     */

export const col = sq => sq % 9;
export const row = sq => (sq / 9) | 0;
export const sqOf = (c, r) => r * 9 + c;
const onBoard = (c, r) => c >= 0 && c < 9 && r >= 0 && r < 9;
const forward = color => color === BLACK ? -1 : 1;

/* 敵陣（成れる範囲） */
const inZone = (color, r) => color === BLACK ? r <= 2 : r >= 6;
/* 行き所のない駒 */
function deadEnd(color, type, r){
  const last = color === BLACK ? 0 : 8;
  const last2 = color === BLACK ? 1 : 7;
  if (type === FU || type === KY) return r === last;
  if (type === KE) return r === last || r === last2;
  return false;
}

/* ───────── 指し手 ─────────
   bit 0-6   移動先
   bit 7-13  移動元。81+t は「t の駒を打つ」
   bit 14    成る                                            */

const DROP0 = 81;
export const mkMove = (from, to, prom) => to | (from << 7) | (prom ? 1 << 14 : 0);
export const mkDrop = (type, to) => to | ((DROP0 + type) << 7);
export const moveTo   = mv => mv & 127;
export const moveFrom = mv => (mv >> 7) & 127;
export const movePro  = mv => (mv >> 14) & 1;
export const isDrop   = mv => ((mv >> 7) & 127) >= DROP0;
export const dropType = mv => ((mv >> 7) & 127) - DROP0;

/* ───────── 局面 ───────── */

export function newPosition(){
  return {
    board: new Int8Array(81).fill(EMPTY),
    hands: [new Int8Array(7), new Int8Array(7)],
    turn: BLACK,
    ply: 1,
    kingSq: [-1, -1],
  };
}

export function clone(pos){
  return {
    board: Int8Array.from(pos.board),
    hands: [Int8Array.from(pos.hands[0]), Int8Array.from(pos.hands[1])],
    turn: pos.turn, ply: pos.ply, kingSq: pos.kingSq.slice(),
  };
}

/* ───────── SFEN ───────── */

const SFEN_CH = { p:FU, l:KY, n:KE, s:GI, g:KI, b:KA, r:HI, k:OU };
const CH_OF = [];
CH_OF[FU]='P'; CH_OF[KY]='L'; CH_OF[KE]='N'; CH_OF[GI]='S';
CH_OF[KI]='G'; CH_OF[KA]='B'; CH_OF[HI]='R'; CH_OF[OU]='K';

export const START_SFEN =
  'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

export function parseSfen(sfen){
  const pos = newPosition();
  const [bd, side, hand, ply] = sfen.trim().split(/\s+/);

  let sq = 0, prom = false;
  for (const ch of bd){
    if (ch === '/') continue;
    if (ch === '+'){ prom = true; continue; }
    if (ch >= '1' && ch <= '9'){ sq += +ch; continue; }
    const lower = ch.toLowerCase();
    const t = SFEN_CH[lower] + (prom ? 8 : 0);
    const c = ch === lower ? WHITE : BLACK;
    pos.board[sq] = mkPiece(c, t);
    if (t === OU) pos.kingSq[c] = sq;
    sq++; prom = false;
  }

  pos.turn = side === 'w' ? WHITE : BLACK;

  if (hand && hand !== '-'){
    let num = 0;
    for (const ch of hand){
      if (ch >= '0' && ch <= '9'){ num = num * 10 + (+ch); continue; }
      const lower = ch.toLowerCase();
      const c = ch === lower ? WHITE : BLACK;
      pos.hands[c][SFEN_CH[lower]] += num || 1;
      num = 0;
    }
  }
  pos.ply = ply ? +ply : 1;
  return pos;
}

export function toSfen(pos){
  let bd = '';
  for (let r = 0; r < 9; r++){
    let gap = 0;
    for (let c = 0; c < 9; c++){
      const p = pos.board[sqOf(c, r)];
      if (p === EMPTY){ gap++; continue; }
      if (gap){ bd += gap; gap = 0; }
      let ch = CH_OF[baseOf(p)];
      if (colorOf(p) === WHITE) ch = ch.toLowerCase();
      bd += (isProm(p) ? '+' : '') + ch;
    }
    if (gap) bd += gap;
    if (r < 8) bd += '/';
  }

  let hand = '';
  const order = [HI, KA, KI, GI, KE, KY, FU];
  for (const c of [BLACK, WHITE])
    for (const t of order){
      const n = pos.hands[c][t];
      if (!n) continue;
      hand += (n > 1 ? n : '') + (c === BLACK ? CH_OF[t] : CH_OF[t].toLowerCase());
    }

  return `${bd} ${pos.turn === BLACK ? 'b' : 'w'} ${hand || '-'} ${pos.ply}`;
}

/* ───────── USI ───────── */

export const sqToUsi = sq => `${9 - col(sq)}${String.fromCharCode(97 + row(sq))}`;
export const usiToSq = s => sqOf(9 - (+s[0]), s.charCodeAt(1) - 97);

export function moveToUsi(mv){
  if (isDrop(mv)) return `${CH_OF[dropType(mv)]}*${sqToUsi(moveTo(mv))}`;
  return sqToUsi(moveFrom(mv)) + sqToUsi(moveTo(mv)) + (movePro(mv) ? '+' : '');
}

export function usiToMove(s){
  if (s[1] === '*') return mkDrop(SFEN_CH[s[0].toLowerCase()], usiToSq(s.slice(2)));
  return mkMove(usiToSq(s.slice(0, 2)), usiToSq(s.slice(2, 4)), s.length > 4 && s[4] === '+');
}

/* ───────── 利き ───────── */

export function attacked(pos, sq, by){
  const bd = pos.board, c0 = col(sq), r0 = row(sq);

  // 桂は飛び越えるので個別に
  const kdr = by === BLACK ? 2 : -2;
  for (const dc of [-1, 1]){
    const c = c0 + dc, r = r0 + kdr;
    if (onBoard(c, r)){
      const p = bd[sqOf(c, r)];
      if (p !== EMPTY && colorOf(p) === by && typeOf(p) === KE) return true;
    }
  }

  for (const [dc, dr] of DIR8){
    let c = c0 + dc, r = r0 + dr, dist = 1;
    while (onBoard(c, r)){
      const p = bd[sqOf(c, r)];
      if (p !== EMPTY){
        if (colorOf(p) === by){
          const t = typeOf(p);
          const m = by === BLACK ? -dr : dr;   // 駒から見た向き（先手基準）
          if (dist === 1)
            for (const [sc, sr] of STEPS[t]) if (sc === -dc && sr === m) return true;
          for (const [sc, sr] of SLIDES[t]) if (sc === -dc && sr === m) return true;
        }
        break;
      }
      c += dc; r += dr; dist++;
    }
  }
  return false;
}

export const inCheck = (pos, color = pos.turn) =>
  pos.kingSq[color] >= 0 && attacked(pos, pos.kingSq[color], 1 - color);

/* ───────── 指し手の生成（擬似合法） ───────── */

function pushMove(out, pos, from, to, type, color){
  const r = row(to), rf = row(from);
  const canPromote = PROMOTABLE[baseOf(type)] && !isProm(type) &&
                     (inZone(color, r) || inZone(color, rf));
  if (canPromote) out.push(mkMove(from, to, true));
  if (!deadEnd(color, type, r)) out.push(mkMove(from, to, false));
}

export function pseudoMoves(pos){
  const out = [], bd = pos.board, me = pos.turn;

  for (let from = 0; from < 81; from++){
    const p = bd[from];
    if (p === EMPTY || colorOf(p) !== me) continue;
    const t = typeOf(p), c0 = col(from), r0 = row(from);

    for (const [dc, dr] of STEPS[t]){
      const c = c0 + dc;
      const r = r0 + (me === BLACK ? dr : -dr);     // dr は先手基準
      if (!onBoard(c, r)) continue;
      const to = sqOf(c, r), q = bd[to];
      if (q !== EMPTY && colorOf(q) === me) continue;
      pushMove(out, pos, from, to, t, me);
    }
    for (const [dc, dr] of SLIDES[t]){
      const sdr = me === BLACK ? dr : -dr;
      let c = c0 + dc, r = r0 + sdr;
      while (onBoard(c, r)){
        const to = sqOf(c, r), q = bd[to];
        if (q !== EMPTY && colorOf(q) === me) break;
        pushMove(out, pos, from, to, t, me);
        if (q !== EMPTY) break;
        c += dc; r += sdr;
      }
    }
  }

  // 打つ手
  const hand = pos.hands[me];
  let hasFu = 0;                                    // 二歩の判定用（筋ごとのビット）
  for (let sq = 0; sq < 81; sq++){
    const p = bd[sq];
    if (p !== EMPTY && colorOf(p) === me && typeOf(p) === FU) hasFu |= 1 << col(sq);
  }
  for (let t = FU; t <= HI; t++){
    if (!hand[t]) continue;
    for (let to = 0; to < 81; to++){
      if (bd[to] !== EMPTY) continue;
      if (deadEnd(me, t, row(to))) continue;
      if (t === FU && (hasFu & (1 << col(to)))) continue;
      out.push(mkDrop(t, to));
    }
  }
  return out;
}

/* ───────── 着手 / 取消 ───────── */

export function doMove(pos, mv){
  const to = moveTo(mv), me = pos.turn;
  const undo = { cap: EMPTY, from: -1, k0: pos.kingSq[0], k1: pos.kingSq[1] };

  if (isDrop(mv)){
    const t = dropType(mv);
    pos.hands[me][t]--;
    pos.board[to] = mkPiece(me, t);
    undo.from = -1;
  } else {
    const from = moveFrom(mv);
    const p = pos.board[from];
    const cap = pos.board[to];
    undo.cap = cap; undo.from = from;
    if (cap !== EMPTY){
      pos.hands[me][baseOf(cap)]++;
      if (typeOf(cap) === OU) pos.kingSq[1 - me] = -1;
    }
    const np = movePro(mv) ? mkPiece(me, typeOf(p) | 8) : p;
    pos.board[to] = np;
    pos.board[from] = EMPTY;
    if (typeOf(p) === OU) pos.kingSq[me] = to;
  }
  pos.turn = 1 - me;
  pos.ply++;
  return undo;
}

export function undoMove(pos, mv, undo){
  const to = moveTo(mv);
  pos.turn = 1 - pos.turn;
  pos.ply--;
  const me = pos.turn;

  if (isDrop(mv)){
    pos.hands[me][dropType(mv)]++;
    pos.board[to] = EMPTY;
  } else {
    const p = pos.board[to];
    const orig = movePro(mv) ? mkPiece(me, typeOf(p) & 7) : p;
    pos.board[undo.from] = orig;
    pos.board[to] = undo.cap;
    if (undo.cap !== EMPTY) pos.hands[me][baseOf(undo.cap)]--;
  }
  pos.kingSq[0] = undo.k0;
  pos.kingSq[1] = undo.k1;
}

/* ───────── 合法手 ─────────
   擬似合法手から、自玉が取られる手を除く。
   打ち歩詰めは、歩を打った直後が相手の詰みなら反則。       */

export function legalMoves(pos, checkUchifu = true){
  const me = pos.turn, out = [];
  for (const mv of pseudoMoves(pos)){
    const u = doMove(pos, mv);
    let ok = !inCheck(pos, me);
    if (ok && checkUchifu && isDrop(mv) && dropType(mv) === FU){
      // 打った歩で王手 かつ 相手に合法手なし → 打ち歩詰め
      if (inCheck(pos, 1 - me) && !hasLegalMove(pos, false)) ok = false;
    }
    undoMove(pos, mv, u);
    if (ok) out.push(mv);
  }
  return out;
}

export function hasLegalMove(pos, checkUchifu = true){
  const me = pos.turn;
  for (const mv of pseudoMoves(pos)){
    const u = doMove(pos, mv);
    let ok = !inCheck(pos, me);
    if (ok && checkUchifu && isDrop(mv) && dropType(mv) === FU){
      if (inCheck(pos, 1 - me) && !hasLegalMove(pos, false)) ok = false;
    }
    undoMove(pos, mv, u);
    if (ok) return true;
  }
  return false;
}

export const isMate = pos => inCheck(pos) && !hasLegalMove(pos);

/* ───────── 千日手 ───────── */

/* 千日手の照合に使う局面のキー。盤・手番・持ち駒が同じなら同一局面（手数は見ない）。 */
export const positionKey = pos => toSfen(pos).replace(/ \d+$/, '');

/* keys[i] は i 手目を指した後の局面のキー（keys[0] は開始局面）、checks[i] はその局面で
   手番側が王手されているか。最後の局面が4回目の出現なら千日手。最初の出現から最後までの
   間、一方の手が全て王手なら、その側（王手を続けた側）の負け。
   戻り値は null（未成立）／'draw'（引き分け）／負けとなる側の色。 */
export function repetition(keys, checks){
  const n = keys.length - 1, last = keys[n];
  let first = -1, count = 0;
  for (let i = 0; i <= n; i++) if (keys[i] === last){ count++; if (first < 0) first = i; }
  if (count < 4) return null;
  const toMove = last.split(' ')[1] === 'b' ? BLACK : WHITE;
  // 局面 j の王手は j 手目を指した側がかけたもの。first の手番側は first+1, first+3, … を指す。
  const allChecks = start => { for (let j = start; j <= n; j += 2) if (!checks[j]) return false; return true; };
  if (allChecks(first + 1)) return toMove;
  if (allChecks(first + 2)) return 1 - toMove;
  return 'draw';
}

/* ───────── 検証用 ───────── */

export function perft(pos, depth){
  if (depth === 0) return 1;
  let n = 0;
  for (const mv of legalMoves(pos)){
    const u = doMove(pos, mv);
    n += perft(pos, depth - 1);
    undoMove(pos, mv, u);
  }
  return n;
}
