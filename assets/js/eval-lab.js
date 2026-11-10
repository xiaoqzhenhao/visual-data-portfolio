/* ============================================================
   Detection Eval Lab · 检测评估与错误分析
   ------------------------------------------------------------
   数据：dataset/eval.json（GT + 模拟 YOLO 预测）
   功能：
     - 置信度 / IoU 阈值、类别内 NMS 实时重算
     - Precision / Recall / F1 / mAP@0.5
     - 每类 P/R/AP、PR 曲线
     - TP/FP/FN 可视化与错误清单
   说明：预测是模拟输出，用于教学；真实项目替换 pred 即可。
   ============================================================ */

const DATA_BASE = new URL('../../dataset/', location.href);
const COLORS = ['#ff6b6b', '#ffc857', '#4cc9f0', '#f72585', '#9bdc5a'];
const NMS_IOU = 0.5;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const state = {
  data: null,
  images: [],
  current: null,
  currentImg: null,
  currentMatch: null,
  metrics: null,
  imageStats: new Map(),
  conf: 0.25,
  iou: 0.5,
  nms: true,
  onlyErr: false,
  filter: 'all',
  showGT: true,
  showPred: true,
  selectedErr: null,
  evalTimer: null,
};

/* ---------- 基础几何 ---------- */
function boxOf(o) {
  const [cx, cy, w, h] = o.bbox;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}
function iou(a, b) {
  const ix1 = Math.max(a[0], b[0]), iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]), iy2 = Math.min(a[3], b[3]);
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const ua = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const ub = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = ua + ub - inter;
  return union > 0 ? inter / union : 0;
}

/* ---------- NMS ---------- */
function nms(preds, iouTh = NMS_IOU) {
  const byClass = new Map();
  for (const p of preds) {
    if (!byClass.has(p.class_id)) byClass.set(p.class_id, []);
    byClass.get(p.class_id).push(p);
  }
  const kept = [];
  for (const list of byClass.values()) {
    list.sort((a, b) => b.confidence - a.confidence);
    const local = [];
    for (const p of list) {
      const pb = boxOf(p);
      if (local.some((k) => iou(pb, boxOf(k)) >= iouTh)) continue;
      local.push(p);
    }
    kept.push(...local);
  }
  return kept.sort((a, b) => b.confidence - a.confidence);
}

/* ---------- 单图匹配 ---------- */
function matchImage(img, confTh, iouTh, useNms) {
  let preds = img.pred.filter((p) => p.confidence >= confTh);
  if (useNms) preds = nms(preds, Math.min(NMS_IOU, iouTh));
  preds = preds.slice().sort((a, b) => b.confidence - a.confidence);

  const gts = img.gt.map((g, i) => ({ ...g, idx: i, used: false }));
  const matches = [];
  for (const p of preds) {
    const pb = boxOf(p);
    let best = -1, bestIou = -1;
    for (const g of gts) {
      if (g.used || g.class_id !== p.class_id) continue;
      const v = iou(pb, boxOf(g));
      if (v > bestIou) { bestIou = v; best = g.idx; }
    }
    if (best >= 0 && bestIou >= iouTh) {
      gts[best].used = true;
      matches.push({ type: 'TP', pred: p, gt: gts[best], iou: bestIou });
    } else {
      matches.push({ type: 'FP', pred: p, gt: null, iou: bestIou });
    }
  }
  const fn = gts.filter((g) => !g.used).map((g) => ({ type: 'FN', pred: null, gt: g, iou: 0 }));
  return {
    preds, gts, matches: [...matches, ...fn],
    tp: matches.filter((m) => m.type === 'TP').length,
    fp: matches.filter((m) => m.type === 'FP').length,
    fn: fn.length,
  };
}

/* ---------- 全量评估 + AP ---------- */
function allPointAP(items, ngt) {
  if (!ngt) return { ap: 0, points: [] };
  items.sort((a, b) => b.conf - a.conf);
  let tp = 0, fp = 0;
  const points = [];
  for (const it of items) {
    if (it.tp) tp++; else fp++;
    points.push({ r: tp / ngt, p: tp / Math.max(1, tp + fp) });
  }
  if (!points.length) return { ap: 0, points: [] };
  const rec = [0, ...points.map((p) => p.r), 1];
  const pre = [0, ...points.map((p) => p.p), 0];
  for (let i = pre.length - 2; i >= 0; i--) pre[i] = Math.max(pre[i], pre[i + 1]);
  let ap = 0;
  for (let i = 1; i < rec.length; i++) {
    if (rec[i] !== rec[i - 1]) ap += (rec[i] - rec[i - 1]) * pre[i];
  }
  return { ap, points };
}

