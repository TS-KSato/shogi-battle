/**
 * shogi.test.mjs — ルール層の検証
 *
 *   node shogi.test.mjs          … 通常（perft 深さ4まで／数秒）
 *   node shogi.test.mjs --full   … perft 深さ5と最多合法手局面の深さ3も回す（約40秒）
 *
 * perft の正解値は複数の独立実装で照合されている公開値。
 * ここが合わないなら、合法手生成のどこかが必ず壊れている。
 */

import * as S from '../src/shogi.js';

let pass = 0, fail = 0;
const ok = (name, got, want) => {
  const good = String(got) === String(want);
  console.log(`${good ? '  ok  ' : '  NG  '} ${name}` + (good ? '' : `\n        got ${got} / want ${want}`));
  good ? pass++ : fail++;
};
const usi = mvs => mvs.map(S.moveToUsi);

const FULL = process.argv.includes('--full');

/* ───────── 1. perft（初期局面） ───────── */

console.log('\nperft — 初期局面');
{
  const p = S.parseSfen(S.START_SFEN);
  const want = [null, 30, 900, 25470, 719731, 19861490];
  for (let d = 1; d <= (FULL ? 5 : 4); d++){
    const t = Date.now();
    ok(`  depth ${d}`, S.perft(p, d), want[d]);
  }
}

/* ───────── 2. perft（合法手が最多の局面） ─────────
   打ち歩詰め・行き所のない駒・大量の打つ手が同時に絡む。
   初期局面より、こちらのほうが検出力が高い。               */

console.log('\nperft — 最多合法手局面');
{
  const p = S.parseSfen('R8/2K1S1SSk/4B4/9/9/9/9/9/1L1L1L3 b RBGSNLP3g3n17p 1');
  ok('  depth 1', S.legalMoves(p).length, 593);
  ok('  depth 2', S.perft(p, 2), 105677);
  if (FULL) ok('  depth 3', S.perft(p, 3), 53393368);
}

/* ───────── 3. SFEN / USI ───────── */

console.log('\n表記');
{
  ok('  SFEN 往復（初期局面）', S.toSfen(S.parseSfen(S.START_SFEN)), S.START_SFEN);
  const mid = 'l6nl/5+P1gk/2np1S3/p1p4Pp/3P2Sp1/1PPb2P1P/P5GS1/R8/LN4bKL w RGgsn5p 1';
  ok('  SFEN 往復（持ち駒・成り駒あり）', S.toSfen(S.parseSfen(mid)), mid);
  ok('  USI 移動',  S.moveToUsi(S.usiToMove('7g7f')),  '7g7f');
  ok('  USI 成り',  S.moveToUsi(S.usiToMove('8h2b+')), '8h2b+');
  ok('  USI 打つ',  S.moveToUsi(S.usiToMove('P*5e')),  'P*5e');
}

/* ───────── 4. 二歩 ───────── */

console.log('\n二歩');
{
  // 先手の歩が5筋(5g)にいる。持ち駒の歩を5筋へ打てない。
  const p = S.parseSfen('4k4/9/9/9/9/9/4P4/9/4K4 b P 1');
  const drops = usi(S.legalMoves(p)).filter(m => m.startsWith('P*'));
  ok('  同じ筋へ打てない', drops.some(m => m[2] === '5'), false);
  ok('  別の筋へは打てる', drops.some(m => m[2] === '4'), true);
}

/* ───────── 5. 行き所のない駒 ───────── */

console.log('\n行き所のない駒');
{
  // 先手の歩が2段目。1段目へは成る手しかない。
  const p = S.parseSfen('4k4/4P4/9/9/9/9/9/9/4K4 b - 1');
  const m = usi(S.legalMoves(p)).filter(x => x.startsWith('5b'));
  ok('  歩は最終段で必ず成る', m.includes('5b5a+') && !m.includes('5b5a'), true);
}
{
  const p = S.parseSfen('4k4/9/9/9/9/9/9/9/4K4 b N 1');
  const d = usi(S.legalMoves(p)).filter(x => x.startsWith('N*'));
  ok('  桂は一段目に打てない', d.some(x => x[3] === 'a'), false);
  ok('  桂は二段目に打てない', d.some(x => x[3] === 'b'), false);
  ok('  桂は三段目に打てる',   d.some(x => x[3] === 'c'), true);
}

/* ───────── 6. 王手放置 ───────── */

