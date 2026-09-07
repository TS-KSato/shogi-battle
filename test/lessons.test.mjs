/**
 * lessons.test.mjs — 勝ちパターン学習の局面の検証
 *
 *   node lessons.test.mjs   （数秒）
 *
 * src/lessons.json の各局面について、ルール層だけで次を確かめる。
 *   ・決められた手数で、敵のどの応手に対しても詰む
 *   ・それより短い手数では勝てない（詰みだけでなく手詰まりも勝ちに数える）
 *   ・駒数が少ない
 */

import { readFileSync } from 'fs';
import * as S from '../src/shogi.js';

const lessons = JSON.parse(readFileSync(new URL('../src/lessons.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, got, want) => {
  const good = String(got) === String(want);
  console.log(`${good ? '  ok  ' : '  NG  '} ${name}` + (good ? '' : `\n        got ${got} / want ${want}`));
  good ? pass++ : fail++;
};

/* 自軍が n 手以内に勝ちを強制できるか。
   mateOnly が真なら詰みだけ、偽なら手詰まり（王手なしで指す手が無い）も勝ちに数える。
   対局側は「指す手が無い」を勝ちにするので、短い勝ちの否定は偽のほうで確かめる。 */
function winIn(pos, n, mateOnly){
  if (n < 1) return false;
  return S.legalMoves(pos).some(mv => { const p = S.clone(pos); S.doMove(p, mv); return winsAfter(p, n - 1, mateOnly); });
}
function winsAfter(pos, m, mateOnly){
  const replies = S.legalMoves(pos);
  if (replies.length === 0) return mateOnly ? S.inCheck(pos) : true;
  if (m < 2) return false;
  return replies.every(r => { const p = S.clone(pos); S.doMove(p, r); return winIn(p, m - 1, mateOnly); });
}
const winningFirst = (pos, n) =>
  S.legalMoves(pos).filter(mv => { const p = S.clone(pos); S.doMove(p, mv); return winsAfter(p, n - 1, true); });

function pieceCount(pos){
  let n = 0;
  for (const p of pos.board) if (p !== S.EMPTY) n++;
  for (const c of [S.BLACK, S.WHITE]) for (let t = S.FU; t <= S.HI; t++) n += pos.hands[c][t];
  return n;
}

for (const L of lessons){
  console.log(`\n${L.name}（${L.moves}手） ${L.sfen}`);
  const pos = S.parseSfen(L.sfen);
  ok('SFEN が読める', S.toSfen(pos), L.sfen);
  ok('自軍の行動から始まる', pos.turn, S.BLACK);
  const t = Date.now();
  const first = winningFirst(pos, L.moves).map(S.moveToUsi);
  ok(`${L.moves}手でどの応手にも詰む（初手 ${first.join(' / ') || '無し'}）`, first.length > 0, true);
  ok(`${L.moves - 2}手以内には勝てない（手詰まりも含む）`, winIn(pos, L.moves - 2, false), false);
  const n = pieceCount(pos);
  ok(`駒数 ${n}（大将を含めて 8 以下）`, n <= 8, true);
  console.log(`        ${Date.now() - t} ms`);
}

console.log(`\n${fail ? '失敗あり' : '全て通過'} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