function computeAP(cls, iouTh, useNms) {
  const items = [];
  let ngt = 0;
  for (const img of state.images) {
    const gts = img.gt.filter((g) => g.class_id === cls).map((g, i) => ({ ...g, used: false, idx: i }));
    ngt += gts.length;
    let preds = img.pred.filter((p) => p.class_id === cls && p.confidence >= 0.05);
    if (useNms) preds = nms(preds, Math.min(NMS_IOU, iouTh));
    preds.sort((a, b) => b.confidence - a.confidence);
    for (const p of preds) {
      const pb = boxOf(p);
      let best = -1, bestIou = -1;
      for (const g of gts) {
        if (g.used) continue;
        const v = iou(pb, boxOf(g));
        if (v > bestIou) { bestIou = v; best = g.idx; }
      }
      if (best >= 0 && bestIou >= iouTh) {
        gts[best].used = true;
        items.push({ conf: p.confidence, tp: 1 });
      } else {
        items.push({ conf: p.confidence, tp: 0 });
      }
    }
  }
  return { ngt, ...allPointAP(items, ngt) };
}

function evaluate() {
  const { conf, iou, nms: useNms } = state;
  const perClass = state.data.classes.map((name, c) => ({ name, c, tp: 0, fp: 0, fn: 0, gt: 0 }));
  let tp = 0, fp = 0, fn = 0;

  state.imageStats = new Map();
  for (const img of state.images) {
    const m = matchImage(img, conf, iou, useNms);
    state.imageStats.set(img.id, { fp: m.fp, fn: m.fn });
    if (img.id === state.current?.id) state.currentMatch = m;
    tp += m.tp; fp += m.fp; fn += m.fn;
    for (const g of img.gt) perClass[g.class_id].gt++;
    for (const it of m.matches) {
      if (it.type === 'TP') perClass[it.pred.class_id].tp++;
      else if (it.type === 'FP') perClass[it.pred.class_id].fp++;
    }
    for (const it of m.matches) {
      if (it.type === 'FN') perClass[it.gt.class_id].fn++;
    }
  }

  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);

  const curves = {};
  const aps = [];
  for (let c = 0; c < state.data.classes.length; c++) {
    const { ap, points } = computeAP(c, iou, useNms);
    perClass[c].ap = ap;
    curves[c] = points;
    if (perClass[c].gt > 0) aps.push(ap);
  }
  const map = aps.length ? aps.reduce((a, b) => a + b, 0) / aps.length : 0;

  state.metrics = { tp, fp, fn, precision, recall, f1, map, perClass, curves };
}

/* ---------- 绘制 ---------- */
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

function draw() {
  const c = $('#canvas');
  const ctx = c.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cw = c.width / dpr, ch = c.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const img = state.currentImg;
  $('#stageEmpty').classList.toggle('show', !img);
  if (!img || !state.current) return;

  const fit = Math.min((cw - 30) / img.width, (ch - 30) / img.height);
  const dw = img.width * fit, dh = img.height * fit;
  const dx = (cw - dw) / 2, dy = (ch - dh) / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.7)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#000';
  ctx.fillRect(dx, dy, dw, dh);
  ctx.restore();
  ctx.drawImage(img, dx, dy, dw, dh);

  const m = state.currentMatch || matchImage(state.current, state.conf, state.iou, state.nms);
  const p2s = (b) => [dx + b[0] * dw, dy + b[1] * dh, dx + b[2] * dw, dy + b[3] * dh];

  // GT
  if (state.showGT) {
    for (const g of state.current.gt) {
      const [x1, y1, x2, y2] = p2s(boxOf(g));
      ctx.save();
      ctx.strokeStyle = '#37e0b2';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.setLineDash([]);
      ctx.font = '9px ui-monospace, Consolas, monospace';
      ctx.fillStyle = 'rgba(6,14,12,.8)';
      const txt = `GT ${state.data.classes[g.class_id]}`;
      const tw = ctx.measureText(txt).width + 8;
      ctx.fillRect(x1, Math.max(dy + 1, y1 - 13), tw, 12);
      ctx.fillStyle = '#87f3dd';
      ctx.fillText(txt, x1 + 4, Math.max(dy + 10, y1 - 4));
      ctx.restore();
    }
  }

  // Predictions: TP / FP
  if (state.showPred) {
    for (const it of m.matches) {
      if (it.type === 'FN') continue;
      if (state.onlyErr && it.type === 'TP') continue;
      const p = it.pred;
      const [x1, y1, x2, y2] = p2s(boxOf(p));
      const color = it.type === 'TP' ? '#4cc9f0' : '#ff5d6c';
      const selected = state.selectedErr?.type === it.type && state.selectedErr?.pred === p;
      ctx.save();
      ctx.strokeStyle = selected ? '#fff' : color;
      ctx.lineWidth = selected ? 2.6 : 1.6;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.font = '9px ui-monospace, Consolas, monospace';
      const txt = `${it.type} ${state.data.classes[p.class_id]} ${p.confidence.toFixed(2)}`;
      const tw = ctx.measureText(txt).width + 8;
      let lx = x1, ly = Math.max(dy + 1, y1 - 13);
      if (ly < dy + 1) ly = y1 + 2;
      ctx.fillStyle = 'rgba(6,10,14,.84)';
      ctx.fillRect(lx, ly, tw, 12);
      ctx.fillStyle = color;
      ctx.fillText(txt, lx + 4, ly + 9);
      ctx.restore();
    }
  }

  // FN
  for (const it of m.matches) {
    if (it.type !== 'FN') continue;
    const g = it.gt;
    const [x1, y1, x2, y2] = p2s(boxOf(g));
    ctx.save();
    ctx.strokeStyle = '#ffc857';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    ctx.font = '9px ui-monospace, Consolas, monospace';
    const txt = `FN ${state.data.classes[g.class_id]}`;
    const tw = ctx.measureText(txt).width + 8;
    ctx.fillStyle = 'rgba(24,17,6,.86)';
    ctx.fillRect(x1, Math.min(dy + dh - 13, y2 + 1), tw, 12);
    ctx.fillStyle = '#ffd479';
    ctx.fillText(txt, x1 + 4, Math.min(dy + dh - 3, y2 + 10));
    ctx.restore();
  }
}

