// SPDX-License-Identifier: MIT
/**
 * Script type: console-snippet
 * Target: https://elang.zju.edu.cn/
 * Side effects: page-enhancement
 *
 * Original author: silentle (https://github.com/silentle)
 * Redistribution: authorized by the original author under the MIT License.
 * Panel adaptation: Ayanami-WU and Codex.
 *
 * Run this snippet only on a page and account that you are authorized to inspect.
 */
(() => {
  'use strict';

  const ID = 'zju-elang-answer-grabber';
  const VERSION = '0.2.0';
  const old = document.getElementById(ID);

  if (old) {
    if (old.dataset.version === VERSION) {
      old.hidden = false;
      const main = old.shadowRoot?.querySelector('main');
      if (main) main.hidden = false;
      const fold = old.shadowRoot?.getElementById('fold');
      if (fold) fold.textContent = '收起';
      old.scrollIntoView({block: 'nearest'});
      window.__ZJU_ELANG_ANSWER_GRABBER__?.refresh?.();
      return;
    }
    window.__ZJU_ELANG_ANSWER_GRABBER__?.close?.();
    old.remove();
  }

  const text = value => String(value == null ? '' : value).trim();
  // Names follow the site's input controls; do not guess finer subtypes.
  const TYPE_LABELS = {
    1: '选择题', 2: '填空题', 3: '文本作答', 4: '多选题',
    5: '选择填空', 6: '文本作答', 7: '选择填空', 8: '选择填空'
  };
  const FILL_TYPES = new Set([2, 5, 7, 8]);
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE',
    'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'TR'
  ]);
  const OMIT_TAGS = new Set([
    'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG'
  ]);

  // Parse in an inert template. Only plain text enters the visible table.
  function readableText(value) {
    const template = document.createElement('template');
    template.innerHTML = formatValue(value);

    function read(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 && node.nodeType !== 11) return '';
      const tag = node.nodeName;
      if (OMIT_TAGS.has(tag)) return '';
      if (tag === 'BR' || tag === 'HR') return '\n';
      if (tag === 'IMG') return node.getAttribute('alt') || '';
      const content = Array.from(node.childNodes, read).join('');
      if (BLOCK_TAGS.has(tag)) return '\n' + content + '\n';
      if (tag === 'TD' || tag === 'TH') return content + '\t';
      return content;
    }

    return read(template.content)
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function formatValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(' , ');
    if (typeof value === 'object') {
      const candidate = value.title ?? value.label ?? value.lable ?? value.value ?? value.answer;
      if (candidate !== undefined) return formatValue(candidate);
      try { return text(JSON.stringify(value)); } catch { return text(value); }
    }
    return text(value);
  }

  function getVueInstance(element) {
    const parent = element.__vueParentComponent;
    const candidates = [
      element.__vue__,
      parent && parent.proxy,
      parent && parent.exposed
    ];
    return candidates.find(Boolean) || null;
  }

  function getJobList(vm) {
    const candidates = [
      vm && vm.jobList,
      vm && vm.$data && vm.$data.jobList,
      vm && vm.$props && vm.$props.jobList
    ];
    return candidates.find(candidate => Array.isArray(candidate)) || null;
  }

  function findData() {
    let empty = null;
    const elements = document.querySelectorAll('*');

    for (let i = 0; i < elements.length; i += 1) {
      const vm = getVueInstance(elements[i]);
      let jobList = null;
      try { jobList = getJobList(vm); } catch { continue; }
      if (!Array.isArray(jobList)) continue;

      const result = {jobList, vm, element: elements[i], inspected: i + 1};
      if (jobList.length > 0) return result;
      if (!empty) empty = result;
    }

    return empty || {jobList: null, vm: null, element: null, inspected: elements.length};
  }

  function getQuestion(item, index) {
    const fields = [
      'question',
      'questionText',
      'question_title',
      'title',
      'name',
      'content',
      'problem'
    ];

    for (const field of fields) {
      const value = readableText(item && item[field]);
      if (value) return value;
    }

    const id = item && (item.id ?? item.question_id);
    return id == null ? '题目 ' + (index + 1) : '题目 ' + id;
  }

  function getAnswer(item) {
    if (item && item.type_id == 2 && Array.isArray(item.optionsArray)) {
      const titles = item.optionsArray
        .map(option => readableText(option && option.title));
      if (titles.some(Boolean)) {
        if (titles.length === 1) return titles[0];
        return titles.map((value, index) => '(' + (index + 1) + ') ' + (value || '未知'))
          .join('\n');
      }
    }

    const fields = ['optionsAnswerParsed', 'options_answer', 'right_answer', 'rightAnswer', 'answer'];
    for (const field of fields) {
      let raw = item && item[field];
      if (typeof raw === 'string' && /^[\[{]/.test(raw.trim())) {
        try { raw = JSON.parse(raw); } catch {}
      }
      if (Array.isArray(raw) && FILL_TYPES.has(Number(item.type_id))) {
        const parts = raw.map(readableText);
        if (parts.some(Boolean)) {
          return parts.map((value, index) => '(' + (index + 1) + ') ' + (value || '未知'))
            .join('\n');
        }
        continue;
      }
      const value = readableText(raw);
      if (value) return value;
    }

    if (item && (item.type_id == 3 || item.type_id == 6)) return '未提供参考答案';
    return '未知';
  }

  function getType(item) {
    const type = item && item.type_id;
    if (type == null) return '未知题型';
    return Object.hasOwn(TYPE_LABELS, String(type))
      ? TYPE_LABELS[String(type)] : '未知题型（' + type + '）';
  }

  const host = document.createElement('div');
  host.id = ID;
  host.dataset.version = VERSION;
  Object.assign(host.style, {
    position: 'fixed',
    right: '16px',
    top: '16px',
    zIndex: '2147483000',
    width: 'min(860px, calc(100vw - 24px))'
  });

  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = [
    '<style>',
    ':host{color-scheme:light}*{box-sizing:border-box}section{font:14px/1.5 system-ui,Microsoft YaHei,sans-serif;color:#173247;background:#f7fafc;border:1px solid #bacdd6;border-radius:16px;box-shadow:0 16px 64px #17324740;overflow:hidden}',
    'header{display:flex;align-items:center;gap:10px;background:#123f50;color:white;padding:14px 16px;cursor:move;touch-action:none}header b{font-size:17px;flex:1}header span{font-size:11px;opacity:.75}header button{background:#ffffff20;border-color:#ffffff40;color:white}',
    'main{padding:14px;max-height:calc(100vh - 100px);overflow:auto}p{margin:0 0 10px}.muted{font-size:12px;color:#586e7b}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}button,input{font:inherit;border:1px solid #b5c8d3;border-radius:7px;background:white;color:#173247;padding:7px}button{cursor:pointer}button:hover{background:#e4f1f4}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:#086b75;color:white;border-color:#086b75}.primary:hover{background:#075863}input{min-width:220px;flex:1}#status{white-space:pre-wrap;background:#e8f1f5;border-left:4px solid #087883;padding:10px;border-radius:6px;margin:10px 0;font-size:13px}#status.error{background:#fff0ed;border-color:#b84931}',
    '.table-wrap{overflow:auto;max-height:60vh;border:1px solid #dce6eb;border-radius:8px}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px}col.number{width:38px}col.answers{width:29%}col.types{width:74px}th,td{text-align:left;border-bottom:1px solid #dce6eb;padding:9px 8px;vertical-align:top;overflow-wrap:anywhere}th{background:#eef4f7;position:sticky;top:0;z-index:1}td.question,td.answer{white-space:pre-wrap}td.type{color:#607681}td.answer{color:#075863;font-weight:600}tr:last-child td{border-bottom:0}footer{margin-top:10px;font-size:12px;color:#516a77}@media(max-width:560px){col.number{width:28px}col.types{width:60px}col.answers{width:33%}th,td{padding:7px 5px}table{font-size:12px}main{padding:10px}header b{font-size:14px}}',
    '</style>',
    '<section aria-label="ZJU E-Lang 答案读取辅助面板">',
    '<header><b>ZJU E-Lang · 答案读取辅助面板</b><span>v' + VERSION + '</span><button id="fold" title="收起或展开">收起</button><button id="close" title="关闭面板">×</button></header>',
    '<main>',
    '<p class="muted">显示当前页面的题目和答案，多空答案按空位编号排列。</p>',
    '<div class="actions"><button id="refresh" class="primary">重新读取</button><button id="copy">复制全部答案</button><input id="filter" type="search" aria-label="筛选题目、答案或题型" placeholder="筛选题目、答案或题型"></div>',
    '<div id="status" role="status" aria-live="polite">正在扫描页面…</div>',
    '<div class="table-wrap"><table><colgroup><col class="number"><col><col class="answers"><col class="types"></colgroup><thead><tr><th>#</th><th>题目</th><th>答案</th><th>题型</th></tr></thead><tbody id="list"></tbody></table></div>',
    '<footer>仅展示和复制，不自动填答或提交；请结合原题核对答案。</footer>',
    '</main></section>'
  ].join('');

  document.body.append(host);
  const $ = id => root.getElementById(id);
  let records = [];
  let sourceData = null;

  function setStatus(message, error) {
    $('status').textContent = message;
    $('status').className = error ? 'error' : '';
  }

  function render() {
    const keyword = $('filter').value.trim().toLowerCase();
    const list = $('list');
    list.replaceChildren();
    $('copy').disabled = records.length === 0;

    if (!sourceData || !Array.isArray(sourceData.jobList)) {
      setStatus('未找到包含 jobList 的 Vue 组件。请先打开题目区域，再点击“重新读取”。', true);
      return;
    }

    const visible = records.filter(record => {
      if (!keyword) return true;
      return [record.question, record.answer, record.type]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });

    for (const record of visible) {
      const row = document.createElement('tr');
      const values = [String(record.index), record.question, record.answer, record.type];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (index === 1) cell.className = 'question';
        if (index === 2) cell.className = 'answer';
        if (index === 3) {
          cell.className = 'type';
          cell.title = record.typeId == null ? '无 type_id 字段' : 'type_id=' + record.typeId;
        }
        row.append(cell);
      });
      list.append(row);
    }

    if (!visible.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = records.length ? '没有匹配的题目。' : 'jobList 为空。';
      row.append(cell);
      list.append(row);
    }

    setStatus(
      '已读取 ' + records.length + ' 道题，当前显示 ' + visible.length + ' 道。'
    );
  }

  function refresh() {
    sourceData = findData();
    records = Array.isArray(sourceData.jobList)
      ? sourceData.jobList.map((item, index) => ({
          index: index + 1,
          question: getQuestion(item, index),
          answer: getAnswer(item),
          type: getType(item),
          typeId: item && item.type_id
        }))
      : [];
    render();
  }

  function fallbackCopy(value) {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    area.remove();
    return copied;
  }

  async function copyAnswers() {
    if (!records.length) {
      setStatus('当前没有可复制的答案。', true);
      return;
    }

    const value = records
      .map(record => '第 ' + record.index + ' 题: ' + record.answer)
      .join('\n');
    let copied = false;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {}

    if (!copied) copied = fallbackCopy(value);
    setStatus(copied ? '已复制 ' + records.length + ' 道题的答案。' : '复制失败，请检查浏览器剪贴板权限。', !copied);
  }

  function closePanel() {
    window.removeEventListener('hashchange', onPageChanged);
    host.remove();
    delete window.__ZJU_ELANG_ANSWER_GRABBER__;
  }

  function onPageChanged() {
    records = [];
    sourceData = null;
    render();
    setStatus('页面已切换。题目加载后，点击“重新读取”。');
  }

  $('refresh').onclick = refresh;
  $('copy').onclick = copyAnswers;
  $('filter').oninput = render;
  $('fold').onclick = () => {
    const main = root.querySelector('main');
    main.hidden = !main.hidden;
    $('fold').textContent = main.hidden ? '展开' : '收起';
  };
  $('close').onclick = closePanel;

  const header = root.querySelector('header');
  let drag = null;
  header.onpointerdown = event => {
    if (event.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    drag = {dx: event.clientX - rect.left, dy: event.clientY - rect.top};
    header.setPointerCapture(event.pointerId);
  };
  header.onpointermove = event => {
    if (!drag) return;
    const rect = host.getBoundingClientRect();
    host.style.right = 'auto';
    host.style.left = Math.max(0, Math.min(innerWidth - rect.width, event.clientX - drag.dx)) + 'px';
    host.style.top = Math.max(0, Math.min(innerHeight - 50, event.clientY - drag.dy)) + 'px';
  };
  header.onpointerup = () => { drag = null; };

  window.__ZJU_ELANG_ANSWER_GRABBER__ = {
    version: VERSION,
    refresh,
    close: closePanel
  };
  window.addEventListener('hashchange', onPageChanged);
  refresh();
})();
