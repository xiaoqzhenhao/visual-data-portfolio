/* ============================================================
   Spatial Lab · 3D 空间感知标注检查器
   ------------------------------------------------------------
   纯前端 Three.js。程序化生成 1.2 万点仓库点云 + 9 个 3D 框，
   计算每个框内的点数/密度/尺寸，标记空框、稀疏框与异常。
   数据是合成的：不冒充真实产线，只验证“3D 标注质检”的思路。
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- 确定性随机 ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261104);
const rand = (a, b) => a + rng() * (b - a);
const jit = (v, a = 0.012) => v + (rng() * 2 - 1) * a;

/* ---------- 点云数据 ---------- */
const P = []; // {x,y,z,cls,intensity}
const CLASS = ['shelf', 'pallet', 'forklift', 'person', 'cone'];
const CLASS_ZH = ['货架', '托盘', '叉车', '人员', '锥桶'];
const CLASS_COLORS = ['#9bdc5a', '#4cc9f0', '#ffc857', '#ff6b6b', '#f72585'];
const BG_COLOR = new THREE.Color('#2b3c4d');

function add(x, y, z, cls = -1, intensity = 0.35) {
  P.push({ x, y: Math.max(0, y), z, cls, intensity });
}

function addLine(x1, y1, z1, x2, y2, z2, cls, step = 0.08, intensity = 0.6) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    add(jit(x1 + dx * t), jit(y1 + dy * t), jit(z1 + dz * t), cls, intensity + rand(-0.1, 0.1));
  }
}

function addGrid(x1, z1, x2, z2, y, cls, step = 0.1, intensity = 0.5) {
  for (let x = x1; x <= x2; x += step) {
    for (let z = z1; z <= z2; z += step) {
      add(jit(x, 0.02), jit(y, 0.012), jit(z, 0.02), cls, intensity + rand(-0.12, 0.12));
    }
  }
}

function addBoxShell(cx, cy, cz, w, h, d, cls, step = 0.09, intensity = 0.58) {
  const x1 = cx - w / 2, x2 = cx + w / 2;
  const y1 = Math.max(0, cy - h / 2), y2 = cy + h / 2;
  const z1 = cz - d / 2, z2 = cz + d / 2;
  // 四个侧面 + 顶面（底面通常被遮挡，少采）
  for (let y = y1; y <= y2; y += step) {
    for (let z = z1; z <= z2; z += step) {
      add(jit(x1), jit(y), jit(z), cls, intensity + rand(-.1, .1));
      add(jit(x2), jit(y), jit(z), cls, intensity + rand(-.1, .1));
    }
    for (let x = x1; x <= x2; x += step) {
      add(jit(x), jit(y), jit(z1), cls, intensity + rand(-.1, .1));
      add(jit(x), jit(y), jit(z2), cls, intensity + rand(-.1, .1));
    }
  }
  for (let x = x1; x <= x2; x += step) {
    for (let z = z1; z <= z2; z += step) {
      add(jit(x), jit(y2), jit(z), cls, intensity + rand(-.06, .06));
    }
  }
}

