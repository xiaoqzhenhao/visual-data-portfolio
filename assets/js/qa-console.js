/* ============================================================
   QA Console · 视觉数据质检工作台
   ------------------------------------------------------------
   纯前端，无依赖。数据来自 ../../dataset/：
     manifest.json  → 样本清单（120 张合成仓库图）
     labels/*.txt   → YOLO 标签
     qa_truth.json  → 预置缺陷真值（只给“系统测试”页）
   复核状态存 localStorage，刷新不丢。
   ============================================================ */

const DATA_BASE = new URL('../../dataset/', location.href);
const REVIEW_KEY = 'qa-console-reviews-v1';

const COLORS = ['#ff6b6b', '#ffc857', '#4cc9f0', '#f72585', '#9bdc5a'];
const RULES = {
  min_wh: 0.002,
  tiny_area: 0.0005,
  dup_iou: 0.85,
  max_aspect: 8.0,
  min_aspect: 0.125,
  coord_tol: 1e-6,
};

const ISSUE_META = {
  empty_label: { zh: '空标签', level: 'warn', hint: '先确认是真负样本还是漏标' },
  invalid_class: { zh: '类别越界', level: 'error', hint: 'class id 超出 0..N-1' },
  out_of_bounds: { zh: '框越界', level: 'error', hint: '坐标超出 [0,1]' },
  zero_area: { zh: '零面积框', level: 'error', hint: '宽或高接近 0' },
  tiny_box: { zh: '过小框', level: 'warn', hint: '面积低于阈值，可能是误标' },
  duplicate: { zh: '重复框', level: 'error', hint: '同图两框 IoU 过高' },
  aspect_ratio: { zh: '长宽比异常', level: 'warn', hint: '可能是框贴错方向' },
  parse_error: { zh: '标签解析失败', level: 'error', hint: '字段数/数字格式不合法' },
  read_error: { zh: '读取失败', level: 'error', hint: '图片或标签无法读取' },
};

const state = {
  manifest: null,
  samples: [],
  truth: {},
  reviews: {},
  current: null,
  currentImg: null,
  filter: 'all',
  page: 0,
  pageSize: 12,
  selectedBox: -1,
  hoverBox: -1,
  showBoxes: true,
  showLabels: true,
  issueOnly: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  tab: 'review',
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pct(n, d) { return d ? `${(n / d * 100).toFixed(1)}%` : '—'; }
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}
function imgUrl(s) { return new URL(s.image, DATA_BASE).href; }
function labelUrl(s) { return new URL(s.label, DATA_BASE).href; }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function download(name, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
}

/* ---------- 规则引擎（与 Python CLI 同口径） ---------- */
function parseYolo(text) {
  const boxes = [];
  const errors = [];
  text.split(/\r?\n/).forEach((raw, lineNo) => {
    const line = raw.trim();
    if (!line) return;
    const p = line.split(/\s+/);
    if (p.length !== 5) {
      errors.push(`第 ${lineNo + 1} 行字段数=${p.length}，应为 5`);
      return;
    }
    const cid = Number(p[0]);
    const [cx, cy, w, h] = p.slice(1).map(Number);
    if (![cid, cx, cy, w, h].every(Number.isFinite)) {
      errors.push(`第 ${lineNo + 1} 行存在非数字`);
      return;
    }
    boxes.push({ cid, cx, cy, w, h, x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 });
  });
  return { boxes, errors };
}

function iou(a, b) {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const ua = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const ub = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = ua + ub - inter;
  return union > 0 ? inter / union : 0;
}

