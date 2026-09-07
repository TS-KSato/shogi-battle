/**
 * drill.js — 軍議演習のソルバー
 *
 * shogi.js の合法手生成の上で、決められた手数（プライ）のうちに詰みを強制できる手と、
 * いちばん長く粘る応手を全探索で求める。局面は兵が少ないので深さ5まで数百ミリ秒で済む。
 * NPC（engine.js）は使わない。
 */

import { legalMoves, clone, doMove, inCheck } from './shogi.js';

/* 手番側が n 手以内に勝ちを強制できるか。
   mateOnly が真なら詰みだけ。偽なら手詰まり（王手なしで指す手が無い）も勝ちに数える。
   対局側は手詰まりも勝ちにするので、「それより短く勝てない」は偽のほうで確かめる。 */
export function winIn(pos, n, mateOnly = true){
  if (n < 1) return false;
  return legalMoves(pos).some(mv => { const p = clone(pos); doMove(p, mv); return winsAfter(p, n - 1, mateOnly); });
}
function winsAfter(pos, m, mateOnly){
  const replies = legalMoves(pos);
  if (replies.length === 0) return mateOnly ? inCheck(pos) : true;
  if (m < 2) return false;
  return replies.every(r => { const p = clone(pos); doMove(p, r); return winIn(p, m - 1, mateOnly); });
}

/* n 手以内に詰みを強制できる手の一覧（手番側） */
export function winningMoves(pos, n){
  return legalMoves(pos).filter(mv => { const p = clone(pos); doMove(p, mv); return winsAfter(p, n - 1, true); });
}

/* 手番側（守る側）の応手のうち、残り n 手で詰むまでに最も手数のかかるもの。
   n 手以内に詰まない応手があればそれを返す。合法手が無ければ null。 */
export function toughestReply(pos, n){
  let best = null, bestD = -1;
  for (const r of legalMoves(pos)){
    const p = clone(pos); doMove(p, r);
    let d = Infinity;
    for (let k = 1; k < n; k += 2) if (winIn(p, k)){ d = k; break; }
    if (d > bestD){ best = r; bestD = d; }
  }
  return best;
}