function addCylinder(cx, cz, y1, y2, r, cls, step = 0.06, intensity = 0.65) {
  for (let y = y1; y <= y2; y += step) {
    const n = Math.max(6, Math.ceil((Math.PI * 2 * r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      add(jit(cx + Math.cos(a) * r, 0.01), jit(y, 0.012), jit(cz + Math.sin(a) * r, 0.01), cls, intensity + rand(-.08, .08));
    }
  }
}

function addCone(cx, cz, r, h, cls) {
  const n = 32;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (let y = 0; y <= h; y += 0.06) {
      const rr = r * (1 - y / h);
      add(jit(cx + Math.cos(a) * rr, 0.008), jit(y, 0.01), jit(cz + Math.sin(a) * rr, 0.008), cls, 0.8);
    }
  }
  for (let i = 0; i < 50; i++) {
    const a = rand(0, Math.PI * 2), rr = rand(0, r);
    add(jit(cx + Math.cos(a) * rr), 0.02, jit(cz + Math.sin(a) * rr), cls, 0.4);
  }
}

/* ---------- 场景生成 ---------- */
function buildCloud() {
  // 地面：0.24m 采样，带轻微噪声
  for (let x = -8; x <= 8; x += 0.24) {
    for (let z = -6; z <= 6; z += 0.24) {
      if (rng() < 0.04) continue;
      add(jit(x, 0.025), jit(0, 0.012), jit(z, 0.025), -1, 0.22 + rand(-.08, .1));
    }
  }
  // 后墙与侧墙
  for (let x = -8; x <= 8; x += 0.3) {
    for (let y = 0.15; y <= 4.6; y += 0.3) add(jit(x, .03), jit(y, .02), jit(-6, .02), -1, 0.34 + rand(-.12, .12));
  }
  for (let z = -6; z <= 6; z += 0.3) {
    for (let y = 0.15; y <= 4.6; y += 0.3) {
      add(jit(-8, .02), jit(y, .02), jit(z, .03), -1, 0.3 + rand(-.1, .1));
      add(jit(8, .02), jit(y, .02), jit(z, .03), -1, 0.3 + rand(-.1, .1));
    }
  }

  // 左右两排货架
  function rack(cx, cz, mirror = 1) {
    const w = 1.35, d = 5.2, h = 3.4;
    const x1 = cx - w / 2, x2 = cx + w / 2;
    const z1 = cz - d / 2, z2 = cz + d / 2;
    // 立柱
    for (const x of [x1, x2]) for (const z of [z1, z2]) addLine(x, 0, z, x, h, z, 0, 0.065, 0.75);
    // 三层横梁 + 层板
    for (const y of [0.55, 1.55, 2.55]) {
      for (const x of [x1, x2]) addLine(x, y, z1, x, y, z2, 0, 0.06, 0.72);
      for (const z of [z1, z2]) addLine(x1, y, z, x2, y, z, 0, 0.06, 0.72);
      addGrid(x1 + 0.06, z1 + 0.05, x2 - 0.06, z2 - 0.05, y, 0, 0.18, 0.46);
    }
    // 货架上的纸箱
    for (const y of [0.96, 1.96, 2.96]) {
      for (let i = 0; i < 4; i++) {
        const zz = z1 + 0.75 + i * 1.2 + rand(-.05, .05);
        if (zz > z2 - 0.45) continue;
        const bw = rand(0.62, 0.85), bh = rand(0.5, 0.7), bd = rand(0.62, 0.85);
        addBoxShell(cx + rand(-.12, .12), y + bh / 2, zz, bw, bh, bd, 0, 0.13, 0.55);
      }
    }
    return { x1, x2, z1, z2, h };
  }
  rack(-5.25, -2.0);
  rack(5.25, -2.0);

  // 托盘 A + 纸箱
  addGrid(-2.25, 0.65, -0.85, 1.75, 0.16, 1, 0.075, 0.5);
  for (const z of [0.7, 1.2, 1.7]) addLine(-2.25, 0.12, z, -0.85, 0.12, z, 1, 0.08, 0.72);
  addBoxShell(-1.55, 0.48, 1.2, 1.05, 0.62, 0.72, 1, 0.12, 0.6);

  // 托盘 B + 纸箱
  addGrid(1.65, 0.05, 3.05, 1.15, 0.16, 1, 0.075, 0.5);
  for (const z of [0.1, 0.6, 1.1]) addLine(1.65, 0.12, z, 3.05, 0.12, z, 1, 0.08, 0.72);
  addBoxShell(2.35, 0.45, 0.6, 0.95, 0.56, 0.68, 1, 0.12, 0.6);

  // 叉车
  addBoxShell(1.15, 0.62, 2.55, 1.55, 0.72, 1.05, 2, 0.1, 0.72);
  addLine(1.95, 0.22, 2.1, 1.95, 1.85, 2.1, 2, 0.055, 0.82);
  addLine(1.95, 0.22, 3.0, 1.95, 1.85, 3.0, 2, 0.055, 0.82);
  addLine(2.0, 1.8, 2.1, 2.0, 1.8, 3.0, 2, 0.06, 0.82);
  addLine(2.0, 0.22, 2.15, 2.85, 0.22, 2.15, 2, 0.055, 0.8);
  addLine(2.0, 0.22, 2.95, 2.85, 0.22, 2.95, 2, 0.055, 0.8);
  for (const z of [2.15, 2.95]) {
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      add(jit(0.45, .01) + Math.cos(a) * .19, .2 + Math.sin(a) * .19, jit(z, .01), 2, .65);
      add(jit(1.7, .01) + Math.cos(a) * .19, .2 + Math.sin(a) * .19, jit(z, .01), 2, .65);
    }
  }

  // 人员
  addCylinder(-2.75, 2.85, 0.78, 1.48, 0.2, 3, 0.055, 0.75);
  addCylinder(-2.75, 2.85, 1.48, 1.62, 0.12, 3, 0.05, 0.8);
  addLine(-2.88, 0, 2.85, -2.82, 0.82, 2.85, 3, 0.055, 0.7);
  addLine(-2.62, 0, 2.85, -2.68, 0.82, 2.85, 3, 0.055, 0.7);
  // 头（球面点）
  for (let i = 0; i < 120; i++) {
    const u = rand(0, Math.PI * 2), v = rand(0.15, Math.PI - 0.15);
    add(-2.75 + Math.cos(u) * Math.sin(v) * 0.14, 1.68 + Math.cos(v) * 0.14, 2.85 + Math.sin(u) * Math.sin(v) * 0.14, 3, 0.85);
  }

  // 两个锥桶
  addCone(-0.45, 3.65, 0.17, 0.52, 4);
  addCone(3.55, 3.2, 0.17, 0.52, 4);
}

