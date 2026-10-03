// ==UserScript==
// @name         ZJU 大学物理实验选课辅助面板
// @namespace    https://github.com/Ayanami-WU/Some-ZJU-Scripts
// @version      1.2.0
// @description  自动读取实验与时间，支持自选排序、排周、逐项确认和已选课表 ICS 导出
// @author       Ayanami-WU
// @match        http://10.203.16.55:86/lab-course/selectCourse*
// @run-at       document-idle
// @grant        none
// @noframes
// @license      MIT
// @supportURL   https://github.com/Ayanami-WU/Some-ZJU-Scripts/issues
// ==/UserScript==

(() => {
  'use strict';
  const VERSION='1.2.0', ID='zju-lab-course-panel', STORE='zju-lab-panel-v12', LEGACY_STORE='zju-lab-panel-v11';
  const text=s=>String(s ?? '').normalize('NFKC').replace(/\s+/g,' ').trim();
  const normalize=s=>text(s).replace(/[▲△\s]/g,'');
  function weeks(value) {
    const raw=text(value).replace(/\s/g,'');
    if(!/^\d+(,\d+)*$/.test(raw)) return [];
    const result=raw.split(',').map(Number);
    return result.every(n=>n>=1 && n<=60) && new Set(result).size===result.length ? result : [];
  }
  function targetWeeks(value) {
    const result=[];
    for(const part of text(value).replace(/\s/g,'').split(',')) {
      const range=part.match(/^(\d+)-(\d+)$/);
      if(range) {
        const start=Number(range[1]), end=Number(range[2]);
        if(start<1 || end>60 || start>end) return [];
        for(let n=start;n<=end;n++) result.push(n);
      } else {
        const parsed=weeks(part);if(parsed.length!==1)return [];
        result.push(parsed[0]);
      }
    }
    return [...new Set(result)].sort((a,b)=>a-b);
  }
  const maskOf=value=>weeks(value).reduce((mask,n)=>mask | (1n << BigInt(n-1)),0n);
  function remaining(label) {
    const a=text(label).match(/已选\s*(\d+)\s*人/), b=text(label).match(/容量\s*(\d+)\s*人/);
    return a && b ? Number(b[1])-Number(a[1]) : null;
  }
  // 按用户选择的实验排周，靠前的实验优先安排较早周次。不猜测必做/备选关系。
  function solve(domains,target=null) {
    let dp=new Map([[0n,{cost:0,items:[]}]]);
    for(const domain of domains) {
      const next=new Map();
      for(const [mask,entry] of dp) for(const item of domain) {
        if(!item.mask || (mask & item.mask))continue;
        const combined=mask | item.mask, cost=entry.cost+item.cost;
        if(!next.has(combined) || cost<next.get(combined).cost) next.set(combined,{cost,items:[...entry.items,item]});
      }
      if(next.size>60000)throw new Error('可用组合过多，请缩小计划周次或减少实验后重试。');
      dp=next;if(!dp.size)return null;
    }
    if(target!==null)return dp.get(target)?.items || null;
    return [...dp.values()].reduce((best,entry)=>!best || entry.cost<best.cost?entry:best,null)?.items || null;
  }
  const fingerprint=value=>{
    let hash=2166136261;
    for(const c of String(value))hash=Math.imul(hash ^ c.charCodeAt(0),16777619);
    return (hash>>>0).toString(16);
  };
  // 日历功能参考 5dbwat4/zjuphylab.ics 及 Ayanami-WU/zjuphylab-ics-beta 的接口流程。
  // 此处为独立实现，没有复制上游的签名、登录或日历转换代码。归属说明见 NOTICE.md。
  const calendarFailure=message=>Object.assign(new Error(message),{calendarSafe:true});
  // Original calendar serializer. Copyright (c) 2026 Ayanami-WU.
  // SPDX-License-Identifier: MIT
  // API workflow inspiration: https://github.com/5dbwat4/zjuphylab.ics
  // and https://github.com/Ayanami-WU/zjuphylab-ics-beta (no source copied).
  // Calendar format: https://www.rfc-editor.org/rfc/rfc5545
  const CalendarCore=(()=>{
    'use strict';
    const encoder=new TextEncoder(), MAX_EVENTS=2000, CHINA_OFFSET_MS=8*60*60*1000;
    const textValue=(value,label,required=false)=>{
      if(value!==undefined && value!==null && !['string','number'].includes(typeof value))throw new Error(`${label}格式无效。`);
      const result=String(value ?? '').trim();
      if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result))throw new Error(`${label}包含无效控制字符。`);
      if(required && !result)throw new Error(`${label}不能为空。`);
      return result;
    };
    const escapeText=value=>String(value)
      .replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
    // The leading space on each continuation line also occupies one UTF-8 octet.
    function foldLine(value) {
      let output='', current='', octets=0;
      for(const character of String(value)) {
        const length=encoder.encode(character).length;
        if(octets+length>75) {output+=current+'\r\n';current=' ';octets=1;}
        current+=character;octets+=length;
      }
      return output+current;
    }
    function dateParts(value,label) {
      const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if(!match)throw new Error(`${label}必须使用 YYYY-MM-DD 日期格式。`);
      const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
      const local=new Date(0);local.setUTCFullYear(year,month-1,day);local.setUTCHours(0,0,0,0);
      if(year<1 || local.getUTCFullYear()!==year || local.getUTCMonth()!==month-1 || local.getUTCDate()!==day)throw new Error(`${label}不是有效日期。`);
      return {year,month,day};
    }
    function timeParts(value,label) {
      const match=/^(\d{2}):(\d{2})$/.exec(value);
      if(!match || Number(match[1])>23 || Number(match[2])>59)throw new Error(`${label}必须是有效的 HH:mm 时间。`);
      return {hour:Number(match[1]),minute:Number(match[2])};
    }
    function localStart(date,time) {
      const value=new Date(0);
      value.setUTCFullYear(date.year,date.month-1,date.day);
      value.setUTCHours(time.hour,time.minute,0,0);
      return value.getTime()-CHINA_OFFSET_MS;
    }
    function utcValue(milliseconds) {
      const value=new Date(milliseconds), year=value.getUTCFullYear();
      if(!Number.isFinite(value.getTime()) || year<1 || year>9999)throw new Error('日历时间超出可导出的年份范围。');
      return value.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    }
    function uidFor(value) {
      // Deterministic identifiers keep account scope out of the visible UID text.
      let first=0xcbf29ce484222325n,second=0x84222325cbf29ce4n;
      const mask=0xffffffffffffffffn,prime=0x100000001b3n;
      for(const byte of encoder.encode(value)) {
        first=((first ^ BigInt(byte))*prime)&mask;
        second=((second ^ BigInt(byte))*prime)&mask;
      }
      return first.toString(16).padStart(16,'0')+second.toString(16).padStart(16,'0')+'@zjuphylab-assistant.local';
    }
    function serialize(records,options={}) {
      if(!Array.isArray(records) || !records.length)throw new Error('没有可导出的已选实验记录。');
      if(!options || typeof options!=='object' || Array.isArray(options))throw new Error('日历导出设置格式无效。');
      const duration=options.durationMinutes;
      if(!Number.isInteger(duration) || duration<1 || duration>1440)throw new Error('实验时长必须是 1 至 1440 分钟的整数。');
      const limit=options.maxEvents ?? MAX_EVENTS;
      if(!Number.isInteger(limit) || limit<1 || limit>MAX_EVENTS)throw new Error(`日历事件上限必须是 1 至 ${MAX_EVENTS} 的整数。`);
      if(records.length>limit)throw new Error(`实验记录过多，最多支持 ${limit} 项。`);
      const accountScope=textValue(options.accountScope,'账号范围',true);
      const termName=textValue(options.termName,'当前学期',true);
      const now=options.now ?? new Date();
      if(!(now instanceof Date) || !Number.isFinite(now.getTime()))throw new Error('日历生成时间无效。');
      const stamp=utcValue(now.getTime()),events=new Map();
      let expandedCount=0;
      records.forEach((record,index)=>{
        const label=`第 ${index+1} 项实验`;
        if(!record || typeof record!=='object' || Array.isArray(record))throw new Error(`${label}记录格式无效。`);
        const dates=textValue(record.dates,`${label}日期`,true).split(',').map(value=>value.trim());
        expandedCount+=dates.length;
        if(expandedCount>limit)throw new Error(`展开后的实验日期过多，最多支持 ${limit} 个事件。`);
        const timeText=textValue(record.times,`${label}时间`,true),time=timeParts(timeText,`${label}时间`);
        const summary=textValue(record.lab_name,`${label}名称`,true);
        const location=textValue(record.address,`${label}地点`);
        const course=textValue(record.course_name ?? record.courseName,`${label}课程`);
        const teacher=textValue(record.teacher_name,`${label}教师`);
        const weekText=textValue(record.select_week ?? record.week,`${label}周次`);
        const dateWeeks=weekText.split(',').map(value=>value.trim());
        for(const [dateIndex,dateText] of dates.entries()) {
          const week=dateWeeks.length===dates.length && dateWeeks.every(Boolean)?dateWeeks[dateIndex]:weekText;
          const description=`课程：${course}\n教师：${teacher}\n学期：${termName}\n周次：${week}`;
          const start=localStart(dateParts(dateText,`${label}日期`),time),end=start+duration*60*1000;
          const startText=utcValue(start),endText=utcValue(end);
          const identity=JSON.stringify([accountScope,termName,course,summary,teacher,location,week,dateText,timeText]);
          const content=JSON.stringify([startText,endText,summary,location,description]);
          if(!events.has(content))events.set(content,{start,content,uid:uidFor(identity),startText,endText,summary,location,description});
        }
      });
      const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Ayanami-WU//ZJU Physics Lab Assistant//ZH-CN','CALSCALE:GREGORIAN'];
      const ordered=[...events.values()].sort((a,b)=>a.start-b.start || (a.content<b.content?-1:a.content>b.content?1:0));
      for(const event of ordered)lines.push(
        'BEGIN:VEVENT',`UID:${event.uid}`,`DTSTAMP:${stamp}`,`DTSTART:${event.startText}`,`DTEND:${event.endText}`,
        `SUMMARY:${escapeText(event.summary)}`,`LOCATION:${escapeText(event.location)}`,`DESCRIPTION:${escapeText(event.description)}`,'END:VEVENT'
      );
      lines.push('END:VCALENDAR');
      return {value:lines.map(foldLine).join('\r\n')+'\r\n',eventCount:ordered.length,recordCount:records.length};
    }
    return Object.freeze({serialize,escapeText,foldLine,MAX_EVENTS});
  })();
  function createCalendarClient({urlFor,authorization,fetchImpl,allowedOrigin,signal}) {
    const paths=new Set(['/api/courses/uid','/api/course/lab/students/full']);
    return {async get(path,params) {
      if(signal?.aborted)throw calendarFailure('日历导出已取消。');
      if(!paths.has(path))throw calendarFailure('日历导出只允许指定的课表读取接口。');
      let url;try{url=new URL(urlFor(path,params));}catch{throw calendarFailure('无法读取网页接口地址，请刷新后重试。');}
      if(url.origin!==allowedOrigin || url.pathname!==`/lab-course${path}` || url.username || url.password || url.hash)throw calendarFailure('网页接口地址与预期学校服务不一致，已停止导出。');
      if(typeof authorization!=='string' || !authorization.trim() || /[\r\n]/.test(authorization))throw calendarFailure('当前登录会话不可用，请重新登录后导出。');
      const controller=new AbortController(),abort=()=>controller.abort();
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      let timer;
      const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{abort();reject(calendarFailure('课表读取超时，请稍后重试。'));},12000);});
      try {
        const operation=(async()=>{
          const response=await fetchImpl(url.href,{method:'GET',headers:{Authorization:authorization},mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
          if(response.status===401 || response.status===403)throw calendarFailure('当前登录会话失效，请重新登录后导出。');
          if(!response.ok)throw calendarFailure('课表读取失败，未生成日历。');
          let envelope;try{envelope=await response.json();}catch{throw calendarFailure('课表接口返回的数据格式异常，未生成日历。');}
          if(signal?.aborted)throw calendarFailure('日历导出已取消。');
          if(envelope?.code===401 || envelope?.code===403)throw calendarFailure('当前登录会话失效，请重新登录后导出。');
          if(envelope?.code!==200)throw calendarFailure('课表接口返回异常，未生成日历。');
          return envelope.data;
        })();
        return await Promise.race([operation,expired]);
      }catch(error){if(error?.calendarSafe)throw error;throw calendarFailure(signal?.aborted?'日历导出已取消。':'课表网络读取失败，未生成日历。');}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }};
  }
  async function readCalendarRecords(client,{uid,termId,checkContext=()=>{},progress=()=>{}}) {
    checkContext();
    const courses=await client.get('/api/courses/uid',{uid,termId,page:-1,size:-1});checkContext();
    const validId=id=>typeof id==='number'?Number.isSafeInteger(id) && id>0:typeof id==='string' && id.trim().length>0 && id===id.trim() && !/[\r\n]/.test(id);
    if(!Array.isArray(courses) || !courses.every(c=>c && validId(c.id) && typeof c.courseName==='string'))throw new Error('课程列表格式异常，未生成日历。');
    if(!courses.length)throw new Error('当前学期没有可导出的课程。');
    const records=[];
    for(const [index,course] of courses.entries()) {
      progress(index+1,courses.length);checkContext();
      const data=await client.get('/api/course/lab/students/full',{uid,termId,courseId:course.id,page:-1,size:-1});checkContext();
      const hasTotal=data?.totalElements!==undefined,total=Number(data?.totalElements);
      if(!Array.isArray(data?.content) || (hasTotal && (data.totalElements===null || data.totalElements==='' || !Number.isSafeInteger(total) || total<0 || total>data.content.length)) || !data.content.every(r=>r && typeof r==='object' && !Array.isArray(r)))throw new Error('已选课表格式异常或不完整，未生成日历。');
      // 仅保留日历必需字段，学生身份、联系方式、成绩等字段不进入序列化器或草稿。
      records.push(...data.content.map(r=>({dates:r.dates,times:r.times,lab_name:r.lab_name,teacher_name:r.teacher_name,address:r.address,select_week:r.select_week,course_name:r.course_name||course.courseName,course_id:course.id,course_lab_id:r.course_lab_id??r.id})));
    }
    if(!records.length)throw new Error('当前学期没有已选实验可导出。');
    return {records,courseCount:courses.length};
  }
  if(typeof module!=='undefined' && module.exports && typeof document==='undefined') {
    module.exports={text,normalize,weeks,targetWeeks,maskOf,remaining,solve,fingerprint,createCalendarClient,readCalendarRecords,CalendarCore};return;
  }
  const demo=location.hostname==='127.0.0.1' && document.documentElement.dataset.labPanelDemo==='true';
  if(!demo && (location.origin!=='http://10.203.16.55:86' || location.pathname.replace(/\/$/,'')!=='/lab-course/selectCourse')) {
    alert('请在实验选课页面运行此脚本。');return;
  }
  const old=document.getElementById(ID);
  if(old) {
    if(old.dataset.version!==VERSION)alert('请先关闭旧面板，再运行新版脚本。');
    else {old.hidden=false;old.scrollIntoView({block:'nearest'});}
    return;
  }
  const host=document.createElement('div');host.id=ID;host.dataset.version=VERSION;
  Object.assign(host.style,{position:'fixed',right:'16px',top:'16px',zIndex:'2147483000',width:'min(720px, calc(100vw - 24px))'});
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
    :host{color-scheme:light}*{box-sizing:border-box}section{font:14px/1.5 system-ui,'Microsoft YaHei',sans-serif;color:#173247;background:#f7fafc;border:1px solid #bacdd6;border-radius:16px;box-shadow:0 16px 64px #17324740;overflow:hidden}
    header{display:flex;align-items:center;gap:10px;background:#123f50;color:white;padding:14px 16px;cursor:move;touch-action:none}header b{font-size:17px;flex:1}header button{background:#ffffff20;border-color:#ffffff40;color:white}
    main{padding:14px;max-height:calc(100vh - 100px);overflow:auto}p{margin:0 0 10px}.muted,.meta{font-size:12px;color:#586e7b}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}button,select,input{font:inherit;border:1px solid #b5c8d3;border-radius:7px;background:white;color:#173247;padding:6px}button,select{cursor:pointer}button:hover{background:#e4f1f4}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:#086b75;color:white;border-color:#086b75}.primary:hover{background:#075863}.amber{background:#fff3d9;border-color:#d6b16c}
    #status{white-space:pre-wrap;background:#e8f1f5;border-left:4px solid #087883;padding:10px;border-radius:6px;margin:10px 0;font-size:13px}#status.error{background:#fff0ed;border-color:#b84931}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;border-bottom:1px solid #dce6eb;padding:7px 3px;vertical-align:top}th{background:#eef4f7;position:sticky;top:0}td select{width:100%;font-size:12px}.meta{font-size:11px;margin-top:3px}td:first-child{width:35px}td.week{width:160px}td.order{width:74px}td button{font-size:12px;padding:4px;margin:1px}label{display:block;margin:7px 0}input[type=checkbox]{vertical-align:middle}#target{width:200px}details{margin:12px 0;font-size:12px}summary{cursor:pointer;font-weight:600}#log{white-space:pre-wrap;font:11px/1.5 ui-monospace,monospace;max-height:100px;overflow:auto}footer{font-size:12px;color:#516a77}
  </style><section aria-label="大学物理实验选课面板"><header><b>大学物理实验 · 自选方案</b><button id="fold">收起</button><button id="close" title="关闭并恢复解锁状态">×</button></header><main>
    <p id="page-info">正在读取当前教学班…</p><p class="muted">v${VERSION} · 勾选实验 → 上下调整顺序 → 自动排周或手动选周次 → 核对后填写/逐项选课。</p>
    <div class="actions"><button id="rescan">重新读取页面</button><button id="reset">重置为网页已选</button><button id="schedule" class="primary">按排序自动排周</button></div>
    <label>计划周次 <input id="target" aria-label="计划周次" placeholder="例如 1-18 或 1,3,5-8"></label>
    <label><input type="checkbox" id="coverage"> 要求完整覆盖计划周次</label>
    <p class="muted">自动排周只安排勾选的实验，不会自动增加或替换。同一教学班每周最多安排一项；必做要求请结合课程说明自行确认。</p>
    <div id="status" role="status" aria-live="polite">正在识别实验列表…</div><p id="summary" class="muted"></p>
    <table><thead><tr><th>选</th><th>实验 / 教师 / 上课时间</th><th>周次</th><th>排序</th></tr></thead><tbody id="plan"></tbody></table>
    <div class="actions"><button id="unlock" class="amber">解锁周次选项</button><button id="relock">恢复解锁前状态</button><button id="apply" class="primary">填写方案到网页</button><button id="undo">撤销上次填写</button></div>
    <div class="actions"><button id="run" class="primary">开始 / 继续逐项选课</button><button id="pause" disabled>本项完成后暂停</button><button id="reconcile">核对待确认结果</button></div>
    <p class="muted">每项保留网页原生确认。等待“已选择”且周次匹配才继续；不会退课，结果不明时暂停。</p>
    <details open><summary>导出已选课表</summary><label>日历每次实验时长（分钟） <input id="duration" type="number" min="1" max="1440" value="145" aria-label="日历每次实验时长（分钟）"></label><p class="muted">导出当前学期所有课程的已选实验，日期和开始时间来自学校课表。接口只提供开始时间，时长默认 145 分钟，可自行修改。</p><div class="actions"><button id="export-ics">导出已选课表 ICS</button><button id="cancel-export" disabled>取消导出</button></div><p class="muted">本地生成文件；课表信息不上传到其他服务。参考 zjuphylab.ics（5dbwat4）及 Ayanami-WU 的改进。</p></details>
    <details><summary>读取与恢复说明</summary><p>名称、教师、上课时间、周次和容量来自当前页面。优先使用网页已有教学班标识；同名实验按教师和时间分别展示。切换账号、学期或课程后重新读取并制定方案。</p><p>解锁仅移除下拉框 disabled，不改变后端开放时间或容量。恢复/关闭会停止保持解锁。未识别的时间显示“未提供”，不会猜测。</p><p>排序、勾选、周次和待核对记录保存在本标签页 sessionStorage，不保存凭据。重载恢复后不会自动提交。旧版结果不明的记录仍需人工核对。</p></details>
    <details><summary>操作记录</summary><pre id="log"></pre></details><footer>“已填写”表示本地周次同步。选课结果以学校系统“我的课表”为准。</footer>
  </main></section>`;
  document.body.append(host);
  const $=id=>root.getElementById(id);
  let rows=new Map(),page=null,planContext='',order=[],draft=[],managed=new Set(),undo=null;
  let busy=false,running=false,pauseRequested=false,uncertain=null,pendingBacklog=[],unlocked=false,closed=false,unlockQueued=false,exportController=null;
  const locks=new Map();
  const log=message=>{$('log').textContent=(`${new Date().toLocaleTimeString()} ${message}\n`+$('log').textContent).slice(0,7000);};
  function status(message,error=false){$('status').textContent=message;$('status').className=error?'error':'';}
  function findVM() {
    const queue=[document.getElementById('myApp')?.__vue__,...Array.from(document.querySelectorAll('.main-content'),el=>el.__vue__)].filter(Boolean),seen=new Set();
    while(queue.length && seen.size<200) {
      const vm=queue.shift();if(seen.has(vm))continue;seen.add(vm);
      if(vm.$el?.isConnected && Array.isArray(vm.courseClassList) && Array.isArray(vm.courseList) && vm.currentTerm && vm.curCourse)return vm;
      queue.push(...(vm.$children||[]));
    }
    return null;
  }
  // 官方 Vue2 表格为“实验名称 / 实验详情”两列；详情 .flex 内含教师、地址、times、周次。
  // Vue 状态只读取元数据，写周次通过 select.change，提交只点击页面原按钮。
  function readPage() {
    const vm=findVM(),active=document.querySelector('.nav-tabs li.active'),course=vm?.curCourse||{},term=vm?.currentTerm||{};
    const name=text(course.courseName || active?.textContent || '当前课程');
    const day=text(vm?.weekArray?.[course.week]),period=String(course.time)==='1'?'上午':String(course.time)==='2'?'下午':'';
    const session=[day,period].join('') || name.match(/(?:周|星期)[一二三四五六日天](?:上午|下午|晚上)/)?.[0] || '';
    const context=JSON.stringify([term.id??'',course.id??active?.getAttribute('value')??'',fingerprint(vm?.user?.username || text(document.querySelector('.navbar-container')?.textContent)),name,session,vm?'':text(document.querySelector('.page-header h1')?.textContent)]);
    const map=new Map(),scope=vm?.$el||document;
    const tables=[...scope.querySelectorAll('table')].filter(table=>[...table.querySelectorAll('th')].some(th=>normalize(th.textContent)==='实验名称'));
    for(const table of tables) {
      const tableRows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.querySelector('select'));
      for(const [index,row] of tableRows.entries()) {
        if(!row.getClientRects().length)continue;
        const selects=row.querySelectorAll('select');if(selects.length!==1)throw new Error('实验行包含多个周次下拉框，无法可靠识别。');
        const select=selects[0],labName=text(row.cells?.[0]?.textContent),flex=row.cells?.[1]?.querySelector('.flex'),parts=flex?[...flex.children]:[];
        const teacher=text(parts[0]?.textContent || row.cells?.[1]?.querySelector('a')?.textContent),address=text(parts[1]?.textContent),times=text(parts[2]?.textContent);
        const candidate=vm?.courseClassList[index];
        const aligned=candidate && normalize(candidate.labName)===normalize(labName) && normalize(candidate.teacherName)===normalize(teacher) && normalize(candidate.times)===normalize(times) && normalize(candidate.address)===normalize(address);
        if(vm && !aligned)throw new Error('实验列表正在更新或页面结构变化，请等待加载后重新读取。');
        if(aligned && String(candidate.courseId)!==String(course.id))throw new Error('教学班正在切换，请等待实验列表加载完成。');
        // 行号仅用于核对元数据，持久 ID 使用真实教学班标识，DOM 回退使用整行特征。
        const id=aligned && candidate.id!=null?`vue:${term.id}:${course.id}:${candidate.id}`:`dom:${JSON.stringify([labName,teacher,address,times])}`;
        if(map.has(id))throw new Error(`“${labName}”存在无法区分的重复教学班，请人工核对。`);
        const options=[...select.options].filter(option=>weeks(option.value).length),enrolled=[...row.querySelectorAll('button')].some(button=>text(button.textContent)==='已选择');
        const time=(/(?:周|星期)[一二三四五六日天]/.test(times)?times:[session,times].filter(Boolean).join(' '))||'未提供';
        map.set(id,{id,name:labName,teacher,address,time,signature:JSON.stringify([labName,teacher,address,time]),row,select,options,enrolled,must:aligned && !!Number(candidate.isMust),counts:aligned?Number(candidate.counts)||null:null});
      }
    }
    if(!map.size)throw new Error('没有读取到实验列表，请确认已登录并打开有实验的选课教学班。');
    const available=[...new Set([...map.values()].flatMap(r=>r.options.flatMap(o=>weeks(o.value))))].sort((a,b)=>a-b);
    const heading=text(scope.querySelector('.page-header h1')?.textContent),requirement=text(scope.querySelector('.text-danger')?.textContent);
    return {rows:map,context,name,session,termName:text(term.name),weekCount:Number(term.weekCount)||Number(heading.match(/共\s*(\d+)\s*周/)?.[1])||null,minimum:Number(course.count)||Number(requirement.match(/至少实验次数\s*(\d+)\s*次/)?.[1])||null,available,source:vm?'网页教学班数据':'页面表格'};
  }
  function collect(){page=readPage();rows=page.rows;return rows;}
  function ensureContext(){if(planContext!==page.context)throw new Error('账号、学期或课程已经切换，请重新读取页面后制定方案。');}
  function persist() {
    try{sessionStorage.setItem(STORE,JSON.stringify({context:planContext,order,draft,target:$('target').value,coverage:$('coverage').checked,uncertain,pendingBacklog}));return true;}
    catch{log('无法保存恢复记录，刷新后需重新制定方案；提交功能暂停。');return false;}
  }
  function syncOrder() {
    order=[...order.filter(id=>rows.has(id)),...[...rows.keys()].filter(id=>!order.includes(id))];
    for(const r of rows.values())if(r.enrolled && !draft.some(x=>x.id===r.id))draft.push({id:r.id,value:r.select.value,signature:r.signature});
    draft.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
  }
  function resetPlan() {
    if(uncertain)throw new Error('请先核对上一项选课结果。');
    collect();planContext=page.context;order=[...rows.keys()];draft=[];managed.clear();undo=null;
    $('target').value=page.available.join(',');$('coverage').checked=false;syncOrder();persist();render();
    status(`已读取 ${rows.size} 个实验。勾选目标实验并调整顺序，再自动排周或手动选择周次。`);
  }
  function issues() {
    const errors=[];if(planContext!==page.context)return ['页面教学班已切换，请重新读取。'];
    if(!draft.length)return ['请先勾选要安排的实验。'];
    const allowed=targetWeeks($('target').value);if(!allowed.length)return ['计划周次格式无效，请填写例如 1-18 或 1,3,5-8。'];
    let mask=0n;const ids=new Set();
    for(const item of draft) {
      const r=rows.get(item.id),option=r?.options.find(o=>o.value===item.value);
      if(ids.has(item.id))errors.push('重复实验');ids.add(item.id);
      if(!r || !option){errors.push(`${r?.name||'方案中的实验'}：未找到所选周次`);continue;}
      if(item.signature!==r.signature)errors.push(`${r.name}：名称、教师或时间已变化，请重置方案后核对`);
      if(weeks(item.value).some(n=>!allowed.includes(n)))errors.push(`${r.name}：超出计划周次`);
      if(!r.enrolled && remaining(option.textContent)!==null && remaining(option.textContent)<=0)errors.push(`${r.name}：该周已满`);
      if(mask & maskOf(item.value))errors.push(`第${item.value}周有冲突`);mask |= maskOf(item.value);
      if(r.enrolled && r.select.value!==item.value)errors.push(`${r.name}：不能修改已选周次`);
    }
    for(const r of rows.values())if(r.enrolled && !ids.has(r.id))errors.push(`网页已选实验未纳入方案：${r.name}`);
    if($('coverage').checked && mask!==maskOf(allowed.join(',')))errors.push('方案未完整覆盖计划周次');
    return [...new Set(errors)];
  }
  function showValidation(){const errors=issues();status(errors.length?errors.join('\n'):`方案检查通过：${draft.length} 项，无周次重叠。尚未写入网页。`,!!errors.length);}
  function makePlan() {
    collect();ensureContext();syncOrder();if(!draft.length)throw new Error('请先勾选实验，自动排周不会替你决定实验项目。');
    if(draft.some(item=>item.signature!==rows.get(item.id)?.signature))throw new Error('方案中的实验信息已变化，请重置并核对后重新勾选。');
    const allowed=targetWeeks($('target').value);if(!allowed.length)throw new Error('计划周次格式无效。');
    const domains=draft.map((item,index)=>{
      const r=rows.get(item.id);if(!r)return [];
      return r.options.filter(o=>weeks(o.value).every(n=>allowed.includes(n)) && (r.enrolled?o.value===r.select.value:remaining(o.textContent)===null || remaining(o.textContent)>0)).map(o=>({id:item.id,value:o.value,mask:maskOf(o.value),cost:weeks(o.value)[0]*(draft.length-index)*100+(o.value===item.value?0:1)}));
    });
    const result=solve(domains,$('coverage').checked?maskOf(allowed.join(',')):null);
    if(!result)throw new Error('勾选实验的可用周次无法排开。请调整实验、顺序或计划周次；完整覆盖需要实验总周数匹配。');
    draft=result.map(({id,value})=>({id,value,signature:rows.get(id).signature}));persist();render();showValidation();log(`按自选排序排周：${draft.length}项`);
  }
  function render() {
    if(page)$('page-info').textContent=[page.name,page.session,page.termName,page.weekCount?`${page.weekCount}周`:null,`读取${rows.size}个实验`].filter(Boolean).join(' · ');
    $('summary').textContent=`方案已选 ${draft.length} 项 / ${new Set(draft.flatMap(x=>weeks(x.value))).size} 周${page?.minimum?`；网页要求至少实验 ${page.minimum} 次（请核对必做要求）`:''}`;
    $('plan').replaceChildren();const disabled=busy || !!uncertain || planContext!==page?.context;
    for(const [index,id] of order.entries()) {
      const r=rows.get(id);if(!r)continue;const item=draft.find(x=>x.id===id),tr=document.createElement('tr');tr.dataset.courseKey=id;
      const chooseCell=document.createElement('td'),courseCell=document.createElement('td'),weekCell=document.createElement('td'),orderCell=document.createElement('td');weekCell.className='week';orderCell.className='order';
      const check=document.createElement('input');check.type='checkbox';check.checked=!!item;check.disabled=disabled || r.enrolled;check.setAttribute('aria-label',`纳入方案 ${r.name} ${r.teacher} ${r.time}`);
      check.onchange=action(()=>{collect();ensureContext();const current=rows.get(id);if(!current)throw new Error('实验已经消失，请重新读取。');if(check.checked)draft.push({id,value:current.enrolled?current.select.value:'',signature:current.signature});else draft=draft.filter(x=>x.id!==id);syncOrder();persist();render();showValidation();});chooseCell.append(check);
      const title=document.createElement('b');title.textContent=r.name;courseCell.append(title);
      const meta=document.createElement('div');meta.className='meta';meta.textContent=[r.teacher,r.time,r.address,r.must?'网页标记必选':'',r.enrolled?'网页已选择':''].filter(Boolean).join(' · ');courseCell.append(meta);
      const locate=document.createElement('button');locate.textContent='定位';locate.onclick=action(()=>{collect();ensureContext();rows.get(id)?.row.scrollIntoView({block:'center',behavior:'smooth'});});courseCell.append(locate);
      const select=document.createElement('select');select.setAttribute('aria-label',`周次 ${r.name} ${r.teacher} ${r.time}`);
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择周次';select.append(placeholder);
      for(const option of r.options){const op=document.createElement('option');op.value=option.value;const rem=remaining(option.textContent);op.textContent=`第${option.value}周${rem===null?'':` · 余${rem}`}${option.disabled?' · 未开放':''}`;select.append(op);}
      select.value=item?.value||'';select.disabled=disabled || !item || r.enrolled;select.onchange=action(()=>{collect();ensureContext();item.value=select.value;persist();render();showValidation();});weekCell.append(select);
      for(const [label,delta] of [['↑',-1],['↓',1]]){const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-label',`${delta<0?'上移':'下移'} ${r.name} ${r.teacher} ${r.time}`);button.disabled=disabled || index+delta<0 || index+delta>=order.length;button.onclick=()=>{[order[index],order[index+delta]]=[order[index+delta],order[index]];syncOrder();persist();render();showValidation();};orderCell.append(button);}
      tr.append(chooseCell,courseCell,weekCell,orderCell);$('plan').append(tr);
    }
    for(const name of ['rescan','reset','schedule','unlock','relock','apply','undo','run','reconcile'])$(name).disabled=busy;
    for(const name of ['reset','schedule','unlock','apply','undo','run'])$(name).disabled=disabled;
    $('apply').disabled ||= !draft.length;$('run').disabled ||= !draft.length;$('undo').disabled ||= !undo;
    $('target').disabled=disabled;$('coverage').disabled=disabled;$('pause').disabled=!running;$('close').disabled=busy;
    $('export-ics').disabled=busy;$('duration').disabled=busy;$('cancel-export').disabled=!exportController;
  }
  function unlockPass() {
    if(closed || !unlocked)return;let current;try{current=readPage();}catch{return;}
    if(current.context!==planContext){unlocked=false;restoreLocks();return;}
    for(const {select} of current.rows.values())for(const el of [select,...select.querySelectorAll('optgroup'),...select.options]) {
      if(!locks.has(el))locks.set(el,el.disabled);if(el.disabled){locks.set(el,true);el.disabled=false;}
    }
  }
  function restoreLocks(){for(const [el,disabled] of locks)if(el.isConnected)el.disabled=disabled;locks.clear();}
  function relock(){unlocked=false;restoreLocks();status('已恢复最近记录的禁用状态；网页规则变化时请刷新获取最新状态。');}
  function startUnlock(){collect();ensureContext();unlocked=true;unlockPass();render();status(`已解锁 ${rows.size} 个实验的周次选项，后端开放和容量规则仍生效。`);}
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  function setWeek(select,value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}
  async function apply() {
    collect();ensureContext();const errors=issues();if(errors.length)throw new Error(errors.join('\n'));
    const pending=draft.filter(x=>!rows.get(x.id).enrolled);
    if(pending.some(x=>{const r=rows.get(x.id),o=r.options.find(o=>o.value===x.value);return r.select.disabled || o.disabled;}) && !unlocked)throw new Error('目标周次仍被禁用，请核对开放状态，或使用前端解锁。');
    const snapshot=new Map();for(const id of new Set([...managed,...pending.map(x=>x.id)])){const r=rows.get(id);if(r && !r.enrolled)snapshot.set(id,r.select.value);}
    undo={snapshot,managed:new Set(managed),context:planContext};busy=true;render();
    try {
      const nextIds=new Set(draft.map(x=>x.id));
      for(const id of managed)if(!nextIds.has(id)){const r=rows.get(id);if(r && !r.enrolled)setWeek(r.select,'');}
      for(const item of pending){collect();ensureContext();if(unlocked)unlockPass();setWeek(rows.get(item.id).select,item.value);}
      await tick();collect();ensureContext();const failed=draft.filter(x=>rows.get(x.id)?.select.value!==x.value);
      managed=new Set(pending.map(x=>x.id));if(failed.length)throw new Error('部分周次被网页覆盖，请核对页面或撤销本次填写。');
      status(`已填写并核对 ${pending.length} 项周次，${draft.length-pending.length} 项为网页已选。尚未提交选课。`);log('本地填写完成，没有发送选课请求');
    }finally{busy=false;render();}
  }
  async function undoApply(){if(!undo)return;collect();ensureContext();if(undo.context!==page.context)throw new Error('不能在另一教学班撤销填写。');let skipped=0;for(const [id,value] of undo.snapshot){const r=rows.get(id);if(!r || r.enrolled){skipped++;continue;}setWeek(r.select,value);}managed=undo.managed;undo=null;await tick();collect();render();status(`已撤销本地填写${skipped?`，跳过${skipped}项已选或已消失实验`:''}。不会取消选课。`);}
  function selectButton(r){const candidates=[...(r?.row.querySelectorAll('button')||[])].filter(b=>text(b.textContent)==='选课' && !b.disabled && b.getAttribute('aria-disabled')!=='true' && b.getClientRects().length);return candidates.length===1?candidates[0]:null;}
  const isRecorded=(item,map)=>!!map.get(item.id)?.enrolled && map.get(item.id).select.value===item.value && item.signature===map.get(item.id).signature;
  async function waitRecorded(item) {
    const deadline=Date.now()+30000;let stable=0;
    while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,250));collect();ensureContext();const r=rows.get(item.id);if(r?.enrolled && r.select.value!==item.value)throw new Error('网页已选择，但周次不同，请人工核对。');stable=isRecorded(item,rows)?stable+1:0;if(stable>=2)return;}
    throw new Error('等待录入超过30秒，结果不明。请关闭成功提示并核对“我的课表”，再核对待确认结果；不会自动重试。');
  }
  async function runQueue() {
    if(uncertain)throw new Error('请先核对上一项结果。');collect();ensureContext();const errors=issues();if(errors.length)throw new Error(errors.join('\n'));
    running=true;busy=true;pauseRequested=false;undo=null;render();
    try {
      for(let index=0;index<draft.length;index++) {
        if(pauseRequested)break;const item={...draft[index]};collect();ensureContext();
        if(isRecorded(item,rows))continue;const problems=issues();if(problems.length)throw new Error(problems.join('\n'));
        let r=rows.get(item.id),button=selectButton(r);if(!button)throw new Error(`${r?.name||'目标实验'}没有可用的“选课”按钮，请核对开放状态。`);
        const option=r.options.find(o=>o.value===item.value);if((r.select.disabled || option.disabled) && !unlocked)throw new Error('目标周次尚不可选，请核对开放状态。');
        if(unlocked)unlockPass();setWeek(r.select,item.value);await tick();collect();ensureContext();r=rows.get(item.id);button=selectButton(r);
        if(!r || r.signature!==item.signature || r.select.value!==item.value || !button)throw new Error('设置周次后实验信息或页面变化，已暂停。');
        const rem=remaining(r.options.find(o=>o.value===item.value)?.textContent);if(rem!==null && rem<=0)throw new Error('提交前目标周次已满，已暂停。');
        status(`正在处理 ${index+1}/${draft.length}：${r.name} · ${r.time} · 第${item.value}周。\n请确认网页弹窗，关闭完成提示，等待网页录入。`);
        uncertain={id:item.id,value:item.value,name:r.name,time:r.time,signature:r.signature,context:planContext,at:Date.now()};
        if(!persist()){uncertain=null;throw new Error('无法保存待核对记录，未点击选课。请恢复 sessionStorage 可用后继续。');}
        const originalConfirm=window.confirm;let cancelled=false;
        const trackedConfirm=function(...args){const answer=originalConfirm.apply(window,args);if(!answer)cancelled=true;return answer;};window.confirm=trackedConfirm;
        try{button.click();}finally{if(window.confirm===trackedConfirm)window.confirm=originalConfirm;}
        if(cancelled){uncertain=null;persist();throw new Error('你取消了本项确认，队列已暂停。');}
        await waitRecorded(item);uncertain=null;persist();render();log(`网页已录入：${r.name} / ${item.value}`);
      }
      collect();ensureContext();status(draft.every(item=>isRecorded(item,rows))?'方案各项均显示“已选择”，周次匹配。请到“我的课表”最终核对。':'已在本项完成后暂停，继续时跳过已录入项目。');
    }finally{running=false;busy=false;persist();render();}
  }
  async function reconcile() {
    collect();if(!uncertain){render();status('没有结果不明的提交记录。');return;}
    if(!uncertain.legacy && uncertain.context===page.context) {
      if(isRecorded(uncertain,rows)){uncertain=pendingBacklog.shift()||null;persist();render();status(uncertain?'上一项已确认，还有旧记录需要核对。':'已从页面确认上一项录入，可以继续。');return;}
      const recorded=rows.get(uncertain.id);
      if(recorded?.enrolled && recorded.select.value!==uncertain.value)throw new Error('上一项已选择但周次不同，请人工核对，不会重试。');
    }
    if(confirm(`上一项（${uncertain.name||'旧版选课记录'}，第${uncertain.value}周）尚未确认。\n请先查看对应账号的“我的课表”，确认结果和原请求已结束。\n你已完成人工核对，允许解除暂停吗？`)){uncertain=pendingBacklog.shift()||null;persist();render();status(uncertain?'本项已解除暂停，还有旧记录需要核对。':'已解除结果不明的暂停，请重新核对方案后继续。');}
  }
  function restoreDraft() {
    let saved,legacy,unreadable=false;try{saved=JSON.parse(sessionStorage.getItem(STORE)||'null');}catch{unreadable=true;log('新版草稿无法读取，请人工核对已有选课。');}
    try{legacy=JSON.parse(sessionStorage.getItem(LEGACY_STORE)||'null');}catch{unreadable=true;log('旧版草稿无法读取，请人工核对已有选课。');}
    uncertain=saved?.uncertain && typeof saved.uncertain==='object'?saved.uncertain:null;
    pendingBacklog=Array.isArray(saved?.pendingBacklog)?saved.pendingBacklog.filter(x=>x && typeof x==='object'):[];
    if(legacy?.uncertain)pendingBacklog.push({...legacy.uncertain,legacy:true,name:'旧版待确认实验'});
    if(unreadable)pendingBacklog.push({legacy:true,name:'无法读取的恢复记录',value:'未知'});
    uncertain ||= pendingBacklog.shift()||null;
    collect();planContext=page.context;
    if(saved?.context===page.context && Array.isArray(saved.order) && Array.isArray(saved.draft)) {
      order=[...new Set(saved.order.filter(id=>typeof id==='string'))];draft=saved.draft.filter(x=>typeof x?.id==='string' && typeof x.value==='string').map(x=>({id:x.id,value:x.value,signature:x.signature}));
      $('target').value=typeof saved.target==='string'?saved.target:page.available.join(',');$('coverage').checked=!!saved.coverage;
    }else{order=[...rows.keys()];draft=[];$('target').value=page.available.join(',');}
    syncOrder();if(persist() && legacy?.uncertain)sessionStorage.removeItem(LEGACY_STORE);render();
    status(uncertain?'有上一项结果待核对，当前已暂停。请点击“核对待确认结果”。':saved?.context===page.context?'已恢复本标签页自选方案，不会自动提交。请核对页面状态。':`已读取 ${rows.size} 个实验，请勾选实验并调整顺序。`,!!uncertain);
  }
  async function exportCalendar() {
    collect();const vm=findVM();
    if(!vm || typeof vm.setRequestUrl!=='function' || !vm.user?.username || vm.currentTerm?.id==null)throw new Error('无法读取网页的课表接口上下文，请刷新学校页面并登录后重试。');
    const duration=Number($('duration').value);
    if(!Number.isInteger(duration) || duration<1 || duration>1440)throw new Error('日历实验时长须为 1—1440 分钟的整数。');
    const initialContext=page.context,uid=String(vm.user.username),termId=vm.currentTerm.id,termName=text(vm.currentTerm.name);
    const controller=new AbortController();exportController=controller;busy=true;render();
    const deadline=setTimeout(()=>controller.abort(),45000);
    try {
      const authorization=[localStorage.getItem('token_type')||'',localStorage.getItem('Authorization')||''].join(' ').trim();
      const allowedOrigin=demo?location.origin:'http://10.203.16.55:8098';
      const client=createCalendarClient({urlFor:(path,params)=>vm.setRequestUrl({path,data:{...params}}),authorization,fetchImpl:window.fetch.bind(window),allowedOrigin,signal:controller.signal});
      const checkContext=()=>{if(controller.signal.aborted)throw new Error('日历导出已取消或超过45秒，未生成文件。');collect();if(page.context!==initialContext)throw new Error('导出期间账号、学期或课程切换，已停止导出。');};
      const {records,courseCount}=await readCalendarRecords(client,{uid,termId,checkContext,progress:(index,total)=>status(`正在只读获取已选课表：${index}/${total} 门课程…`)});
      let calendar;
      try{calendar=CalendarCore.serialize(records,{termName,accountScope:fingerprint(`${uid}|${termId}`),durationMinutes:duration});}
      catch{throw new Error('课表日期、时间或学期信息无效，未生成文件。请核对学校课表后重试。');}
      checkContext();
      const url=URL.createObjectURL(new Blob([calendar.value],{type:'text/calendar;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='zjuphylab.ics';document.body.append(link);
      try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
      status(`已生成当前学期已选课表：${courseCount} 门课程，${calendar.eventCount} 个事件。开始时间按中国标准时间处理，单次时长 ${duration} 分钟。`);log('日历已在浏览器本地生成，没有选课或退课请求');
    }catch(error){if(controller.signal.aborted)throw new Error('日历导出已取消或超时，未生成文件。');throw error;}
    finally{clearTimeout(deadline);exportController=null;busy=false;render();}
  }
  function action(fn){return async()=>{if(busy)return;try{await fn();}catch(e){status(e.message,true);log(e.message);render();}};}
  $('rescan').onclick=action(()=>{collect();if(page.context!==planContext){if(uncertain)throw new Error('页面已切换且有待核对结果，请先核对原教学班结果。');relock();resetPlan();}else{syncOrder();if(unlocked)unlockPass();persist();render();showValidation();}});
  $('reset').onclick=action(resetPlan);$('schedule').onclick=action(makePlan);$('unlock').onclick=action(startUnlock);$('relock').onclick=action(relock);
  $('apply').onclick=action(apply);$('undo').onclick=action(undoApply);$('run').onclick=action(runQueue);$('reconcile').onclick=action(reconcile);
  $('export-ics').onclick=action(exportCalendar);$('cancel-export').onclick=()=>exportController?.abort();
  $('target').onchange=()=>{persist();showValidation();};$('coverage').onchange=()=>{persist();showValidation();};
  $('pause').onclick=()=>{pauseRequested=true;status('已请求暂停，等待当前项结果后停止。');};
  $('close').onclick=()=>{if(busy)return;closed=true;observer.disconnect();relock();host.remove();};
  $('fold').onclick=()=>{const main=root.querySelector('main');main.hidden=!main.hidden;$('fold').textContent=main.hidden?'展开':'收起';};
  const observer=new MutationObserver(()=>{if(unlockQueued || closed)return;unlockQueued=true;queueMicrotask(()=>{unlockQueued=false;unlockPass();});});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
  const header=root.querySelector('header');header.onpointerdown=e=>{if(e.target.closest('button'))return;const rect=host.getBoundingClientRect(),dx=e.clientX-rect.left,dy=e.clientY-rect.top;header.setPointerCapture(e.pointerId);header.onpointermove=ev=>{host.style.right='auto';host.style.left=Math.max(0,Math.min(innerWidth-rect.width,ev.clientX-dx))+'px';host.style.top=Math.max(0,Math.min(innerHeight-50,ev.clientY-dy))+'px';};header.onpointerup=()=>{header.onpointermove=null;};};
  action(restoreDraft)();
})();