function computeIssues(sample, numClasses) {
  const issues = [];
  const s = sample.id;
  if (sample.parseErrors?.length) {
    for (const msg of sample.parseErrors) issues.push({ type: 'parse_error', level: 'error', sample: s, box: null, message: msg });
  }
  if (!sample.boxes.length) {
    if (!sample.parseErrors?.length) {
      issues.push({ type: 'empty_label', level: 'warn', sample: s, box: null, message: '标签为空：需确认是真负样本还是漏标' });
    }
    return issues;
  }
  sample.boxes.forEach((b, i) => {
    const { cid, x1, y1, x2, y2 } = b;
    const w = x2 - x1, h = y2 - y1;
    if (cid < 0 || cid >= numClasses) {
      issues.push({ type: 'invalid_class', level: 'error', sample: s, box: i, message: `类别 id=${cid} 超出 0..${numClasses - 1}` });
    }
    if (x1 < -RULES.coord_tol || y1 < -RULES.coord_tol || x2 > 1 + RULES.coord_tol || y2 > 1 + RULES.coord_tol) {
      issues.push({ type: 'out_of_bounds', level: 'error', sample: s, box: i, message: `框越界：(${x1.toFixed(3)}, ${y1.toFixed(3)}) → (${x2.toFixed(3)}, ${y2.toFixed(3)})` });
    }
    if (w <= RULES.min_wh || h <= RULES.min_wh) {
      issues.push({ type: 'zero_area', level: 'error', sample: s, box: i, message: `零面积框：w=${w.toFixed(4)}, h=${h.toFixed(4)}` });
    } else if (w * h < RULES.tiny_area) {
      issues.push({ type: 'tiny_box', level: 'warn', sample: s, box: i, message: `框过小：area=${(w * h).toFixed(6)}` });
    }
    if (h > 0 && (w / h > RULES.max_aspect || w / h < RULES.min_aspect)) {
      issues.push({ type: 'aspect_ratio', level: 'warn', sample: s, box: i, message: `长宽比异常：${(w / h).toFixed(2)}` });
    }
  });
  for (let i = 0; i < sample.boxes.length; i++) {
    for (let j = i + 1; j < sample.boxes.length; j++) {
      const v = iou(sample.boxes[i], sample.boxes[j]);
      if (v >= RULES.dup_iou) {
        issues.push({ type: 'duplicate', level: 'error', sample: s, box: i, message: `与第 ${j + 1} 个框重复：IoU=${v.toFixed(3)}` });
      }
    }
  }
  return issues;
}

