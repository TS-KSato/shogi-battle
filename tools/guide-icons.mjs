/**
 * guide-icons.mjs — ガイド用の兵の絵を assets/guide/<code>.png に生成する
 *
 *   node tools/guide-icons.mjs
 *
 * play3d.html と同じ three.js（CDN の同じ版）・同じ GLB・同じ照明で、俯角35度から
 * 1体ずつ撮る。姿勢は待機アニメの途中。自軍（青）を対局画面と同じ奥向きで。背景は透明。
 * 描画後に透明でない画素の範囲を切り取り、四辺に同じ余白を付けて中央に置く。
 * 近衛兵には幟、進化した鉄砲兵には大砲を、対局画面と同じ位置に添える。
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
const W = 360, H = 420, MARGIN = 12;   // 描画の大きさと、切り取り後の余白（px）

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

mkdirSync(OUT, { recursive:true });
for (const it of ITEMS){
  const dataUrl = await page.evaluate(async ({ it, W, H, MARGIN }) => {
    const load = url => new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
    const lambert = src => { const m = new THREE.MeshLambertMaterial({ skinning: true }); if (src.map) m.map = src.map; if (src.color) m.color.copy(src.color); return m; };
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
    const sc = new THREE.Scene();
    // play3d.html と同じ照明
    sc.add(new THREE.HemisphereLight(0xbfd4e8, 0x2a2216, 0.5));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.1); sun.position.set(7, 4.5, 3); sc.add(sun);
    const rim = new THREE.DirectionalLight(0x8fa9d8, 0.4); rim.position.set(-5, 2.5, -6); sc.add(rim);

    const g = await load(`./assets/${it.file}`);
    const obj = THREE.SkeletonUtils.clone(g.scene);
    const box = new THREE.Box3();
    obj.traverse(o => { if (o.isSkinnedMesh){ o.material = lambert(o.material); o.frustumCulled = false;
      o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); } });
    obj.rotation.y = it.side === 'blue' ? Math.PI : 0;     // 対局画面と同じ向き（自軍は奥向き）
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
    // 俯角35度から、箱の8隅が画面に収まる最短の距離で撮る（余白を最小にして兵を大きく）
    const TILT = 35 * Math.PI/180;
    const center = box.getCenter(new THREE.Vector3());
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const cam = new THREE.PerspectiveCamera(34, W/H, 0.05, 20);
    const fits = dist => {
      cam.position.set(center.x, center.y + dist*Math.sin(TILT), center.z + dist*Math.cos(TILT));
      cam.lookAt(center); cam.updateMatrixWorld(true);
      return corners.every(c => { const v = c.clone().project(cam); return Math.abs(v.x) <= 0.96 && Math.abs(v.y) <= 0.96; });
    };
    let lo = 0.1, hi = 20;
    for (let i = 0; i < 40; i++){ const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi);
    renderer.render(sc, cam);
    // 透明でない画素の範囲を求め、同じ余白で切り取る
    const src = document.createElement('canvas'); src.width = W; src.height = H;
    const g2 = src.getContext('2d'); g2.drawImage(renderer.domElement, 0, 0);
    const d = g2.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y*W + x)*4 + 3] > 8){
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const out = document.createElement('canvas'); out.width = bw + 2*MARGIN; out.height = bh + 2*MARGIN;
    out.getContext('2d').drawImage(src, x0, y0, bw, bh, MARGIN, MARGIN, bw, bh);
    const url = out.toDataURL('image/png');
    renderer.dispose();
    return url;
  }, { it, W, H, MARGIN });
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(path.join(OUT, `${it.code}.png`), buf);
  console.log(`${it.code}.png  ${buf.length} bytes`);
}
await browser.close(); srv.close();