/* ---------- 面板 ---------- */
function renderStats() {
  const m = state.metrics;
  $('#mPrecision').textContent = `${(m.precision * 100).toFixed(1)}%`;
  $('#mRecall').textContent = `${(m.recall * 100).toFixed(1)}%`;
  $('#mF1').textContent = `${(m.f1 * 100).toFixed(1)}%`;
  $('#mAP').textContent = m.map.toFixed(3);
  $('#cTP').textContent = `TP ${m.tp}`;
  $('#cFN').textContent = `FN ${m.fn}`;
  $('#cFP').textContent = `FP ${m.fp}`;
}

function renderClassTable() {
  $('#classTable').innerHTML = state.metrics.perClass.map((c) => {
    const p = c.tp / Math.max(1, c.tp + c.fp);
    const r = c.tp / Math.max(1, c.tp + c.fn);
    return `<tr><td>${state.data.classes[c.c]}</td><td>${(p * 100).toFixed(0)}%</td><td>${(r * 100).toFixed(0)}%</td><td>${c.ap.toFixed(2)}</td></tr>`;
  }).join('');
}

function renderPR() {
  const c = $('#pr');
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const padL = 30, padR = 10, padT = 10, padB = 22;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#070b11';
  ctx.fillRect(0, 0, W, H);

  // grid
  ctx.strokeStyle = 'rgba(137,160,187,.14)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const x = padL + (W - padL - padR) * i / 4;
    const y = padT + (H - padT - padB) * i / 4;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }
  // axes labels
  ctx.fillStyle = '#4d5c6e';
  ctx.font = '9px ui-monospace, Consolas, monospace';
  ctx.fillText('R', W - 14, H - 6);
  ctx.save(); ctx.translate(9, padT + 10); ctx.rotate(-Math.PI / 2); ctx.fillText('P', 0, 0); ctx.restore();
  ctx.fillText('0', padL - 3, H - 8);
  ctx.fillText('1', W - padR - 3, H - 8);

  const x = (r) => padL + (W - padL - padR) * clamp(r, 0, 1);
  const y = (p) => padT + (H - padT - padB) * (1 - clamp(p, 0, 1));

  state.data.classes.forEach((name, i) => {
    const pts = state.metrics.curves[i] || [];
    if (!pts.length) return;
    ctx.strokeStyle = COLORS[i];
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x(0), y(1));
    for (const p of pts) ctx.lineTo(x(p.r), y(p.p));
    ctx.lineTo(x(1), y(0));
    ctx.stroke();
  });

  $('#prLegend').innerHTML = state.data.classes.map((n, i) =>
    `<span><i style="background:${COLORS[i]}"></i>${n} ${state.metrics.perClass[i].ap.toFixed(2)}</span>`).join('');
}

