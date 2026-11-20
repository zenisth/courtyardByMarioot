import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DATA = window.__DATA__;
const M = DATA.meta;
const DAY = 864e5, T0 = Date.UTC(2028, 0, 1);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = d => { const t = new Date(T0 + Math.round(d) * DAY); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
const $ = s => document.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* ================= schedule + payment-delay engine ================= */
const ACTS = M.acts.map((a, i) => ({ ...a, i }));
const BASE_END = Math.max(...ACTS.map(a => a.e));
const MILES = ACTS.filter(a => a.ms);
const S = { delays: Object.fromEntries(MILES.map(m => [m.i, 0])), restart: 7, grace: 15, terms: 15, halts: [] };

function rOf(b, side = 'end') {          // baseline day -> calendar day
  let o = 0;
  for (const h of S.halts) { if (h.anchor < b || (side === 'start' && h.anchor <= b)) o += h.e - h.s; }
  return b + o;
}
function rInv(d) {                       // calendar day -> baseline (work) day
  let o = 0;
  for (const h of S.halts) { if (d < h.s) break; if (d < h.e) return h.anchor; o += h.e - h.s; }
  return d - o;
}
function computeHalts() {
  S.halts = [];
  for (const m of MILES) {
    const D = S.delays[m.i];
    m.done = rOf(m.e, 'end'); m.due = m.done + S.terms; m.paid = m.due + D; m.impact = 0; m.note = '';
    if (D <= S.grace) { m.note = D ? 'Within grace period' : ''; continue; }
    const stopAt = m.due + S.grace, resume = m.paid + S.restart;
    const anchor = rInv(stopAt);
    if (anchor >= BASE_END) { m.note = 'Works already complete'; continue; }
    const inside = S.halts.find(h => stopAt >= h.s && stopAt < h.e);
    if (inside) { const add = Math.max(0, resume - inside.e); inside.e += add; m.impact = add; if (add) inside.who.push(m.name); }
    else {
      // shift later halts (none yet, processed in order) and insert
      S.halts.push({ s: stopAt, e: resume, anchor, who: [m.name] }); m.impact = resume - stopAt;
    }
    S.halts.sort((a, b) => a.s - b.s);
  }
  for (const a of ACTS) { a.rs = rOf(a.s, 'start'); a.re = rOf(a.e, 'end'); if (a.segs) a.rsegs = a.segs.map(([s, e]) => [rOf(s, 'start'), rOf(e, 'end')]); }
  S.end = rOf(BASE_END, 'end');
}
computeHalts();

/* ================= decode geometry ================= */
async function decode() {
  const bin = Uint8Array.from(atob(DATA.b64), c => c.charCodeAt(0));
  const ds = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(ds).arrayBuffer()).buffer;
}

/* ================= three scene ================= */
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
camera.position.set(-150, 115, 165);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 8, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 40; controls.maxDistance = 700;
const HOME = { p: camera.position.clone(), t: controls.target.clone() };
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-60, 120, 80); scene.add(sun);