console.log('\n王手放置');
{
  // 先手玉が5iにいて、後手の飛車が5筋を通している。玉は5筋から逃げるしかない。
  const p = S.parseSfen('4k4/9/9/9/4r4/9/9/9/4K4 b - 1');
  ok('  王手されている', S.inCheck(p), true);
  const m = usi(S.legalMoves(p));
  ok('  5筋に留まる手がない', m.some(x => x === '5i5h'), false);
  ok('  横へ逃げる手はある',   m.includes('5i4i') && m.includes('5i6i'), true);
}

/* ───────── 7. 打ち歩詰め ─────────
   後手玉9a。先手の銀7bが8aを、金8cが8b・9bを抑えている。
   9bへ歩を打つと詰みになるため反則。                          */

console.log('\n打ち歩詰め');
{
  const p = S.parseSfen('k8/2S6/1G7/9/9/9/9/9/8K b P 1');
  ok('  まだ王手ではない', S.inCheck(p, S.WHITE), false);

  const strict  = usi(S.legalMoves(p, true));
  const relaxed = usi(S.legalMoves(p, false));
  ok('  規則を外すと生成される', relaxed.includes('P*9b'), true);
  ok('  規則ありでは除かれる',   strict.includes('P*9b'), false);

  // 王手にはなるが詰まない歩打ちは合法
  const q = S.parseSfen('k8/9/1G7/9/9/9/9/9/8K b P 1');
  ok('  詰まない歩打ちは合法', usi(S.legalMoves(q)).includes('P*9b'), true);
}

/* ───────── 8. 詰み ───────── */

console.log('\n詰み');
{
  const p = S.parseSfen('k8/2S6/1G7/9/9/9/9/9/8K b P 1');
  S.doMove(p, S.usiToMove('P*9b'));            // 反則だが、詰みの形として使う
  ok('  王手されている', S.inCheck(p), true);
  ok('  合法手がない',   S.hasLegalMove(p), false);
  ok('  詰み判定',       S.isMate(p), true);
}
{
  const p = S.parseSfen(S.START_SFEN);
  ok('  初期局面は詰みでない', S.isMate(p), false);
}

/* ───────── 9. 着手と取消 ─────────
   どの手を指しても、戻せば必ず同じ SFEN に復元される。       */

console.log('\n着手と取消');
{
  let bad = 0;
  const walk = (pos, depth) => {
    if (depth === 0) return;
    const before = S.toSfen(pos);
    for (const mv of S.legalMoves(pos)){
      const u = S.doMove(pos, mv);
      walk(pos, depth - 1);
      S.undoMove(pos, mv, u);
      if (S.toSfen(pos) !== before) bad++;
    }
  };
  walk(S.parseSfen(S.START_SFEN), 3);
  ok('  3手先まで完全に復元', bad, 0);
}

/* ───────── 10. 千日手 ─────────
   手を進めながら局面のキーと王手の有無を積み、repetition に渡す。 */

console.log('\n千日手');
{
  // 同じ手順を繰り返して開始局面に戻す。局面の出現回数 = 1 + 繰り返し回数。
  const play = (sfen, cycle, times) => {
    const p = S.parseSfen(sfen);
    const keys = [S.positionKey(p)], checks = [S.inCheck(p)];
    for (let t = 0; t < times; t++)
      for (const u of cycle){ S.doMove(p, S.usiToMove(u)); keys.push(S.positionKey(p)); checks.push(S.inCheck(p)); }
    return S.repetition(keys, checks);
  };
  const shuffle = ['2h3h', '8b7b', '3h2h', '7b8b'];                 // 飛車を往復させるだけ。王手なし
  ok('  同一局面が3回では成立しない', play(S.START_SFEN, shuffle, 2), null);
  ok('  同一局面が4回で引き分け', play(S.START_SFEN, shuffle, 3), 'draw');
  // 先手の飛車が王手を続け、後手玉が 9a と 8a を往復する。先手の手は全て王手。
  const perpetual = ['8i9i', '9a8a', '9i8i', '8a9a'];
  ok('  王手を続けた側（先手）の負け', play('k8/9/9/9/9/9/9/9/1R6K b - 1', perpetual, 3), S.BLACK);
  ok('  王手を続けても3回では成立しない', play('k8/9/9/9/9/9/9/9/1R6K b - 1', perpetual, 2), null);
}

/* ───────── 結果 ───────── */

console.log(`\n${fail === 0 ? '全て通過' : '失敗あり'} — ${pass} 件成功 / ${fail} 件失敗`);
if (!FULL) console.log('（--full で perft 深さ5と最多合法手局面の深さ3も実行）');
process.exit(fail ? 1 : 0);