/* ---------- 3D 框 ---------- */
const rawBoxes = [
  { id: 1, name: '货架 A', cls: 0, center: [-5.25, 1.7, -2.0], size: [1.55, 3.45, 5.35] },
  { id: 2, name: '货架 B', cls: 0, center: [5.25, 1.7, -2.0], size: [1.55, 3.45, 5.35] },
  { id: 3, name: '托盘 A', cls: 1, center: [-1.55, 0.42, 1.2], size: [1.55, 0.86, 1.25] },
  { id: 4, name: '托盘 B', cls: 1, center: [2.35, 0.4, 0.6], size: [1.5, 0.8, 1.2] },
  { id: 5, name: '叉车', cls: 2, center: [1.25, 0.9, 2.55], size: [2.7, 1.85, 1.2] },
  { id: 6, name: '人员', cls: 3, center: [-2.75, 0.95, 2.85], size: [0.55, 1.95, 0.55] },
  { id: 7, name: '锥桶 A', cls: 4, center: [-0.45, 0.28, 3.65], size: [0.42, 0.58, 0.42] },
  { id: 8, name: '锥桶 B', cls: 4, center: [3.55, 0.28, 3.2], size: [0.42, 0.58, 0.42] },
  { id: 9, name: 'GHOST 空框', cls: 1, center: [-4.15, 0.62, 4.2], size: [0.8, 1.2, 0.8], ghost: true },
];

/* ---------- 状态 ---------- */
const state = {
  points: null,
  boxes: [],
  selected: 0,
  showBoxes: true,
  showLabels: true,
  colorMode: 'class',
  autoRotate: false,
  auditTimer: null,
};

/* ---------- Three 基础 ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080d);
scene.fog = new THREE.FogExp2(0x05080d, 0.021);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 120);
camera.position.set(8.6, 7.2, 11.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('#scene').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI / 2.04;
controls.autoRotateSpeed = 0.55;
controls.update();

// 地面网格（弱一点，只做空间参照）
const grid = new THREE.GridHelper(18, 36, 0x1b3142, 0x122334);
grid.position.y = 0.003;
grid.material.transparent = true;
grid.material.opacity = 0.3;
scene.add(grid);

/* ---------- 颜色 ---------- */
const colorCache = {
  class: CLASS_COLORS.map((c) => new THREE.Color(c)),
  heightA: new THREE.Color('#17324a'),
  heightB: new THREE.Color('#37e0b2'),
  intensityA: new THREE.Color('#243b52'),
  intensityB: new THREE.Color('#e8fbff'),
};
const tmpColor = new THREE.Color();

function computeColor(p, mode) {
  if (mode === 'height') return tmpColor.copy(colorCache.heightA).lerp(colorCache.heightB, clamp(p.y / 4.2, 0, 1));
  if (mode === 'intensity') return tmpColor.copy(colorCache.intensityA).lerp(colorCache.intensityB, clamp(p.intensity, 0, 1));
  if (p.cls < 0) return tmpColor.copy(BG_COLOR).multiplyScalar(0.75 + p.intensity * 0.55);
  return tmpColor.copy(colorCache.class[p.cls]);
}

