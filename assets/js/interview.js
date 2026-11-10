/* 面试问答训练 · 20 题
   每题：结论 / 证据 / 边界 / 可能追问
   60 秒计时 + 自评分，进度存 localStorage。 */

const QUESTIONS = [
  {
    tag: 'HR', q: '你专科，别人本科，为什么选你？',
    a1: '学历是事实，我不回避；我用可运行的作品补学历差距。',
    a2: '四个作品：视觉数据质检工作台（120 张/789 框/8 规则/24 个缺陷全命中）、3D 空间检查器（15,318 点/9 个 3D 框）、Detection Eval Lab（96 图/641 GT，mAP@0.5 0.757）、数据审计 CLI（120 张 0.33s）。',
    a3: 'C++/PyTorch 训练还在补，我不假装精通；如果贵司接受实习/项目制，我愿意用产出证明。',
    follow: '那你觉得本科生的优势是什么？你怎么补？',
  },
  {
    tag: 'HR', q: '为什么投数据工程师，不是 Unity/VR 开发？',
    a1: 'VR 让我理解 3D 空间，但我更喜欢把数据变干净、把问题定位清楚。',
    a2: 'Unity 是“把场景做出来”；数据工程是“让每一帧、每个框可训练、可复核”。我的三个项目都在做后者：标注质检、3D 框检查、检测评估。',
    a3: '我不排斥 Unity，但职业方向明确选数据侧；这样我能把 3D 空间感变成差异化，而不是和科班拼渲染。',
    follow: '那你 Unity 到什么程度？',
  },
  {
    tag: 'HR', q: '为什么是超节点？',
    a1: '贵司做实时三维视觉感知，数据侧会涉及点云、语义标注和评测，和我的方向直接对上。',
    a2: '公开资料提到 SDK 支持 Linux/ROS/Android，提供 C++/Python API，涉及点云、语义地图；我的 3D 点云 + Python 数据工具正好用得上。',
    a3: '我了解的是公开信息，内部流程还要向团队学习；我不想背公司简介，更想聊数据侧具体做什么。',
    follow: '你还看过我们什么产品？',
  },
  {
    tag: 'HR', q: '你最大的优势是什么？',
    a1: '我能把“空间里的问题”翻译成可复核的数据问题。',
    a2: '框内点数/密度/空框 → 3D 质检；8 条规则 + 样本号/框序号 → 2D 质检；TP/FP/FN + P/R/mAP → 检测评估。',
    a3: '我不是算法大神，但我能把数据侧的口径、报告、退回流程做清楚。',
    follow: '举个你发现别人没发现的问题的例子？',
  },
  {
    tag: 'HR', q: '你最大的缺点是什么？',
    a1: 'C++ 和 PyTorch 训练经验不足。',
    a2: '我能读懂基础代码、跑通推理/评估，但还不能独立训检测模型；已经在补最小闭环，并用 Eval Lab 把评估链路先跑通。',
    a3: '我不会说“我完美主义”；这是真实短板，给我 2–3 个月能补到能干活的程度。',
    follow: '那你为什么还投数据工程师？',
  },
  {
    tag: 'HR', q: '期望薪资是多少？',
    a1: '参考深圳专科应届数据岗，期望 7–9K，可按岗位职责和实习/试用期调整。',
    a2: '我先问职责：纯质检，还是含采集、工具、评测？如果接触真实 3D 数据和转正路径明确，我愿意谈。',
    a3: '低于 6K 要考虑租房成本；但我不会只盯着起薪，更看重能不能长期做 3D 视觉数据。',
    follow: '如果我们只能给 6K 呢？',
  },
  {
    tag: 'HR', q: '能实习多久？什么时候到岗？',
    a1: '可实习，随时到岗；学校课程/毕业设计可以协调。',
    a2: '如果论文/答辩冲突，我会提前说清时间，不临时失联；深圳/出差都能接受。',
    a3: '具体实习时长可以和学校确认，但我会优先保证工作交接。',
    follow: '你学校允许长期实习吗？',
  },
  {
    tag: '专业', q: 'COCO 和 YOLO 标签怎么互转？',
    a1: 'COCO 是 JSON + 绝对像素，YOLO 是每图一个 txt + 归一化坐标；核心是格式和类别偏移。',
    a2: 'COCO bbox = [x,y,w,h] 像素，category_id 从 1 开始；YOLO 每行 class cx cy w h，归一化 0–1，class 从 0 开始。转换时 id ±1、坐标归一化/反归一化。',
    a3: '坑在类别映射、图片尺寸、空标签、越界；我会写单测，用四角坐标验证。',
    follow: '如果一张图里有 3 个类别，txt 怎么写？',
  },
  {
    tag: '专业', q: 'IoU 是什么？怎么用它算 TP/FP/FN？',
    a1: 'IoU 是交集面积 ÷ 并集面积，用来衡量两个框的重合度。',
    a2: '匹配时同类别、按置信度排序、一个 GT 只能被一个预测匹配；IoU ≥ 阈值（常用 0.5）算 TP，否则 FP；没被匹配的 GT 是 FN。',
    a3: '阈值不是真理，0.5 和 0.75 会得到不同结论；类别错了即使 IoU 高也不能算 TP。',
    follow: '一个 GT 被两个预测匹配，怎么算？',
  },
  {
    tag: '专业', q: 'NMS 是干什么的？阈值怎么影响结果？',
    a1: 'NMS 去掉同一目标的重复框，保留置信度最高的。',
    a2: '按置信度排序，取最高框，删掉同类别且 IoU 超阈值的框，重复。阈值低删得狠，框更少；阈值高保留多，重复框可能残留。',
    a3: '密集目标可能被误删；所以有 Soft-NMS、类别内 NMS 等变体，要看场景。',
    follow: '为什么 NMS 通常按类别做？',
  },
  {
    tag: '专业', q: 'mAP 怎么算？mAP@0.5 和 mAP@[.5:.95] 有什么区别？',
    a1: 'mAP 是每个类别 AP 的平均；AP 是 PR 曲线下面积。',
    a2: '固定类别和 IoU，按置信度排序算 P/R，画 PR 曲线求面积；mAP@0.5 只看 IoU 0.5，mAP@[.5:.95] 在 10 个 IoU 阈值上平均，更严格。',
    a3: '不能跨数据集比较：类别数、图片数、IoU 阈值不同，数字没有可比性。',
    follow: '为什么 mAP 高但实际效果差？',
  },
  {
    tag: '专业', q: 'Precision 和 Recall 怎么取舍？',
    a1: 'P 是报出来的有多少对的，R 是该找的找回了多少；阈值高 P 升 R 降。',
    a2: 'P=TP/(TP+FP)，R=TP/(TP+FN)，F1=2PR/(P+R)。误报代价高看 P，漏检代价高看 R；汇报必须带 per-class。',
    a3: '不能只报一个总 mAP；类别不平衡时，总分会掩盖小目标的问题。',
    follow: '如果业务要求“不能漏人”，你怎么调？',
  },
  {
    tag: '专业', q: '标注质量怎么量化？',
    a1: '分过程指标和结果指标，不能只看一个“准确率”。',
    a2: '过程：抽检通过率、返修率、问题类型分布；结果：与 gold set 的 IoU/类别一致率、多人一致性；业务：bad case 率、评测集提升。',
    a3: '要分层看类别/场景/标注员；单一总数会掩盖问题。',
    follow: '没有 gold set 怎么办？',
  },
  {
    tag: '项目', q: '你的 24/24 是什么？能说明模型很准吗？',
    a1: '不能。24/24 是规则对 24 个预置缺陷的回归测试，不是模型准确率。',
    a2: '120 张样本里按固定节奏注入 8 类缺陷，每类 3 个；规则引擎跑完与真值逐条比对，24/24 命中。',
    a3: '这证明规则能抓到已知问题，不证明能抓到未知问题；真实数据要看 per-class Precision/Recall。',
    follow: '0 误报呢？真实数据也 0 误报吗？',
  },
  {
    tag: '项目', q: '0 误报能证明什么？不能证明什么？',
    a1: '只证明在这批合成数据上，规则没有把正常样本误判为问题。',
    a2: '合成数据分布干净；真实场景有光照、遮挡、类别混淆，误报会上升。',
    a3: '下一步要用真实数据分层抽样 + 人工仲裁，按类别/场景看 Precision，而不是承诺 0 误报。',
    follow: '如果真实数据误报 30%，你怎么办？',
  },
  {
    tag: '项目', q: '3D 框怎么判断标得好不好？',
    a1: '看框内点数/密度、尺寸先验、朝向、与 2D 投影一致性、多帧一致性。',
    a2: '我的 Spatial Lab 计算点数、体积、密度、长宽比，标记空框/稀疏/尺寸异常；0 点先 REVIEW，不直接判错。',
    a3: 'AABB 只是第一层；真实产线要 OBB + yaw，并做 2D-3D 投影检查。',
    follow: '空框一定是标错吗？',
  },
  {
    tag: '专业', q: 'AABB 和 OBB 有什么区别？',
    a1: 'AABB 轴对齐，简单但忽略朝向；OBB 带 yaw，更贴近真实目标。',
    a2: '目标斜放时，AABB 会变大，把背景/相邻目标包进来，体积和点数统计都会偏。',
    a3: '我的项目先用 AABB 验证逻辑；真实 3D 标注要升级 OBB，计算更复杂但更准。',
    follow: 'OBB 的点数怎么算？',
  },
  {
    tag: '专业', q: 'Linux 磁盘满了怎么排查？',
    a1: '先看分区，再逐层定位大文件，最后确认能不能删。',
    a2: 'df -h 看分区；du -sh * | sort -h 逐层定位；find /path -type f -size +1G 找大文件；lsof 看是否被进程占用。',
    a3: '不要直接 rm -rf；先确认文件归属、备份、日志轮转，再清理。',
    follow: '如果是日志把磁盘打满？',
  },
  {
    tag: '专业', q: '多进程和多线程怎么选？',
    a1: 'CPU 密集用多进程，I/O 密集可用多线程/异步。',
    a2: 'Python 有 GIL，同一时刻只有一个线程执行字节码；我的审计 CLI 按图片切分，Linux 多进程，Windows 自动回退线程池。',
    a3: '多进程有启动/序列化开销，小数据集反而更慢；要按 batch 大小选。',
    follow: '你的 CLI 为什么不是默认多进程？',
  },
  {
    tag: '项目', q: '数据从 120 张变 10 万张，这套东西怎么改？',
    a1: '从“脚本”升级成“数据管线”：manifest、分片、并发、版本、监控。',
    a2: '对象存储 + manifest（路径/hash/批次/版本）；分片 + 并发 + 断点续跑；先全量轻规则，再分层抽样重规则/人工；数据/标签/规则都版本化。',
    a3: '我没做过 10 万张的真实压测，这是方案不是战绩；给我数据我会先做 1 万张的基准测试。',
    follow: '如果让你一周上线，你先做什么？',
  },
];