/* ---------- 数据 ---------- */
async function loadData() {
  const [manifestRes, truthRes] = await Promise.all([
    fetch(new URL('manifest.json', DATA_BASE)),
    fetch(new URL('qa_truth.json', DATA_BASE)).catch(() => null),
  ]);
  if (!manifestRes.ok) throw new Error(`manifest.json HTTP ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  const truth = truthRes && truthRes.ok ? await truthRes.json() : {};
  if (!Array.isArray(manifest.samples) || !manifest.samples.length) throw new Error('manifest 中没有样本');
  const numClasses = (manifest.classes || []).length;

  const samples = await Promise.all(manifest.samples.map(async (s) => {
    const res = await fetch(new URL(s.label, DATA_BASE));
    if (!res.ok) throw new Error(`标签读取失败：${s.label}`);
    const text = await res.text();
    const { boxes, errors } = parseYolo(text);
    return { ...s, boxes, parseErrors: errors };
  }));
  samples.forEach((s) => { s.issues = computeIssues(s, numClasses); });

  state.manifest = manifest;
  state.samples = samples;
  state.truth = truth;
}

function loadReviews() {
  try { state.reviews = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}') || {}; }
  catch { state.reviews = {}; }
}
function saveReviews() {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify(state.reviews)); }
  catch { /* 隐私模式忽略 */ }
}

/* ---------- 统计 ---------- */
function sampleStats() {
  const total = state.samples.length;
  const boxes = state.samples.reduce((n, s) => n + s.boxes.length, 0);
  const bad = state.samples.filter((s) => s.issues.length).length;
  const reviewed = state.samples.filter((s) => state.reviews[s.id]).length;
  const passed = state.samples.filter((s) => state.reviews[s.id]?.status === 'pass').length;
  const rejected = state.samples.filter((s) => state.reviews[s.id]?.status === 'reject').length;
  return { total, boxes, bad, clean: total - bad, reviewed, passed, rejected };
}

function renderStats() {
  const s = sampleStats();
  $('#kpiSamples').textContent = s.total;
  $('#kpiBoxes').textContent = s.boxes.toLocaleString('en-US');
  $('#kpiReviewed').innerHTML = `${s.reviewed}<small>/ ${s.total}</small>`;
  $('#kpiBad').innerHTML = `${s.bad}<small>需要处理</small>`;
  $('#kpiPass').textContent = pct(s.clean, s.total);
}

/* ---------- 列表 ---------- */
function visibleSamples() {
  const f = state.filter;
  if (f === 'issue') return state.samples.filter((s) => s.issues.length);
  if (f === 'unreviewed') return state.samples.filter((s) => !state.reviews[s.id]);
  if (f === 'pass') return state.samples.filter((s) => state.reviews[s.id]?.status === 'pass');
  if (f === 'reject') return state.samples.filter((s) => state.reviews[s.id]?.status === 'reject');
  return state.samples;
}

function renderList() {
  const list = visibleSamples();
  const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
  state.page = clamp(state.page, 0, pages - 1);
  const start = state.page * state.pageSize;
  const slice = list.slice(start, start + state.pageSize);
  const box = $('#sampleList');

  box.innerHTML = slice.map((s) => {
    const rv = state.reviews[s.id];
    const dot = rv ? rv.status : (s.issues.length ? 'bad' : '');
    const sub = rv
      ? (rv.status === 'pass' ? '已通过' : '已打回')
      : `${s.boxes.length} boxes${s.issues.length ? ` · ${s.issues.length} issue` : ''}`;
    return `<div class="sample ${state.current?.id === s.id ? 'on' : ''}" data-sid="${esc(s.id)}" role="button" tabindex="0">
      <div class="sample__thumb"><img src="${esc(imgUrl(s))}" loading="lazy" alt=""></div>
      <div>
        <div class="sample__id">#${esc(s.id)}</div>
        <div class="sample__sub">${esc(sub)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        ${s.issues.length ? `<span class="sample__badge">${s.issues.length}</span>` : ''}
        <span class="sample__dot ${dot}"></span>
      </div>
    </div>`;
  }).join('') || '<div style="padding:24px 10px;color:var(--faint);font-size:11px;text-align:center">当前筛选下没有样本</div>';

  $('#listCount').textContent = `${list.length} SAMPLES`;
  $('#pageInfo').textContent = `${state.page + 1} / ${pages}`;
  $('#prevPage').disabled = state.page <= 0;
  $('#nextPage').disabled = state.page >= pages - 1;
  $$('.filters button').forEach((b) => b.classList.toggle('on', b.dataset.filter === state.filter));
}

/* ---------- 画布 ---------- */
function resizeCanvas() {
  const stage = $('#stage');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const c = $('#canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  draw();
}

function fitScale() {
  if (!state.currentImg) return 1;
  const stage = $('#stage');
  const w = stage.clientWidth, h = stage.clientHeight;
  return Math.min((w - 34) / state.currentImg.width, (h - 34) / state.currentImg.height);
}

function draw() {
  const c = $('#canvas');
  const ctx = c.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cw = c.width / dpr, ch = c.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const s = state.current;
  const img = state.currentImg;
  $('#stageEmpty').classList.toggle('show', !s || !img);
  if (!s || !img) return;

  const fit = fitScale();
  const scale = fit * state.zoom;
  const dw = img.width * scale, dh = img.height * scale;
  const dx = (cw - dw) / 2 + state.panX;
  const dy = (ch - dh) / 2 + state.panY;

  // 图片背后的柔光，避免暗图直接贴在背景上
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.7)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = '#000';
  ctx.fillRect(dx, dy, dw, dh);
  ctx.restore();
  ctx.drawImage(img, dx, dy, dw, dh);

  const issueSet = new Set(s.issues.filter((i) => i.box !== null).map((i) => i.box));
  const issueByBox = new Map();
  for (const it of s.issues) if (it.box !== null) issueByBox.set(it.box, it);

  s.boxes.forEach((b, i) => {
    if (!state.showBoxes) return;
    if (state.issueOnly && !issueSet.has(i)) return;
    const x = dx + b.x1 * dw;
    const y = dy + b.y1 * dh;
    const w = (b.x2 - b.x1) * dw;
    const h = (b.y2 - b.y1) * dh;
    const color = COLORS[b.cid % COLORS.length] || '#ff5d6c';
    const isIssue = issueSet.has(i);
    const selected = state.selectedBox === i;
    const hover = state.hoverBox === i;

    ctx.save();
    if (selected || hover) {
      ctx.fillStyle = `${color}18`;
      ctx.fillRect(x, y, w, h);
    }
    if (isIssue) {
      ctx.strokeStyle = '#ff5d6c';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 4]);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 2.4 : 1.3;
      ctx.setLineDash([]);
    }
    ctx.strokeRect(x, y, w, h);

    if (selected) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      const hlen = Math.min(9, w / 3, h / 3);
      ctx.beginPath();
      ctx.moveTo(x, y + hlen); ctx.lineTo(x, y); ctx.lineTo(x + hlen, y);
      ctx.moveTo(x + w - hlen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + hlen);
      ctx.moveTo(x + w, y + h - hlen); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - hlen, y + h);
      ctx.moveTo(x + hlen, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - hlen);
      ctx.stroke();
    }

    if (state.showLabels) {
      const cn = state.manifest.classes[b.cid] || `class-${b.cid}`;
      const text = `#${i + 1} ${cn}`;
      ctx.font = '500 10px ui-monospace, Consolas, monospace';
      const tw = ctx.measureText(text).width + 10;
      let lx = x, ly = y - 16;
      if (ly < dy + 2) ly = y + 2;
      if (lx + tw > dx + dw) lx = dx + dw - tw;
      if (lx < dx) lx = dx;
      ctx.fillStyle = isIssue ? 'rgba(93,15,24,.92)' : 'rgba(6,10,14,.86)';
      ctx.fillRect(lx, ly, tw, 14);
      ctx.strokeStyle = isIssue ? 'rgba(255,93,108,.6)' : 'rgba(255,255,255,.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(lx, ly, tw, 14);
      ctx.fillStyle = isIssue ? '#ff9aa4' : '#dbe6f5';
      ctx.fillText(text, lx + 5, ly + 10);
    }
    ctx.restore();
  });

  // 问题但无框（空标签）提示
  if (s.issues.some((i) => i.box === null) && state.showLabels) {
    ctx.save();
    ctx.fillStyle = 'rgba(93,15,24,.9)';
    ctx.fillRect(dx + 8, dy + 8, 156, 20);
    ctx.strokeStyle = 'rgba(255,93,108,.6)';
    ctx.strokeRect(dx + 8, dy + 8, 156, 20);
    ctx.fillStyle = '#ff9aa4';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillText('NO LABEL · 需人工确认', dx + 14, dy + 22);
    ctx.restore();
  }
}