const U = { uT: { value: 0 } };
const LIGHT = `float lit(vec3 n){ vec3 L=normalize(vec3(-0.45,0.8,0.55)); return 0.62+0.22*n.y+0.28*max(dot(n,L),0.0); }`;
const VS = `
attribute vec2 aT; attribute vec4 aAx; attribute float aPt;
varying vec2 vT; varying vec4 vAx; varying float vPt; varying float vC; varying float vL;
${LIGHT}
void main(){
  vT=aT; vAx=aAx; vPt=aPt;
  vC = aAx.x<0.5 ? position.y : (aAx.x<1.5 ? position.z : position.x);
  #ifdef USE_LIT
  vL = lit(normalize(normal));
  #else
  vL = 1.0;
  #endif
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
const FS_COMMON = `
uniform float uT; varying vec2 vT; varying vec4 vAx; varying float vPt; varying float vC; varying float vL;
float prog(){ return clamp((uT-vT.x)/max(vT.y-vT.x,0.001),0.0,1.0); }
float frac(){ float d=vAx.z-vAx.y; return abs(d)<0.001?0.0:(vC-vAx.y)/d; }
vec3 baseCol(){
  vec3 c = vAx.w<0.5 ? vec3(0.60,0.66,0.72) : (vAx.w<1.5 ? vec3(0.89,0.82,0.73) : vec3(0.58,0.76,0.86));
  if(vAx.w>0.5 && vAx.w<1.5 && vPt>=0.0) c = mix(c, vec3(0.93,0.91,0.87), clamp((uT-vPt)/3.0,0.0,1.0));
  return c;
}`;
const solidMat = new THREE.ShaderMaterial({
  uniforms: U, defines: { USE_LIT: 1 }, vertexShader: VS,
  fragmentShader: FS_COMMON + `
  void main(){
    if(uT<vT.x) discard; float p=prog(); float f=frac();
    if(p<1.0 && f>p+0.0005) discard;
    vec3 c = p<1.0 ? vec3(0.91,0.45,0.17) : baseCol();
    gl_FragColor=vec4(c*vL,1.0);
  }`,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
const ghostMat = new THREE.ShaderMaterial({
  uniforms: U, defines: { USE_LIT: 1 }, vertexShader: VS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  fragmentShader: FS_COMMON + `
  void main(){
    if(uT>=vT.y) discard; float p=prog();
    if(uT>=vT.x && frac()<=p) discard;
    gl_FragColor=vec4(vec3(0.80,0.82,0.85), 0.07);
  }`,
});
const lineMat = new THREE.ShaderMaterial({
  uniforms: U, vertexShader: VS, transparent: true, depthWrite: false,
  fragmentShader: FS_COMMON + `
  void main(){
    float p=prog(); bool built = uT>=vT.x && (p>=1.0 || frac()<=p+0.0005);
    if(built) gl_FragColor = p<1.0 ? vec4(0.55,0.22,0.05,0.7) : vec4(0.20,0.25,0.31,0.42);
    else gl_FragColor = vec4(0.45,0.49,0.54,0.16);
  }`,
});

const E = M.elements; // [act,cat,t0,t1,ax,lo,hi,pt,si]
const t1sorted = E.map(e => e[3]).sort((a, b) => a - b);
const t0sorted = E.map(e => e[2]).sort((a, b) => a - b);
const countLE = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };

function buildGeom(pos, elem, perVert) {
  const n = pos.length / 3, g = new THREE.BufferGeometry();
  const aT = new Float32Array(n * 2), aAx = new Float32Array(n * 4), aPt = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const e = E[elem[Math.floor(v / perVert)]];
    aT[v * 2] = e[2]; aT[v * 2 + 1] = e[3];
    aAx[v * 4] = e[4]; aAx[v * 4 + 1] = e[5]; aAx[v * 4 + 2] = e[6]; aAx[v * 4 + 3] = e[1];
    aPt[v] = e[7];
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 2));
  g.setAttribute('aAx', new THREE.BufferAttribute(aAx, 4));
  g.setAttribute('aPt', new THREE.BufferAttribute(aPt, 1));
  return g;
}

/* ---- ground + pit ---- */
const PIT = M.pit; // x1,z1,x2,z2
const groundMat = new THREE.ShaderMaterial({
  uniforms: { uHole: { value: 0 } },
  vertexShader: `varying vec3 vW; void main(){ vW=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `uniform float uHole; varying vec3 vW;
   void main(){ if(uHole>0.5 && vW.x>${PIT[0].toFixed(2)} && vW.x<${PIT[2].toFixed(2)} && vW.z>${PIT[1].toFixed(2)} && vW.z<${PIT[3].toFixed(2)}) discard;
   gl_FragColor=vec4(0.905,0.885,0.84,1.0);} `,
  polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
});
const plane = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: 0xefece5 }));
plane.rotation.x = -Math.PI / 2; plane.position.y = -6.5; scene.add(plane);
const pitW = PIT[2] - PIT[0], pitD = PIT[3] - PIT[1], pitCx = (PIT[0] + PIT[2]) / 2, pitCz = (PIT[1] + PIT[3]) / 2;
const soil = new THREE.MeshLambertMaterial({ color: 0xc2ad8f, side: THREE.DoubleSide });
const pitFloor = new THREE.Mesh(new THREE.PlaneGeometry(pitW, pitD), new THREE.MeshLambertMaterial({ color: 0xb59f80 }));
pitFloor.rotation.x = -Math.PI / 2; pitFloor.position.set(pitCx, -0.05, pitCz); scene.add(pitFloor);
const pitWalls = new THREE.Group(); scene.add(pitWalls);
[[pitW, 0, pitD / 2, 0], [pitW, 0, -pitD / 2, 0], [pitD, pitW / 2, 0, Math.PI / 2], [pitD, -pitW / 2, 0, Math.PI / 2]].forEach(([w, x, z, r]) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), soil); m.position.set(pitCx + x, -0.5, pitCz + z); m.rotation.y = r; pitWalls.add(m);
});
// shrubs cleared during site cleaning
const shrubs = [];
{ const g = new THREE.ConeGeometry(1.4, 2.6, 6), mat = new THREE.MeshLambertMaterial({ color: 0x8fa66b });
  let s = 7; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 46; i++) { const m = new THREE.Mesh(g, mat); m.position.set(PIT[0] + 4 + rnd() * (pitW - 8), 1.3, PIT[1] + 4 + rnd() * (pitD - 8)); m.scale.setScalar(0.6 + rnd() * 0.8); m.userData.t = rnd() * 9; scene.add(m); shrubs.push(m); } }

/* ================= equipment ================= */
const YEL = new THREE.MeshLambertMaterial({ color: 0xf2b632 }), DARK = new THREE.MeshLambertMaterial({ color: 0x39424c }),
  GREY = new THREE.MeshLambertMaterial({ color: 0xd5d8dc }), WHITE = new THREE.MeshLambertMaterial({ color: 0xf4f4f2 }),
  ORG = new THREE.MeshLambertMaterial({ color: 0xe8742c });
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
const cyl = (r, l, mat) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 14), mat);