const KEY = 'interview-drill-v1';
let scores = {};
try { scores = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { scores = {}; }
let i = 0;
let timeLeft = 60;
let timer = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function save() { try { localStorage.setItem(KEY, JSON.stringify(scores)); } catch { /* ignore */ } }
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function renderList() {
  $('#qlist').innerHTML = QUESTIONS.map((q, idx) => {
    const s = scores[idx] || 0;
    return `<button class="qitem ${idx === i ? 'on' : ''} s${s}" data-i="${idx}">
      <span class="n">${String(idx + 1).padStart(2, '0')}</span>
      <span>${q.q}</span>
      <span class="s">${s ? `${s}/3` : '—'}</span>
    </button>`;
  }).join('');
  $$('#qlist .qitem').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.i))));
  const done = Object.keys(scores).length;
  const avg = done ? (Object.values(scores).reduce((a, b) => a + b, 0) / done).toFixed(1) : '—';
  $('#doneText').textContent = `${done} / ${QUESTIONS.length}`;
  $('#bar').style.width = `${(done / QUESTIONS.length) * 100}%`;
  $('#avg').textContent = `平均 ${avg}`;
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}
function resetTimer() {
  stopTimer(); timeLeft = 60;
  $('#timerNum').textContent = '60';
  $('#timerNum').classList.remove('low');
  $('#timerBar').style.width = '100%';
  $('#startBtn').textContent = '开始 60 秒';
}
function startTimer() {
  if (timer) { stopTimer(); $('#startBtn').textContent = '继续 60 秒'; return; }
  $('#startBtn').textContent = '暂停';
  timer = setInterval(() => {
    timeLeft--;
    $('#timerNum').textContent = String(timeLeft);
    $('#timerBar').style.width = `${(timeLeft / 60) * 100}%`;
    if (timeLeft <= 10) $('#timerNum').classList.add('low');
    if (timeLeft <= 0) {
      stopTimer(); $('#startBtn').textContent = '重新计时';
      toast('时间到：先说结论，再给两条证据。');
    }
  }, 1000);
}

