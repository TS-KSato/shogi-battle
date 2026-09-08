/**
 * guide-photos.mjs — ガイドのルールの写真を assets/guide/rule-*.jpg に撮る
 *
 *   node tools/guide-photos.mjs
 *
 * 対局画面（play3d.html）を ?sfen= で開き、決まった局面で決まった操作をして撮る。
 * 画面の見た目を変えたら、これを実行して6枚を撮り直す。
 *
 *   capture-before / capture-after   降す直前（赤い輪）・直後（ログと控え欄）
 *   promo                            進化の確認で「進化する」を押した状態
 *   check                            大将が危ない
 *   mate-before / mate-after         追い詰める直前（2.2倍に拡大、控えを選択）・直後（等倍、結果の札）
 *
 * 画面は 375×667・DPR 1。JPEG 品質 82 で各 100KB 未満。
 *
 * 必要なもの：playwright-core と Chromium。guide-icons.mjs と同じく、playwright-core が
 * 別の場所にあれば NODE_PATH、Chromium の場所は CHROME、CDN に届かない環境では THREE_LIBS
 * （three.min.js / GLTFLoader.js / SkeletonUtils.js を置いたディレクトリ）で指す。
 * リポジトリを配る小さなサーバーはこの中で立てるので、別に用意しなくてよい。
 *
 * マスの画面座標は play3d.html の resize() と applyView() と同じ式で求める。
 * そちらのカメラや拡大の式を変えたら、ここも合わせること。
 */
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { readFileSync, existsSync, statSync, createReadStream } from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'assets/guide');
const W = 375, H = 667, QUALITY = 82;

const TYPES = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.json':'application/json', '.glb':'model/gltf-binary', '.jpg':'image/jpeg', '.png':'image/png' };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;

/* マス (col,row)（col = 9 − 筋、row = 段 − 1）の画面座標。等倍のカメラを play3d.html と同じ式で
   作って投影する。zoom を渡すと、そのマス zc,zr にカーソルを置いてホイールで zoom 倍にした後の
   座標（ndc' = zoom·ndc0 + (1 − zoom)·カーソルの ndc0）。 */
const SQPX = `(function(col, row, zoom, zc, zr){
  const view = document.getElementById('view'), canvas = view.querySelector('canvas');
  const w = view.clientWidth, h = view.clientHeight, N = 9, SQ = 1, TILT = 35*Math.PI/180, LENS = 0.42;
  const cam = new THREE.PerspectiveCamera(34, w/h, 0.5, 60);
  const FIT = 0.94, EDGE_PX = 2, halfW = (N*SQ)/2/FIT, lensX = 2*EDGE_PX/w - (1-FIT);
  const vFov = cam.fov*Math.PI/180, hFov = 2*Math.atan(Math.tan(vFov/2)*cam.aspect);
  const distW = halfW/Math.tan(hFov/2) + (N*SQ)/2*Math.cos(TILT);
  const distD = ((N*SQ)/2+0.3)*Math.sin(TILT)/Math.tan(vFov/2) + (N*SQ)/2*Math.cos(TILT);
  const dist = Math.max(distW, distD);
  cam.position.set(0, dist*Math.sin(TILT), dist*Math.cos(TILT)); cam.lookAt(0,0,0); cam.updateProjectionMatrix();
  const e = cam.projectionMatrix.elements; e[8] = -lensX; e[9] = LENS;
  cam.updateMatrixWorld();
  const v = new THREE.Vector3((col-4)*SQ, 0, (row-4)*SQ).project(cam);
  if (zoom){ const m = new THREE.Vector3((zc-4)*SQ, 0, (zr-4)*SQ).project(cam); v.x = zoom*v.x + (1-zoom)*m.x; v.y = zoom*v.y + (1-zoom)*m.y; }
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (v.x+1)/2*r.width, y: r.top + (1-v.y)/2*r.height };
})`;
const sq = s => [9 - +s[0], s.charCodeAt(1) - 97];     // '5e' → [col,row]

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
if (process.env.THREE_LIBS){
  for (const f of ['three.min.js', 'GLTFLoader.js', 'SkeletonUtils.js'])
    await page.route(`**/${f}`, r => r.fulfill({ contentType: 'application/javascript', body: readFileSync(path.join(process.env.THREE_LIBS, f), 'utf8') }));
}
const open = async sfen => {
  await page.goto(`http://localhost:${port}/play3d.html?sfen=${encodeURIComponent(sfen)}&side=0&level=easy`);
  await page.waitForTimeout(6000);                     // 兵のモデルの読み込みを待つ
};
const pxOf = (s, zoom = 0, zc = 0, zr = 0) => { const [c, r] = sq(s); return page.evaluate(`${SQPX}(${c},${r},${zoom},${zc},${zr})`); };
const tap = async (s, wait = 400) => { const p = await pxOf(s); await page.mouse.click(p.x, p.y); await page.waitForTimeout(wait); };
const shot = async name => {
  const f = path.join(OUT, `rule-${name}.jpg`);
  await page.screenshot({ path: f, type: 'jpeg', quality: QUALITY });
  const turn = await page.evaluate(() => document.getElementById('turn').textContent);
  const log = await page.evaluate(() => [...document.querySelectorAll('#log div')].map(d => d.textContent).filter(Boolean).join(' / '));
  console.log(`rule-${name}.jpg  ${statSync(f).size} bytes  「${turn}」${log ? '  ' + log : ''}`);
};

// 降す。5六の鉄砲兵は、5五の敵の鉄砲兵に大将ごと睨まれているので縦にしか動けない（印が少なく読みやすい）
await open('4k4/9/9/9/4r4/4R4/9/4K4/9 b - 1');
await tap('5f'); await shot('capture-before');
await tap('5e', 1400); await shot('capture-after');    // 降す演出（0.8秒）の後、敵軍が応じる前に撮る

// 進化。歩兵が5四から5三へ入り、「進化する」を押した状態
await open('4k4/9/9/4P4/9/9/9/4K4/9 b - 1');
await tap('5d'); await tap('5c');
await page.click('#promoYes'); await page.waitForTimeout(400);
await shot('promo');

// 大将が危ない。敵の鉄砲兵 5四が自軍の大将 5八に迫っている
await open('4k4/9/9/4r4/9/9/9/4K3L/9 b - 1');
await shot('check');

// 追い詰める。控えの近衛兵を5二へ投入。前は敵陣を2.2倍に拡大して控えを選んだ状態、後は等倍で結果の札
await open('3lkl3/3p1p3/9/9/1B7/9/9/9/4K4 b G 1');
const ZOOM = 2.2, [zc, zr] = sq('5c');
const c = await pxOf('5c');
await page.mouse.move(c.x, c.y); await page.mouse.wheel(0, -Math.log(ZOOM) / 0.0015); await page.waitForTimeout(400);   // wheel の式の逆
await page.click('#handBottom .koma'); await page.waitForTimeout(400);
await shot('mate-before');
await page.click('#reset'); await page.waitForTimeout(300);
await tap('5b', 1800);                                 // 投入 → 暗転 0.35秒 → 札 0.4秒
await shot('mate-after');

await browser.close(); srv.close();
