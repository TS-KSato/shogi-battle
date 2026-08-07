/**
 * npc.worker.js — NPC を描画から切り離すための Worker
 *
 *   new Worker('./npc.worker.js', { type: 'module' })
 *
 * 受け取る指示
 *   { type:'newgame' }                     … くり返し記録を消す
 *   { type:'moved',  sfen }                … 指した後の局面を記録する
 *   { type:'think',  id, sfen, level }     … 考えて返す
 *
 * 返すもの
 *   { type:'result', id, usi, score, depth, nodes, ms }
 *   { type:'error',  id, message }
 */

import { parseSfen } from './shogi.js';
import { think, posKey } from './engine.js';

let history = new Map();

self.onmessage = (e) => {
  const msg = e.data || {};

  try {
    switch (msg.type){
      case 'newgame':
        history = new Map();
        break;

      case 'moved': {
        const k = posKey(parseSfen(msg.sfen));
        history.set(k, (history.get(k) || 0) + 1);
        break;
      }

      case 'think': {
        const t0 = Date.now();
        const r = think(parseSfen(msg.sfen), msg.level, history);
        if (!r){
          self.postMessage({ type:'result', id: msg.id, usi: null, ms: Date.now() - t0 });
          break;
        }
        self.postMessage({
          type: 'result', id: msg.id,
          usi: r.usi, score: r.score, depth: r.depth, nodes: r.nodes,
          ms: Date.now() - t0,
        });
        break;
      }
    }
  } catch (err){
    self.postMessage({ type:'error', id: msg.id, message: String(err && err.message || err) });
  }
};
