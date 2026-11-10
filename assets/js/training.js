/* ============================================================
   训练营 · 8 课
   ------------------------------------------------------------
   用两个作品做教材：检测评估、标注质检、3D 点云、面试表达。
   进度存 localStorage；每课一个测验 + 一个动手作业。
   ============================================================ */

const LESSONS = [
  {
    id: 'l1',
    short: '检测任务',
    title: '检测任务：模型到底在输出什么',
    tag: 'FOUNDATION',
    minutes: 8,
    lead: '先别急着背 mAP。你做的所有事，最终都要回到一句话：模型输出了什么，GT 要求什么。',
    body: `
      <p>目标检测的输出不是“一个类别”，而是一组：<b>框 + 类别 + 置信度</b>。框的位置是图像坐标，不是“感觉差不多”。</p>
      <h2>两套必须会互转的格式</h2>
      <div class="two-col">
        <div class="mini-card"><b>YOLO</b><span>一行一个框：<code>class cx cy w h</code>，全部归一化到 0–1；class 从 0 开始。</span></div>
        <div class="mini-card"><b>COCO</b><span>JSON：<code>annotations.bbox = [x, y, w, h]</code> 绝对像素；<code>category_id</code> 从 1 开始。</span></div>
      </div>
      <div class="formula">YOLO: 0 0.512 0.480 0.120 0.260<br>COCO: bbox [x, y, w, h] 像素</div>
      <h2>为什么坐标系会坑人</h2>
      <p>图片缩放、Canvas 绘制、导出、训练预处理，任何一层把 <code>cxcywh</code> 和 <code>xyxy</code> 搞混，框就会飘。数据工程师最常见的 bug 不是“模型不行”，而是<b>标签和图片没对齐</b>。</p>
      <div class="note"><b>工程习惯：</b>内部统一用 <b>xyxy 归一化</b>；只在导出时转格式；转换函数写单测，用四角坐标验证。</div>
      <div class="warn-note note"><b>数据岗高频追问：</b>COCO 转 YOLO 时，类别 id 要减 1；YOLO 转 COCO 时要加 1。忘了这一步，模型会把“人”学成“叉车”。</div>
      <div class="note"><b>7 天节奏：</b>Day1 L1–L2 · Day2 L3–L4 · Day3 L5 · Day4 L6 · Day5 L7 · Day6 L8 + 模拟面试 · Day7 复盘/投递。</div>
      <div class="note"><b>拿 #0001 练：</b>第一行 <code>4 0.145313 0.537500 0.234375 0.535000</code>，转成 xyxy 是 <code>(0.028, 0.270) → (0.263, 0.805)</code>；乘 640×400 得 <code>[18, 108, 168, 322]</code>。去 QA Console 对照这个框。</div>
    `,
    quiz: {
      q: '下面哪一行是合法的 YOLO 标签？',
      options: ['person 120 80 40 90', '0 0.512 0.480 0.120 0.260', '{"bbox":[120,80,40,90]}', '1 120 80 40 90'],
      answer: 1,
      why: 'YOLO 每行 5 个字段：class + cx cy w h，且坐标归一化到 0–1；类别从 0 开始。A 有类别名，C 是 COCO 风格，D 是像素坐标且类别从 1 开始。',
    },
    homework: '打开 <a href="demos/qa/">QA Console</a>，点一个样本，找到对应的 <code>labels/*.txt</code>，手算一个框的 xyxy，和画布上的框对一遍。',
  },
  {
    id: 'l2',
    short: 'IoU / TP / FP / FN',
    title: 'IoU：一个数字决定 TP / FP / FN',
    tag: 'CORE METRIC',
    minutes: 10,
    lead: '评估不是“看起来像”，而是按规则匹配：同一个类别、IoU 过阈值、一个 GT 只能被一个预测匹配。',
    body: `
      <p><b>IoU</b>（Intersection over Union）= 两个框的交集面积 ÷ 并集面积。取值 0–1，越大越重合。</p>
      <div class="formula">IoU = area(A ∩ B) / area(A ∪ B)</div>
      <h2>匹配流程（必须背下来）</h2>
      <ol>
        <li>预测按置信度从高到低排序；</li>
        <li>每个预测只在<b>同一类别</b>里找 IoU 最大的、还没被匹配的 GT；</li>
        <li>IoU ≥ 阈值（常用 0.5）→ <b>TP</b>；否则 → <b>FP</b>；</li>
        <li>最后没被任何预测匹配上的 GT → <b>FN</b>。</li>
      </ol>
      <div class="two-col">
        <div class="mini-card"><b>TP</b><span>预测对了：类别对、IoU 过阈值、GT 没被别人抢走。</span></div>
        <div class="mini-card"><b>FP</b><span>误检：框错了，或类别错了，或重复框。</span></div>
        <div class="mini-card"><b>FN</b><span>漏检：GT 没被任何预测匹配上。</span></div>
        <div class="mini-card"><b>容易错</b><span>一个 GT 被两个预测匹配：只能算一个 TP，另一个 FP。</span></div>
      </div>
      <div class="note"><b>类别敏感：</b>“人”的框和“叉车”的框即使 IoU 很高，也不能算 TP；类别错了就是 FP + FN。</div>
    `,
    quiz: {
      q: '一个预测框与某个 GT 同类别，IoU=0.62，阈值设 0.5，GT 还没被匹配。它算什么？',
      options: ['FP，因为不到 0.7', 'TP，因为 0.62 ≥ 0.5 且类别、唯一性都满足', 'FN，因为 GT 没被匹配', '无法判断，必须看 mAP'],
      answer: 1,
      why: 'TP 的条件是：同类别、IoU ≥ 阈值、GT 未被占用。0.62 ≥ 0.5，满足。0.7 不是通用阈值，只是更严格的选择。',
    },
    homework: '打开 <a href="demos/eval/">Eval Lab</a>，保持 conf=0.25、IoU=0.50，找一张同时有 FP 和 FN 的样本，截图并在纸上标出哪个是 FP、哪个是 FN。',
  },
  {
    id: 'l3',
    short: 'P / R / F1',
    title: 'Precision / Recall：别只看一个数',
    tag: 'CORE METRIC',
    minutes: 8,
    lead: 'Precision 回答“报出来的有多少是对的”，Recall 回答“该找的找回了多少”。它们天然互相拉扯。',
    body: `
      <div class="formula">Precision = TP / (TP + FP)<br>Recall = TP / (TP + FN)<br>F1 = 2PR / (P + R)</div>
      <h2>置信度阈值就是那个旋钮</h2>
      <p>阈值调高：只保留高分框 → Precision 通常升，Recall 通常降。<br>阈值调低：框更多 → Recall 升，但 FP 也升。</p>
      <div class="two-col">
        <div class="mini-card"><b>P 高 R 低</b><span>报得准，但漏得多。适合“误报代价高”的场景。</span></div>
        <div class="mini-card"><b>R 高 P 低</b><span>找得全，但误报多。适合“漏检代价高”的场景。</span></div>
      </div>
      <div class="note"><b>数据工程师的职责：</b>不要只报一个 mAP。要按类别、按场景、按置信度区间拆开，告诉算法/产品“哪里漏、哪里误”。</div>
      <div class="warn-note note"><b>类别不平衡：</b>cone 这种小目标 AP 0.53，shelf 0.88；总 mAP 会被大类拉高。汇报时必须带 per-class。</div>
    `,
    quiz: {
      q: 'Precision=90%，Recall=40%，最准确的解释是？',
      options: ['模型整体很好', '报出来的框很准，但漏掉了很多目标', '模型把很多背景误检成目标', 'mAP 一定大于 0.9'],
      answer: 1,
      why: 'P 高说明报出来的多数是对的；R 低说明该找的只找回 40%。这是“保守但漏检多”的模型，不能因为 P 高就说整体好。',
    },
    homework: '在 <a href="demos/eval/">Eval Lab</a> 把置信度从 0.25 拉到 0.60，记录 P/R/F1 的变化，写一句话解释“为什么 P 升 R 降”。',
  },
  {
    id: 'l4',
    short: 'NMS',
    title: 'NMS：把重复框清掉',
    tag: 'POST-PROCESS',
    minutes: 8,
    lead: '模型会对同一个目标输出多个高分框。NMS 的任务是：保留最好的，压掉 IoU 太高的同类框。',
    body: `
      <h2>算法四步</h2>
      <ol>
        <li>按置信度从高到低排序；</li>
        <li>取当前最高分框，保留；</li>
        <li>删掉与它同类别、IoU 大于阈值的框；</li>
        <li>重复，直到没有框。</li>
      </ol>
      <div class="formula">keep = argmax(score)<br>remove: same class &amp;&amp; IoU(keep, box) &gt; nms_threshold</div>
      <h2>阈值的影响</h2>
      <p><b>阈值低</b>：抑制更狠 → 框更少，密集目标可能被误删。<br><b>阈值高</b>：保留更多 → 重复框可能残留。</p>
      <div class="note"><b>类别内 NMS：</b>通常按类别分别做，不要让人和叉车互相抑制。<br><b>Soft-NMS：</b>不直接删，而是按 IoU 降低分数，适合密集场景。</div>
      <div class="warn-note note"><b>项目里怎么讲：</b>“我的 Eval Lab 可以开关 NMS，FP 会明显变化；这让我理解后处理对指标的影响。”</div>
    `,
    quiz: {
      q: '把 NMS 的 IoU 阈值调低，通常会怎样？',
      options: ['保留更多框，FP 增加', '抑制更强，框更少，密集目标可能被误删', '只影响 Recall，不影响 Precision', '和阈值无关'],
      answer: 1,
      why: '阈值低 = 更容易判定“重复” = 删得更多。框少了，FP 可能降，但密集/相邻目标的 Recall 可能降。',
    },
    homework: '在 <a href="demos/eval/">Eval Lab</a> 开关“类别内 NMS”，记录 FP 和 Recall 的变化；解释为什么 NMS 不是“越干净越好”。',
  },
  {
    id: 'l5',
    short: 'AP / mAP',
    title: 'AP / mAP：评估的是排序，不只是框',
    tag: 'CORE METRIC',
    minutes: 10,
    lead: 'mAP 不是“准确率”。它把所有预测按置信度排序，算每个类别的 PR 曲线面积，再对类别取平均。',
    body: `
      <h2>AP 怎么来</h2>
      <ol>
        <li>固定类别和 IoU 阈值，把所有预测按置信度降序排；</li>
        <li>逐个累加 TP/FP，得到一串 (Recall, Precision) 点；</li>
        <li>画 PR 曲线，曲线下面积就是 AP；</li>
        <li>所有类别 AP 取平均 → mAP。</li>
      </ol>
      <div class="formula">AP = ∫ P(R) dR（实际用插值/离散求和）<br>mAP = mean(AP_class)</div>
      <h2>两个常见版本</h2>
      <div class="two-col">
        <div class="mini-card"><b>mAP@0.5</b><span>IoU 阈值固定 0.5，比较宽松。</span></div>
        <div class="mini-card"><b>mAP@[.5:.95]</b><span>IoU 从 0.5 到 0.95、步长 0.05，取平均，更严格。</span></div>
      </div>
      <div class="warn-note note"><b>不能跨数据集比较：</b>“我的 mAP 0.75”必须带数据集、类别数、IoU 阈值、图片数量；否则没有意义。</div>
      <div class="note"><b>项目里怎么讲：</b>“我在 96 张自建仓库图上，用模拟预测做评估；重点不是刷分，是演示阈值、NMS、per-class 错误分析。”</div>
    `,
    quiz: {
      q: 'mAP@[.5:.95] 和 mAP@0.5，哪个更严格？',
      options: ['mAP@0.5 更严格', 'mAP@[.5:.95] 更严格，因为它要求多个 IoU 阈值下的平均表现', '两者一样', '取决于图片数量'],
      answer: 1,
      why: 'mAP@[.5:.95] 在 10 个 IoU 阈值上取平均，框必须更准才能拿高分；mAP@0.5 只看 0.5，宽松得多。',
    },
    homework: '看 <a href="demos/eval/">Eval Lab</a> 的 PR 曲线，找出 AP 最低的类别，写两点可能原因（数据/类别/尺度/标注）。',
  },
  {
    id: 'l6',
    short: '标注质检',
    title: '标注质检：把“有问题”变成可执行项',
    tag: 'DATA QUALITY',
    minutes: 10,
    lead: '数据岗的核心不是“我会点框”，而是让每一批数据可复核、可退回、可复现。',
    body: `
      <h2>8 条规则，分 error / warn</h2>
      <p>空标签、类别越界、框越界、零面积、过小、重复框（IoU≥0.85）、长宽比异常、解析错误。</p>
      <div class="two-col">
        <div class="mini-card"><b>error</b><span>会让训练/导出直接挂，或确定是错：类别越界、越界框、零面积、重复框、解析错误。</span></div>
        <div class="mini-card"><b>warn</b><span>需要人判断：空标签可能是真负样本，过小框可能是远处小目标。</span></div>
      </div>
      <h2>24/24 是什么</h2>
      <p>在 120 张合成样本里预置 24 个已知缺陷（8 类 × 3 个），规则引擎跑完与真值逐条比对：<b>24/24 命中</b>。这是<b>规则回归测试</b>，不是模型准确率。</p>
      <div class="warn-note note"><b>0 误报的边界：</b>只在这批合成数据上成立。真实数据有光照、遮挡、类别混淆，必须分层看 Precision，不能拿 0 误报当承诺。</div>
      <h2>系统测试怎么提建议</h2>
      <p>功能、边界、数据一致性、权限、并发、性能。Bug 报告写清：环境/步骤/预期/实际/影响/严重级别；修复后回归。</p>
    `,
    quiz: {
      q: '一个标签文件是空的，应该直接判 error 并删除吗？',
      options: ['是，空标签一定是漏标', '否，可能是真负样本，应先 warn + 人工确认', '是，空标签会让模型崩溃', '否，空标签应该自动补框'],
      answer: 1,
      why: '空标签可能是“图上确实没有目标”的真负样本，也可能是漏标。直接删会破坏数据分布；正确做法是 warn、抽样确认、记录原因。',
    },
    homework: '在 <a href="demos/qa/">QA Console</a> 复核 3 个样本，至少写一条退回备注，要求能定位到“第几张图、第几个框、哪条规则”。',
  },
  {
    id: 'l7',
    short: '3D 点云',
    title: '3D 点云与 3D BBox：空间里的框怎么检',
    tag: '3D VISION',
    minutes: 10,
    lead: '2D 框在图像平面；3D 框在世界/相机坐标系。多一个维度，就多一套坐标、朝向和遮挡问题。',
    body: `
      <h2>3D 框怎么表示</h2>
      <p>常见：中心 <code>(x,y,z)</code> + 尺寸 <code>(w,h,d)</code> + 朝向 <code>yaw</code>。真实数据里 yaw 很重要，否则框会把旁边的东西也包进来。</p>
      <div class="two-col">
        <div class="mini-card"><b>AABB</b><span>轴对齐包围盒，实现简单；忽略朝向，体积容易高估。</span></div>
        <div class="mini-card"><b>OBB</b><span>带朝向的包围盒，更贴近真实目标；计算更复杂。</span></div>
      </div>
      <h2>质检看什么</h2>
      <ul>
        <li>框内点数 / 密度：0 点可能是空框，也可能是遮挡/远距离；</li>
        <li>尺寸是否符合类别先验；</li>
        <li>朝向是否与点云主方向一致；</li>
        <li>与 2D 投影/相机图像是否对齐；</li>
        <li>多帧是否一致。</li>
      </ul>
      <div class="note"><b>项目里怎么讲：</b>我的 Spatial Lab 用 AABB 先验证“点数/密度/空框”逻辑；真实产线要升级到 OBB + yaw，并做 2D-3D 投影一致性。</div>
      <div class="warn-note note"><b>坐标先对齐：</b>相机坐标、世界坐标、点云坐标不一致，框就会“飘”。先打印坐标，再调视觉。</div>
    `,
    quiz: {
      q: '用 AABB 代替带 yaw 的 OBB，最直接的问题是什么？',
      options: ['点云会变少', '忽略朝向，体积容易高估，密集场景会把相邻目标包进来', 'mAP 一定变高', '不能计算点数'],
      answer: 1,
      why: 'AABB 的边平行于坐标轴；目标斜着放时，AABB 会变大，包进背景/相邻目标，体积和点数统计都会偏。',
    },
    homework: '打开 <a href="demos/spatial/">Spatial Lab</a>，选中 GHOST 空框，解释“空框为什么标 REVIEW 而不是直接判错”；再选一个货架框，读它的点数/密度。',
  },
  {
    id: 'l8',
    short: '面试表达',
    title: '面试表达：把项目讲成证据',
    tag: 'INTERVIEW',
    minutes: 12,
    lead: '面试官不关心你“学了什么”，只关心你“交付过什么、能不能复用”。每个回答：结论 → 证据 → 边界。',
    body: `
      <h2>30 秒开场</h2>
      <div class="formula">我是【姓名】，VR 专科应届，目标视觉数据工程。<br>我做过视觉数据质检工作台和 3D 空间检查器：<br>120 张 / 789 框 / 8 条规则 / 24 个缺陷全部命中；<br>15,318 点云 / 9 个 3D 框，能检出空框。<br>优势是 Python/Linux + 3D 空间；C++/PyTorch 在补。</div>
      <h2>被追问时，先给边界</h2>
      <ul>
        <li><b>24/24：</b>是规则对预置缺陷的回归，不是模型准确率；</li>
        <li><b>0 误报：</b>只在这批合成数据上成立，真实数据要分层看 Precision；</li>
        <li><b>3D：</b>AABB 先验证逻辑，真实要用 OBB + yaw；</li>
        <li><b>C++/PyTorch：</b>有基础，正在补最小闭环，不冒充精通。</li>
      </ul>
      <h2>反问（选 2 个）</h2>
      <ul>
        <li>数据团队现在最缺什么样的人？</li>
        <li>标注是内部还是外包？质检指标是什么？</li>
        <li>这个岗位前 3 个月最重要的交付是什么？</li>
      </ul>
      <div class="warn-note note"><b>不要说：</b>“我学习能力强”“我什么都能学”“稳定压倒一切”。用项目、数字、边界说话。</div>
    `,
    quiz: {
      q: '面试官问“你的 24/24 是不是说明模型很准”，最好的回答是？',
      options: ['是，说明模型准确率 100%', '不是，这是规则对 24 个预置缺陷的回归测试；模型准确率要看独立评测集', '是，但只在合成数据上', '24/24 是 mAP'],
      answer: 1,
      why: '24/24 是规则回归，不是模型精度。要主动说清测试对象、数据来源、边界，再补“真实数据要看 per-class Precision/Recall”。',
    },
    homework: '录一段 90 秒自我介绍：30 秒定位 + 40 秒两个项目 + 20 秒短板/补法。回放，删掉所有“我学习能力强”这类空话。',
  },
];

