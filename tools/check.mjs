#!/usr/bin/env node
// Copyright (c) 2026 Ayanami-WU. SPDX-License-Identifier: MIT
import {execFile} from 'node:child_process';
import {lstat, readFile, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const toolPath=fileURLToPath(import.meta.url);
const repositoryRoot=path.dirname(path.dirname(toolPath));
const excluded=new Set(['.git','node_modules','dist','coverage','.agents','.codex','.aws']);
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const validVersion=value=>semver.test(value) && (value.split('+')[0].split('-').slice(1).join('-').split('.').every(item=>!/^\d+$/.test(item) || item==='0' || !item.startsWith('0')));
const effects=new Set(['read-only','page-enhancement','page-write','business-submit']);
const secretRules=new Set(['private-key','github-token','cloud-key','credential-literal']);
const slash=value=>value.split(path.sep).join('/');
const lineAt=(source,index)=>source.slice(0,index).split('\n').length;
const clean=value=>String(value??'').replace(/`/g,'').trim();
const cleanLicense=value=>clean(value).split(/[（(]/)[0].trim();
const fixturePath=file=>/^(?:tools\/tests\/|scripts\/[^/]+\/tests\/)/.test(file);
const ignoredFile=file=>file.split('/').some(part=>excluded.has(part));
function nodeEnvironment() {
  const env={...process.env};
  // Nested node:test must not silently bypass an explicitly requested test run.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
}

export function parseUserscript(source) {
  const block=/^\uFEFF?\s*\/\/\s*==UserScript==\s*\r?\n([\s\S]*?)^\/\/\s*==\/UserScript==\s*$/m.exec(source);
  if(!block || source.slice(0,block.index).trim())return null;
  const values=new Map();
  for(const match of block[1].matchAll(/^\/\/\s*@([\w:-]+)(?:[ \t]+([^\r\n]*))?\r?$/gm)) {
    const name=match[1],value=(match[2]||'').trim();
    if(!values.has(name))values.set(name,[]);
    values.get(name).push({value,line:lineAt(source,block.index+block[0].indexOf(block[1])+match.index)});
  }
  return values;
}

function secretWaivers(source,file) {
  const waivers=new Map();
  if(!fixturePath(file) || !/\.(?:js|mjs|cjs|html)$/.test(file))return waivers;
  const record=(body,index)=>{
    const match=/^\s*repo-check:\s*allow-secret\s+([a-z-]+)\s+--\s+([^\r\n]+?)\s*$/.exec(body);
    if(!match || !secretRules.has(match[1]) || match[2].trim().length<6)return;
    const line=lineAt(source,index)-1;
    const prefix=source.slice(source.lastIndexOf('\n',index-1)+1,index).trim();
    const targetLine=prefix?line:line+1;
    if(!waivers.has(targetLine))waivers.set(targetLine,new Set());
    waivers.get(targetLine).add(match[1]);
  };
  // Conservative lexical reading: comments inside strings/templates/regex are
  // never waivers. Template interpolation comments are deliberately not waived.
  function template(start,end) {
    for(let i=start;i<end;i++) {
      if(source[i]==='\\'){i++;continue;}
      if(source[i]==='`')return i+1;
      if(source[i]==='$' && source[i+1]==='{')i=javascript(i+2,end,true,false)-1;
    }
    return end;
  }
  function javascript(start,end,stopAtBrace=false,collect=true) {
    let state='code',inClass=false,previous='',depth=1;
    for(let i=start;i<end;i++) {
      const c=source[i],next=source[i+1];
      if(state!=='code') {
        if(c==='\\'){i++;continue;}
        if(state==='regex') {
          if(c==='[')inClass=true;else if(c===']')inClass=false;
          else if(c==='/' && !inClass){state='code';previous=')';}
        }else if(c===state){state='code';previous=')';}
        continue;
      }
      if(c==='`'){i=template(i+1,end)-1;previous=')';continue;}
      if(c==='"' || c==="'"){state=c;continue;}
      if(c==='/' && next==='/') {
        const newline=source.indexOf('\n',i),stop=newline<0?end:Math.min(newline,end);
        if(collect)record(source.slice(i+2,stop),i);i=stop;continue;
      }
      if(c==='/' && next==='*'){const stop=source.indexOf('*/',i+2);i=stop<0?end:stop+1;continue;}
      if(c==='/' && (!previous || /[([{=,:;!?&|+\-*%~<>]/.test(previous) || /\b(?:return|throw|case|delete|typeof|void|yield|await)\s*$/.test(source.slice(Math.max(start,i-30),i)))){state='regex';inClass=false;continue;}
      if(stopAtBrace && c==='{')depth++;
      if(stopAtBrace && c==='}' && --depth===0)return i+1;
      if(!/\s/.test(c))previous=c;
    }
    return end;
  }
  if(!file.endsWith('.html'))javascript(0,source.length);
  else {
    for(let i=0;i<source.length;i++) {
      if(source.startsWith('<!--',i)) {
        const end=source.indexOf('-->',i+4);if(end<0)break;
        record(source.slice(i+4,end),i);i=end+2;continue;
      }
      if(source[i]!=='<')continue;
      if(/^<plaintext\b/i.test(source.slice(i)))break;
      const tag=/^<(script|textarea|style|title|xmp|iframe|noembed|noframes)\b/i.exec(source.slice(i));
      let end=i+1,quote='';
      while(end<source.length) {
        const c=source[end];if(quote){if(c===quote)quote='';}
        else if(c==='"' || c==="'")quote=c;else if(c==='>')break;
        end++;
      }
      if(tag) {
        const close=new RegExp(`</${tag[1]}\\s*>`,'ig');close.lastIndex=end+1;
        const match=close.exec(source);const stop=match?.index??source.length;
        if(tag[1].toLowerCase()==='script')javascript(end+1,stop);
        i=match?close.lastIndex-1:source.length;
      }else i=end;
    }
  }
  return waivers;
}

export function scanSensitiveText(source,file) {
  const issues=[],lines=source.split(/\r?\n/),waivers=secretWaivers(source,file);
  const patterns=[
    ['private-key',/-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
    ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{20,255})\b/],
    ['cloud-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ];
  const credential=/(?<![\w])(?:["']?(?:password|passwd|pwd|token|access_token|api_key|apiKey|secret|client_secret|authorization)["']?)\s*[:=]\s*(["'`])([^"'`\r\n]{8,})\1/gi;
  for(const [index,line] of lines.entries()) {
    const found=new Set(patterns.filter(([,pattern])=>pattern.test(line)).map(([rule])=>rule));
    for(const match of line.matchAll(credential)) {
      const value=match[2].replace(/^Bearer\s+/i,'');
      if(!/^(?:demo|example|fake|mock|sample|synthetic|test)[-_]/i.test(value) && !/^(?:TODO|CHANGEME|REPLACE_ME|<[^>]+>)$/i.test(value) && !value.includes('${'))found.add('credential-literal');
    }
    for(const rule of found)if(!waivers.get(index)?.has(rule))issues.push({level:'error',file,line:index+1,rule,message:'发现疑似敏感信息，请移除或为匿名测试数据添加精确的局部说明。'});
  }
  return issues;
}

function readmeFields(source) {
  const fields=new Map();
  for(const match of source.matchAll(/^\s*-\s*([^：:\r\n]+)[：:]\s*([^\r\n]*)$/gm))fields.set(match[1].trim(),{value:clean(match[2]),line:lineAt(source,match.index)});
  return fields;
}

function inspectPackage(name,entry,contents,report) {
  const directory=`scripts/${name}`,source=contents.get(entry)||'';
  const readmeFile=`${directory}/README.md`,changelogFile=`${directory}/CHANGELOG.md`,licenseFile=`${directory}/LICENSE`;
  for(const file of [readmeFile,changelogFile,licenseFile])if(!contents.get(file)?.trim())report('error',file,1,'package-file','缺少或无法读取必需说明文件。');
  const fields=readmeFields(contents.get(readmeFile)||'');
  for(const key of ['类型','版本','副作用等级','许可证'])if(!fields.get(key)?.value)report('error',readmeFile,1,'readme-field',`README 缺少“${key}”声明。`);
  const type=entry.endsWith('.user.js')?'userscript':'console-snippet';
  if(fields.has('类型') && fields.get('类型').value!==type)report('error',readmeFile,fields.get('类型').line,'script-type','README 类型与主入口文件不一致。');
  const effect=fields.get('副作用等级');
  if(effect && !effects.has(effect.value))report('error',readmeFile,effect.line,'side-effects','副作用等级不在仓库规范允许的范围内。');
  let sourceVersion,sourceLicense;
  if(type==='userscript') {
    const metadata=parseUserscript(source);
    if(!metadata)report('error',entry,1,'metadata-header','缺少位于文件开头的 Userscript 元数据头。');
    else {
      for(const key of ['name','namespace','version','description','author','match','grant','license'])if(!metadata.get(key)?.some(item=>item.value))report('error',entry,1,'metadata-required',`缺少必填 @${key}。`);
      const repeatable=new Set(['match','exclude','include','grant','connect','require','resource']);
      const knownFields=new Set(['name','namespace','version','description','author','match','exclude','include','grant','connect','require','resource','run-at','license','supportURL','updateURL','downloadURL','homepage','homepageURL','icon','iconURL','noframes']);
      for(const [key,items] of metadata) {
        const label=knownFields.has(key)?`@${key}`:'未知元数据字段';
        if(!repeatable.has(key) && items.length>1)report('error',entry,items[1].line,'metadata-duplicate',`单值字段 ${label} 重复。`);
        for(const item of items)if(!item.value && key!=='noframes')report('error',entry,item.line,'metadata-value',`${label} 不能为空。`);
      }
      sourceVersion=metadata.get('version')?.[0];sourceLicense=metadata.get('license')?.[0];
      const stage=metadata.get('run-at')?.[0];
      if(stage && !['document-start','document-body','document-end','document-idle','context-menu'].includes(stage.value))report('error',entry,stage.line,'metadata-value','@run-at 不是已支持的运行阶段。');
      for(const item of metadata.get('match')||[]) {
        if(item.value==='<all_urls>'){report('error',entry,item.line,'match-scope','@match 覆盖全部网站，请缩小范围。');continue;}
        const match=/^(https?|\*):\/\/([^/\s]+)(\/[^\s]*)$/.exec(item.value);
        if(!match){report('error',entry,item.line,'match-format','@match 必须包含协议、主机和页面路径。');continue;}
        const host=match[2];
        const validHost=/^(?:\*|(?:\*\.)?(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(?::\d{1,5})?|\[[0-9A-Fa-f:]+\](?::\d{1,5})?)$/.test(host);
        if(!validHost || /:(\d+)$/.test(host) && Number(host.match(/:(\d+)$/)[1])>65535)report('error',entry,item.line,'match-format','@match 主机或端口格式无效。');
        else if(host==='*')report('error',entry,item.line,'match-scope','@match 主机为全网通配，请缩小范围。');
        else if(host.startsWith('*.') || match[3]==='/*')report('warning',entry,item.line,'match-scope','@match 包含子域通配或全站路径，请确认并在 README 说明范围。');
      }
      for(const item of metadata.get('include')||[]) {
        const unrestricted=['*','<all_urls>','*://*/*','http://*/*','https://*/*'].includes(item.value);
        report(unrestricted?'error':'warning',entry,item.line,'match-scope',unrestricted?'@include 覆盖全部网站，请缩小范围。':'@include 会额外扩大运行范围，请人工核对其与 @match 的组合。');
      }
      const grants=metadata.get('grant')||[];
      if(grants.some(item=>item.value==='none') && grants.some(item=>item.value!=='none'))report('error',entry,grants[0].line,'permission','@grant none 不能与其他权限同时使用。');
      for(const item of grants)if(item.value && item.value!=='none')report('warning',entry,item.line,'permission','存在额外 @grant 权限，请在 README 说明必要性。');
      for(const key of ['require','connect','updateURL','downloadURL'])for(const item of metadata.get(key)||[])report('warning',entry,item.line,'permission',`存在 @${key} 外部资源或更新配置，请人工核对并记录。`);
    }
  }else {
    const header=source.match(/^(?:(?:\s*\/\/[^\r\n]*(?:\r?\n|$))|\s*\/\*[\s\S]*?\*\/)+/)?.[0]||'';
    const declaration=header.match(/\bScript type:\s*([^\r\n*]+)/);
    if(declaration?.[1].trim()!=='console-snippet')report('error',entry,1,'script-type','控制台片段缺少 Script type: console-snippet 声明。');
    const target=header.match(/\bTarget:\s*([^\r\n*]+)/)?.[1].trim();
    if(!target || !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(target))report('error',entry,1,'target','控制台片段缺少有效 Target 页面声明。');
    const declaredEffect=header.match(/\bSide effects:\s*([^\r\n*]+)/)?.[1].trim();
    if(!effects.has(declaredEffect) || effect && declaredEffect!==effect.value)report('error',entry,1,'side-effects','控制台 Side effects 与 README 副作用声明不一致。');
    const spdx=header.match(/SPDX-License-Identifier:\s*([^\r\n]+)/);
    if(spdx)sourceLicense={value:spdx[1].trim(),line:lineAt(source,spdx.index)};
    if(parseUserscript(source))report('error',entry,1,'script-type','控制台片段不能同时声明为 Userscript。');
  }
  const documentedLicense=fields.get('许可证');
  if(sourceLicense && /^(?:TODO|UNKNOWN)$/i.test(sourceLicense.value))report('error',entry,sourceLicense.line,'license','正式脚本许可证不能使用占位值。');
  if(sourceLicense && documentedLicense && cleanLicense(sourceLicense.value)!==cleanLicense(documentedLicense.value))report('error',readmeFile,documentedLicense.line,'license','README 与脚本许可证声明不一致。');
  if(cleanLicense(documentedLicense?.value)==='MIT' && contents.has(licenseFile) && (!/^\s*MIT License\b/.test(contents.get(licenseFile)) || !contents.get(licenseFile).includes('Permission is hereby granted')))report('error',licenseFile,1,'license','LICENSE 内容与 MIT 声明不一致。');

  const versions=[];
  if(sourceVersion)versions.push({file:entry,...sourceVersion});
  const documentedVersion=fields.get('版本');
  if(documentedVersion)versions.push({file:readmeFile,...documentedVersion});
  const latest=/^##\s+v?([^\s\r\n]+)\s*$/m.exec(contents.get(changelogFile)||'');
  if(latest)versions.push({file:changelogFile,value:latest[1],line:lineAt(contents.get(changelogFile),latest.index)});
  else if(contents.has(changelogFile))report('error',changelogFile,1,'version-format','CHANGELOG 缺少最新版本标题。');
  for(const match of source.matchAll(/\bVERSION\s*=\s*(['"])([^'"\r\n]+)\1/g))versions.push({file:entry,value:match[2],line:lineAt(source,match.index)});
  const expected=sourceVersion?.value || documentedVersion?.value;
  for(const version of versions) {
    if(!validVersion(version.value))report('error',version.file,version.line,'version-format','版本号不是有效的语义化版本。');
    else if(expected && version.value!==expected)report('error',version.file,version.line,'version-mismatch','脚本、README 和 CHANGELOG 的版本不一致。');
  }
  return {name,entry,type};
}

async function repositoryFiles(root,report) {
  let candidates;
  try {
    const top=await execute('git',['rev-parse','--show-toplevel'],{cwd:root,timeout:10000});
    if(await realpath(top.stdout.trim())===root) {
      const result=await execute('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,timeout:10000,maxBuffer:5*1024*1024});
      candidates=[...new Set(result.stdout.split('\0').filter(Boolean))];
    }
  }catch{/* Temporary fixtures and source exports need no Git repository. */}
  if(!candidates) {
    candidates=[];
    async function walk(relative='') {
      for(const item of await readdir(path.join(root,relative),{withFileTypes:true})) {
        const file=slash(path.join(relative,item.name));
        if(excluded.has(item.name) || item.name==='.env' || item.name.startsWith('.env.') && item.name!=='.env.example')continue;
        if(item.isDirectory())await walk(file);else candidates.push(file);
      }
    }
    await walk();
  }
  const contents=new Map();
  for(const file of candidates.sort()) {
    if(ignoredFile(file))continue;
    const basename=path.basename(file);
    if(/^\.env(?:\.|$)/.test(basename) && basename!=='.env.example'){report('error',file,1,'credential-file','仓库含本地环境配置文件，已跳过内容读取；请使用不含真实凭据的示例文件。');continue;}
    const absolute=path.resolve(root,file);
    if(!absolute.startsWith(root+path.sep)){report('error',file,1,'symlink','文件路径超出仓库范围，已跳过读取。');continue;}
    try {
      const stat=await lstat(absolute),resolved=await realpath(absolute);
      if(stat.isSymbolicLink() || resolved!==absolute){report('error',file,1,'symlink','符号链接不参与检查，已跳过读取。');continue;}
      if(!stat.isFile())continue;
      if(stat.size>2*1024*1024){report('warning',file,1,'file-size','文件超过 2 MiB，已跳过内容检查。');continue;}
      const bytes=await readFile(absolute);if(bytes.includes(0))continue;
      const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);contents.set(slash(file),source);
    }catch{report('error',file,1,'file-read','无法读取仓库文本文件。');}
  }
  return contents;
}

export async function checkRepository(root,{runTests=false}={}) {
  root=await realpath(root);
  const issues=[],packages=[],syntaxFiles=[],testFiles=[];
  const report=(level,file,line,rule,message)=>issues.push({level,file:slash(file),line,rule,message});
  const contents=await repositoryFiles(root,report);
  let directories=[];
  try {
    const scripts=path.join(root,'scripts'),stat=await lstat(scripts);
    if(stat.isSymbolicLink() || await realpath(scripts)!==scripts)report('error','scripts',1,'symlink','scripts 必须是仓库内的实际目录，已跳过读取。');
    else directories=await readdir(scripts,{withFileTypes:true});
  }
  catch{report('error','scripts',1,'package-file','缺少 scripts 目录。');}
  for(const directory of directories.sort((a,b)=>a.name.localeCompare(b.name))) {
    const packageDirectory=`scripts/${directory.name}`;
    if(directory.isSymbolicLink()){report('error',packageDirectory,1,'symlink','脚本目录不能是符号链接。');continue;}
    if(!directory.isDirectory())continue;
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(directory.name))report('error',packageDirectory,1,'package-name','脚本目录名称应使用小写字母、数字和短横线。');
    const entries=[`${packageDirectory}/${directory.name}.user.js`,`${packageDirectory}/${directory.name}.js`].filter(file=>contents.has(file));
    if(entries.length!==1){report('error',packageDirectory,1,'package-entry','每个脚本目录必须恰好有一个与目录同名的 .user.js 或 .js 主入口。');continue;}
    packages.push(inspectPackage(directory.name,entries[0],contents,report));
  }
  if(!directories.length)report('error','scripts',1,'package-entry','没有找到脚本目录。');
  for(const [file,source] of contents) {
    issues.push(...scanSensitiveText(source,file));
    if(/^(?:scripts|tools|templates)\//.test(file) && /\.(?:js|mjs|cjs)$/.test(file))syntaxFiles.push(file);
    if(/^scripts\/[^/]+\/tests\/[^/]+\.test\.cjs$/.test(file) || /^tools\/tests\/[^/]+\.test\.mjs$/.test(file))testFiles.push(file);
  }
  for(const file of syntaxFiles) {
    try{await execute(process.execPath,['--check',path.join(root,file)],{cwd:root,env:nodeEnvironment(),timeout:15000,maxBuffer:1024*1024});}
    catch(error){
      // Node syntax diagnostics contain the original source line: never print them.
      const escaped=path.join(root,file).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const location=new RegExp(escaped+':(\\d+)').exec(String(error.stderr||''));
      report('error',file,Number(location?.[1])||1,'syntax','JavaScript 语法检查失败，请在本地查看该文件。');
    }
  }
  let testCount=0,testsRan=false;
  if(runTests && !issues.some(issue=>issue.level==='error')) {
    if(testFiles.length) {
      testsRan=true;
      try {
        const result=await execute(process.execPath,['--test',...testFiles.map(file=>path.join(root,file))],{cwd:root,env:nodeEnvironment(),timeout:120000,maxBuffer:5*1024*1024});
        testCount=Number(result.stdout.match(/^(?:#|ℹ)\s+tests\s+(\d+)/m)?.[1])||0;
      }catch{report('error','tests',1,'test-failure','离线 Node 测试失败或超时；为避免回显测试数据，详细输出未打印。');}
    }else report('warning','tests',1,'test-failure','没有发现符合命名约定的离线测试。');
  }
  return {issues,packages,syntaxFiles,testFiles,testsRan,testCount};
}

async function main(args) {
  const flags=new Set(args),known=new Set(['--test','--strict','--help']);
  if([...flags].some(flag=>!known.has(flag))){process.stderr.write('未知参数，请使用 --help 查看用法。\n');process.exitCode=2;return;}
  if(flags.has('--help')) {
    process.stdout.write('用法：node tools/check.mjs [--test] [--strict]\n默认进行只读静态检查。\n--test    静态检查无错误后运行已有离线 Node 测试\n--strict  警告也导致非零退出\n--help    显示本说明\n');return;
  }
  try {
    const result=await checkRepository(repositoryRoot,{runTests:flags.has('--test')});
    for(const issue of result.issues)process.stdout.write(`${issue.level==='error'?'错误':'警告'} ${JSON.stringify(issue.file)}:${issue.line} [${issue.rule}] ${issue.message}\n`);
    const errors=result.issues.filter(issue=>issue.level==='error').length,warnings=result.issues.filter(issue=>issue.level==='warning').length;
    const staticIssues=result.issues.filter(issue=>issue.rule!=='test-failure'),staticErrors=staticIssues.filter(issue=>issue.level==='error').length,staticWarnings=staticIssues.filter(issue=>issue.level==='warning').length;
    process.stdout.write(`静态检查：${result.packages.length} 个脚本，${result.syntaxFiles.length} 个 JavaScript 文件；${staticErrors} 个错误，${staticWarnings} 个警告。\n`);
    if(result.testsRan)process.stdout.write(`离线测试：${result.testFiles.length} 个文件${result.issues.some(issue=>issue.rule==='test-failure' && issue.level==='error')?'失败':'通过'}${result.testCount?`，共 ${result.testCount} 项`:''}。\n`);
    else if(flags.has('--test') && staticErrors)process.stdout.write('存在静态错误，未执行离线测试。\n');
    process.exitCode=errors || flags.has('--strict') && warnings?1:0;
  }catch{process.stderr.write('无法完成仓库检查，请确认运行目录及文件权限。\n');process.exitCode=1;}
}

if(process.argv[1] && path.resolve(process.argv[1])===toolPath)await main(process.argv.slice(2));
