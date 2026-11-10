/* ============================================================
   Notes · 极简 Markdown 阅读器
   ------------------------------------------------------------
   不引第三方库：支持标题、段落、列表、任务列表、引用、代码块、
   表格、粗体、行内代码、链接。够读这三份文档。
   ============================================================ */

const DOCS = {
  interview: {
    title: '面试题库',
    sub: 'HR 12 题 · 专业 28 题 · 项目追问 15 题 · 反问与边界',
    file: 'docs/面试问答.md',
  },
  strategy: {
    title: '投递作战手册',
    sub: '岗位拆解 · 简历检查 · 邮件 / 电话 / 现场 · 7 天计划',
    file: 'docs/投递作战手册.md',
  },
  projects: {
    title: '项目技术说明',
    sub: '架构 · 数据 · 规则 · 3D · 取舍 · 边界',
    file: 'docs/项目技术说明.md',
  },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let currentKey = 'interview';
let currentTitle = '资料库';
let currentMd = '';
let editing = false;

function toast(msg) {
  let el = document.getElementById('editToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'editToast';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f1b1a;color:#37e0b2;border:1px solid rgba(55,224,178,.3);padding:8px 14px;border-radius:6px;font-size:11px;z-index:99';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.remove(), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  let t = escapeHtml(s);
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return t;
}

function isBlockStart(line) {
  return /^(#{1,4}\s|```|>\s?|\s*[-*]\s|\s*\d+\.\s|\|)/.test(line);
}

function parseTable(lines, start) {
  const rows = [];
  let i = start;
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    const raw = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '');
    rows.push(raw.split('|').map((c) => c.trim()));
    i++;
  }
  const header = rows[0] || [];
  const body = rows.slice(2); // rows[1] 是 |---|---|
  const th = header.map((c) => `<th>${inline(c)}</th>`).join('');
  const trs = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
  return { html: `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`, next: i };
}

function mdToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  const headings = [];
  let i = 0;
  let hid = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 表格
    if (line.trim().startsWith('|') && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || '')) {
      const t = parseTable(lines, i);
      out.push(t.html);
      i = t.next;
      continue;
    }

    // 标题
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      hid++;
      const id = `sec-${hid}`;
      if (level > 1) headings.push({ level, text: text.replace(/[*`]/g, ''), id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${buf.map((x) => `<p>${inline(x)}</p>`).join('')}</blockquote>`);
      continue;
    }

    // 列表（含任务列表）
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        const task = /^\[([ xX])\]\s+/.exec(raw);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(`<li class="task"><input type="checkbox" disabled ${checked ? 'checked' : ''}>${inline(raw.replace(/^\[[ xX]\]\s+/, ''))}</li>`);
        } else {
          items.push(`<li>${inline(raw)}</li>`);
        }
        i++;
        // 允许列表项下的续行
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, ` ${inline(lines[i].trim())}</li>`);
          i++;
        }
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 段落
    const buf = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  return { html: out.join('\n'), headings };
}

function renderToc(headings) {
  const toc = $('#toc');
  toc.innerHTML = headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => `<a href="#${h.id}" data-target="${h.id}" class="${h.level === 3 ? 'lv3' : ''}">${escapeHtml(h.text)}</a>`)
    .join('');
  $$('#toc a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const el = document.getElementById(a.dataset.target);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 74;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }));
}