function show(idx) {
  i = Math.max(0, Math.min(QUESTIONS.length - 1, idx));
  const q = QUESTIONS[i];
  resetTimer();
  $('#tag').textContent = q.tag;
  $('#idx').textContent = `${String(i + 1).padStart(2, '0')} / ${QUESTIONS.length}`;
  $('#question').textContent = q.q;
  $('#a1').innerHTML = q.a1;
  $('#a2').innerHTML = q.a2;
  $('#a3').innerHTML = q.a3;
  $('#follow').innerHTML = q.follow;
  $('#answer').classList.remove('show');
  $('#score').classList.remove('show');
  $$('#score button').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === scores[i]));
  renderList();
}

function reveal() {
  stopTimer();
  $('#answer').classList.add('show');
  $('#score').classList.add('show');
}

function score(n) {
  scores[i] = n;
  save();
  $$('#score button').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === n));
  renderList();
  toast(n === 3 ? '流畅：下一题' : n === 2 ? '能说：再补一条证据' : '卡住：回去看训练营这一课');
}

function bind() {
  $('#startBtn').addEventListener('click', startTimer);
  $('#revealBtn').addEventListener('click', reveal);
  $('#nextBtn').addEventListener('click', () => show((i + 1) % QUESTIONS.length));
  $$('#score button').forEach((b) => b.addEventListener('click', () => score(Number(b.dataset.s))));
  $('#randomBtn').addEventListener('click', () => show(Math.floor(Math.random() * QUESTIONS.length)));
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('清空所有自评分？')) return;
    scores = {}; save(); show(0); toast('已重置');
  });
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
    if (e.key === ' ') { e.preventDefault(); reveal(); }
  });
}

bind();
show(0);
