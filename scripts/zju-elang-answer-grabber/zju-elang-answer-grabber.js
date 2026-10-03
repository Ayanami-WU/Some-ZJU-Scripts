// SPDX-License-Identifier: MIT
/**
* Script type: console-snippet
* Target: ZJU E-Lang question page; the host is intentionally not fixed yet.
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
  const VERSION = '0.1.1';
  const old = document.getElementById(ID);

  if (old) {
    old.hidden = false;
    old.scrollIntoView({block: 'nearest'});
    window.__ZJU_ELANG_ANSWER_GRABBER__?.refresh?.();
    return;
  }

  const text = value => String(value == null ? '' : value).trim();

  function formatValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(' , ');
    if (typeof value === 'object') {
      const candidate = value.title ?? value.label ?? value.value ?? value.answer;
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
      const value = formatValue(item && item[field]);
      if (value) return value;
    }

    const id = item && (item.id ?? item.question_id);
    return id == null ? '题目 ' + (index + 1) : '题目 ' + id;
  }

  function getAnswer(item) {
    if (item && item.type_id == 2 && Array.isArray(item.optionsArray)) {
      const titles = item.optionsArray
        .map(option => formatValue(option && option.title))
        .filter(Boolean);
      if (titles.length) return titles.join(' , ');
    }

    const fields = ['options_answer', 'right_answer', 'rightAnswer', 'answer'];
    for (const field of fields) {
      const value = formatValue(item && item[field]);
      if (value) return value;
    }

    return '未知';
  }

  function getType(item) {
    const type = item && item.type_id;
    return type == null ? '未知题型' : 'type_id=' + type;
  }

  const host = document.createElement('div');
  host.id = ID;
  host.dataset.version = VERSION;
  Object.assign(host.style, {
    position: 'fixed',
    right: '16px',
    top: '16px',
    zIndex: '2147483000',
    width: 'min(760px, calc(100vw - 24px))'
  });

  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = [
    '<style>',
    ':host{color-scheme:light}*{box-sizing:border-box}section{font:14px/1.5 system-ui,Microsoft YaHei,sans-serif;color:#173247;background:#f7fafc;border:1px solid #bacdd6;border-radius:16px;box-shadow:0 16px 64px #17324740;overflow:hidden}',
    'header{display:flex;align-items:center;gap:10px;background:#123f50;color:white;padding:14px 16px;cursor:move;touch-action:none}header b{font-size:17px;flex:1}header span{font-size:11px;opacity:.75}header button{background:#ffffff20;border-color:#ffffff40;color:white}',
    'main{padding:14px;max-height:calc(100vh - 100px);overflow:auto}p{margin:0 0 10px}.muted{font-size:12px;color:#586e7b}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}button,input{font:inherit;border:1px solid #b5c8d3;border-radius:7px;background:white;color:#173247;padding:7px}button{cursor:pointer}button:hover{background:#e4f1f4}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:#086b75;color:white;border-color:#086b75}.primary:hover{background:#075863}input{min-width:220px;flex:1}#status{white-space:pre-wrap;background:#e8f1f5;border-left:4px solid #087883;padding:10px;border-radius:6px;margin:10px 0;font-size:13px}#status.error{background:#fff0ed;border-color:#b84931}',
    '.table-wrap{overflow:auto;border:1px solid #dce6eb;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:12px;min-width:620px}th,td{text-align:left;border-bottom:1px solid #dce6eb;padding:7px 8px;vertical-align:top}th{background:#eef4f7;position:sticky;top:0}td:first-child{width:48px}td.type{width:90px;color:#607681}td.answer{white-space:pre-wrap;color:#075863;font-weight:600}tr:last-child td{border-bottom:0}footer{margin-top:10px;font-size:12px;color:#516a77}',
    '</style>',
    '<section aria-label="ZJU E-Lang 答案读取辅助面板">',
    '<header><b>ZJU E-Lang · 答案读取辅助面板</b><span>v0.1.1</span><button id="fold" title="收起或展开">收起</button><button id="close" title="关闭面板">×</button></header>',
    '<main>',
    '<p class="muted">读取当前页面 Vue 状态中的 jobList；只展示和复制前端已有数据，不自动填答或提交。</p>',
    '<div class="actions"><button id="refresh" class="primary">重新读取</button><button id="copy">复制答案</button><input id="filter" type="search" placeholder="筛选题目或答案"></div>',
    '<div id="status" role="status" aria-live="polite">正在扫描页面…</div>',
    '<div class="table-wrap"><table><thead><tr><th>#</th><th>题目</th><th>答案</th><th>题型</th></tr></thead><tbody id="list"></tbody></table></div>',
    '<footer>答案字段的语义取决于页面数据结构；请人工核对。脚本不发起网络请求。</footer>',
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
        if (index === 2) cell.className = 'answer';
        if (index === 3) cell.className = 'type';
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
      '已读取 ' + records.length + ' 道题，当前显示 ' + visible.length +
      ' 道；已扫描约 ' + sourceData.inspected + ' 个页面元素。'
    );
  }

  function refresh() {
    sourceData = findData();
    records = Array.isArray(sourceData.jobList)
      ? sourceData.jobList.map((item, index) => ({
          index: index + 1,
          question: getQuestion(item, index),
          answer: getAnswer(item),
          type: getType(item)
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
    host.remove();
    delete window.__ZJU_ELANG_ANSWER_GRABBER__;
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
  refresh();
})();