let headingEls = [];
function setupScrollSpy() {
  headingEls = $$('#md h2, #md h3');
  const onScroll = () => {
    const progress = $('#progress');
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = `${max > 0 ? Math.min(100, (scrollY / max) * 100) : 0}%`;

    let active = null;
    for (const el of headingEls) {
      if (el.getBoundingClientRect().top <= 96) active = el.id;
    }
    $$('#toc a').forEach((a) => a.classList.toggle('on', a.dataset.target === active));
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

function standaloneHtml() {
  const body = $('#md').innerHTML;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(currentTitle)}</title>
<style>
body{max-width:820px;margin:40px auto;padding:0 22px;font:15px/1.9 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#17212b}
h1{font-size:30px;line-height:1.2}h2{font-size:23px;margin-top:32px;border-top:1px solid #e1e8ef;padding-top:14px}
h3{font-size:16px;margin-top:20px}p{margin:9px 0}code{font-family:Consolas,monospace;background:#eef6f4;padding:1px 5px;border-radius:4px}
pre{background:#0b1118;color:#d5e2f0;padding:14px;border-radius:8px;overflow:auto}blockquote{border-left:3px solid #0b7a70;background:#f2faf7;margin:12px 0;padding:8px 13px}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #e1e8ef;padding:6px 8px;text-align:left}th{background:#f3f7fa}
a{color:#0b7a70}
</style></head><body><h1>${escapeHtml(currentTitle)}</h1>${body}</body></html>`;
}

function bindEdit() {
  const md = $('#md');
  const editBtn = $('#editBtn');
  const saveBtn = $('#saveBtn');
  const resetBtn = $('#resetBtn');
  const downloadBtn = $('#downloadBtn');
  if (!editBtn) return;

  editBtn.addEventListener('click', () => {
    editing = !editing;
    md.contentEditable = editing ? 'true' : 'false';
    md.classList.toggle('editing', editing);
    editBtn.textContent = editing ? '编辑中…' : '编辑';
    editBtn.classList.toggle('on', editing);
    saveBtn.hidden = !editing;
    resetBtn.hidden = !editing;
    if (editing) {
      md.focus();
      toast('可以直接改正文；改完点“保存修改”（只保存在本机浏览器）');
    }
  });

  saveBtn.addEventListener('click', () => {
    try {
      localStorage.setItem(`notes-edit-v1:${currentKey}`, md.innerHTML);
      toast('已保存到本机浏览器；换设备/清缓存会丢失，重要内容请导出 HTML');
    } catch { toast('保存失败：浏览器存储不可用'); }
    editing = false;
    md.contentEditable = 'false';
    md.classList.remove('editing');
    editBtn.textContent = '编辑';
    editBtn.classList.remove('on');
    saveBtn.hidden = true;
    resetBtn.hidden = true;
    const base = $('#docMeta').textContent.replace(/ · 已修改$/, '');
    $('#docMeta').textContent = `${base} · 已修改`;
  });

  resetBtn.addEventListener('click', () => {
    if (!confirm('恢复原文？你保存的修改会被清除。')) return;
    try { localStorage.removeItem(`notes-edit-v1:${currentKey}`); } catch { /* ignore */ }
    location.reload();
  });

  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([standaloneHtml()], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${currentKey}-edited.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
    toast('已导出 HTML，可用浏览器打开/继续编辑');
  });
}

async function load() {
  const params = new URLSearchParams(location.search);
  const key = params.get('doc') && DOCS[params.get('doc')] ? params.get('doc') : 'interview';
  const meta = DOCS[key];
  currentKey = key;
  currentTitle = meta.title;
  document.title = `${meta.title} · 超节点求职`;
  $('#docTitle').textContent = meta.title;
  $('#docSub').textContent = meta.sub;
  $('#rawLink').href = encodeURI(meta.file);
  $$('#docNav a').forEach((a) => a.classList.toggle('on', a.dataset.doc === key));

  try {
    const res = await fetch(encodeURI(meta.file));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    currentMd = md;
    const { html, headings } = mdToHtml(md);
    let saved = '';
    try { saved = localStorage.getItem(`notes-edit-v1:${key}`) || ''; } catch { saved = ''; }
    $('#md').innerHTML = saved || html;
    $('#docMeta').textContent = `DOC / ${key.toUpperCase()} · ${md.split('\n').length} LINES · 2026.11${saved ? ' · 已修改' : ''}`;
    renderToc(headings);
    setupScrollSpy();
    bindEdit();
  } catch (e) {
    $('#docTitle').textContent = '加载失败';
    $('#docSub').textContent = '请通过本地服务器打开，不要直接双击 HTML。';
    $('#md').innerHTML = `<p style="color:#b42318">读取 ${escapeHtml(meta.file)} 失败：${escapeHtml(e.message)}</p>`;
  }
}

load();