function excavator() {
  const g = new THREE.Group();
  g.add(box(3.4, 0.9, 4.4, DARK, 0, 0.45, 0));
  const up = new THREE.Group(); up.position.y = 0.9; g.add(up);
  up.add(box(3.0, 1.2, 3.2, YEL, 0, 0.6, 0.3)); up.add(box(1.1, 1.3, 1.2, YEL, -0.8, 1.85, -0.6)); up.add(box(1.0, 1.0, 1.1, GREY, -0.8, 1.95, -0.6));
  const boom = new THREE.Group(); boom.position.set(0.5, 1.2, -1.2); up.add(boom);
  const b1 = box(0.5, 0.6, 4.6, YEL, 0, 0, -2.3); boom.add(b1);
  const stick = new THREE.Group(); stick.position.set(0, 0, -4.6); boom.add(stick);
  stick.add(box(0.4, 0.5, 3.2, YEL, 0, 0, -1.6));
  const bucket = box(1.2, 0.9, 0.9, DARK, 0, -0.2, -3.3); stick.add(bucket);
  g.userData = { up, boom, stick };
  g.scale.setScalar(1.15);
  return g;
}
function dumper() {
  const g = new THREE.Group();
  g.add(box(2.5, 0.8, 8, DARK, 0, 0.9, 0)); g.add(box(2.5, 2.0, 2.0, YEL, 0, 2.2, -3)); g.add(box(2.6, 1.6, 5.2, GREY, 0, 2.1, 1.1));
  [-2.8, 0.8, 2.8].forEach(z => [-1.25, 1.25].forEach(x => { const w = cyl(0.55, 0.45, DARK); w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w); }));
  return g;
}
function rmc() {
  const g = new THREE.Group();
  g.add(box(2.4, 0.7, 8.5, DARK, 0, 0.9, 0)); g.add(box(2.4, 2.1, 2.0, YEL, 0, 2.2, -3.2));
  const drum = new THREE.Group(); drum.position.set(0, 2.9, 1.0); drum.rotation.x = -0.25; g.add(drum);
  const d = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.8, 5, 16), GREY); d.rotation.x = Math.PI / 2; drum.add(d);
  const st = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.12, 6, 16), ORG); st.position.z = 0.6; drum.add(st);
  const st2 = st.clone(); st2.position.z = -1.0; st2.scale.setScalar(1.08); drum.add(st2);
  [-2.9, 1.2, 3.0].forEach(z => [-1.2, 1.2].forEach(x => { const w = cyl(0.55, 0.45, DARK); w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w); }));
  g.userData = { drum };
  return g;
}
const SEG = [15, 14, 14, 13];
function pumpTruck() {
  const g = new THREE.Group();
  g.add(box(2.6, 1.0, 12, DARK, 0, 1.0, 0)); g.add(box(2.6, 2.2, 2.2, YEL, 0, 2.6, -4.6)); g.add(box(2.4, 1.2, 6.5, YEL, 0, 2.1, 1.4));
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const o = box(4.5, 0.3, 0.4, YEL, sx * 3.2, 0.6, sz * 3); o.rotation.y = sx * sz * 0.5; g.add(o); g.add(box(0.8, 0.2, 0.8, DARK, sx * 5.2, 0.1, sz * 3 + sx * sz * 1.2)); });
  const turret = new THREE.Group(); turret.position.set(0, 3.2, -1.8); g.add(turret);
  turret.add(cyl(1.0, 1.2, YEL));
  const segs = SEG.map((L, i) => { const s = box(0.55 - i * 0.07, 0.55 - i * 0.07, 1, i % 2 ? ORG : YEL); turret.add(s); return s; });
  const hose = box(0.25, 3.5, 0.25, DARK); turret.add(hose);
  g.userData = { turret, segs, hose, J: null };
  return g;
}
function towerCrane() {
  const g = new THREE.Group();
  const mast = new THREE.Group(); g.add(mast);
  const top = new THREE.Group(); g.add(top);
  const slew = new THREE.Group(); top.add(slew);
  slew.add(box(2.4, 1.2, 2.4, YEL, 0, 0.6, 0));
  slew.add(box(1.6, 1.8, 1.8, WHITE, 1.4, 1.6, 0));
  const jib = box(45, 1.3, 1.2, YEL, 22.5 + 1.2, 1.8, 0); slew.add(jib);
  { const je = new THREE.LineSegments(new THREE.EdgesGeometry(jib.geometry), new THREE.LineBasicMaterial({ color: 0x8a6a10 })); je.position.copy(jib.position); slew.add(je); }
  const cj = box(14, 1.1, 1.6, YEL, -7 - 1.2, 1.8, 0); slew.add(cj);
  slew.add(box(3, 3, 2.4, GREY, -12.5, 0.3, 0));
  slew.add(box(1.4, 7, 1.4, YEL, 0, 5.2, 0));
  const pend = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 8.6, 0), new THREE.Vector3(46, 2.4, 0), new THREE.Vector3(0, 8.6, 0), new THREE.Vector3(-14.5, 2.4, 0)]);
  slew.add(new THREE.LineSegments(pend, new THREE.LineBasicMaterial({ color: 0x5a4a20 })));
  const trolley = new THREE.Group(); slew.add(trolley); trolley.add(box(1.4, 0.5, 1.5, DARK, 0, 0.9, 0));
  const rope = box(0.08, 1, 0.08, DARK); trolley.add(rope);
  const load = new THREE.Group(); trolley.add(load); load.add(box(0.7, 0.6, 0.7, DARK)); load.add(box(3.5, 0.5, 1.2, ORG, 0, -1.2, 0));
  g.userData = { mast, top, slew, trolley, rope, load, h: -1 };
  return g;
}
function setMast(c, h) {
  if (c.userData.h === h) return; c.userData.h = h;
  const { mast, top } = c.userData; mast.clear();
  const base = -4.5, L = h - base;
  const pts = []; const s = 0.9;
  for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) pts.push(x, base, z, x, h, z);
  for (let y = base; y < h; y += 2.6) {
    const y2 = Math.min(h, y + 2.6);
    pts.push(-s, y, -s, s, y2, -s, s, y, -s, s, y2, s, s, y, s, -s, y2, s, -s, y, s, -s, y2, -s);
    pts.push(-s, y, -s, s, y, -s, s, y, -s, s, y, s, s, y, s, -s, y, s, -s, y, s, -s, y, -s);
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  mast.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x9a6c0c })));
  const core = box(1.8, L, 1.8, new THREE.MeshLambertMaterial({ color: 0xf2b632, transparent: true, opacity: 0.55 }), 0, base + L / 2, 0); mast.add(core);
  top.position.y = h;
}
function cabin(color) { const g = new THREE.Group(); g.add(box(6, 2.6, 2.5, new THREE.MeshLambertMaterial({ color }), 0, 1.3, 0)); g.add(box(6.2, 0.2, 2.7, DARK, 0, 2.7, 0)); return g; }