/* ---------- 右栏 ---------- */
function renderInspector() {
  const s = state.current;
  if (!s) return;
  const rv = state.reviews[s.id];
  $('#mId').textContent = `#${s.id}`;
  $('#mLabel').textContent = s.label;
  $('#mSize').textContent = `${s.width} × ${s.height}`;
  $('#mBoxes').textContent = `${s.boxes.length}`;
  $('#issueCount').textContent = `${s.issues.length} ISSUE${s.issues.length === 1 ? '' : 'S'}`;
  $('#boxCount').textContent = `${s.boxes.length} BOXES`;

  const statusEl = $('#reviewStatus');
  statusEl.className = `review-status ${rv?.status || ''}`;
  statusEl.textContent = rv ? (rv.status === 'pass' ? '已通过' : '已打回') : '待复核';

  $('#issueList').innerHTML = s.issues.length
    ? s.issues.map((it, idx) => `
      <div class="issue ${it.level === 'warn' ? 'warn' : ''} ${state.selectedBox === it.box ? 'on' : ''}" data-box="${it.box ?? ''}" data-idx="${idx}">
        <div class="issue__t"><b>${esc(ISSUE_META[it.type]?.zh || it.type)}</b><em>${it.box === null ? 'SAMPLE' : `BOX #${it.box + 1}`}</em></div>
        <p>${esc(it.message)}</p>
      </div>`).join('')
    : `<div class="ok-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>
        本样本未命中规则，可人工抽检后通过
      </div>`;

  $('#boxList').innerHTML = s.boxes.length
    ? s.boxes.map((b, i) => `
      <div class="box-row ${state.selectedBox === i ? 'on' : ''}" data-box="${i}">
        <i style="background:${COLORS[b.cid % COLORS.length] || '#ff5d6c'}"></i>
        <span>#${i + 1} ${esc(state.manifest.classes[b.cid] || `class-${b.cid}`)}</span>
        <em>${(b.w * 100).toFixed(1)}×${(b.h * 100).toFixed(1)}%</em>
      </div>`).join('')
    : '<div style="font-size:10.5px;color:var(--faint);padding:4px 0">标签为空</div>';

  $('#note').value = rv?.note || '';
  $('#nextHint').textContent = rv
    ? `已${rv.status === 'pass' ? '通过' : '打回'} · ${new Date(rv.at).toLocaleString('zh-CN', { hour12: false })}`
    : '复核后会自动进入下一张';
}

/* ---------- 选中 / 切图 ---------- */
async function selectSample(sid) {
  const s = state.samples.find((x) => x.id === sid);
  if (!s) return;
  state.current = s;
  state.selectedBox = -1;
  state.hoverBox = -1;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  state.currentImg = null;
  renderList();
  renderInspector();
  $('#stageId').textContent = `#${s.id}`;
  $('#stageSub').textContent = `${s.label} · ${s.boxes.length} boxes`;
  $('#hudSize').textContent = `${s.width}×${s.height}`;
  $('#hudIssues').hidden = !s.issues.length;
  $('#hudIssues').textContent = `${s.issues.length} ISSUE`;
  $('#hudZoom').textContent = '100%';
  draw();
  $('#stageEmpty').classList.add('show');
  try {
    const img = await loadImage(imgUrl(s));
    if (state.current?.id !== s.id) return;
    state.currentImg = img;
    $('#stageEmpty').classList.remove('show');
    draw();
  } catch {
    toast('图片加载失败：' + s.image, true);
  }
}

function step(delta) {
  const list = visibleSamples();
  if (!list.length) return;
  let i = list.findIndex((s) => s.id === state.current?.id);
  if (i < 0) i = 0;
  const next = list[(i + delta + list.length) % list.length];
  selectSample(next.id);
}

/* ---------- 复核 ---------- */
function setReview(status) {
  const s = state.current;
  if (!s) return;
  const note = $('#note').value.trim();
  state.reviews[s.id] = { status, note, at: new Date().toISOString() };
  saveReviews();
  renderList();
  renderStats();
  renderInspector();
  renderReport();
  toast(status === 'pass' ? `#${s.id} 已通过` : `#${s.id} 已打回，备注已保存`);
  const list = visibleSamples();
  const idx = list.findIndex((x) => x.id === s.id);
  const next = list[idx + 1] || list[idx - 1];
  if (next) setTimeout(() => { if (state.current?.id === s.id) selectSample(next.id); }, 260);
}

/* ---------- 规则页 ---------- */
function renderRules() {
  const rows = [
    ['empty_label', 'warn', '空标签', '标签文件存在但没有任何框。可能是“真负样本”（图上确实没有目标），也可能是漏标。', '先看采集场景与抽样比例，再决定补标还是标记为负样本；不要一刀切删除。'],
    ['invalid_class', 'error', '类别越界', 'class id 不在 0..N-1 范围内，训练时会直接报错或把目标分到错误类别。', '退回标注同学核对类别映射表；批量出现时先查导出脚本。'],
    ['out_of_bounds', 'error', '框越界', '框的坐标超出图片边界，常见于拖拽越界、坐标归一化错误、原图尺寸变更。', '按原图尺寸重算；无法修复的框退回重标。'],
    ['zero_area', 'error', '零面积框', '宽或高接近 0，通常是误点、复制粘贴或脚本写入了空框。', '删除空框；如对应真实目标则重标。'],
    ['tiny_box', 'warn', '过小框', '面积低于阈值，可能是远处小目标，也可能是误标。', '结合场景分辨率判断；小目标数据集应单独放宽容差。'],
    ['duplicate', 'error', '重复框', '同一目标被标了多个框，IoU 超过阈值。会虚增正样本、干扰 NMS 评估。', '保留质量最高的一个；批量重复时检查标注工具的复制快捷键。'],
    ['aspect_ratio', 'warn', '长宽比异常', '框的形状与类别先验不符，可能是方向贴错或拖拽变形。', '按类别设置合理范围，误报则加入白名单。'],
    ['parse_error', 'error', '标签解析失败', '字段数不是 5、存在非数字、编码错误等，属于“进不了训练脚本”的硬错误。', '定位到行号修复；导出环节增加 schema 校验。'],
  ];
  $('#ruleGrid').innerHTML = rows.map(([code, lv, title, desc, fix]) => `
    <article class="rule-card">
      <h3>${title}</h3>
      <span class="lv ${lv}">${lv.toUpperCase()}</span>
      <div class="code">${code}</div>
      <p>${desc}</p>
      <div class="fix"><b>处理：</b>${fix}</div>
    </article>`).join('');
}

/* ---------- 系统测试页 ---------- */
function renderTest() {
  const truth = state.truth || {};
  const keys = Object.keys(truth).sort();
  let hit = 0, total = 0;
  const rows = keys.map((sid) => {
    const s = state.samples.find((x) => x.id === sid);
    const expected = truth[sid] || [];
    const detected = new Set((s?.issues || []).map((i) => i.type));
    const ok = expected.every((k) => detected.has(k));
    total += expected.length;
    if (ok) hit += expected.length;
    const extra = [...detected].filter((k) => !expected.includes(k));
    return `<tr>
      <td class="mono">#${esc(sid)}</td>
      <td>${expected.map((k) => `<span class="tag-bad">${esc(ISSUE_META[k]?.zh || k)}</span>`).join(' ') || '—'}</td>
      <td>${[...detected].map((k) => `<span class="${k === 'empty_label' ? 'tag-ok' : 'tag-bad'}">${esc(ISSUE_META[k]?.zh || k)}</span>`).join(' ') || '—'}</td>
      <td>${ok ? '<span class="tag-ok">PASS</span>' : '<span class="tag-bad">MISS</span>'}</td>
      <td style="color:var(--dim)">${extra.length ? `额外命中：${extra.map((k) => ISSUE_META[k]?.zh || k).join('、')}` : '与真值一致'}</td>
    </tr>`;
  }).join('');

  const falsePos = state.samples.filter((s) => s.issues.length && !truth[s.id]).length;
  const ruleTypes = new Set(state.samples.flatMap((s) => s.issues.map((i) => i.type)));
  $('#tRecall').textContent = total ? pct(hit, total) : '—';
  $('#tFalse').textContent = `${falsePos} 个`;
  $('#tCases').textContent = `${ruleTypes.size} / 8`;
  $('#truthRows').innerHTML = rows || '<tr><td colspan="5" style="color:var(--faint)">未找到 qa_truth.json</td></tr>';
}

/* ---------- 报告页 ---------- */
function barRows(counts, total, colorMode = 'issue') {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((x) => x[1]));
  return entries.map(([k, v]) => `
    <div class="bar-row">
      <span>${esc(k)}</span>
      <div class="track"><i style="width:${(v / max * 100).toFixed(0)}%"></i></div>
      <em>${v}</em>
    </div>`).join('') || '<div style="color:var(--faint);font-size:10.5px">暂无</div>';
}