function applyPointColors() {
  const attr = state.points.geometry.getAttribute('color');
  const arr = attr.array;
  for (let i = 0; i < P.length; i++) {
    const c = computeColor(P[i], state.colorMode);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  attr.needsUpdate = true;
  state.points.material.needsUpdate = true;
}

/* ---------- 构建 ---------- */
function build() {
  buildCloud();

  const pos = new Float32Array(P.length * 3);
  const col = new Float32Array(P.length * 3);
  for (let i = 0; i < P.length; i++) {
    pos[i * 3] = P[i].x; pos[i * 3 + 1] = P[i].y; pos[i * 3 + 2] = P[i].z;
    const c = computeColor(P[i], state.colorMode);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.PointsMaterial({
    size: 0.035,
    vertexColors: true,
    transparent: true,
    opacity: 0.94,
    sizeAttenuation: true,
    depthWrite: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  state.points = points;

  // 计算每个框内点数
  state.boxes = rawBoxes.map((b) => {
    const [cx, cy, cz] = b.center;
    const [w, h, d] = b.size;
    const min = [cx - w / 2, cy - h / 2, cz - d / 2];
    const max = [cx + w / 2, cy + h / 2, cz + d / 2];
    let count = 0;
    for (const p of P) {
      if (p.x >= min[0] && p.x <= max[0] && p.y >= min[1] && p.y <= max[1] && p.z >= min[2] && p.z <= max[2]) count++;
    }
    const volume = w * h * d;
    const density = count / volume;
    const flags = [];
    if (count === 0) flags.push({ code: 'EMPTY', label: '空框 / 0 点', bad: true });
    else if (count < 40) flags.push({ code: 'SPARSE', label: '点云稀疏', bad: false });
    if (count > 0 && density < 25) flags.push({ code: 'DENSITY', label: '密度偏低', bad: false });
    const minDim = Math.min(w, h, d), maxDim = Math.max(w, h, d);
    if (minDim < 0.15) flags.push({ code: 'SIZE', label: '尺寸过小', bad: true });
    if (maxDim / Math.max(0.001, minDim) > 7) flags.push({ code: 'ASPECT', label: '长宽比异常', bad: false });
    return { ...b, min, max, volume, count, density, flags, mesh: null, edges: null, label: null };
  });

  buildBoxes();
  buildLabels();
  applyPointColors();
  updateStats();
  select(0);
  animate();
}

function buildBoxes() {
  for (const b of state.boxes) {
    const [w, h, d] = b.size;
    const color = new THREE.Color(CLASS_COLORS[b.cls]);
    const edgeColor = b.flags.length ? new THREE.Color('#ff5d6c') : color;

    const boxGeo = new THREE.BoxGeometry(w, h, d);
    const fillMat = new THREE.MeshBasicMaterial({
      color: edgeColor, transparent: true, opacity: 0.035, depthWrite: false, depthTest: true,
    });
    const fill = new THREE.Mesh(boxGeo, fillMat);
    fill.position.set(...b.center);
    fill.userData.boxIndex = b.id - 1;
    fill.renderOrder = 1;
    scene.add(fill);
    b.mesh = fill;

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false })
    );
    edges.position.set(...b.center);
    edges.renderOrder = 4;
    scene.add(edges);
    b.edges = edges;
    b.baseColor = edgeColor.clone();
  }
}

function buildLabels() {
  const root = $('#labels');
  for (const b of state.boxes) {
    const el = document.createElement('button');
    el.className = `box-label ${b.flags.length ? 'flag' : ''}`;
    el.style.borderLeftColor = b.flags.length ? '#ff5d6c' : CLASS_COLORS[b.cls];
    el.innerHTML = `<b>#${String(b.id).padStart(2, '0')}</b> ${b.name} <em>${b.count}</em>`;
    el.addEventListener('click', () => select(b.id - 1));
    root.appendChild(el);
    b.label = el;
  }
}

/* ---------- 选择 / 面板 ---------- */
function select(index) {
  index = clamp(index, 0, state.boxes.length - 1);
  state.selected = index;
  for (const b of state.boxes) {
    const on = b.id - 1 === index;
    b.edges.material.color.copy(on ? new THREE.Color('#ffffff') : b.baseColor);
    b.edges.material.opacity = on ? 1 : 0.78;
    b.mesh.material.opacity = on ? 0.11 : 0.035;
    b.label.classList.toggle('on', on);
  }
  renderInspector();
  renderBoxList();
}

function renderInspector() {
  const b = state.boxes[state.selected];
  if (!b) return;
  const flagged = b.flags.length > 0;
  $('#selIndex').textContent = `BOX ${String(b.id).padStart(2, '0')} / ${String(state.boxes.length).padStart(2, '0')}`;
  $('#selName').textContent = b.name;
  const v = $('#selVerdict');
  v.textContent = flagged ? 'REVIEW' : 'PASS';
  v.className = `verdict ${flagged ? 'review' : 'pass'}`;
  $('#selClass').textContent = `${CLASS[b.cls]} / ${b.cls}`;
  $('#selPoints').textContent = b.count.toLocaleString('en-US');
  $('#selCenter').textContent = b.center.map((n) => n.toFixed(2)).join(', ');
  $('#selSize').textContent = b.size.map((n) => n.toFixed(2)).join(' × ');
  $('#selVolume').textContent = `${b.volume.toFixed(2)} m³`;
  $('#selDensity').textContent = `${Math.round(b.density).toLocaleString('en-US')} pts/m³`;
  $('#selFlags').innerHTML = flagged
    ? b.flags.map((f) => `<span class="flag ${f.bad ? 'bad' : ''}">${f.label}</span>`).join('')
    : '<span class="no-flag">✓ 未命中质检规则</span>';
}

function renderBoxList() {
  $('#boxList').innerHTML = state.boxes.map((b) => `
    <div class="box-row ${b.id - 1 === state.selected ? 'on' : ''}" data-idx="${b.id - 1}">
      <i style="background:${b.flags.length ? '#ff5d6c' : CLASS_COLORS[b.cls]}"></i>
      <span>#${String(b.id).padStart(2, '0')} ${b.name}</span>
      <em>${b.count}</em>
      ${b.flags.length ? '<span class="warn">!</span>' : '<span></span>'}
    </div>`).join('');
  $$('#boxList .box-row').forEach((el) => el.addEventListener('click', () => select(Number(el.dataset.idx))));
}

function updateStats() {
  const flagged = state.boxes.filter((b) => b.flags.length).length;
  $('#statPoints').textContent = P.length.toLocaleString('en-US');
  $('#statBoxes').textContent = state.boxes.length;
  $('#statFlags').textContent = flagged;
}

/* ---------- 标签投影 ---------- */
const tmpV = new THREE.Vector3();
function updateLabels() {
  const w = innerWidth, h = innerHeight;
  for (const b of state.boxes) {
    const [cx, cy, cz] = b.center;
    tmpV.set(cx, cy + b.size[1] / 2 + 0.22, cz).project(camera);
    const visible = tmpV.z < 1 && tmpV.z > -1 && Math.abs(tmpV.x) < 1.15 && Math.abs(tmpV.y) < 1.15;
    const on = state.showLabels && visible;
    b.label.classList.toggle('hide', !on);
    if (on) {
      b.label.style.left = `${(tmpV.x * 0.5 + 0.5) * w}px`;
      b.label.style.top = `${(-tmpV.y * 0.5 + 0.5) * h}px`;
    }
  }
}

/* ---------- 交互 ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pick(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(state.boxes.map((b) => b.mesh), false);
  return hits.length ? hits[0].object.userData.boxIndex : -1;
}

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, moved: false };
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (down) {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
    return;
  }
  const idx = pick(e);
  renderer.domElement.style.cursor = idx >= 0 ? 'pointer' : 'grab';
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const moved = down?.moved;
  down = null;
  if (moved) return;
  const idx = pick(e);
  if (idx >= 0) select(idx);
});

function resetView() {
  camera.position.set(8.6, 7.2, 11.2);
  controls.target.set(0, 1.2, 0);
  controls.update();
}
function topView() {
  camera.position.set(0.01, 17.5, 0.01);
  controls.target.set(0, 0.2, 0);
  controls.update();
  toast('顶视图：检查框与点云的空间覆盖关系');
}
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function toggleBoxes(force) {
  state.showBoxes = force ?? !state.showBoxes;
  $('#toggleBoxes').checked = state.showBoxes;
  for (const b of state.boxes) {
    b.mesh.visible = state.showBoxes;
    b.edges.visible = state.showBoxes;
    b.label.classList.toggle('hide', !state.showBoxes || !state.showLabels);
  }
}
function toggleLabels(force) {
  state.showLabels = force ?? !state.showLabels;
  $('#toggleLabels').checked = state.showLabels;
  updateLabels();
}

/* ---------- 自动巡检 ---------- */
let auditIdx = 0;
function audit() {
  const flagged = state.boxes.filter((b) => b.flags.length);
  if (!flagged.length) { toast('本场景没有命中问题的框'); return; }
  if (state.auditTimer) {
    clearInterval(state.auditTimer);
    state.auditTimer = null;
    $('#btnAudit').textContent = '自动巡检';
    toast('已停止巡检');
    return;
  }
  auditIdx = 0;
  $('#btnAudit').textContent = '停止巡检';
  const step = () => {
    if (auditIdx >= flagged.length) {
      clearInterval(state.auditTimer);
      state.auditTimer = null;
      $('#btnAudit').textContent = '自动巡检';
      toast(`巡检完成：${flagged.length} 个框命中问题`);
      return;
    }
    const b = flagged[auditIdx++];
    select(b.id - 1);
    toast(`发现问题 #${String(b.id).padStart(2, '0')} ${b.name}：${b.flags.map((f) => f.label).join(' / ')}`, true);
  };
  step();
  state.auditTimer = setInterval(step, 1600);
}

/* ---------- 导出 ---------- */
function exportJson() {
  const payload = {
    scene: 'warehouse-synthetic-3d',
    generatedAt: new Date().toISOString(),
    points: P.length,
    boxes: state.boxes.map((b) => ({
      id: b.id, name: b.name, class: CLASS[b.cls], className: CLASS_ZH[b.cls],
      center: b.center, size: b.size, volume: +b.volume.toFixed(4),
      pointsInBox: b.count, density: +b.density.toFixed(2),
      flags: b.flags.map((f) => f.code), verdict: b.flags.length ? 'review' : 'pass',
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'spatial-qa-report.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
  toast('3D 质检报告已导出');
}

/* ---------- 渲染循环 ---------- */
let frames = 0, lastFps = performance.now();
function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  controls.update();
  updateLabels();
  renderer.render(scene, camera);
  frames++;
  if (now - lastFps > 600) {
    $('#fps').textContent = `${Math.round((frames * 1000) / (now - lastFps))} FPS`;
    frames = 0;
    lastFps = now;
  }
}

/* ---------- 事件绑定 ---------- */
function bind() {
  $$('#colorMode button').forEach((btn) => btn.addEventListener('click', () => {
    state.colorMode = btn.dataset.mode;
    $$('#colorMode button').forEach((b) => b.classList.toggle('on', b === btn));
    applyPointColors();
  }));
  $('#toggleBoxes').addEventListener('change', (e) => toggleBoxes(e.target.checked));
  $('#toggleLabels').addEventListener('change', (e) => toggleLabels(e.target.checked));
  $('#autoRotate').addEventListener('change', (e) => { controls.autoRotate = e.target.checked; });
  $('#pointSize').addEventListener('input', (e) => { state.points.material.size = Number(e.target.value) / 100; });
  $('#btnTop').addEventListener('click', topView);
  $('#btnReset').addEventListener('click', resetView);
  $('#btnAudit').addEventListener('click', audit);
  $('#prevBox').addEventListener('click', () => select((state.selected - 1 + state.boxes.length) % state.boxes.length));
  $('#nextFlag').addEventListener('click', () => {
    const flagged = state.boxes.filter((b) => b.flags.length);
    if (!flagged.length) { toast('本场景没有命中问题的框'); return; }
    const cur = flagged.findIndex((b) => b.id - 1 === state.selected);
    select(flagged[(cur + 1) % flagged.length].id - 1);
  });

  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    const k = e.key.toLowerCase();
    if (k === 'r') resetView();
    else if (k === 'g') toggleBoxes();
    else if (k === 'l') toggleLabels();
    else if (k === 't') topView();
    else if (k === '[') select((state.selected - 1 + state.boxes.length) % state.boxes.length);
    else if (k === ']') select((state.selected + 1) % state.boxes.length);
    else if (k === 'f') $('#nextFlag').click();
  });

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

/* ---------- 启动 ---------- */
function init() {
  bind();
  build();
  requestAnimationFrame(() => {
    $('#loading').classList.add('done');
    renderer.render(scene, camera);
  });
  // 用于自动化截图：暴露只读统计
  window.__SPATIAL_STATS__ = () => ({
    points: P.length,
    boxes: state.boxes.map((b) => ({ id: b.id, name: b.name, count: b.count, flags: b.flags.map((f) => f.code) })),
  });
}

init();
