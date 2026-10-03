'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {createCalendarClient,readCalendarRecords}=require('../zjuphylab-assistant-panel.user.js');

const origin='http://10.203.16.55:8098';
const coursesPath='/api/courses/uid';
const recordsPath='/api/course/lab/students/full';
const context={uid:'test-account',termId:7};
const urlFor=(path,params={})=>{
  const url=new URL(`/lab-course${path}`,origin);
  for(const [name,value] of Object.entries(params))url.searchParams.set(name,String(value));
  return url.href;
};
const envelope=(data,code=200)=>new Response(JSON.stringify({code,data}),{
  status:200,headers:{'Content-Type':'application/json'}
});
const clientWith=(fetchImpl,overrides={})=>createCalendarClient({
  urlFor,authorization:'Bearer test-session',fetchImpl,allowedOrigin:origin,...overrides
});
const record=(overrides={})=>({
  id:31,dates:'2026-10-03',times:'08:00',lab_name:'示例实验',teacher_name:'示例教师',
  address:'示例实验楼',select_week:'3',...overrides
});

test('calendar requests use only GET with pinned paths, explicit token and no cookies, cache or redirects',async()=>{
  const calls=[];
  const client=clientWith(async(url,options)=>{
    calls.push({url,options});
    return envelope(url.includes(coursesPath)?[]:{content:[]});
  });
  await client.get(coursesPath,{...context,page:-1,size:-1});
  await client.get(recordsPath,{...context,courseId:11,page:-1,size:-1});
  assert.equal(calls.length,2);
  for(const call of calls) {
    const url=new URL(call.url);
    assert.equal(url.origin,origin);
    assert.ok([`/lab-course${coursesPath}`,`/lab-course${recordsPath}`].includes(url.pathname));
    assert.equal(url.searchParams.get('uid'),context.uid);
    assert.equal(url.searchParams.get('termId'),String(context.termId));
    assert.equal(url.searchParams.get('page'),'-1');
    assert.equal(url.searchParams.get('size'),'-1');
    assert.equal(call.options.method,'GET');
    assert.equal(call.options.redirect,'error');
    assert.equal(call.options.credentials,'omit');
    assert.equal(call.options.cache,'no-store');
    assert.equal(call.options.mode,'cors');
    assert.deepEqual(call.options.headers,{Authorization:'Bearer test-session'});
    assert.equal(call.options.body,undefined);
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(call.options.signal.aborted,false);
    assert.equal(call.url.includes('test-session'),false);
  }
});

test('unsafe endpoints are rejected before URL creation or network access',async()=>{
  let urls=0,requests=0;
  const client=clientWith(async()=>{requests++;return envelope([]);},{
    urlFor:()=>{urls++;return urlFor(coursesPath);}
  });
  for(const path of ['/api/login','/api/terms','/api/course/lab/select','/api/course/lab/students','/api/courses/uid?submit=1','https://other.invalid/api/courses/uid','/api/courses/uid/']) {
    await assert.rejects(client.get(path,{}),/只允许指定/);
  }
  assert.equal(urls,0);assert.equal(requests,0);
});

test('a signed URL cannot redirect the calendar client to another origin, path, userinfo or fragment',async()=>{
  let requests=0;
  const invalid=[
    `http://10.203.16.55:86/lab-course${coursesPath}`,
    `https://10.203.16.55:8098/lab-course${coursesPath}`,
    `http://other.invalid:8098/lab-course${coursesPath}`,
    `${origin}/lab-course/api/course/lab/select`,
    `${origin}/api/courses/uid`,
    `${origin}/lab-course${coursesPath}/`,
    `http://username:password@10.203.16.55:8098/lab-course${coursesPath}`,
    `${origin}/lab-course${coursesPath}#private-fragment`
  ];
  for(const href of invalid) {
    const client=clientWith(async()=>{requests++;return envelope([]);},{urlFor:()=>href});
    await assert.rejects(client.get(coursesPath,context),/接口地址与预期/);
  }
  assert.equal(requests,0);
});

test('missing or injected authorization never reaches the network',async()=>{
  let requests=0;
  for(const authorization of ['',null,undefined,'   ','Bearer test\r\nX-Header: value']) {
    const client=clientWith(async()=>{requests++;return envelope([]);},{authorization});
    await assert.rejects(client.get(coursesPath,context),/当前登录会话不可用/);
  }
  assert.equal(requests,0);
});

