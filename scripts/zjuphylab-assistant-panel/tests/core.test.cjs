'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {text,normalize,weeks,targetWeeks,maskOf,remaining,solve,fingerprint}=require('../zjuphylab-assistant-panel.user.js');

const item=(id,value,cost=0)=>({id,value,mask:maskOf(value),cost});

test('page text and week parsing normalize browser whitespace and fullwidth characters',()=>{
  assert.equal(text('  合成\n实验　Ａ  '),'合成 实验 A');
  assert.equal(normalize(' ▲ 合成 △\n 实验 Ａ '),'合成实验A');
  assert.deepEqual(weeks('１, ２,１８'),[1,2,18]);
});

test('editable target ranges produce a sorted deduplicated week set',()=>{
  assert.deepEqual(targetWeeks('18,1-3,2,5-6'),[1,2,3,5,6,18]);
  assert.deepEqual(targetWeeks('５８－６０,１'),[1,58,59,60]);
  for(const value of ['', '0-3','58-61','5-3','1,,3','1-2-3','week18'])assert.deepEqual(targetWeeks(value),[],value);
});

test('context fingerprints are deterministic and distinguish common account/term strings',()=>{
  assert.equal(fingerprint('demo-account-a'),fingerprint('demo-account-a'));
  assert.notEqual(fingerprint('demo-account-a'),fingerprint('demo-account-b'));
  assert.notEqual(fingerprint('demo-term-a|demo-course-a'),fingerprint('demo-term-b|demo-course-a'));
});

test('page-provided weeks above 14 remain valid, including the supported upper bound',()=>{
  assert.deepEqual(weeks('1,2,18,33,60'),[1,2,18,33,60]);
  assert.deepEqual(weeks('15,16'),[15,16]);
});

test('invalid or duplicate week values cannot become selectable options',()=>{
  for(const value of ['', '0','61','1,1','1,,2','1,2x','1.5','-1']){
    assert.deepEqual(weeks(value),[],value);
    assert.equal(maskOf(value),0n,value);
  }
});

test('BigInt week masks do not alias weeks 1 and 33 or truncate week 60',()=>{
  const expected=1n|(1n<<32n)|(1n<<59n);
  assert.equal(maskOf('1,33,60'),expected);
  assert.equal(maskOf('1')&maskOf('33'),0n);
  assert.equal(maskOf('15,16'),(1n<<14n)|(1n<<15n));
});

test('capacity labels distinguish available, full, over-capacity and unknown values',()=>{
  assert.equal(remaining('第18周 已选 3 人 / 容量 8 人'),5);
  assert.equal(remaining('第1,2周 已选8人 / 容量8人'),0);
  assert.equal(remaining('第2周 已选9人 / 容量8人'),-1);
  assert.equal(remaining('第3周，容量未知'),null);
});

test('sparse plans select only requested experiments without requiring full term coverage',()=>{
  const domains=[[item('lab-a','16',2),item('lab-a','18',0)],[item('lab-b','20',0)]];
  const result=solve(domains);
  assert.deepEqual(result.map(x=>[x.id,x.value]),[['lab-a','18'],['lab-b','20']]);
});

test('global scheduling moves an earlier preferred course when a later course has a fixed week',()=>{
  const result=solve([[item('ranked-first','2',0),item('ranked-first','4',1)],[item('ranked-second','2',0)]]);
  assert.deepEqual(result.map(x=>[x.id,x.value]),[['ranked-first','4'],['ranked-second','2']]);
});

test('a fixed enrolled domain retains its actual week and excludes overlapping alternatives',()=>{
  const result=solve([[item('enrolled','8',0)],[item('candidate','8',0),item('candidate','16',1)]]);
  assert.deepEqual(result.map(x=>[x.id,x.value]),[['enrolled','8'],['candidate','16']]);
});

test('a two-week experiment occupies both weeks and retains the original option value',()=>{
  const result=solve([[item('two-week','15,16',0)],[item('single-week','16',0),item('single-week','18',1)]]);
  assert.deepEqual(result.map(x=>x.value),['15,16','18']);
});

test('conflicting requested experiments and missing option domains have no solution',()=>{
  assert.equal(solve([[item('lab-a','18')],[item('lab-b','18')]]),null);
  assert.equal(solve([[item('lab-a','18')],[]]),null);
});

test('explicit coverage requires the complete requested mask, while sparse mode does not',()=>{
  const domains=[[item('lab-a','15,16',0)],[item('lab-b','18',0)]];
  const exactTarget=maskOf('15,16,18');
  assert.deepEqual(solve(domains,exactTarget).map(x=>x.value),['15,16','18']);
  assert.equal(solve(domains,maskOf('15,16,17,18')),null);
  assert.equal(solve(domains,maskOf('15,16')),null);
  assert.deepEqual(solve(domains).map(x=>x.value),['15,16','18']);
});

test('minimum total cost is used while preserving user course order in the returned plan',()=>{
  const result=solve([
    [item('course-first','1,2',0),item('course-first','3,4',3)],
    [item('course-second','1,2',2),item('course-second','3,4',9)]
  ],maskOf('1,2,3,4'));
  assert.deepEqual(result.map(x=>[x.id,x.value]),[['course-first','3,4'],['course-second','1,2']]);
});

test('unbounded user choices pause with a useful error at the state limit',()=>{
  const domains=Array.from({length:16},(_,index)=>[
    item(`course-${index}`,String(index*2+1)),
    item(`course-${index}`,String(index*2+2))
  ]);
  assert.throws(()=>solve(domains),/组合过多/);
});