const EQ = new THREE.Group(); scene.add(EQ);
const ex1 = excavator(), ex2 = excavator(), dmp = dumper(), crane = towerCrane(), pump = pumpTruck();
const trucks = [0, 1, 2, 3, 4].map(() => rmc());
EQ.add(ex1, ex2, dmp, crane, pump, ...trucks);
const cabins = new THREE.Group(); EQ.add(cabins);
[[0, 0, 0xf4f4f2], [0, 3.6, 0xf4f4f2], [7, 0, 0xdfe6ec], [7, 3.6, 0xf4f4f2]].forEach(([x, z, c]) => { const k = cabin(c); k.position.set(x, 0, z); cabins.add(k); });
cabins.position.set(-58, 0, -48);
crane.position.set(M.lift[0], 0, M.lift[1]);
const PUMP_POS = new THREE.Vector3(-47.5, 0, 24);
pump.position.copy(PUMP_POS);
const ROAD_X = -47.5;

function solveBoom(J, base, target) {   // FABRIK in 2D (u = horizontal, v = height)
  const n = SEG.length, tot = SEG.reduce((a, b) => a + b);
  const d = Math.hypot(target[0] - base[0], target[1] - base[1]);
  if (d >= tot - 0.01) { let p = base.slice(); J[0] = p.slice(); const dir = [(target[0] - base[0]) / d, (target[1] - base[1]) / d];
    for (let i = 0; i < n; i++) { p = [p[0] + dir[0] * SEG[i], p[1] + dir[1] * SEG[i]]; J[i + 1] = p; } return; }
  for (let it = 0; it < 14; it++) {
    J[n] = target.slice();
    for (let i = n - 1; i >= 0; i--) { const dx = J[i][0] - J[i + 1][0], dy = J[i][1] - J[i + 1][1], l = Math.hypot(dx, dy) || 1; J[i] = [J[i + 1][0] + dx / l * SEG[i], J[i + 1][1] + dy / l * SEG[i]]; }
    J[0] = base.slice();
    for (let i = 0; i < n; i++) { const dx = J[i + 1][0] - J[i][0], dy = J[i + 1][1] - J[i][1], l = Math.hypot(dx, dy) || 1; J[i + 1] = [J[i][0] + dx / l * SEG[i], J[i][1] + dy / l * SEG[i]]; }
  }
}

/* ================= state helpers ================= */
const actByName = Object.fromEntries(ACTS.map(a => [a.name, a]));
const P = (a, t) => clamp((t - a.s) / Math.max(a.e - a.s, 0.001), 0, 1);
function builtTop(t) { let top = 0; for (let i = 1; i < 13; i++) { const a = actByName[M.slabAct[i]]; if (a && t > a.s + (a.e - a.s) * 0.5) top = Math.max(top, M.lev[i]); } return top; }
function pourAt(t) { return M.pours.find(p => t >= p[0] && t < p[1]); }
function haltAt(d) { return S.halts.find(h => d >= h.s && d < h.e); }

/* ================= UI ================= */
const ui = {
  date: $('#date'), week: $('#week'), status: $('#status'), onsite: $('#onsite'), count: $('#count'),
  slider: $('#slider'), play: $('#play'), sub: $('#sub'),
};
let cal = 0, playing = true, speed = 1;