test('separate clients keep authorization isolated and never place it in returned records',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push(options.headers.Authorization);
    return envelope([{id:11,courseName:'示例课程'}]);
  };
  const first=clientWith(fetchImpl,{authorization:'Bearer first-private-session'});
  const second=clientWith(fetchImpl,{authorization:'Bearer second-private-session'});
  const results=await Promise.all([first.get(coursesPath,context),second.get(coursesPath,context)]);
  assert.deepEqual(calls,['Bearer first-private-session','Bearer second-private-session']);
  assert.doesNotMatch(JSON.stringify(results),/private-session|Authorization/);
  assert.deepEqual(Object.keys(first),['get']);
});

test('HTTP and business authorization errors are reported without upstream private messages',async()=>{
  for(const status of [401,403]) {
    await assert.rejects(clientWith(async()=>new Response('private-student-token',{status})).get(coursesPath,context),error=>{
      assert.match(error.message,/登录会话失效/);
      assert.doesNotMatch(error.message,/private-student-token/);
      return true;
    });
    await assert.rejects(clientWith(async()=>envelope('private-student-token',status)).get(coursesPath,context),/登录会话失效/);
  }
  for(const status of [302,404,500,503]) {
    await assert.rejects(clientWith(async()=>new Response('private-student-token',{status})).get(coursesPath,context),error=>{
      assert.match(error.message,/读取失败/);
      assert.doesNotMatch(error.message,/private-student-token/);
      return true;
    });
  }
});

test('invalid business envelopes stop collection without exposing their message or data',async()=>{
  for(const payload of [null,[],{},'private-upstream-value',{code:'200',data:[]},{code:500,data:'private-upstream-value',message:'private-student-token'}]) {
    const client=clientWith(async()=>new Response(JSON.stringify(payload),{status:200}));
    await assert.rejects(client.get(coursesPath,context),error=>{
      assert.match(error.message,/接口返回异常/);
      assert.doesNotMatch(error.message,/private-upstream|private-student-token/);
      return true;
    });
  }
});

test('raw network and JSON parser errors are sanitized before reaching panel logs',async()=>{
  const privateMessage='private-student private-phone private-session';
  const failures=[
    async()=>{throw new Error(privateMessage);},
    async()=>({status:200,ok:true,json:async()=>{throw new SyntaxError(privateMessage);}})
  ];
  for(const fetchImpl of failures) {
    await assert.rejects(clientWith(fetchImpl).get(coursesPath,context),error=>{
      assert.doesNotMatch(error.message,/private-student|private-phone|private-session/);
      assert.match(error.message,/课表|网络|接口/);
      return true;
    });
  }
});

test('an already aborted export never constructs a signed URL or sends a GET',async()=>{
  const controller=new AbortController();controller.abort();
  let requests=0,urls=0;
  const client=clientWith(async()=>{requests++;return envelope([]);},{
    signal:controller.signal,urlFor:(...args)=>{urls++;return urlFor(...args);}
  });
  await assert.rejects(client.get(coursesPath,context),/已取消/);
  assert.equal(requests,0);assert.equal(urls,0);
});

test('cancellation during a request aborts its fetch and discards a reply received afterward',async()=>{
  const controller=new AbortController();let requestSignal;
  const client=clientWith(async(_url,options)=>{
    requestSignal=options.signal;
    controller.abort();
    return envelope([{id:11,courseName:'示例课程'}]);
  },{signal:controller.signal});
  await assert.rejects(client.get(coursesPath,context),/已取消/);
  assert.equal(requestSignal.aborted,true);
});

test('all enrolled courses are aggregated with courseId and only calendar fields survive',async()=>{
  const calls=[],progress=[];
  const courses=[{id:11,courseName:'课程甲'},{id:'12',courseName:'课程乙'}];
  const privateFields={student_uid:'private-student-id',student_name:'private-student-name',phone:'private-phone',final_score:88,content:{private:'private-extra'},Authorization:'private-session'};
  const client={async get(path,params){
    calls.push({path,params});
    if(path===coursesPath)return courses;
    if(String(params.courseId)==='11')return {totalElements:1,content:[record({...privateFields})]};
    return {totalElements:1,content:[record({id:32,...privateFields,course_name:'接口课程名',course_lab_id:99})]};
  }};
  const result=await readCalendarRecords(client,{...context,progress:(index,total)=>progress.push([index,total])});
  assert.equal(result.courseCount,2);assert.equal(result.records.length,2);
  assert.deepEqual(calls,[
    {path:coursesPath,params:{...context,page:-1,size:-1}},
    {path:recordsPath,params:{...context,courseId:11,page:-1,size:-1}},
    {path:recordsPath,params:{...context,courseId:'12',page:-1,size:-1}}
  ]);
  assert.deepEqual(progress,[[1,2],[2,2]]);
  assert.equal(result.records[0].course_name,'课程甲');
  assert.equal(result.records[1].course_name,'接口课程名');
  assert.equal(result.records[0].course_lab_id,31);assert.equal(result.records[1].course_lab_id,99);
  const allowed=['dates','times','lab_name','teacher_name','address','select_week','course_name','course_id','course_lab_id'].sort();
  for(const item of result.records)assert.deepEqual(Object.keys(item).sort(),allowed);
  assert.doesNotMatch(JSON.stringify(result),/private-|student_|phone|final_score|Authorization/);
});

