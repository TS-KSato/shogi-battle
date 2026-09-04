/**
 * guide-icons.mjs — ガイド用の兵の絵を assets/guide/<code>.png に生成する
 *
 *   node tools/guide-icons.mjs
 *
 * play3d.html と同じ three.js（CDN の同じ版）・同じ GLB・同じ照明で、俯角35度から
 * 1体ずつ撮る。姿勢は待機アニメの途中。自軍（青）を対局画面と同じ奥向きで。背景は透明。
 * 近衛兵には幟、進化した鉄砲兵には大砲を、対局画面と同じ位置に添える。
 *
 * 枠は全枚 240×280 で共通。カメラの距離と拡大率も全枚で共通にするので、兵の背丈が
 * 揃っていれば絵の中の見かけの大きさも揃う。各枚は不透明な画素の範囲の中心を枠の中心に置く。
 *
 * 必要なもの：playwright-core と Chromium。playwright-core が別の場所にあるなら
 * NODE_PATH で指す。Chromium の場所は CHROME で指定できる。CDN に届かない環境では
 * THREE_LIBS に three.min.js / GLTFLoader.js / SkeletonUtils.js を置いたディレクトリを指すと
 * そこから読む。
 */
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createReadStream } from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'assets/guide');

/* 出力名 → モデル。side は向きと色。extra は添える静止形状とその位置（play3d.html の
   NOBORI_SIDE / NOBORI_BACK / TAIHO_SIDE と同じ。駒の全高 0.7026 に対する比）。 */
const ITEMS = [
  { code:'fu',        file:'fu_blue_idle.glb',        side:'blue' },
  { code:'kyo',       file:'kyo_blue_idle.glb',       side:'blue' },
  { code:'kei',       file:'kei_blue_idle.glb',       side:'blue' },
  { code:'gin',       file:'gin_blue_idle.glb',       side:'blue' },
  { code:'kin',       file:'kin_blue_idle.glb',       side:'blue', extra:{ file:'nobori_blue.glb', x:0.38*0.7026, z:0.05*0.7026 } },
  { code:'kaku',      file:'kaku_blue_idle.glb',      side:'blue' },
  { code:'hisha',     file:'hisha_blue_idle.glb',     side:'blue' },
  { code:'gyoku',     file:'gyoku_blue_idle.glb',     side:'blue' },
  { code:'uma',       file:'kaku_blue_promoted.glb',  side:'blue' },
  { code:'ryu',       file:'hisha_blue_promoted.glb', side:'blue', extra:{ file:'taiho.glb', x:0.35*0.7026, z:0 } },
];
const RENDER_W = 720, RENDER_H = 840;      // 下描きの大きさ。枠より大きく描いて縮める
const FRAME_W = 240, FRAME_H = 280;        // 出力の枠。全枚共通
const MARGIN = 10;                         // いちばん大きい兵と枠のすき間

// リポジトリをそのまま配る小さなサーバー（GLB を相対パスで読むため）
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.glb':'model/gltf-binary' };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME, args:['--no-sandbox'] });
const page = await browser.newPage();
if (process.env.THREE_LIBS){
  const local = { 'three.min.js':'three.min.js', 'GLTFLoader.js':'GLTFLoader.js', 'SkeletonUtils.js':'SkeletonUtils.js' };
  for (const [tail, f] of Object.entries(local))
    await page.route(`**/${tail}`, r => r.fulfill({ contentType:'application/javascript', body: readFileSync(path.join(process.env.THREE_LIBS, f), 'utf8') }));
}
await page.goto(`http://localhost:${port}/guide.html`);
for (const url of [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/utils/SkeletonUtils.js',
]) await page.addScriptTag({ url });