// floor grid
const grid = $('#floors');
const FL = M.storeys;
grid.innerHTML = `<div class="gl">Frame</div>` + FL.map((s, i) => `<div class="cell" id="f${i}">${s}</div>`).join('') +
  `<div class="gl">Masonry</div>` + FL.map((s, i) => `<div class="cell" id="m${i}">${s}</div>`).join('');
const frameAct = i => actByName[M.colAct[i]];
const masWin = i => (i < 12 ? { s: M.mas[i][0], e: M.mas[i][1] } : actByName['Terrace']);

// payment drawer
const pd = $('#paylist');
const OPTS = [[0, 'On time'], [15, '15 days'], [30, '1 month'], [45, '1.5 months'], [60, '2 months'], [90, '3 months'], [120, '4 months'], [180, '6 months']];
pd.innerHTML = MILES.map(m => `<div class="prow" id="pr${m.i}"><div class="pn"><b>${m.name}</b><span class="pdue"></span></div>
 <select data-i="${m.i}">${OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><div class="pimp"></div></div>`).join('');
pd.addEventListener('change', e => { const i = e.target.dataset.i; if (i != null) { S.delays[i] = +e.target.value; recalc(); } });
$('#all').innerHTML = `<option value="">Set all…</option>` + OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
$('#all').addEventListener('change', e => { if (e.target.value === '') return; for (const m of MILES) S.delays[m.i] = +e.target.value; pd.querySelectorAll('select').forEach(s => s.value = e.target.value); e.target.value = ''; recalc(); });
$('#restart').addEventListener('input', e => { S.restart = clamp(+e.target.value || 0, 0, 60); recalc(); });
$('#reset').addEventListener('click', () => { for (const m of MILES) S.delays[m.i] = 0; pd.querySelectorAll('select').forEach(s => s.value = 0); recalc(); });
$('#paybtn').addEventListener('click', () => document.body.classList.toggle('drawer'));
$('#closedrawer').addEventListener('click', () => document.body.classList.remove('drawer'));

