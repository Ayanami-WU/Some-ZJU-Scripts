'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {execFileSync}=require('node:child_process');
const sourcePath=require.resolve('../zjuphylab-assistant-panel.user.js');
const {CalendarCore}=require(sourcePath);
const options={termName:'2026 秋冬',accountScope:'demo-account',durationMinutes:180,now:new Date('2026-10-03T04:05:06Z')};
const record={dates:'2026-10-03',times:'08:00',lab_name:'声速测量',teacher_name:'示例教师',address:'实验楼 301',week:'5',courseName:'大学物理实验'};
const serialize=(records=[record],overrides={})=>CalendarCore.serialize(records,{...options,...overrides});
const unfolded=value=>value.replace(/\r\n[ \t]/g,'');
const values=(value,name)=>unfolded(value).split('\r\n').filter(line=>line.startsWith(name+':')).map(line=>line.slice(name.length+1));

test('calendar has required headers, UTC event timestamps, metadata and CRLF terminator',()=>{
  const result=serialize();
  assert.equal(result.recordCount,1);assert.equal(result.eventCount,1);
  assert.ok(result.value.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:'));
  assert.match(result.value,/\r\nCALSCALE:GREGORIAN\r\n/);
  assert.ok(result.value.endsWith('END:VCALENDAR\r\n'));
  assert.equal(result.value.replace(/\r\n/g,'').includes('\n'),false);
  assert.equal(result.value.replace(/\r\n/g,'').includes('\r'),false);
  assert.deepEqual(values(result.value,'DTSTAMP'),['20261003T040506Z']);
  assert.deepEqual(values(result.value,'DTSTART'),['20261003T000000Z']);
  assert.deepEqual(values(result.value,'DTEND'),['20261003T030000Z']);
  assert.deepEqual(values(result.value,'SUMMARY'),['声速测量']);
  assert.deepEqual(values(result.value,'LOCATION'),['实验楼 301']);
  assert.deepEqual(values(result.value,'DESCRIPTION'),['课程：大学物理实验\\n教师：示例教师\\n学期：2026 秋冬\\n周次：5']);
  assert.doesNotMatch(result.value,/ORGANIZER|ATTENDEE|学分|credits/i);
});

test('comma-separated dates expand into chronologically ordered independent events',()=>{
  const result=serialize([{...record,dates:'2026-10-05, 2026-10-03'}]);
  assert.equal(result.recordCount,1);assert.equal(result.eventCount,2);
  assert.deepEqual(values(result.value,'DTSTART'),['20261003T000000Z','20261005T000000Z']);
  assert.equal(new Set(values(result.value,'UID')).size,2);
});

test('duration is supplied by caller and may carry the end into the next UTC day or year',()=>{
  assert.deepEqual(values(serialize([record],{durationMinutes:95}).value,'DTEND'),['20261003T013500Z']);
  const result=serialize([{...record,dates:'2026-12-31',times:'23:30'}],{durationMinutes:600});
  assert.deepEqual(values(result.value,'DTSTART'),['20261231T153000Z']);
  assert.deepEqual(values(result.value,'DTEND'),['20270101T013000Z']);
  assert.throws(()=>CalendarCore.serialize([record],{...options,durationMinutes:undefined}),/实验时长/);
  for(const durationMinutes of [0,-1,1.5,1441,Infinity,NaN,'180'])assert.throws(()=>serialize([record],{durationMinutes}),/实验时长/);
});

test('China UTC+8 conversion crosses local date boundaries and ignores process time zone',()=>{
  const result=serialize([{...record,dates:'2026-01-01',times:'00:01'}]);
  assert.deepEqual(values(result.value,'DTSTART'),['20251231T160100Z']);
  const snippet=`const {CalendarCore}=require(${JSON.stringify(sourcePath)});process.stdout.write(CalendarCore.serialize(${JSON.stringify([record])},{termName:'2026 秋冬',accountScope:'demo-account',durationMinutes:180,now:new Date('2026-10-03T04:05:06Z')}).value);`;
  for(const zone of ['UTC','Asia/Shanghai','America/New_York','Pacific/Honolulu']) {
    assert.equal(execFileSync(process.execPath,['-e',snippet],{env:{...process.env,TZ:zone},encoding:'utf8'}),serialize().value,zone);
  }
});

test('leap years are validated without JavaScript date rollover',()=>{
  for(const dates of ['2024-02-29','2000-02-29','0096-02-29'])assert.equal(serialize([{...record,dates}]).eventCount,1,dates);
  for(const dates of ['2026-02-29','1900-02-29','2100-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','2026-01-32','0000-01-01']) {
    assert.throws(()=>serialize([{...record,dates}]),/有效日期/,dates);
  }
});

test('malformed dates and times abort the whole export including one invalid record',()=>{
  for(const dates of ['2026-1-01','26-01-01','2026/01/01','2026-01-01,','2026-01-01,,2026-02-01','2026-01-01T00:00:00']) {
    assert.throws(()=>serialize([record,{...record,dates}]),/日期/,dates);
  }
  for(const times of ['24:00','08:60','8:00','08:0','08:00:00','08:00-11:00','-1:00','']) {
    assert.throws(()=>serialize([record,{...record,times}]),/时间/,times);
  }
});

test('TEXT escaping handles backslashes, commas, semicolons and every newline spelling',()=>{
  assert.equal(CalendarCore.escapeText('a\\b,c;d\r\ne\nf\rg'),'a\\\\b\\,c\\;d\\ne\\nf\\ng');
  const result=serialize([{...record,lab_name:'声速,测量;A\\B\r\n新行',address:'楼;房,间\\位置\n下一行'}]);
  assert.deepEqual(values(result.value,'SUMMARY'),['声速\\,测量\\;A\\\\B\\n新行']);
  assert.deepEqual(values(result.value,'LOCATION'),['楼\\;房\\,间\\\\位置\\n下一行']);
  assert.equal((result.value.match(/BEGIN:VEVENT/g)||[]).length,1);
});

test('UTF-8 folding includes continuation whitespace and preserves multibyte codepoints',()=>{
  const long='SUMMARY:'+('汉字😀é'.repeat(50));
  const folded=CalendarCore.foldLine(long);
  assert.equal(unfolded(folded),long);
  const lines=folded.split('\r\n');
  assert.ok(lines.length>1);
  assert.ok(lines.slice(1).every(line=>line.startsWith(' ')));
  for(const line of lines) {
    assert.ok(Buffer.byteLength(line,'utf8')<=75,line);
    assert.equal(Buffer.from(line,'utf8').toString('utf8'),line);
  }
  const result=serialize([{...record,lab_name:'汉😀'.repeat(100),teacher_name:'é'.repeat(100)}]);
  for(const line of result.value.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75,line);
  assert.deepEqual(values(result.value,'SUMMARY'),['汉😀'.repeat(100)]);
});

test('UIDs are stable across exports, record ordering, timestamps and duration changes',()=>{
  const first=serialize().value;
  assert.deepEqual(values(first,'UID'),values(serialize([record],{now:new Date('2026-11-01T00:00:00Z'),durationMinutes:90}).value,'UID'));
  assert.notDeepEqual(values(first,'UID'),values(serialize([record],{accountScope:'another-account'}).value,'UID'));
  assert.notDeepEqual(values(first,'UID'),values(serialize([record],{termName:'2027 春夏'}).value,'UID'));
  assert.doesNotMatch(values(first,'UID')[0],/demo-account/);
  const other={...record,dates:'2026-10-04'};
  assert.equal(serialize([record,other]).value,serialize([other,record]).value);
});

test('identical records and repeated dates deduplicate without hiding source record count',()=>{
  const result=serialize([record,{...record,dates:'2026-10-03,2026-10-03'}]);
  assert.equal(result.recordCount,2);assert.equal(result.eventCount,1);
  assert.equal(values(result.value,'UID').length,1);
  assert.equal(serialize([record,{...record,address:'另一地点'}]).eventCount,2);
});

test('empty input, missing required fields and invalid settings produce actionable errors',()=>{
  for(const records of [[],null,{},[null],[[]]])assert.throws(()=>serialize(records));
  for(const field of ['dates','times','lab_name'])assert.throws(()=>serialize([{...record,[field]:undefined}]),/不能为空/);
  assert.throws(()=>serialize([record],{accountScope:''}),/账号范围/);
  assert.throws(()=>serialize([record],{termName:''}),/当前学期/);
  assert.throws(()=>serialize([record],{now:new Date('invalid')}),/生成时间/);
  assert.throws(()=>serialize([{...record,address:'bad\0control'}]),/控制字符/);
  assert.throws(()=>serialize([{...record,teacher_name:{}}]),/格式无效/);
});

test('missing optional fields remain empty without adding people or course data',()=>{
  const result=serialize([{dates:'2026-10-03',times:'08:00',lab_name:'示例实验'}]);
  assert.deepEqual(values(result.value,'LOCATION'),['']);
  assert.deepEqual(values(result.value,'DESCRIPTION'),['课程：\\n教师：\\n学期：2026 秋冬\\n周次：']);
});

test('school select_week and course_name fields map weeks to dates only for matching counts',()=>{
  const paired={...record,dates:'2026-10-05,2026-10-03',select_week:'7,5',course_name:'大学物理实验（甲）'};
  const result=serialize([paired]);
  assert.deepEqual(values(result.value,'DESCRIPTION'),[
    '课程：大学物理实验（甲）\\n教师：示例教师\\n学期：2026 秋冬\\n周次：5',
    '课程：大学物理实验（甲）\\n教师：示例教师\\n学期：2026 秋冬\\n周次：7'
  ]);
  const unpaired=serialize([{...paired,select_week:'5,7,9'}]);
  assert.ok(values(unpaired.value,'DESCRIPTION').every(value=>value.endsWith('周次：5\\,7\\,9')));
});

test('event expansion cap rejects too many dates even when they would deduplicate',()=>{
  assert.throws(()=>serialize(Array.from({length:CalendarCore.MAX_EVENTS+1},()=>record)),/记录过多/);
  assert.throws(()=>serialize([{...record,dates:Array.from({length:3},()=>record.dates).join(',')}],{maxEvents:2}),/日期过多/);
  for(const maxEvents of [0,1.5,CalendarCore.MAX_EVENTS+1])assert.throws(()=>serialize([record],{maxEvents}),/上限/);
});