const KEY = 'training-progress-v1';
let done = [];
try { done = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { done = []; }
let current = 0;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(done)); } catch { /* ignore */ }
}
function isDone(id) { return done.includes(id); }
function setDone(id, value) {
  done = done.filter((x) => x !== id);
  if (value) done.push(id);
  save();
  renderNav();
}
function renderNav() {
  $('#lessonNav').innerHTML = LESSONS.map((l, i) => `
    <button data-i="${i}" class="${i === current ? 'on' : ''} ${isDone(l.id) ? 'done' : ''}">
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
      <span>${l.short}<small>${l.minutes} MIN</small></span>
    </button>`).join('');
  $$('#lessonNav button').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.i))));
  const pct = (done.length / LESSONS.length) * 100;
  $('#progressText').textContent = `${done.length} / ${LESSONS.length}`;
  $('#progressBar').style.width = `${pct}%`;
}

function renderQuiz(l, index) {
  return `<div class="quiz" data-quiz="${l.id}">
    <div class="quiz__h">CHECK / 01 · 单选题</div>
    <div class="quiz__b">
      <div class="quiz__q">${l.quiz.q}</div>
      ${l.quiz.options.map((o, i) => `<button class="quiz__opt" data-i="${i}">${String.fromCharCode(65 + i)}. ${o}</button>`).join('')}
      <div class="quiz__why" id="why-${l.id}"><b>为什么：</b>${l.quiz.why}</div>
    </div>
  </div>`;
}

