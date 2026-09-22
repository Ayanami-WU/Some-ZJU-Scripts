// ==UserScript==
// @name         ZJU 大学物理实验选课辅助面板
// @namespace    https://github.com/Ayanami-WU/Some-ZJU-Scripts
// @version      1.1.0
// @description  为大学物理实验周一下午选课提供排周、预填和逐项人工确认辅助
// @author       Ayanami-WU
// @match        http://10.203.16.55:86/lab-course/selectCourse*
// @run-at       document-idle
// @grant        none
// @noframes
// @license      MIT
// @supportURL   https://github.com/Ayanami-WU/Some-ZJU-Scripts/issues
// ==/UserScript==

/* 大学物理实验选课面板 v1.1
 * 在 http://10.203.16.55:86/lab-course/selectCourse 的控制台粘贴整段运行。
 * 支持串行点击网页选课按钮；每项由用户确认，等页面录入后再继续。不退课。
 */
(() => {
  'use strict';
  const COURSES = [
    ['必做1：示波器的使用+声速测定（2周）',2],
    ['必做1：示波器的使用+组装整流器（2周）',2],
    ['必做2：分光计的调整和使用+棱镜偏向角特性（2周）',2],
    ['必做2：分光计的调整和使用+光栅衍射（2周）',2],
    ['弗兰克赫兹实验',1],['光电效应测定普朗克常量',1],
    ['用霍尔法测直流圆线圈与亥姆霍兹线圈磁场',1],['密立根油滴实验',1],
    ['铁磁材料居里温度测量',1],['铁磁材料的磁滞回线和基本磁化曲线',1],
    ['万用表的设计',1],['交流电路功率因数实验',1],
    ['用扭摆法测定物体转动惯量',1],['碰撞实验',1],
    ['金属材料杨氏模量的测定',1],['动态法测量材料杨氏模量',1],
    ['液体表面张力系数测定',1],['固定均匀弦振动的研究',1],
    ['光速测量',1],['等厚干涉G',1],['光的衍射G',1],['光的偏振应用研究G',1]
  ];
  const SLOTS = [
    { ids:[1,2], week:'1,2' }, { ids:[3,4], week:'3,4' },
    { ids:[5], week:'5' }, { ids:[6], week:'6' }, { ids:[7], week:'7' },
    { ids:[9,10], week:'8' }, { ids:[11], week:'9' }, { ids:[12], week:'10' },
    { ids:[15,16], week:'11' }, { ids:[17,18], week:'12' },
    { ids:[19], week:'13' }, { ids:[20,21,22], week:'14' }
  ];
  const normalize = s => String(s || '').normalize('NFKC').replace(/[▲△\s]/g,'');
  function weeks(value) {
    if (!/^\d+(,\d+)*$/.test(String(value))) return [];
    const a = String(value).split(',').map(Number);
    return a.every(n=>n>=1 && n<=14) && new Set(a).size===a.length ? a : [];
  }
  const maskOf = v => weeks(v).reduce((m,n)=>m | (1 << (n-1)),0);
  function remaining(label) {
    const a=String(label).match(/已选\s*(\d+)\s*人/), b=String(label).match(/容量\s*(\d+)\s*人/);
    return a && b ? Number(b[1])-Number(a[1]) : null;
  }
  // 有界动态规划：优先最少替换首选，再尽量保留默认周次。
  function solve(domains) {
    let dp = new Map([[0,{cost:0,items:[]}]]);
    for (const domain of domains) {
      const next=new Map();
      for (const [mask,entry] of dp) for (const item of domain) {
        if (!item.mask || (mask & item.mask)) continue;
        const m=mask | item.mask, cost=entry.cost+item.cost;
        if (!next.has(m) || cost < next.get(m).cost) next.set(m,{cost,items:[...entry.items,item]});
      }
      dp=next;
      if (!dp.size) return null;
    }
    return dp.get((1<<14)-1)?.items || null;
  }
  // 纯函数导出仅用于离线测试。
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') {
    module.exports={COURSES,SLOTS,normalize,weeks,maskOf,remaining,solve}; return;
  }
  const demo = location.hostname==='127.0.0.1' && document.documentElement.dataset.labPanelDemo==='true';
  if (!demo && (location.origin!=='http://10.203.16.55:86' || location.pathname.replace(/\/$/,'')!=='/lab-course/selectCourse')) {
    alert('请在实验选课页面运行此脚本。'); return;
  }
  const ID='zju-lab-course-panel';
  const old=document.getElementById(ID);
  if (old) {
    if(old.dataset.version!=='1.1') alert('请先点击旧面板右上角 × 关闭，再粘贴新版脚本。');
    else { old.hidden=false; old.scrollIntoView({block:'nearest'}); }
    return;
  }

  const host=document.createElement('div'); host.id=ID;host.dataset.version='1.1';
  Object.assign(host.style,{position:'fixed',right:'16px',top:'16px',zIndex:'2147483000',width:'min(620px, calc(100vw - 24px))'});
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
    :host{color-scheme:light}*{box-sizing:border-box}section{font:14px/1.5 system-ui,'Microsoft YaHei',sans-serif;color:#173247;background:#f7fafc;border:1px solid #bacdd6;border-radius:16px;box-shadow:0 16px 64px #17324740;overflow:hidden}
    header{display:flex;align-items:center;gap:10px;background:#123f50;color:white;padding:14px 16px;cursor:move;touch-action:none}header b{font-size:17px;flex:1}header button{background:#ffffff20;border-color:#ffffff40;color:white}
    main{padding:14px;max-height:calc(100vh - 100px);overflow:auto}p{margin:0 0 10px}.muted{font-size:12px;color:#586e7b}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}button,select{font:inherit;border:1px solid #b5c8d3;border-radius:7px;background:white;color:#173247;padding:7px;cursor:pointer}button:hover{background:#e4f1f4}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:#086b75;color:white;border-color:#086b75}.primary:hover{background:#075863}.amber{background:#fff3d9;border-color:#d6b16c}#status{white-space:pre-wrap;background:#e8f1f5;border-left:4px solid #087883;padding:10px;border-radius:6px;margin:10px 0;font-size:13px}#status.error{background:#fff0ed;border-color:#b84931}
    table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;border-bottom:1px solid #dce6eb;padding:7px 3px;vertical-align:top}th{background:#eef4f7;position:sticky;top:0}td select{width:100%;max-width:335px;font-size:12px;padding:5px}td.week{width:82px}td:last-child{width:50px}td button{font-size:12px;padding:5px}.meta{font-size:11px;color:#607681;margin-top:3px}details{margin:12px 0;font-size:12px}summary{cursor:pointer;font-weight:600}#log{white-space:pre-wrap;font:11px/1.5 ui-monospace,monospace;max-height:100px;overflow:auto;margin:6px 0 0}label{display:block;margin:7px 0}input{vertical-align:middle}footer{margin-top:10px;font-size:12px;color:#516a77}
  </style><section aria-label="大学物理实验选课面板"><header><b>大学物理实验 · 选课面板</b><button id="fold" title="收起或展开">收起</button><button id="close" title="关闭面板并恢复解锁状态">×</button></header><main>
    <p>周一下午 · <b>12 项 / 14 周</b> · 必做1、必做2各选一项</p>
    <p class="muted">v1.1 · 按 PDF 制定。逐项选周次 → 点击选课 → 你确认 → 等待网页录入 → 下一项。</p>
    <div class="actions"><button id="unlock" class="amber">① 解锁所有选项</button><button id="relock">恢复解锁前状态</button></div>
    <div class="actions"><button id="original">② 原计划</button><button id="backup">③ 备选方案</button><button id="rescan">重新读取页面</button></div>
    <div id="status" role="status" aria-live="polite">正在识别实验列表…</div>
    <div class="actions"><button id="run" class="primary">④ 开始 / 继续逐项选课</button><button id="pause" disabled>本项完成后暂停</button><button id="reconcile">核对待确认结果</button></div>
    <p class="muted">每次仍需确认网页弹窗。等待“已选择”且周次匹配才继续；不会并发提交。遇到满员或异常会暂停。</p>
    <table><thead><tr><th>实验项目 / 教学班</th><th>周次</th><th>网页</th></tr></thead><tbody id="plan"></tbody></table>
    <div class="actions"><button id="apply" class="primary">填写当前方案到网页</button><button id="undo">撤销上次填写</button></div>
    <details><summary>备选规则与使用说明</summary><p>原计划只使用 PDF 首选。备选方案尽量保留首选，排不开时再替换；也可在上表手动切换。</p><p>明确备选：必做1 → 整流器；必做2 → 光栅；等厚干涉 → 衍射或偏振。</p><p>默认补位配对：居里温度 → 磁滞回线；静态杨氏模量 → 动态杨氏模量；表面张力 → 弦振动。这些补位配对是本面板的安排，PDF 未全部指定一一对应关系。</p><p>解锁仅移除实验周次的 disabled，保留容量信息；不修改开放时间、不启用提交按钮。重绘时保持解锁；恢复或关闭会停止保持解锁。</p><p>局部刷新后自动接续。F5 整页刷新会卸载脚本：重新粘贴后恢复本标签页草稿，再点击继续。请关闭网页的成功提示以便网页继续刷新。结果不明时先人工核对，不会自动重试。</p><p>方案、待核对请求记录保存在本标签页 sessionStorage，不保存登录凭据；不会在重载后自动提交。</p></details>
    <details><summary>操作记录</summary><pre id="log"></pre></details>
    <footer>“已填写”仅指周次已同步；“已选择”来自网页已有状态。最终以“我的课表”为准。</footer>
  </main></section>`;
  document.body.append(host);
  const $=id=>root.getElementById(id);
  let rows=new Map(), draft=[], mode='original', unlocked=false, observer=null, unlockQueued=false, closed=false;
  let managed=new Set(), undo=null, busy=false, running=false, pauseRequested=false, uncertain=null;
  const STORE='zju-lab-panel-v11';
  const context=()=>normalize(document.title+'|'+(document.querySelector('.nav-tabs li.active')?.textContent||'')+'|'+(document.querySelector('.page-header h1')?.textContent||''));
  function persist() {
    try { sessionStorage.setItem(STORE,JSON.stringify({context:context(),mode,draft:draft.map(x=>({id:x.id,value:x.value})),uncertain})); }
    catch { log('无法保存刷新恢复记录；整页刷新后需重新设置方案。'); }
  }
  const locks=new Map();
  const log=message=>{ $('log').textContent=(`${new Date().toLocaleTimeString()} ${message}\n`+$('log').textContent).slice(0,7000); };
  function status(message,error=false) { $('status').textContent=message; $('status').className=error?'error':''; }
  function collect() {
    const map=new Map();
    for(const row of document.querySelectorAll('table tr')) {
      if (row.getClientRects().length===0) continue;
      const selects=row.querySelectorAll('select');
      if(!selects.length) continue;
      const name=normalize(row.cells?.[0]?.textContent);
      const id=COURSES.findIndex(c=>normalize(c[0])===name)+1;
      if(!id) {
        if([...row.querySelectorAll('button')].some(b=>b.textContent.trim()==='已选择')) throw new Error('发现 PDF 方案未识别的已选实验，请先人工核对课表。');
        continue;
      }
      if(selects.length!==1 || map.has(id)) throw new Error(`“${COURSES[id-1][0]}”匹配多个教学班，请先只显示周一下午课程。`);
      const select=selects[0];
      const enrolled=[...row.querySelectorAll('button')].some(b=>b.textContent.trim()==='已选择');
      const options=[...select.options].filter(o=>weeks(o.value).length===COURSES[id-1][1]);
      const teacher=row.cells?.[1]?.querySelector('a')?.textContent.trim() || '';
      map.set(id,{id,row,select,enrolled,options,teacher});
    }
    if(!map.size) throw new Error('没有识别到实验列表。请确认已登录，且当前为大学物理实验周一下午。');
    return map;
  }
  function unlockPass() {
    if(closed || !unlocked) return;
    let current;
    try { current=collect(); } catch { return; }
    for(const {select} of current.values()) for(const el of [select,...select.querySelectorAll('optgroup'),...select.options]) {
      if(!locks.has(el)) locks.set(el,el.disabled);
      // 保存后续由网页重新施加的禁用状态，恢复时采用最近一次观察到的限制。
      if(el.disabled) { locks.set(el,true); el.disabled=false; }
    }
  }
  function startUnlock() {
    rows=collect(); unlocked=true; unlockPass();
    if(!observer) {
      observer=new MutationObserver(()=>{
        if(!unlockQueued) { unlockQueued=true; queueMicrotask(()=>{unlockQueued=false;unlockPass();}); }
      });
      observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
    }
    status(`已解锁 ${rows.size} 个实验的周次选项。可先预填；后端开放和容量规则仍生效。`); log('已开启前端周次解锁');
  }
  function relock() {
    unlocked=false; observer?.disconnect(); observer=null;
    for(const [el,disabled] of locks) if(el.isConnected) el.disabled=disabled;
    locks.clear(); status('已恢复最近记录的禁用状态。若网页开放状态已变化，刷新页面获取最新状态。'); log('已停止解锁');
  }
  function enrolledCheck(map) {
    const allowed=new Set(SLOTS.flatMap(s=>s.ids));
    for(const r of map.values()) if(r.enrolled && !allowed.has(r.id)) throw new Error(`网页已有方案外选课：${COURSES[r.id-1][0]}。请先人工核对课表，面板不会退课。`);
    for(const slot of SLOTS) if(slot.ids.filter(id=>map.get(id)?.enrolled).length>1) throw new Error('同一首选/备选组已有多个已选项目，请先核对课表。');
  }
  function makePlan(nextMode) {
    rows=collect(); enrolledCheck(rows); mode=nextMode;
    const domains=SLOTS.map((slot,index)=>{
      const fixed=slot.ids.find(id=>rows.get(id)?.enrolled);
      const ids=fixed?[fixed]:(mode==='backup'?slot.ids:[slot.ids[0]]);
      const domain=[];
      for(const id of ids) {
        const r=rows.get(id); if(!r) continue;
        for(const option of r.options) {
          if(fixed && option.value!==r.select.value) continue;
          if(!fixed && remaining(option.textContent)!==null && remaining(option.textContent)<=0) continue;
          const cost=(slot.ids.indexOf(id)>0?100000:0)+slot.ids.indexOf(id)*100+
            (option.value===slot.week?0:10)+Math.abs(weeks(option.value)[0]-weeks(slot.week)[0]);
          domain.push({index,id,value:option.value,mask:maskOf(option.value),cost});
        }
      }
      return domain;
    });
    const result=solve(domains);
    if(!result) {
      draft=[]; render();
      const absent=domains.map((d,i)=>d.length?null:COURSES[SLOTS[i].ids[0]-1][0]).filter(Boolean);
      throw new Error(`无法排出覆盖14周的完整方案。${absent.length?'缺少可用选项：'+absent.join('、'):'现有可用周次相互冲突。'}${mode==='original'?'可试用备选方案。':''}`);
    }
    draft=result; persist(); render();
    const changes=draft.filter((x,i)=>x.id!==SLOTS[i].ids[0]).length;
    status(`${mode==='backup'?'备选方案':'原计划'}已生成：12项覆盖14周，${changes}项使用备选。\n仅为预览；核对后点击“填写当前方案到网页”。`);
    log(`生成${mode==='backup'?'备选':'原'}计划，替换${changes}项`);
  }
  function issues(map=rows) {
    const errors=[]; let mask=0;
    if(draft.length!==12) return ['需要先生成完整的12项方案。'];
    const ids=new Set();
    draft.forEach((x,i)=>{
      if(!SLOTS[i].ids.includes(x.id)) errors.push('项目不在相应首选/备选组内');
      if(ids.has(x.id)) errors.push('重复实验'); ids.add(x.id);
      const r=map.get(x.id), option=r?.options.find(o=>o.value===x.value);
      if(!r || !option) {errors.push(`${COURSES[x.id-1][0]}：未找到所选周次`);return;}
      if(!r.enrolled && remaining(option.textContent)!==null && remaining(option.textContent)<=0) errors.push(`${COURSES[x.id-1][0]}：该周已满`);
      if(mask & maskOf(x.value)) errors.push(`第${x.value}周有冲突`);
      mask |= maskOf(x.value);
      if(r.enrolled && r.select.value!==x.value) errors.push('不能修改已选实验的周次');
    });
    for(const r of map.values()) if(r.enrolled && !ids.has(r.id)) errors.push(`已有选课未包含在当前方案：${COURSES[r.id-1][0]}`);
    if(mask!==16383) errors.push('当前方案未完整覆盖第1—14周');
    return [...new Set(errors)];
  }
  function render() {
    $('plan').replaceChildren();
    draft.forEach((x,i)=>{
      const tr=document.createElement('tr'), courseCell=document.createElement('td'), weekCell=document.createElement('td'), locateCell=document.createElement('td'); weekCell.className='week';
      const cs=document.createElement('select'); cs.setAttribute('aria-label',`项目${i+1}实验`);
      for(const id of SLOTS[i].ids) {const op=document.createElement('option');op.value=id;op.textContent=`${id===SLOTS[i].ids[0]?'首选':'备选'} · ${COURSES[id-1][0]}`;cs.append(op);}
      cs.value=x.id; cs.title=COURSES[x.id-1][0]; cs.disabled=busy || !!uncertain || SLOTS[i].ids.some(id=>rows.get(id)?.enrolled);
      const ws=document.createElement('select'); ws.setAttribute('aria-label',`项目${i+1}周次`);
      const r=rows.get(x.id);
      for(const o of r?.options || []) {const op=document.createElement('option');op.value=o.value;op.textContent=o.value+(remaining(o.textContent)!==null && remaining(o.textContent)<=0?' 满':'');ws.append(op);}
      ws.value=x.value; ws.disabled=busy || !!uncertain || !!r?.enrolled;
      cs.onchange=()=>{x.id=Number(cs.value);const opts=rows.get(x.id)?.options||[];x.value=opts.find(o=>o.value===x.value)?.value || opts[0]?.value || '';persist();render();showValidation();};
      ws.onchange=()=>{x.value=ws.value;persist();render();showValidation();};
      const meta=document.createElement('div');meta.className='meta';
      const option=r?.options.find(o=>o.value===x.value), rem=option?remaining(option.textContent):null;
      meta.textContent=r?`${r.teacher} · ${r.enrolled?'网页已选择':`余量${rem===null?'未知':rem}`} · 网页第${x.id}项`:'网页未找到该实验';
      const locate=document.createElement('button');locate.textContent='定位';locate.onclick=()=>{const target=collect().get(x.id)?.row;if(target){target.scrollIntoView({block:'center',behavior:'smooth'});target.animate([{backgroundColor:'#ffe49c'},{backgroundColor:'transparent'}],{duration:1600});}};
      courseCell.append(cs,meta);weekCell.append(ws);locateCell.append(locate);tr.append(courseCell,weekCell,locateCell);$('plan').append(tr);
    });
    for(const name of ['unlock','relock','original','backup','rescan','apply','undo','run','reconcile']) $(name).disabled=busy;
    for(const name of ['original','backup','apply','undo','run']) $(name).disabled=busy || !!uncertain;
    $('apply').disabled ||= draft.length!==12; $('run').disabled ||= draft.length!==12;
    $('undo').disabled ||= !undo; $('pause').disabled=!running; $('close').disabled=busy;
  }
  function showValidation() { const errors=issues();status(errors.length?errors.join('\n'):'方案检查通过：12项、14周、无周次重叠。修改仍未写入网页。',!!errors.length); }
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  function setWeek(select,value) {
    select.value=value;
    // 已核对当前 app bundle：change 只调用 Vue $set(course,"selectWeek",value)。
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  async function apply() {
    rows=collect();enrolledCheck(rows);const errors=issues(rows);
    if(errors.length) throw new Error(errors.join('\n'));
    const pending=draft.filter(x=>!rows.get(x.id).enrolled);
    if(pending.some(x=>{const r=rows.get(x.id),o=r.options.find(o=>o.value===x.value);return r.select.disabled||o.disabled;}) && !unlocked) throw new Error('目标周次仍被禁用。请先点击“解锁所有选项”，或等网页正常开放。');
    const snapshot=new Map();
    for(const id of new Set([...managed,...pending.map(x=>x.id)])) {const r=rows.get(id);if(r&&!r.enrolled)snapshot.set(id,r.select.value);}
    undo={snapshot,managed:new Set(managed)};busy=true;render();
    try {
      const nextIds=new Set(draft.map(x=>x.id));
      for(const id of managed) if(!nextIds.has(id)) {const r=rows.get(id);if(r&&!r.enrolled)setWeek(r.select,'');}
      for(const x of pending) {const r=rows.get(x.id);if(unlocked)unlockPass();setWeek(r.select,x.value);}
      await tick();if(unlocked)unlockPass();rows=collect();
      const failed=draft.filter(x=>rows.get(x.id)?.select.value!==x.value);
      managed=new Set([...managed,...pending.map(x=>x.id)].filter(id=>nextIds.has(id)));
      if(failed.length) throw new Error(`部分周次被网页重新覆盖：${failed.map(x=>COURSES[x.id-1][0]).join('、')}。可撤销后重新读取页面。`);
      status(`已填写并核对 ${pending.length} 项周次；${12-pending.length} 项为网页已选。\n尚未代你提交。开放后使用对应行的“选课”按钮，并核对“我的课表”。`);log(`填写完成：${pending.length}项；没有发送选课请求`);
    } finally {busy=false;render();}
  }
  async function undoApply() {
    if(!undo) return;
    const current=collect();let skipped=0;
    for(const [id,value] of undo.snapshot) {const r=current.get(id);if(!r||r.enrolled){skipped++;continue;}setWeek(r.select,value);}
    managed=undo.managed;undo=null;await tick();if(unlocked)unlockPass();rows=collect();render();
    status(`已撤销上次本地周次填写。${skipped?`跳过${skipped}项已选或已消失项目。`:''}不会取消已经提交的选课。`);log('撤销本地填写');
  }
  function selectButton(r) {
    const candidates=[...r.row.querySelectorAll('button')].filter(b=>b.textContent.trim()==='选课' && !b.disabled && b.getAttribute('aria-disabled')!=='true' && b.getClientRects().length);
    return candidates.length===1?candidates[0]:null;
  }
  function isRecorded(item,map) {const r=map.get(item.id);return !!r?.enrolled && r.select.value===item.value;}
  async function waitRecorded(item) {
    const deadline=Date.now()+30000;let stable=0;
    while(Date.now()<deadline) {
      await new Promise(resolve=>setTimeout(resolve,250));
      // 每次重新查找 DOM，允许整个课程表由 Vue 重绘；不复用旧按钮。
      const current=collect(), r=current.get(item.id);
      if(r?.enrolled && r.select.value!==item.value) throw new Error('网页显示已选择，但周次与方案不一致；请核对课表。');
      stable=isRecorded(item,current)?stable+1:0;
      if(stable>=2) {rows=current;return;}
    }
    throw new Error('等待录入超过30秒，结果不明。请关闭可能残留的成功提示，刷新核对课表，再用“核对待确认结果”。不会重复发送。');
  }
  async function runQueue() {
    if(uncertain) throw new Error('先核对上一项的结果，才能继续。');
    rows=collect();enrolledCheck(rows);const problems=issues(rows);if(problems.length)throw new Error(problems.join('\n'));
    running=true;busy=true;pauseRequested=false;undo=null;persist();render();
    let finished=false;
    try {
      for(let i=0;i<draft.length;i++) {
        if(pauseRequested) break;
        const item={...draft[i]};
        rows=collect();enrolledCheck(rows);
        // 已经录入的项目只核对，不再点击（“已选择”按钮实际上是退课入口）。
        if(isRecorded(item,rows)) continue;
        const errors=issues(rows);if(errors.length)throw new Error(errors.join('\n'));
        let r=rows.get(item.id), button=selectButton(r);
        if(!button) throw new Error(`${COURSES[item.id-1][0]}还没有可用的“选课”按钮。开放后刷新网页、重新运行脚本，再继续。`);
        const option=r.options.find(o=>o.value===item.value);
        if((r.select.disabled || option.disabled) && !unlocked) throw new Error('目标周次尚不可选，先核对开放状态和容量。');
        if(unlocked)unlockPass();setWeek(r.select,item.value);await tick();
        rows=collect();r=rows.get(item.id);button=selectButton(r);
        if(!r || r.select.value!==item.value || !button) throw new Error('设置周次后页面发生变化，已暂停，请重新读取。');
        if(remaining(r.options.find(o=>o.value===item.value)?.textContent)!==null && remaining(r.options.find(o=>o.value===item.value)?.textContent)<=0) throw new Error('提交前目标周次已满，已暂停。');
        status(`正在处理 ${i+1}/12：${COURSES[item.id-1][0]}，第${item.value}周。\n请确认网页选课弹窗，并关闭完成提示；等待录入后才继续。`);
        log(`准备点击：${COURSES[item.id-1][0]} / ${item.value}`);
        uncertain={id:item.id,value:item.value,at:Date.now()};persist();
        // 只记录当前同步 confirm 是否取消；始终把真实确认框交给用户。
        const originalConfirm=window.confirm;let cancelled=false;
        const trackedConfirm=function(...args){const answer=originalConfirm.apply(window,args);if(!answer)cancelled=true;return answer;};
        window.confirm=trackedConfirm;
        try {button.click();} finally {if(window.confirm===trackedConfirm)window.confirm=originalConfirm;}
        if(cancelled) {uncertain=null;persist();throw new Error('你取消了本项确认，队列已暂停。');}
        await waitRecorded(item);
        uncertain=null;persist();render();log(`网页已录入：${COURSES[item.id-1][0]} / ${item.value}`);
      }
      rows=collect();finished=draft.every(item=>isRecorded(item,rows));
      status(finished?'12项均在网页显示“已选择”，周次匹配。请到“我的课表”做最终核对。':'已在本项处理完成后暂停。继续时会跳过已录入的项目。');
    } finally {running=false;busy=false;persist();render();}
  }
  async function reconcile() {
    rows=collect();
    if(!uncertain) {render();status('没有结果不明的提交记录。');return;}
    if(isRecorded(uncertain,rows)) {log('已从页面确认上一项录入');uncertain=null;persist();render();status('上一项已录入，可以继续。');return;}
    if(rows.get(uncertain.id)?.enrolled) throw new Error('上一项显示已选择，但周次不同。请人工核对，不会重新提交。');
    if(confirm(`上一项（${COURSES[uncertain.id-1][0]}，第${uncertain.value}周）尚未在页面确认。\n请先刷新页面或查看我的课表，确认未选上且原请求已经结束。\n你已核对未选上，允许解除暂停并自行重试吗？`)) {
      uncertain=null;persist();render();status('已解除结果不明的暂停。请核对方案后点击继续。');
    }
  }
  function restoreDraft() {
    let saved;try{saved=JSON.parse(sessionStorage.getItem(STORE)||'null');}catch{}
    if(!saved || saved.context!==context() || !Array.isArray(saved.draft) || saved.draft.length!==12) return false;
    if(!saved.draft.every((x,i)=>SLOTS[i].ids.includes(x.id) && weeks(x.value).length===COURSES[x.id-1][1])) return false;
    rows=collect();draft=saved.draft;mode=saved.mode==='backup'?'backup':'original';
    const u=saved.uncertain;
    uncertain=u && draft.some(x=>x.id===u.id && x.value===u.value)?u:null;
    if(uncertain && isRecorded(uncertain,rows)) {uncertain=null;persist();}
    render();status(`已恢复本标签页草稿；不会自动提交。${uncertain?'\n有上一项结果待核对，请点“核对待确认结果”。':'\n请检查页面状态，再点击“开始 / 继续逐项选课”。'}`);return true;
  }
  function action(fn) {return async()=>{if(busy)return;try{await fn();}catch(e){status(e.message,true);log(e.message);}};}
  $('unlock').onclick=action(startUnlock);$('relock').onclick=action(relock);
  $('original').onclick=action(()=>makePlan('original'));$('backup').onclick=action(()=>makePlan('backup'));
  $('rescan').onclick=action(()=>{rows=collect();if(unlocked)unlockPass();if(draft.length){render();showValidation();}else makePlan(mode);});
  $('apply').onclick=action(apply);$('undo').onclick=action(undoApply);
  $('run').onclick=action(runQueue);$('reconcile').onclick=action(reconcile);
  $('pause').onclick=()=>{pauseRequested=true;status('已请求暂停；正在提交的这一项仍会等待结果，不会发送下一项。');};
  $('close').onclick=()=>{if(busy)return;closed=true;relock();host.remove();};
  $('fold').onclick=()=>{const main=root.querySelector('main');main.hidden=!main.hidden;$('fold').textContent=main.hidden?'展开':'收起';};
  const header=root.querySelector('header');
  header.onpointerdown=e=>{if(e.target.closest('button'))return;const rect=host.getBoundingClientRect();const dx=e.clientX-rect.left,dy=e.clientY-rect.top;header.setPointerCapture(e.pointerId);header.onpointermove=ev=>{host.style.right='auto';host.style.left=Math.max(0,Math.min(innerWidth-rect.width,ev.clientX-dx))+'px';host.style.top=Math.max(0,Math.min(innerHeight-50,ev.clientY-dy))+'px';};header.onpointerup=()=>{header.onpointermove=null;};};
  action(()=>{if(!restoreDraft())makePlan('original');})();
})();
