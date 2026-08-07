/**
 * engine.test.mjs — NPC の検証
 *
 *   node engine.test.mjs          … 戦術・合法性・時間（約1分）
 *   node engine.test.mjs --games  … 自己対局で難易度の順序も確認（数分）
 *
 * ここで見ているのは棋力ではない。
 *   ・非合法手を絶対に指さないこと
 *   ・対局が必ず終わること（無限ループしないこと）
 *   ・思考時間の上限を守ること
 * 棋力は実機と人手で測る。ここでは保証しない。
 */

import * as S from '../src/shogi.js';
import { think, posKey, LEVELS } from '../src/engine.js';

let pass = 0, fail = 0;
const ok = (name, got, want) => {
  const good = String(got) === String(want);
  console.log(`${good ? '  ok  ' : '  NG  '} ${name}` + (good ? '' : `\n        got ${got} / want ${want}`));
  good ? pass++ : fail++;
};
const note = (name, v) => console.log(`  --   ${name}: ${v}`);

/* ───────── 1. 戦術 ───────── */

console.log('\n戦術');
{
  // 8h の角の利きに、後手の飛車が浮いている
  const p = S.parseSfen('4k4/9/9/9/4r4/9/9/1B7/4K4 b - 1');
  ok('  ただの駒を取る', think(p, 'normal').usi, '8h5e');
}
{
  /* 後手玉9a、先手の金8c。9bまたは8bへ金を打てば詰み。
     正解が複数あるので、指し手そのものではなく
     「その手を指すと詰んでいるか」で判定する。          */
  const p = S.parseSfen('k8/9/1G7/9/9/9/9/9/8K b G 1');
  const r = think(p, 'normal');
  S.doMove(p, r.move);
  ok('  1手詰を見つける', S.isMate(p), true);
  ok('  詰みとして評価する', r.score > 90000, true);
}
{
  // 王手されている。逃げる手を選ぶ
  const p = S.parseSfen('4k4/9/9/9/4r4/9/9/9/4K4 b - 1');
  const r = think(p, 'normal');
  ok('  王手に応じる', /^5i[46]/.test(r.usi), true);
}

/* ───────── 2. 合法性 ─────────
   どの難易度でも、返ってくる手は必ず合法手でなければならない。 */

console.log('\n合法性');
{
  const spots = [
    S.START_SFEN,
    'l6nl/5+P1gk/2np1S3/p1p4Pp/3P2Sp1/1PPb2P1P/P5GS1/R8/LN4bKL w RGgsn5p 1',
    'R8/2K1S1SSk/4B4/9/9/9/9/9/1L1L1L3 b RBGSNLP3g3n17p 1',
    '4k4/9/9/9/4r4/9/9/1B7/4K4 b - 1',
  ];
  let bad = 0, n = 0;
  for (const sfen of spots)
    for (const lv of ['easy','normal','hard'])
      for (let i = 0; i < 3; i++){
        const p = S.parseSfen(sfen);
        const legal = new Set(S.legalMoves(p).map(S.moveToUsi));
        const r = think(p, lv);
        n++;
        if (!r || !legal.has(r.usi)) bad++;
      }
  ok(`  ${n} 回すべて合法手`, bad, 0);
}

/* ───────── 3. 思考時間 ───────── */

console.log('\n思考時間');
{
  for (const lv of ['easy','normal','hard']){
    let worst = 0;
    for (const sfen of [S.START_SFEN,
        'l6nl/5+P1gk/2np1S3/p1p4Pp/3P2Sp1/1PPb2P1P/P5GS1/R8/LN4bKL w RGgsn5p 1']){
      const t = Date.now();
      think(S.parseSfen(sfen), lv);
      worst = Math.max(worst, Date.now() - t);
    }
    // 打ち切りは1024局面ごとに見るため、上限を少し超えることがある
    ok(`  ${lv}  上限 ${LEVELS[lv].ms}ms → 実測 ${worst}ms`, worst <= LEVELS[lv].ms * 1.6 + 200, true);
  }
}

/* ───────── 4. 対局が終わること ───────── */

function play(lvB, lvW, maxPly = 300){
  const pos = S.parseSfen(S.START_SFEN);
  const hist = new Map();
  let worst = 0;
  for (let i = 0; i < maxPly; i++){
    const legal = new Set(S.legalMoves(pos).map(S.moveToUsi));
    if (legal.size === 0)
      return { winner: 1 - pos.turn, plies: i, worst, reason: S.inCheck(pos) ? '詰み' : '指し手なし' };
    const t = Date.now();
    const r = think(pos, pos.turn === S.BLACK ? lvB : lvW, hist);
    worst = Math.max(worst, Date.now() - t);
    if (!r || !legal.has(r.usi)) return { illegal: r && r.usi, plies: i, worst };
    S.doMove(pos, r.move);
    const k = posKey(pos);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  return { winner: null, plies: maxPly, worst, reason: '手数上限' };
}

console.log('\n対局');
{
  const g = play('easy', 'easy');
  ok('  easy 同士が終局する', g.reason, '詰み');
  note('  手数', g.plies);
}

if (process.argv.includes('--games')){
  console.log('\n難易度の順序（各1局）');
  for (const [a, b] of [['normal','easy'], ['hard','normal']]){
    const g1 = play(a, b), g2 = play(b, a);
    const win = (g1.winner === S.BLACK ? 1 : 0) + (g2.winner === S.WHITE ? 1 : 0);
    ok(`  ${a} が ${b} に勝ち越す`, win >= 1, true);
    note(`  ${a} vs ${b}`, `${win}/2 勝  ${g1.plies}手 / ${g2.plies}手`);
  }
}

console.log(`\n${fail === 0 ? '全て通過' : '失敗あり'} — ${pass} 件成功 / ${fail} 件失敗`);
if (!process.argv.includes('--games')) console.log('（--games で自己対局も実行）');
process.exit(fail ? 1 : 0);