test('a later course failure rejects the whole export and stops before the next course',async()=>{
  const visited=[];
  const client={async get(path,params){
    if(path===coursesPath)return [{id:11,courseName:'甲'},{id:12,courseName:'乙'},{id:13,courseName:'丙'}];
    visited.push(params.courseId);
    if(params.courseId===12)throw new Error('第二门课读取失败');
    return {content:[record()]};
  }};
  await assert.rejects(readCalendarRecords(client,context),/第二门课读取失败/);
  assert.deepEqual(visited,[11,12]);
});

test('empty courses, malformed lists and no enrolled experiments cannot produce an empty calendar',async()=>{
  for(const courses of [[],null,{},[{courseName:'缺少编号'}],[{id:11,courseName:null}]]) {
    let labs=0;
    await assert.rejects(readCalendarRecords({async get(path){if(path===coursesPath)return courses;labs++;return {content:[]};}},context),/课程/);
    assert.equal(labs,0);
  }
  await assert.rejects(readCalendarRecords({async get(path){return path===coursesPath?[{id:11,courseName:'示例课程'}]:{content:[]};}},context),/没有已选实验/);
});

test('invalid course identifiers are rejected before any lab request',async()=>{
  for(const id of ['', '   ', NaN, Infinity, -Infinity, {}, null]) {
    let labs=0;
    await assert.rejects(readCalendarRecords({async get(path){if(path===coursesPath)return [{id,courseName:'示例课程'}];labs++;return {content:[record()]};}},context),/课程列表格式异常/);
    assert.equal(labs,0);
  }
});

test('malformed or truncated lab responses reject partial output for numeric or string totals',async()=>{
  for(const data of [null,{},[],{content:null},{content:[null]},{content:[[]]},{content:[record()],totalElements:2},{content:[record()],totalElements:'2'}]) {
    const client={async get(path){return path===coursesPath?[{id:11,courseName:'示例课程'}]:data;}};
    await assert.rejects(readCalendarRecords(client,context),/格式异常或不完整/);
  }
});

test('context changes before a request stop collection without touching the next account',async()=>{
  let reads=0;
  await assert.rejects(readCalendarRecords({async get(){reads++;return [];}},{...context,checkContext:()=>{throw new Error('账号已经切换');}}),/账号已经切换/);
  assert.equal(reads,0);
  let active=true;
  const calls=[];
  const client={async get(path){calls.push(path);return [{id:11,courseName:'示例课程'}];}};
  await assert.rejects(readCalendarRecords(client,{
    ...context,progress:()=>{active=false;},checkContext:()=>{if(!active)throw new Error('教学班已经切换');}
  }),/教学班已经切换/);
  assert.deepEqual(calls,[coursesPath]);
});

test('context changes while responses are pending reject the received records and stop further queries',async()=>{
  for(const switchAt of ['courses','first-lab','second-lab']) {
    let active=true;
    const calls=[];
    const client={async get(path,params){
      calls.push({path,courseId:params.courseId});
      if(path===coursesPath) {
        if(switchAt==='courses')active=false;
        return [{id:11,courseName:'甲'},{id:12,courseName:'乙'},{id:13,courseName:'丙'}];
      }
      if((switchAt==='first-lab' && params.courseId===11) || (switchAt==='second-lab' && params.courseId===12))active=false;
      return {content:[record()]};
    }};
    await assert.rejects(readCalendarRecords(client,{
      ...context,checkContext:()=>{if(!active)throw new Error('账号、学期或课程已经切换');}
    }),/已经切换/);
    assert.equal(calls.length,{'courses':1,'first-lab':2,'second-lab':3}[switchAt]);
    assert.equal(calls.some(call=>call.courseId===13),false);
  }
});