function bindQuiz(l) {
  const box = document.querySelector(`.quiz[data-quiz="${l.id}"]`);
  if (!box) return;
  const opts = [...box.querySelectorAll('.quiz__opt')];
  opts.forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    opts.forEach((x) => { x.disabled = true; });
    if (i === l.quiz.answer) b.classList.add('correct');
    else {
      b.classList.add('wrong');
      opts[l.quiz.answer].classList.add('correct');
    }
    document.getElementById(`why-${l.id}`).classList.add('show');
  }));
}

function renderLesson() {
  const l = LESSONS[current];
  const last = current === LESSONS.length - 1;
  $('#crumb').textContent = `LESSON ${String(current + 1).padStart(2, '0')} / ${String(LESSONS.length).padStart(2, '0')}`;
  $('#lessonHost').innerHTML = `
    <article class="lesson">
      <div class="lesson__tag"><i></i>${l.tag} / ${String(current + 1).padStart(2, '0')}</div>
      <h1>${l.title}</h1>
      <p class="lead">${l.lead}</p>
      ${l.body}
      ${renderQuiz(l, current)}
      <div class="homework"><b>作业：</b>${l.homework}</div>
      <div class="complete-row">
        <span class="state">${isDone(l.id) ? '本课已完成' : '看完 + 做完作业，再标记完成'}</span>
        <button class="btn ${isDone(l.id) ? 'btn--primary' : ''}" id="completeBtn">${isDone(l.id) ? '✓ 已完成' : '标记完成'}</button>
      </div>
      <div class="navbtns">
        <button class="btn" id="prevBtn" ${current === 0 ? 'disabled' : ''}>← 上一课</button>
        <button class="btn btn--primary" id="nextBtn">${last ? '完成训练营' : '下一课 →'}</button>
      </div>
    </article>`;
  bindQuiz(l);
  $('#completeBtn').addEventListener('click', () => {
    const next = !isDone(l.id);
    setDone(l.id, next);
    renderLesson();
  });
  $('#prevBtn').addEventListener('click', () => show(current - 1));
  $('#nextBtn').addEventListener('click', () => {
    if (last) {
      if (done.length === LESSONS.length) location.href = 'index.html';
      else toast(`还差 ${LESSONS.length - done.length} 课：先过完，再回去投简历。`);
    } else show(current + 1);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function show(i) {
  current = Math.max(0, Math.min(LESSONS.length - 1, i));
  if (location.hash !== `#${LESSONS[current].id}`) history.replaceState(null, '', `#${LESSONS[current].id}`);
  renderNav();
  renderLesson();
  renderNav();
}

function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f1b1a;color:#37e0b2;border:1px solid rgba(55,224,178,.3);padding:8px 14px;border-radius:6px;font-size:11px;z-index:99';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function init() {
  const hash = location.hash.replace('#', '');
  const idx = LESSONS.findIndex((l) => l.id === hash);
  current = idx >= 0 ? idx : 0;
  renderNav();
  renderLesson();
  renderNav();
}

init();