function handoffText() {
  const st = sampleStats();
  const lines = [
    '# 视觉数据复核退回单',
    '',
    `- 批次：WH-A-2026-10`,
    `- 样本：${st.total} 张 / ${st.boxes} 个框`,
    `- 规则命中：${st.bad} 张样本存在问题`,
    `- 已复核：${st.reviewed} 张（通过 ${st.passed} / 打回 ${st.rejected}）`,
    '',
    '## 需要处理的样本',
    '',
  ];
  const bad = state.samples.filter((s) => s.issues.length || state.reviews[s.id]?.status === 'reject');
  if (!bad.length) lines.push('本批未发现需要退回的样本。');
  bad.forEach((s) => {
    const rv = state.reviews[s.id];
    lines.push(`### #${s.id}${rv ? ` · ${rv.status === 'pass' ? '已通过' : '已打回'}` : ''}`);
    s.issues.forEach((it) => {
      const box = it.box === null ? '整张样本' : `第 ${it.box + 1} 个框`;
      lines.push(`- [${it.level}] ${ISSUE_META[it.type]?.zh || it.type}（${box}）：${it.message}`);
    });
    if (rv?.note) lines.push(`- 复核备注：${rv.note}`);
    lines.push('');
  });
  return lines.join('\n');
}

function renderReport() {
  const issueCounts = {};
  const classCounts = {};
  for (const s of state.samples) {
    for (const it of s.issues) issueCounts[ISSUE_META[it.type]?.zh || it.type] = (issueCounts[ISSUE_META[it.type]?.zh || it.type] || 0) + 1;
    for (const b of s.boxes) {
      const cn = state.manifest.classes[b.cid] || `class-${b.cid}`;
      classCounts[cn] = (classCounts[cn] || 0) + 1;
    }
  }
  $('#issueBars').innerHTML = barRows(issueCounts);
  $('#classBars').innerHTML = barRows(classCounts);
  const st = sampleStats();
  const checks = [
    `样本总数 <b>${st.total}</b> 张，标注框 <b>${st.boxes}</b> 个`,
    `规则命中 <b>${st.bad}</b> 张，干净样本 <b>${st.clean}</b> 张（${pct(st.clean, st.total)}）`,
    `已复核 <b>${st.reviewed}</b> 张：通过 <b>${st.passed}</b>，打回 <b>${st.rejected}</b>`,
    `剩余待复核 <b>${st.total - st.reviewed}</b> 张`,
    `复核结论已保存到浏览器 localStorage，可导出交接`,
  ];
  $('#reportChecks').innerHTML = checks.map((t) => `
    <div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg><span>${t}</span></div>`).join('');
  $('#handoff').value = handoffText();
}

