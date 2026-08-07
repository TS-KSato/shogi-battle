/**
 * npc.js — 本体側から NPC を呼ぶ窓口
 *
 * Worker が返ってこない場合に対局を止めないための退避処理を持つ。
 * （仕様書 第11節「別スレッドから応答がない場合を検知し、対局停止を避ける」）
 *
 *   const npc = new Npc();
 *   npc.newGame();
 *   const { usi, fallback } = await npc.think(sfen, 'normal');
 *   npc.moved(sfenAfterMove);
 */

import { parseSfen, legalMoves, moveToUsi } from './shogi.js';

const TIMEOUT_MS = { easy: 3000, normal: 5000, hard: 8000 };

export class Npc {
  constructor(url = new URL('./npc.worker.js', import.meta.url)){
    this.url = url;
    this.seq = 0;
    this.pending = new Map();
    this.spawn();
  }

  spawn(){
    this.worker = new Worker(this.url, { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.type === 'error') p.reject(new Error(m.message));
      else p.resolve(m);
    };
    this.worker.onerror = () => this.recover();
  }

  /** Worker を作り直し、待っている要求は退避手で解決する */
  recover(){
    try { this.worker.terminate(); } catch {}
    for (const [, p] of this.pending){
      clearTimeout(p.timer);
      p.resolve(null);
    }
    this.pending.clear();
    this.spawn();
  }

  newGame(){ this.worker.postMessage({ type:'newgame' }); }
  moved(sfen){ this.worker.postMessage({ type:'moved', sfen }); }

  /**
   * @returns {Promise<{usi:string|null, fallback:boolean, ...}>}
   *   fallback:true なら Worker が応答せず、こちらで合法手を選んでいる。
   */
  async think(sfen, level = 'normal'){
    const id = ++this.seq;
    const limit = TIMEOUT_MS[level] || 5000;

    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.recover();
        resolve(null);                       // 時間切れ → 退避へ
      }, limit);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ type:'think', id, sfen, level });
    });

    if (res && res.usi) return { ...res, fallback: false };

    // 退避：本体側で合法手から選ぶ。対局は止めない。
    const moves = legalMoves(parseSfen(sfen));
    if (moves.length === 0) return { usi: null, fallback: true };
    return {
      usi: moveToUsi(moves[Math.floor(Math.random() * moves.length)]),
      fallback: true, score: 0, depth: 0, nodes: 0, ms: 0,
    };
  }

  dispose(){ try { this.worker.terminate(); } catch {} }
}