function renderErrors() {
  const m = state.currentMatch;
  const list = $('#errorList');
  if (!m) { list.innerHTML = ''; return; }
  const errors = m.matches.filter((it) => it.type === 'FP' || it.type === 'FN');
  $('#errorCount').textContent = errors.length;
  $('#hudErr').hidden = !errors.length;
  $('#hudErr').textContent = `ERR ${errors.length}`;
  if (!errors.length) {
    list.innerHTML = '<div style="color:var(--mint);font-size:10px;padding:4px 2px">当前阈值下，本样本无 FP/FN。调低置信度/提高 IoU 再看看。</div>';
    return;
  }
  list.innerHTML = errors.map((it, i) => {
    if (it.type === 'FP') {
      return `<div class="err" data-i="${i}"><span class="err__t">FP</span><span class="err__d">${state.data.classes[it.pred.class_id]} · 置信度 ${it.pred.confidence.toFixed(2)}</span><span class="err__c">误检</span></div>`;
    }
    return `<div class="err fn" data-i="${i}"><span class="err__t">FN</span><span class="err__d">${state.data.classes[it.gt.class_id]} · 漏检</span><span class="err__c">GT 未匹配</span></div>`;
  }).join('');
  list.querySelectorAll('.err').forEach((el) => el.addEventListener('click', () => {
    const it = errors[Number(el.dataset.i)];
    state.selectedErr = { type: it.type, pred: it.pred, gt: it.gt };
    list.querySelectorAll('.err').forEach((x) => x.classList.toggle('on', x === el));
    draw();
  }));
}

function renderList() {
  const imgs = state.images.filter((img) => {
    if (state.filter === 'all') return true;
    const s = state.imageStats.get(img.id) || { fp: 0, fn: 0 };
    return state.filter === 'error' ? s.fp + s.fn > 0 : s.fp + s.fn === 0;
  });
  $('#listCount').textContent = `${imgs.length} IMAGES`;
  $('#sampleList').innerHTML = imgs.map((img) => {
    const s = state.imageStats.get(img.id) || { fp: 0, fn: 0 };
    const n = s.fp + s.fn;
    return `<div class="sample ${state.current?.id === img.id ? 'on' : ''}" data-id="${img.id}">
      <div class="sample__thumb"><img src="${new URL(img.image, DATA_BASE).href}" loading="lazy" alt=""></div>
      <div><div class="sample__id">#${img.id}</div><div class="sample__sub">GT ${img.gt.length} · PRED ${img.pred.length}</div></div>
      <span class="sample__badge ${n ? '' : 'ok'}">${n ? `${n} err` : 'OK'}</span>
    </div>`;
  }).join('') || '<div style="padding:20px 8px;color:var(--faint);font-size:10px;text-align:center">当前筛选下没有样本</div>';
  $$('#sampleList .sample').forEach((el) => el.addEventListener('click', () => selectImage(el.dataset.id)));
}

function renderCurrentHeader() {
  const img = state.current;
  if (!img) return;
  const m = state.currentMatch;
  $('#stageId').textContent = `#${img.id}`;
  $('#stageSub').textContent = `${img.width}×${img.height} · GT ${img.gt.length} / PRED ${img.pred.length} · 当前 TP ${m?.tp ?? 0} FP ${m?.fp ?? 0} FN ${m?.fn ?? 0}`;
  $('#hudGt').textContent = `GT ${img.gt.length}`;
  $('#hudPred').textContent = `PRED ${m?.preds.length ?? 0}`;
}