/* ---------- 导出 ---------- */
function exportJson() {
  const payload = {
    batch: 'WH-A-2026-10',
    generatedAt: new Date().toISOString(),
    summary: sampleStats(),
    rules: RULES,
    reviews: state.reviews,
    samples: state.samples.map((s) => ({
      id: s.id, image: s.image, label: s.label, width: s.width, height: s.height,
      boxes: s.boxes.map(({ cid, cx, cy, w, h }) => ({ cid, cx, cy, w, h })),
      issues: s.issues,
      review: state.reviews[s.id] || null,
    })),
  };
  download('qa-review-report.json', JSON.stringify(payload, null, 2));
  toast('JSON 报告已导出');
}

function exportCsv() {
  const rows = [['sample', 'image', 'boxes', 'issues', 'issue_types', 'review_status', 'note']];
  for (const s of state.samples) {
    const rv = state.reviews[s.id];
    rows.push([
      s.id, s.image, s.boxes.length, s.issues.length,
      [...new Set(s.issues.map((i) => i.type))].join('|'),
      rv?.status || '', (rv?.note || '').replace(/[\r\n,]/g, ' '),
    ]);
  }
  const csv = '\ufeff' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  download('qa-review-report.csv', csv, 'text/csv');
  toast('CSV 已导出');
}