function recalc() {
  computeHalts();
  ui.slider.max = S.end + 3;
  cal = Math.min(cal, S.end + 3);
  for (const m of MILES) {
    const r = $('#pr' + m.i);
    r.querySelector('.pdue').textContent = `Completes ${fmt(m.done)} · payment due ${fmt(m.due)}`;
    const imp = r.querySelector('.pimp');
    imp.textContent = m.impact ? `+${Math.round(m.impact)} d halt` : (m.note || '—');
    imp.className = 'pimp' + (m.impact ? ' bad' : '');
    r.classList.toggle('late', S.delays[m.i] > 0);
  }
  const dd = Math.round(S.end - BASE_END), haltDays = Math.round(S.halts.reduce((a, h) => a + h.e - h.s, 0));
  $('#hoBase').textContent = fmt(BASE_END);
  $('#hoRev').textContent = fmt(S.end);
  const b = $('#hoBadge'); b.textContent = dd > 0 ? `+${dd} days` : 'On schedule'; b.className = 'badge ' + (dd > 0 ? 'bad' : 'ok');
  $('#hoNote').textContent = dd > 0 ? `Site halted ${haltDays} days across ${S.halts.length} stoppage${S.halts.length > 1 ? 's' : ''} · grace ${S.grace} d · restart ${S.restart} d` : `All milestone payments within ${S.terms}-day terms + ${S.grace}-day grace`;
  $('#dsum').innerHTML = `<div><small style="color:#7b858f">Forecast handover</small><br><b>${fmt(S.end)}</b></div><span class="badge ${dd > 0 ? 'bad' : 'ok'}">${dd > 0 ? '+' + dd + ' days' : 'On schedule'}</span><button class="btn primary" onclick="document.body.classList.remove('drawer')">View simulation</button>`;
  $('#paycount').textContent = MILES.filter(m => S.delays[m.i] > 0).length || '';
  ui.sub.textContent = `${Math.round(S.end / 30.4)}-month programme`;
  paintSlider(); gantt.dirty = true;
}
function paintSlider() {
  const max = +ui.slider.max, stops = S.halts.map(h => `transparent ${h.s / max * 100}%, #d64545 ${h.s / max * 100}%, #d64545 ${h.e / max * 100}%, transparent ${h.e / max * 100}%`);
  $('#halttrack').style.background = stops.length ? `linear-gradient(90deg, ${stops.join(',')})` : 'none';
}
ui.slider.addEventListener('input', () => { cal = +ui.slider.value; });
ui.play.addEventListener('click', () => { if (!playing && cal >= S.end) cal = 0; playing = !playing; });
document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => { speed = +b.dataset.speed; document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b)); }));
$('#spd').addEventListener('click', e => { const L = [0.5, 1, 2, 4]; speed = L[(L.indexOf(speed) + 1) % 4]; e.target.textContent = speed + '×'; document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', +x.dataset.speed === speed)); });
function homeView() { const a = camera.aspect, f = a < 1.25 ? Math.min(1.25 / a, 2.1) : 1; camera.position.copy(HOME.p).sub(HOME.t).multiplyScalar(f).add(HOME.t); controls.target.copy(HOME.t); }
$('#home').addEventListener('click', homeView);
addEventListener('keydown', e => { if (e.code === 'Space' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') { e.preventDefault(); ui.play.click(); } });

/* ---- gantt (canvas) ---- */
const gc = $('#gantt'), gx = gc.getContext('2d');
const gantt = { dirty: true, LW: 132 };
function ganttRange() { return [-4, Math.max(S.end, BASE_END) + 8]; }
function drawGantt(t, d) {
  const W = gc.clientWidth, H = gc.clientHeight, dpr = Math.min(devicePixelRatio, 2);
  if (gc.width !== W * dpr || gc.height !== H * dpr) { gc.width = W * dpr; gc.height = H * dpr; }
  gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.clearRect(0, 0, W, H);
  const small = W < 520; gantt.LW = small ? 92 : 132; const FS = small ? 10 : 11;
  const [a0, a1] = ganttRange(), LW = gantt.LW, top = 22, n = ACTS.length, rh = (H - top - 4) / n;
  const X = v => LW + (v - a0) / (a1 - a0) * (W - LW - 8);
  gx.font = FS + 'px Inter, system-ui, sans-serif'; gx.textBaseline = 'middle';
  // month ticks
  for (let y = 2028, mo = 0; ; mo++) { const ms = Date.UTC(y + Math.floor(mo / 12), mo % 12, 1), dd = (ms - T0) / DAY; if (dd > a1) break; if (dd < a0) continue;
    const x = X(dd); gx.fillStyle = '#e6e3dd'; gx.fillRect(x, top - 4, 1, H - top);
    if (mo % (small ? 3 : 2) === 0) { gx.fillStyle = '#8b939c'; gx.textAlign = 'left'; gx.fillText(MON[mo % 12] + (mo % 12 === 0 ? ' ’' + (y + Math.floor(mo / 12)) % 100 : ''), x + 2, 9); } }
  // halts
  for (const h of S.halts) { const x1 = X(h.s), x2 = X(h.e); gx.fillStyle = 'rgba(214,69,69,0.10)'; gx.fillRect(x1, top - 4, x2 - x1, H - top);
    gx.save(); gx.beginPath(); gx.rect(x1, top - 4, x2 - x1, H - top); gx.clip(); gx.strokeStyle = 'rgba(214,69,69,0.28)'; gx.lineWidth = 1;
    for (let k = -H; k < x2 - x1 + H; k += 7) { gx.beginPath(); gx.moveTo(x1 + k, top - 4); gx.lineTo(x1 + k + H, H); gx.stroke(); } gx.restore(); }
  const delayed = S.halts.length > 0;
  ACTS.forEach((a, i) => {
    const y = top + i * rh, cy = y + rh / 2, bh = Math.min(10, rh * 0.5);
    const active = t >= a.s && t < a.e;
    gx.fillStyle = active ? '#1f2a36' : '#5b6672'; gx.font = (active ? '600 ' : '') + FS + 'px Inter, system-ui, sans-serif'; gx.textAlign = 'left';
    gx.fillText(a.name, 4, cy);
    if (a.ms) { gx.fillStyle = '#c3c8ce'; gx.beginPath(); gx.arc(LW - 9, cy, 2.2, 0, 7); gx.fill(); }
    gx.fillStyle = '#efede9'; gx.fillRect(LW, cy - bh / 2, W - LW - 8, bh);
    const segsB = a.segs || [[a.s, a.e]], segsR = a.rsegs || [[a.rs, a.re]];
    if (delayed) { gx.strokeStyle = '#9aa3ad'; gx.setLineDash([3, 2]); gx.lineWidth = 1; segsB.forEach(([s, e]) => gx.strokeRect(X(s) + 0.5, cy - bh / 2 - 2.5, Math.max(X(e) - X(s), 2), bh + 5)); gx.setLineDash([]); }
    segsR.forEach(([rs, re], k) => {
      const [bs, be] = segsB[k];
      const x1 = X(rs), x2 = X(re), w = Math.max(x2 - x1, 2);
      gx.fillStyle = '#cfd5db'; gx.fillRect(x1, cy - bh / 2, w, bh);
      if (t > bs) { const xd = t >= be ? x2 : X(d); gx.fillStyle = t >= be ? '#1f2a36' : '#e8742c'; gx.fillRect(x1, cy - bh / 2, Math.max(Math.min(xd, x2) - x1, 1.5), bh);
        if (t < be) { gx.fillStyle = '#1f2a36'; } }
    });
    if (a.ms) { const m = MILES.find(q => q.i === a.i); if (m && m.due != null) { const xx = X(m.due), late = S.delays[a.i] > S.grace;
      gx.fillStyle = late ? '#d64545' : '#3f9b6b'; gx.beginPath(); gx.moveTo(xx, cy - 5); gx.lineTo(xx + 4, cy); gx.lineTo(xx, cy + 5); gx.lineTo(xx - 4, cy); gx.fill();
      if (late) { const xp = X(m.paid); gx.strokeStyle = '#d64545'; gx.lineWidth = 1.2; gx.beginPath(); gx.moveTo(xx + 4, cy); gx.lineTo(xp, cy); gx.stroke(); gx.beginPath(); gx.arc(xp, cy, 2.5, 0, 7); gx.fill(); } } }
  });
  // today
  const xt = X(d); gx.fillStyle = '#e8742c'; gx.fillRect(xt - 1, top - 6, 2, H - top + 2);
  gx.beginPath(); gx.moveTo(xt - 5, top - 10); gx.lineTo(xt + 5, top - 10); gx.lineTo(xt, top - 3); gx.fill();
  gantt.X = X; gantt.a0 = a0; gantt.a1 = a1;
}
gc.addEventListener('click', e => { const r = gc.getBoundingClientRect(), x = e.clientX - r.left; if (x < gantt.LW) return;
  const W = gc.clientWidth; cal = clamp(gantt.a0 + (x - gantt.LW) / (W - gantt.LW - 8) * (gantt.a1 - gantt.a0), 0, S.end + 3); });

/* ================= main loop ================= */
let solid, ghost, lines, gmesh, last = performance.now(), lastUI = -1;
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); gantt.dirty = true; }
addEventListener('resize', resize);

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (playing) { cal += dt * speed * 12; if (cal >= S.end + 3) { cal = S.end + 3; playing = false; } }
  const t = rInv(cal), halt = haltAt(cal), time = now / 1000;
  U.uT.value = t;
  ui.play.textContent = playing ? '❚❚' : '▶';
  if (document.activeElement !== ui.slider) ui.slider.value = cal;

  // ground / pit
  const exc = actByName['Excavation'];
  const depth = -5.3 * P(exc, t);
  const backfill = t >= actByName['Basement-1'].e;
  groundMat.uniforms.uHole.value = t >= exc.s && !backfill ? 1 : 0; pitFloor.visible = !backfill;
  pitFloor.position.y = depth - 0.03;
  pitFloor.material.color.setHex(t < exc.s ? 0xe7e2d6 : 0xb59f80);
  pitWalls.visible = t >= exc.s && !backfill; pitWalls.children.forEach(m => { m.scale.y = Math.max(-depth, 0.01); m.position.y = depth / 2; });
  shrubs.forEach(s => s.visible = t < s.userData.t);

  // equipment
  const onsite = [];
  const clean = t < 20, excav = t >= exc.s && t < exc.e;
  ex1.visible = clean || excav; ex2.visible = excav; dmp.visible = t < exc.e + 2;
  const dig = (ex, k) => { const u = ex.userData; u.up.rotation.y = Math.sin(time * 0.7 + k) * 1.2; u.boom.rotation.x = 0.35 + Math.sin(time * 1.4 + k) * 0.25; u.stick.rotation.x = -0.9 + Math.sin(time * 1.4 + k + 1) * 0.5; };
  if (ex1.visible) { dig(ex1, 0); if (clean) ex1.position.set(-20 + Math.sin(time * 0.15) * 14, 0, -10 + t * 3); else ex1.position.set(-14, depth, 8); }
  if (ex2.visible) { dig(ex2, 2); ex2.position.set(16, depth, -20 + P(exc, t) * 25); ex2.rotation.y = 0.8; }
  if (dmp.visible) { dmp.position.set(ROAD_X + 4, 0, 30 + Math.sin(time * 0.3) * 12); }
  if (clean || excav) onsite.push(excav ? '2 excavators' : '1 excavator');
  if (dmp.visible) onsite.push('dumper');
  cabins.visible = t >= 20;

  const craneOn = t >= actByName['Basement-1'].s && t < M.mas['11'][1];
  crane.visible = craneOn;
  if (craneOn) {
    const top = builtTop(t), h = Math.ceil((top + 14) / 6.7) * 6.7;
    setMast(crane, Math.max(h, 18));
    const u = crane.userData;
    if (!halt) { u.slew.rotation.y += dt * 0.12 * Math.max(speed, 1); u.trolley.position.x = 26 + Math.sin(time * 0.35) * 14; }
    const drop = Math.max(u.h - (top + 2.5) - (halt ? -0 : Math.sin(time * 0.5) * 2 + 2), 3);
    u.rope.scale.y = drop; u.rope.position.y = 0.9 - drop / 2; u.load.position.y = 0.6 - drop;
    onsite.push('Tower crane (lift shaft)');
  }
  const pour = halt ? null : pourAt(t);
  pump.visible = !!pour; trucks.forEach(k => k.visible = false);
  if (pour) {
    const [ps, pe, , c] = pour, u = pump.userData, f = (t - ps) / (pe - ps);
    const target = new THREE.Vector3(c[0] + Math.sin(time * 0.4) * 6, c[1] + 1.5, c[2] + (f - 0.5) * 16);
    const tp = new THREE.Vector3().copy(PUMP_POS).add(u.turret.position);
    const yaw = Math.atan2(target.x - tp.x, target.z - tp.z);
    u.turret.rotation.y = yaw;
    const J = (u.J = []); const hd = Math.hypot(target.x - tp.x, target.z - tp.z);
    { let p = [0, 0.6]; J.push(p); [[0.9, 0.5], [0.95, 0.3], [0.8, -0.6], [0.4, -0.9]].forEach((d, i) => { p = [p[0] + d[0] * SEG[i], p[1] + d[1] * SEG[i]]; J.push(p); }); }
    let tu = hd, tv = target.y - tp.y + 3.5; const tot = SEG.reduce((a, b) => a + b) * 0.96, rr = Math.hypot(tu, tv - 0.6); if (rr > tot) { tu *= tot / rr; tv = 0.6 + (tv - 0.6) * tot / rr; }
    solveBoom(J, [0, 0.6], [tu, tv]);
    u.segs.forEach((s, i) => { const [a, b] = [J[i], J[i + 1]]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      s.scale.z = L; s.position.set(0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2); s.rotation.set(-Math.atan2(b[1] - a[1], b[0] - a[0]), 0, 0); });
    const tip = J[J.length - 1]; u.hose.position.set(0, tip[1] - 1.75, tip[0]);
    // RMC conveyor
    const cyc = time / 6, ph = cyc % 1, e = ph < 0.55 ? 0 : (ph - 0.55) / 0.45, ee = e * e * (3 - 2 * e);
    trucks.forEach((k, i) => {
      const uu = i - 1 - ee; k.visible = true; k.userData.drum.rotation.z += dt * (uu > -0.2 && uu < 0.2 ? 4 : 1.5);
      if (uu >= 0) { k.position.set(ROAD_X, 0, PUMP_POS.z + 11 + uu * 11); k.rotation.y = 0; if (uu > 3.6) k.visible = false; }
      else { const q = -uu; k.position.set(ROAD_X - q * 13, 0, PUMP_POS.z + 11 - q * 4); k.rotation.y = q * 1.2; if (q > 0.98) k.visible = false; }
    });
    onsite.push('Concrete pump (boom)', 'RMC trucks');
  }

  // per-frame UI (throttled to day changes)
  const key = Math.floor(cal * 4) + ':' + S.halts.length + ':' + S.end;
  if (key !== lastUI || gantt.dirty) {
    lastUI = key; gantt.dirty = false;
    ui.date.textContent = fmt(cal);
    ui.week.textContent = `Week ${Math.floor(cal / 7) + 1} of ${Math.ceil(S.end / 7)}`;
    const cur = ACTS.filter(a => t >= a.s && t < a.e && a.name !== 'Masonry Work').map(a => a.name);
    const mi = Object.keys(M.mas).find(i => t >= M.mas[i][0] && t < M.mas[i][1]);
    if (mi != null) cur.push(`Masonry ${FL[mi] === 'B1' ? 'basement' : FL[mi] === 'GF' ? 'ground floor' : 'floor ' + FL[mi]}`);
    if (halt) { ui.status.innerHTML = `<i class="dot red"></i>Site halted — awaiting payment: ${halt.who.join(', ')} <span class="muted">· resumes ${fmt(halt.e)}</span>`; ui.status.classList.add('halt'); }
    else { ui.status.innerHTML = `<i class="dot"></i>${cur.length ? cur.join(' · ') : (cal >= S.end ? 'Building handed over' : 'Mobilising')}`; ui.status.classList.remove('halt'); }
    $('#monsite').innerHTML = ui.onsite.innerHTML = onsite.length && !halt ? `<i class="dot yel"></i>On site: ${onsite.join(', ')}` : (halt ? `<i class="dot red"></i>Plant idle · crane parked` : `<i class="dot yel"></i>No plant on site`);
    ui.count.innerHTML = `<b>${countLE(t1sorted, t).toLocaleString()}</b> of ${E.length.toLocaleString()} elements built`;
    FL.forEach((s, i) => {
      const fa = frameAct(i), mw = masWin(i);
      const st = (w) => t >= w.e ? 'done' : (t >= w.s ? 'prog' : '');
      $('#f' + i).className = 'cell ' + st(fa); $('#m' + i).className = 'cell ' + st(mw);
    });
    drawGantt(t, cal);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

(async () => {
  const buf = await decode();
  const c = M.counts; let o = 0;
  const tri = new Float32Array(buf, o, c.tri * 9); o += c.tri * 36;
  const triE = new Uint16Array(buf.slice(o, o + c.tri * 2)); o += c.tri * 2;
  const edg = new Float32Array(buf.slice(o, o + c.edg * 24)); o += c.edg * 24;
  const edgE = new Uint16Array(buf.slice(o, o + c.edg * 2)); o += c.edg * 2;
  const gnd = new Float32Array(buf.slice(o, o + c.gnd * 36));
  const tg = buildGeom(new Float32Array(tri), triE, 3); tg.computeVertexNormals();
  solid = new THREE.Mesh(tg, solidMat); ghost = new THREE.Mesh(tg, ghostMat); ghost.renderOrder = 2;
  lines = new THREE.LineSegments(buildGeom(edg, edgE, 2), lineMat); lines.renderOrder = 3;
  [solid, ghost, lines].forEach(m => { m.frustumCulled = false; scene.add(m); });
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gnd, 3));
  gmesh = new THREE.Mesh(gg, groundMat); gmesh.material.side = THREE.DoubleSide; scene.add(gmesh);
  recalc(); resize(); homeView();
  document.body.classList.add('ready');
  requestAnimationFrame(tick);
})();