/* ---------- 选择/评估 ---------- */
async function selectImage(id) {
  const img = state.images.find((x) => x.id === id);
  if (!img) return;
  state.current = img;
  state.currentImg = null;
  state.selectedErr = null;
  state.currentMatch = matchImage(img, state.conf, state.iou, state.nms);
  renderCurrentHeader();
  renderErrors();
  renderList();
  draw();
  try {
    const el = await loadImage(new URL(img.image, DATA_BASE).href);
    if (state.current?.id !== id) return;
    state.currentImg = el;
    draw();
  } catch { /* ignore */ }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

function scheduleEval() {
  clearTimeout(state.evalTimer);
  state.evalTimer = setTimeout(() => {
    evaluate();
    state.currentMatch = state.current ? matchImage(state.current, state.conf, state.iou, state.nms) : null;
    renderStats();
    renderClassTable();
    renderPR();
    renderCurrentHeader();
    renderErrors();
    renderList();
    draw();
  }, 60);
}

/* ---------- 导出 ---------- */
function download(name, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
}

function exportJson() {
  const m = state.metrics;
  const payload = {
    model: state.data.model,
    note: state.data.note,
    thresholds: { confidence: state.conf, iou: state.iou, nms: state.nms },
    metrics: {
      precision: +m.precision.toFixed(4), recall: +m.recall.toFixed(4),
      f1: +m.f1.toFixed(4), mAP50: +m.map.toFixed(4),
      tp: m.tp, fp: m.fp, fn: m.fn,
      perClass: m.perClass.map((c) => ({
        class: state.data.classes[c.c], gt: c.gt, tp: c.tp, fp: c.fp, fn: c.fn,
        precision: +(c.tp / Math.max(1, c.tp + c.fp)).toFixed(4),
        recall: +(c.tp / Math.max(1, c.tp + c.fn)).toFixed(4),
        ap50: +c.ap.toFixed(4),
      })),
    },
    images: state.images.map((img) => {
      const s = state.imageStats.get(img.id) || { fp: 0, fn: 0 };
      return { id: img.id, fp: s.fp, fn: s.fn };
    }),
  };
  download('detection-eval-report.json', JSON.stringify(payload, null, 2), 'application/json');
  toast('评估报告已导出');
}

function exportCsv() {
  const rows = [['sample', 'type', 'class', 'confidence', 'note']];
  for (const img of state.images) {
    const m = matchImage(img, state.conf, state.iou, state.nms);
    for (const it of m.matches) {
      if (it.type === 'FP') rows.push([img.id, 'FP', state.data.classes[it.pred.class_id], it.pred.confidence.toFixed(2), '误检']);
      if (it.type === 'FN') rows.push([img.id, 'FN', state.data.classes[it.gt.class_id], '', '漏检']);
    }
  }
  const csv = '\ufeff' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  download('detection-errors.csv', csv, 'text/csv');
  toast('错误清单已导出');
}

function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---------- 绑定 ---------- */
function bind() {
  $('#conf').addEventListener('input', (e) => {
    state.conf = Number(e.target.value);
    $('#confVal').textContent = state.conf.toFixed(2);
    scheduleEval();
  });
  $('#iou').addEventListener('input', (e) => {
    state.iou = Number(e.target.value);
    $('#iouVal').textContent = state.iou.toFixed(2);
    scheduleEval();
  });
  $('#nms').addEventListener('change', (e) => { state.nms = e.target.checked; scheduleEval(); });
  $('#hideLow').addEventListener('change', (e) => { state.onlyErr = e.target.checked; draw(); });
  $('#toggleGT').addEventListener('click', (e) => { state.showGT = !state.showGT; e.currentTarget.classList.toggle('on', state.showGT); draw(); });
  $('#togglePred').addEventListener('click', (e) => { state.showPred = !state.showPred; e.currentTarget.classList.toggle('on', state.showPred); draw(); });
  $('#prevSample').addEventListener('click', () => step(-1));
  $('#nextSample').addEventListener('click', () => step(1));
  $$('#filters button').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    $$('#filters button').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  }));
  $('#exportJson').addEventListener('click', exportJson);
  $('#exportCsv').addEventListener('click', exportCsv);
  window.addEventListener('resize', resizeCanvas);
  new ResizeObserver(() => resizeCanvas()).observe($('#stage'));
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') step(-1);
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') step(1);
  });
}

function step(delta) {
  const imgs = state.images.filter((img) => {
    const s = state.imageStats.get(img.id) || { fp: 0, fn: 0 };
    if (state.filter === 'error') return s.fp + s.fn > 0;
    if (state.filter === 'clean') return s.fp + s.fn === 0;
    return true;
  });
  if (!imgs.length) return;
  let i = imgs.findIndex((x) => x.id === state.current?.id);
  if (i < 0) i = 0;
  selectImage(imgs[(i + delta + imgs.length) % imgs.length].id);
}

/* ---------- 启动 ---------- */
async function init() {
  bind();
  try {
    const res = await fetch(new URL('eval.json', DATA_BASE));
    if (!res.ok) throw new Error(`eval.json HTTP ${res.status}`);
    state.data = await res.json();
    state.images = state.data.images;
    evaluate();
    state.currentMatch = null;
    renderStats();
    renderClassTable();
    renderPR();
    await selectImage(state.images[0].id);
    resizeCanvas();
  } catch (e) {
    console.error(e);
    $('#sampleList').innerHTML = `<div style="padding:20px 10px;color:var(--red);font-size:10.5px;line-height:1.7">数据加载失败：${e.message}<br><br>请通过本地服务器打开，不要双击 HTML。</div>`;
    $('#listCount').textContent = 'ERROR';
    toast('数据加载失败，请用本地服务器', true);
  }
}

init();