/* ---------- 事件 ---------- */
function bindEvents() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('.filters button').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    state.page = 0;
    renderList();
    const first = visibleSamples()[0];
    if (first) selectSample(first.id);
  }));

  $('#sampleList').addEventListener('click', (e) => {
    const el = e.target.closest('.sample');
    if (el) selectSample(el.dataset.sid);
  });
  $('#sampleList').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.sample');
    if (el) { e.preventDefault(); selectSample(el.dataset.sid); }
  });

  $('#prevPage').addEventListener('click', () => {
    state.page = Math.max(0, state.page - 1);
    renderList();
  });
  $('#nextPage').addEventListener('click', () => {
    const pages = Math.max(1, Math.ceil(visibleSamples().length / state.pageSize));
    state.page = Math.min(pages - 1, state.page + 1);
    renderList();
  });

  $('#issueList').addEventListener('click', (e) => {
    const el = e.target.closest('.issue');
    if (!el) return;
    const b = el.dataset.box;
    state.selectedBox = b === '' ? -1 : Number(b);
    renderInspector();
    draw();
  });
  $('#boxList').addEventListener('click', (e) => {
    const el = e.target.closest('.box-row');
    if (!el) return;
    state.selectedBox = Number(el.dataset.box);
    renderInspector();
    draw();
  });

  $('#note').addEventListener('input', () => {
    const s = state.current;
    if (!s) return;
    if (!state.reviews[s.id]) return;
    state.reviews[s.id].note = $('#note').value;
    saveReviews();
    renderReport();
  });

  $('#btnPass').addEventListener('click', () => setReview('pass'));
  $('#btnReject').addEventListener('click', () => setReview('reject'));
  $('#zoomIn').addEventListener('click', () => zoomBy(1.25));
  $('#zoomOut').addEventListener('click', () => zoomBy(0.8));
  $('#zoomFit').addEventListener('click', () => { state.zoom = 1; state.panX = 0; state.panY = 0; updateZoomHud(); draw(); });
  $('#toggleBoxes').addEventListener('click', (e) => { state.showBoxes = !state.showBoxes; e.currentTarget.classList.toggle('on', state.showBoxes); draw(); });
  $('#toggleLabels').addEventListener('click', (e) => { state.showLabels = !state.showLabels; e.currentTarget.classList.toggle('on', state.showLabels); draw(); });
  $('#toggleIssueOnly').addEventListener('click', (e) => { state.issueOnly = !state.issueOnly; e.currentTarget.classList.toggle('on', state.issueOnly); draw(); });

  $('#exportJson').addEventListener('click', exportJson);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#copyHandoff').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(handoffText()); toast('退回说明已复制'); }
    catch { const ta = $('#handoff'); ta.select(); document.execCommand('copy'); toast('退回说明已复制'); }
  });
  $('#resetReviews').addEventListener('click', () => {
    if (!confirm('清空本机所有复核状态？此操作不可撤销。')) return;
    state.reviews = {};
    saveReviews();
    renderList(); renderStats(); renderInspector(); renderReport();
    toast('复核状态已重置');
  });

  // 画布交互
  const stage = $('#stage');
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    const rect = stage.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (state.zoom > 1 && drag.moved) {
        state.panX = drag.panX + dx;
        state.panY = drag.panY + dy;
        stage.classList.add('dragging');
        draw();
      }
      return;
    }
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== state.hoverBox) {
      state.hoverBox = hit;
      $('#canvas').style.cursor = hit >= 0 ? 'pointer' : 'crosshair';
      draw();
    }
  });
  stage.addEventListener('pointerup', (e) => {
    const rect = stage.getBoundingClientRect();
    const wasMoved = drag?.moved;
    drag = null;
    stage.classList.remove('dragging');
    if (wasMoved) return;
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    state.selectedBox = hit;
    renderInspector();
    draw();
  });
  stage.addEventListener('pointerleave', () => {
    if (state.hoverBox !== -1) { state.hoverBox = -1; draw(); }
  });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    zoomBy(dir > 0 ? 1.12 : 0.9);
  }, { passive: false });

  window.addEventListener('resize', () => resizeCanvas());
  new ResizeObserver(() => resizeCanvas()).observe(stage);

  document.addEventListener('keydown', (e) => {
    if (state.tab !== 'review') return;
    const t = e.target;
    if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setReview('pass'); }
    else if (e.key === 'x' || e.key === 'X') { e.preventDefault(); setReview('reject'); }
    else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(0.8); }
    else if (e.key === 'f' || e.key === 'F') { state.zoom = 1; state.panX = 0; state.panY = 0; updateZoomHud(); draw(); }
  });
}