const shots = await page.evaluate(async ({ items, RENDER_W, RENDER_H, FRAME_W, FRAME_H, MARGIN }) => {
  const load = url => new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const lambert = src => { const m = new THREE.MeshLambertMaterial({ skinning: true }); if (src.map) m.map = src.map; if (src.color) m.color.copy(src.color); return m; };
  const TILT = 35 * Math.PI/180;
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(1); renderer.setSize(RENDER_W, RENDER_H, false); renderer.setClearColor(0x000000, 0);
  const cam = new THREE.PerspectiveCamera(34, RENDER_W/RENDER_H, 0.05, 20);

  // 兵ごとに場面を作り、外接箱の8隅を控える
  const scenes = [];
  for (const it of items){
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xbfd4e8, 0x2a2216, 0.5));      // play3d.html と同じ照明
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.1); sun.position.set(7, 4.5, 3); sc.add(sun);
    const rim = new THREE.DirectionalLight(0x8fa9d8, 0.4); rim.position.set(-5, 2.5, -6); sc.add(rim);
    const g = await load(`./assets/${it.file}`);
    const obj = THREE.SkeletonUtils.clone(g.scene);
    const box = new THREE.Box3();
    obj.traverse(o => { if (o.isSkinnedMesh){ o.material = lambert(o.material); o.frustumCulled = false;
      o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); } });
    obj.rotation.y = it.side === 'blue' ? Math.PI : 0;               // 対局画面と同じ向き（自軍は奥向き）
    sc.add(obj);
    // 素の姿勢は T ポーズなので、対局画面と同じ待機アニメの姿勢にしてから撮る
    const mixer = new THREE.AnimationMixer(obj);
    mixer.clipAction(g.animations[0]).play(); mixer.update(0.4);
    if (it.extra){
      const e = await load(`./assets/${it.extra.file}`);
      e.scene.traverse(o => { if (o.isMesh){ o.material = lambert(o.material); o.material.skinning = false;
        o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().translate(new THREE.Vector3(it.extra.x, 0, it.extra.z)); box.union(b); } });
      e.scene.position.set(it.extra.x, 0, it.extra.z);
      sc.add(e.scene);
    }
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z])
      corners.push(new THREE.Vector3(x, y, z));
    scenes.push({ it, sc, center: box.getCenter(new THREE.Vector3()), corners });
  }

  // 全枚で同じ距離から撮る。距離はいちばん遠くから見る必要がある兵に合わせる
  const place = (s, dist) => {
    cam.position.set(s.center.x, s.center.y + dist*Math.sin(TILT), s.center.z + dist*Math.cos(TILT));
    cam.lookAt(s.center); cam.updateMatrixWorld(true);
  };
  const fits = (s, dist) => { place(s, dist);
    return s.corners.every(c => { const v = c.clone().project(cam); return Math.abs(v.x) <= 0.98 && Math.abs(v.y) <= 0.98; }); };
  let dist = 0;
  for (const s of scenes){
    let lo = 0.1, hi = 20;
    for (let i = 0; i < 40; i++){ const mid = (lo + hi) / 2; if (fits(s, mid)) hi = mid; else lo = mid; }
    dist = Math.max(dist, hi);
  }

  // 同じ距離で描き、不透明な画素の範囲を切り出す
  const crops = scenes.map(s => {
    place(s, dist);
    renderer.render(s.sc, cam);
    const src = document.createElement('canvas'); src.width = RENDER_W; src.height = RENDER_H;
    src.getContext('2d').drawImage(renderer.domElement, 0, 0);
    const d = src.getContext('2d').getImageData(0, 0, RENDER_W, RENDER_H).data;
    let x0 = RENDER_W, y0 = RENDER_H, x1 = -1, y1 = -1;
    for (let y = 0; y < RENDER_H; y++) for (let x = 0; x < RENDER_W; x++) if (d[(y*RENDER_W + x)*4 + 3] > 8){
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { code: s.it.code, src, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  });

  // いちばん大きい幅・高さが枠に収まる拡大率を1つ決め、全枚に使う
  const maxW = Math.max(...crops.map(c => c.w)), maxH = Math.max(...crops.map(c => c.h));
  const scale = Math.min((FRAME_W - 2*MARGIN)/maxW, (FRAME_H - 2*MARGIN)/maxH);
  return crops.map(c => {
    const w = c.w * scale, h = c.h * scale;
    const out = document.createElement('canvas'); out.width = FRAME_W; out.height = FRAME_H;
    const g2 = out.getContext('2d'); g2.imageSmoothingQuality = 'high';
    g2.drawImage(c.src, c.x0, c.y0, c.w, c.h, (FRAME_W - w)/2, (FRAME_H - h)/2, w, h);
    return { code: c.code, url: out.toDataURL('image/png'), w: Math.round(w), h: Math.round(h) };
  });
}, { items: ITEMS, RENDER_W, RENDER_H, FRAME_W, FRAME_H, MARGIN });

mkdirSync(OUT, { recursive:true });
for (const s of shots){
  const buf = Buffer.from(s.url.split(',')[1], 'base64');
  writeFileSync(path.join(OUT, `${s.code}.png`), buf);
  console.log(`${s.code}.png  ${FRAME_W}x${FRAME_H}  兵の占める大きさ ${s.w}x${s.h}  ${buf.length} bytes`);
}
await browser.close(); srv.close();