function zoomBy(f) {
  state.zoom = clamp(state.zoom * f, 1, 4);
  if (state.zoom === 1) { state.panX = 0; state.panY = 0; }
  updateZoomHud();
  draw();
}
function updateZoomHud() { $('#hudZoom').textContent = `${Math.round(state.zoom * 100)}%`; }

function hitTest(mx, my) {
  const s = state.current, img = state.currentImg;
  if (!s || !img) return -1;
  const stage = $('#stage');
  const cw = stage.clientWidth, ch = stage.clientHeight;
  const fit = fitScale();
  const scale = fit * state.zoom;
  const dw = img.width * scale, dh = img.height * scale;
  const dx = (cw - dw) / 2 + state.panX;
  const dy = (ch - dh) / 2 + state.panY;
  const ix = (mx - dx) / scale / img.width;
  const iy = (my - dy) / scale / img.height;
  for (let i = s.boxes.length - 1; i >= 0; i--) {
    const b = s.boxes[i];
    if (ix >= b.x1 && ix <= b.x2 && iy >= b.y1 && iy <= b.y2) return i;
  }
  return -1;
}

function showTab(name) {
  if (!['review', 'rules', 'test', 'report'].includes(name)) name = 'review';
  state.tab = name;
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  if (name === 'test') renderTest();
  if (name === 'report') renderReport();
  if (name === 'review') setTimeout(resizeCanvas, 30);
}

/* ---------- 启动 ---------- */
async function init() {
  bindEvents();
  renderRules();
  loadReviews();
  try {
    await loadData();
  } catch (e) {
    console.error(e);
    $('#sampleList').innerHTML = `<div style="padding:22px 12px;color:var(--red);font-size:11px;line-height:1.7">
      数据加载失败：${esc(e.message)}<br><br>
      请通过本地服务器打开，不要直接双击 HTML 文件。
    </div>`;
    $('#listCount').textContent = 'ERROR';
    toast('数据加载失败，请用本地服务器打开', true);
    return;
  }
  $('#legend').innerHTML = state.manifest.classes.map((c, i) =>
    `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(c)}</span>`).join('')
    + '<span><i style="background:#ff5d6c"></i>问题框</span>';
  renderStats();
  renderList();
  renderReport();
  const first = state.samples[0];
  if (first) selectSample(first.id);
  resizeCanvas();
  if (location.hash && location.hash.length > 1) showTab(location.hash.slice(1));
}

init();
