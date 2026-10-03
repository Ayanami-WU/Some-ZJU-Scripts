import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {access, mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {checkRepository} from '../check.mjs';

const slug='demo-helper';
const packageRoot=`scripts/${slug}`;
const entry=`${packageRoot}/${slug}.user.js`;
const mitLicense=`MIT License

Copyright (c) 2026 Anonymous Fixture

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
const userscript=`// ==UserScript==
// @name         Anonymous fixture helper
// @namespace    https://example.test/anonymous-fixture
// @version      1.0.0
// @description  Anonymous test-only browser helper
// @author       Anonymous Fixture
// @match        https://example.test/specific/page*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @supportURL   https://example.test/issues
// ==/UserScript==
(() => {
  'use strict';
  const VERSION='1.0.0';
  throw new Error('Fixture entry must never be executed by validation');
})();
`;
const readme=`# Anonymous fixture helper

- 类型：userscript
- 目标页面：https://example.test/specific/page
- 版本：1.0.0
- 副作用等级：page-enhancement
- 当前状态：experimental
- 许可证：MIT（见本目录 LICENSE）
`;
const changelog='# 更新记录\n\n## 1.0.0\n\n- Anonymous initial fixture.\n';
const command=promisify(execFile);

async function git(root,args) {
  const env={...process.env};
  for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
  env.GIT_CONFIG_NOSYSTEM='1';env.GIT_CONFIG_GLOBAL='/dev/null';env.GIT_CONFIG_SYSTEM='/dev/null';
  return command('git',args,{cwd:root,env,timeout:10000});
}
async function initializeGit(root,t) {
  try{await git(root,['init','--quiet']);return true;}
  catch(error){if(error.code==='ENOENT'){t.skip('Git is not installed.');return false;}throw error;}
}

async function write(root,file,value) {
  const target=path.join(root,file);
  await mkdir(path.dirname(target),{recursive:true});
  await writeFile(target,value,'utf8');
}
async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'zju-repo-check-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await write(root,entry,userscript);
  await write(root,`${packageRoot}/README.md`,readme);
  await write(root,`${packageRoot}/CHANGELOG.md`,changelog);
  await write(root,`${packageRoot}/LICENSE`,mitLicense);
  return root;
}
const inspect=root=>checkRepository(root,{runTests:false});
const matchesFile=(issue,file)=>issue.file===file || String(issue.file).endsWith('/'+file);
const errors=result=>result.issues.filter(issue=>issue.level==='error');
const warnings=result=>result.issues.filter(issue=>issue.level==='warning');
const forFile=(result,file)=>result.issues.filter(issue=>matchesFile(issue,file));
function assertErrorFor(result,file) {
  assert.ok(forFile(result,file).some(issue=>issue.level==='error'),JSON.stringify(result.issues));
}

test('valid userscript package passes without executing the browser entry',async t=>{
  const root=await fixture(t),result=await inspect(root);
  assert.deepEqual(errors(result),[]);
  assert.equal(result.packages.length,1);
  assert.ok(Array.isArray(result.syntaxFiles));
  assert.ok(Array.isArray(result.testFiles));
  assert.ok(result.syntaxFiles.some(file=>String(file).endsWith(entry)));
  assert.deepEqual(result.testFiles,[]);
});

test('each package requires its exact entry name and README, CHANGELOG and LICENSE',async t=>{
  for(const missing of [`${slug}.user.js`,'README.md','CHANGELOG.md','LICENSE']) {
    const root=await fixture(t);
    await rm(path.join(root,packageRoot,missing));
    if(missing.endsWith('.user.js'))await write(root,`${packageRoot}/wrong-name.user.js`,userscript);
    const result=await inspect(root);
    assert.ok(errors(result).length>0,missing);
    assert.ok(result.issues.some(issue=>String(issue.file).includes(packageRoot)),missing);
  }
});

test('required userscript metadata cannot be omitted',async t=>{
  for(const field of ['name','namespace','version','description','author','match','grant','license']) {
    const root=await fixture(t);
    await write(root,entry,userscript.replace(new RegExp(`^// @${field}\\s+.*\\n`,'m'),''));
    const result=await inspect(root);
    assertErrorFor(result,entry);
    assert.ok(forFile(result,entry).some(issue=>issue.message.includes(field)),field);
  }
});

test('missing metadata headers and duplicated singleton fields are errors',async t=>{
  const root=await fixture(t);
  await write(root,entry,"const VERSION='1.0.0';\n");
  assert.ok(forFile(await inspect(root),entry).some(issue=>issue.rule==='metadata-header' && issue.level==='error'));
  await write(root,entry,userscript.replace('// @version      1.0.0','// @version      1.0.0\n// @version      1.0.0'));
  assert.ok(forFile(await inspect(root),entry).some(issue=>issue.rule==='metadata-duplicate' && issue.level==='error'));
});

test('unknown metadata keys never expose a synthetic token in duplicate or empty-value diagnostics',async t=>{
  const root=await fixture(t),token=['gh','p_'].join('')+'P'.repeat(36);
  await write(root,entry,userscript.replace('// @run-at',`// @${token}\n// @${token}\n// @run-at`));
  const result=await inspect(root);
  assert.ok(forFile(result,entry).some(issue=>issue.rule==='metadata-duplicate'));
  assert.ok(forFile(result,entry).some(issue=>issue.rule==='metadata-value'));
  assert.ok(forFile(result,entry).some(issue=>issue.rule==='github-token'));
  assert.equal(JSON.stringify(result.issues).includes(token),false);
});

test('README package declarations are required',async t=>{
  for(const field of ['类型','版本','副作用等级','许可证']) {
    const root=await fixture(t);
    await write(root,`${packageRoot}/README.md`,readme.split('\n').filter(line=>!line.startsWith(`- ${field}：`)).join('\n'));
    const result=await inspect(root);
    assert.ok(forFile(result,`${packageRoot}/README.md`).some(issue=>issue.rule==='readme-field' && issue.level==='error'),field);
  }
});

test('run-at is optional but must have a valid value when supplied',async t=>{
  const root=await fixture(t);
  await write(root,entry,userscript.replace(/^\/\/ @run-at\s+.*\n/m,''));
  assert.deepEqual(errors(await inspect(root)),[]);
  await write(root,entry,userscript.replace('document-idle','invalid-run-stage'));
  assertErrorFor(await inspect(root),entry);
});

test('runtime, README and CHANGELOG versions must agree with userscript metadata',async t=>{
  for(const [file,content] of [
    [entry,userscript.replace("const VERSION='1.0.0'","const VERSION='1.1.0'")],
    [`${packageRoot}/README.md`,readme.replace('版本：1.0.0','版本：1.1.0')],
    [`${packageRoot}/CHANGELOG.md`,changelog.replace('## 1.0.0','## 1.1.0')]
  ]) {
    const root=await fixture(t);await write(root,file,content);
    const result=await inspect(root);
    assert.ok(errors(result).length>0,file);
    assert.ok(result.issues.some(issue=>matchesFile(issue,file)),file);
  }
});

test('a runtime VERSION constant is optional',async t=>{
  const root=await fixture(t);
  await write(root,entry,userscript.replace("  const VERSION='1.0.0';\n",''));
  const result=await inspect(root);
  assert.deepEqual(errors(result),[]);
  assert.ok(!result.issues.some(issue=>issue.rule.startsWith('version-')));
});

test('broad domain matches and privileged grants produce warnings',async t=>{
  const root=await fixture(t);
  await write(root,entry,userscript.replace('https://example.test/specific/page*','https://*.zju.edu.cn/*').replace('@grant        none','@grant        GM_xmlhttpRequest'));
  const result=await inspect(root);
  assert.equal(errors(result).length,0,JSON.stringify(result.issues));
  assert.ok(warnings(result).length>=2,JSON.stringify(result.issues));
  assert.ok(forFile(result,entry).some(issue=>issue.level==='warning' && /match|匹配/i.test(issue.message)));
  assert.ok(forFile(result,entry).some(issue=>issue.level==='warning' && /grant|权限/i.test(issue.message)));
});

test('unrestricted host matches are errors',async t=>{
  for(const match of ['*://*/*','<all_urls>']) {
    const root=await fixture(t);
    await write(root,entry,userscript.replace('https://example.test/specific/page*',match));
    const result=await inspect(root);
    assert.ok(forFile(result,entry).some(issue=>issue.level==='error' && issue.rule==='match-scope'),match);
  }
});

test('malformed versions and URL match syntax are rejected',async t=>{
  const root=await fixture(t);
  await write(root,entry,userscript.replace('@version      1.0.0','@version      latest'));
  assert.ok(forFile(await inspect(root),entry).some(issue=>issue.rule==='version-format' && issue.level==='error'));
  await write(root,entry,userscript.replace('https://example.test/specific/page*','example.test/page'));
  assert.ok(forFile(await inspect(root),entry).some(issue=>issue.rule==='match-format' && issue.level==='error'));
});

test('semantic version prereleases allow identifiers but reject numeric leading zeros',async t=>{
  const root=await fixture(t);
  for(const version of ['1.0.0-alpha.1+build.007','1.0.0-alpha.01']) {
    await write(root,entry,userscript.replaceAll('1.0.0',version));
    await write(root,`${packageRoot}/README.md`,readme.replaceAll('1.0.0',version));
    await write(root,`${packageRoot}/CHANGELOG.md`,changelog.replaceAll('1.0.0',version));
    const result=await inspect(root);
    if(version==='1.0.0-alpha.01')assert.ok(errors(result).some(issue=>issue.rule==='version-format'));
    else assert.deepEqual(errors(result),[]);
  }
});

test('an unrestricted include cannot bypass an otherwise narrow match',async t=>{
  for(const include of ['*','*://*/*','<all_urls>']) {
    const root=await fixture(t);
    await write(root,entry,userscript.replace('// @run-at',`// @include      ${include}\n// @run-at`));
    assert.ok(forFile(await inspect(root),entry).some(issue=>issue.rule==='match-scope' && issue.level==='error' && issue.message.includes('@include')),include);
  }
});

test('regular-expression includes are explicit scope warnings',async t=>{
  const root=await fixture(t),include='/^https:\\/\\/example\\.test\\/specific\\//';
  await write(root,entry,userscript.replace('// @run-at',`// @include      ${include}\n// @run-at`));
  const result=await inspect(root);
  assert.deepEqual(errors(result),[]);
  assert.ok(forFile(result,entry).some(issue=>issue.rule==='match-scope' && issue.level==='warning' && issue.message.includes('@include')));
});

test('campus URLs with a port and a specific path wildcard remain valid',async t=>{
  const root=await fixture(t),target='http://10.203.16.55:86/lab-course/selectCourse*';
  await write(root,entry,userscript.replace('https://example.test/specific/page*',target));
  await write(root,`${packageRoot}/README.md`,readme.replace('https://example.test/specific/page',target));
  assert.deepEqual(errors(await inspect(root)),[]);
});

test('console snippets require type, target and side effects and validate optional SPDX',async t=>{
  const consoleEntry=`${packageRoot}/${slug}.js`;
  const consoleSource=`// SPDX-License-Identifier: MIT
/**
 * Script type: console-snippet
 * Target: https://example.test/specific/page
 * Side effects: page-enhancement
 */
(() => { const VERSION='1.0.0'; throw new Error('Do not execute the fixture'); })();
`;
  const root=await fixture(t);
  await rm(path.join(root,entry));
  await write(root,consoleEntry,consoleSource);
  await write(root,`${packageRoot}/README.md`,readme.replace('类型：userscript','类型：console-snippet'));
  assert.deepEqual(errors(await inspect(root)),[]);
  for(const marker of ['Script type:','Target:','Side effects:']) {
    await write(root,consoleEntry,consoleSource.split('\n').filter(line=>!line.includes(marker)).join('\n'));
    assertErrorFor(await inspect(root),consoleEntry);
  }
  await write(root,consoleEntry,consoleSource.split('\n').filter(line=>!line.includes('SPDX-License-Identifier:')).join('\n'));
  assert.deepEqual(errors(await inspect(root)),[]);
  await write(root,consoleEntry,consoleSource.replace('SPDX-License-Identifier: MIT','SPDX-License-Identifier: Apache-2.0'));
  assert.ok(errors(await inspect(root)).some(issue=>issue.rule==='license'));
});

test('documented license must match the source declaration',async t=>{
  const root=await fixture(t);
  await write(root,`${packageRoot}/README.md`,readme.replace('许可证：MIT','许可证：Apache-2.0'));
  const result=await inspect(root);
  assert.ok(errors(result).length>0,JSON.stringify(result.issues));
  assert.ok(result.issues.some(issue=>/license|许可/i.test(issue.rule+' '+issue.message)));
});

test('declared MIT packages require the expected MIT permission text',async t=>{
  const root=await fixture(t),file=`${packageRoot}/LICENSE`;
  await write(root,file,'Different license text with no MIT permission grant.\n');
  assert.ok(forFile(await inspect(root),file).some(issue=>issue.rule==='license' && issue.level==='error'));
});

test('package entry ambiguity and README script type mismatches are errors',async t=>{
  const root=await fixture(t);
  await write(root,`${packageRoot}/${slug}.js`,'// SPDX-License-Identifier: MIT\nconst VERSION="1.0.0";\n');
  assert.ok(errors(await inspect(root)).some(issue=>issue.rule==='package-entry'));
  await rm(path.join(root,packageRoot,`${slug}.js`));
  await write(root,`${packageRoot}/README.md`,readme.replace('类型：userscript','类型：console-snippet'));
  assert.ok(errors(await inspect(root)).some(issue=>issue.rule==='script-type'));
});

test('grant none cannot be combined with an additional grant',async t=>{
  const root=await fixture(t);
  await write(root,entry,userscript.replace('// @grant        none','// @grant        none\n// @grant        GM_xmlhttpRequest'));
  assert.ok(forFile(await inspect(root),entry).some(issue=>issue.level==='error' && /grant|权限/i.test(issue.message)));
});

test('syntax checking includes JavaScript variants under scripts, tools and templates',async t=>{
  const root=await fixture(t);
  for(const file of [`${packageRoot}/helper.cjs`,'tools/helper.mjs','templates/helper.js'])await write(root,file,'const valid = true;\n');
  const valid=await inspect(root);
  assert.deepEqual(errors(valid),[]);
  for(const file of [`${packageRoot}/helper.cjs`,'tools/helper.mjs','templates/helper.js'])assert.ok(valid.syntaxFiles.some(candidate=>String(candidate).endsWith(file)),file);
  await write(root,'tools/broken.mjs','const malformed = ;\n');
  const invalid=await inspect(root);
  assertErrorFor(invalid,'tools/broken.mjs');
  assert.ok(forFile(invalid,'tools/broken.mjs').some(issue=>/syntax|语法/i.test(issue.rule+' '+issue.message)));
});

test('test discovery accepts only documented package and tools test patterns',async t=>{
  const root=await fixture(t);
  const accepted=[`${packageRoot}/tests/helper.test.cjs`,'tools/tests/helper.test.mjs'];
  const excluded=[`${packageRoot}/helper.test.cjs`,`${packageRoot}/tests/helper.test.js`,`${packageRoot}/tests/helper.cjs`,`${packageRoot}/tests/nested/helper.test.cjs`,'tools/helper.test.mjs','tools/tests/helper.test.cjs','tools/tests/nested/helper.test.mjs'];
  for(const file of [...accepted,...excluded])await write(root,file,"throw new Error('Discovery must not execute fixture tests by default');\n");
  const result=await checkRepository(root);
  assert.deepEqual(errors(result),[]);
  assert.deepEqual([...result.testFiles].sort(),accepted.sort());
});

test('dependency, Git and generated output directories are skipped',async t=>{
  const root=await fixture(t);
  for(const file of [`${packageRoot}/node_modules/vendor.js`,'tools/dist/bundle.mjs','templates/.git/ignored.cjs'])await write(root,file,'const malformed = ;\n');
  const result=await inspect(root);
  assert.deepEqual(errors(result),[]);
  assert.equal(result.syntaxFiles.length,1);
});

test('file and directory symlinks are reported without following external fixture paths',async t=>{
  const root=await fixture(t),outside=await mkdtemp(path.join(tmpdir(),'zju-check-outside-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  await write(outside,'external.js','const malformed = ;\n');
  await mkdir(path.join(root,'tools'),{recursive:true});
  await symlink(path.join(outside,'external.js'),path.join(root,'tools/linked.js'));
  await symlink(outside,path.join(root,'scripts/linked-directory'));
  const result=await inspect(root);
  for(const file of ['tools/linked.js','scripts/linked-directory'])assert.ok(forFile(result,file).some(issue=>issue.rule==='symlink' && issue.level==='error'),file);
  assert.ok(!result.syntaxFiles.some(file=>String(file).includes('linked')));
  assert.ok(!result.issues.some(issue=>issue.rule==='syntax'));
});

test('a symlinked top-level scripts directory is rejected before reading external package names',async t=>{
  const root=await fixture(t),outside=await mkdtemp(path.join(tmpdir(),'zju-check-external-packages-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  await mkdir(path.join(outside,'external-package'));
  await rm(path.join(root,'scripts'),{recursive:true,force:true});
  await symlink(outside,path.join(root,'scripts'));
  const result=await inspect(root);
  assert.ok(forFile(result,'scripts').some(issue=>issue.rule==='symlink' && issue.level==='error'));
  assert.ok(!result.issues.some(issue=>String(issue.file).startsWith('scripts/external-package')));
  assert.deepEqual(result.packages,[]);
});

const githubPrefix=['gh','p_'].join('');
const cloudPrefix=['AK','IA'].join('');
const syntheticSecrets=()=>[
  {rule:'private-key',value:'-----BEGIN '+'PRIVATE KEY-----',source:`const key = \`${'-----BEGIN '+'PRIVATE KEY-----'}\nAAAAAAAAAAAAAAAA\n${'-----END '+'PRIVATE KEY-----'}\`;`},
  {rule:'github-token',value:githubPrefix+'A'.repeat(36),source:`const access = '${githubPrefix+'A'.repeat(36)}';`},
  {rule:'cloud-key',value:cloudPrefix+'F'.repeat(16),source:`const access = '${cloudPrefix+'F'.repeat(16)}';`},
  // repo-check: allow-secret credential-literal -- Anonymous literal verifies the scanner without real credentials.
  {rule:'credential-literal',value:'fixture-synthetic-password-00000',source:"const password = 'fixture-synthetic-password-00000';"}
];

test('secret-shaped synthetic literals are reported without revealing their values',async t=>{
  const root=await fixture(t),secrets=syntheticSecrets();
  for(const secret of secrets)await write(root,`tools/${secret.rule}.js`,secret.source+'\n');
  const result=await inspect(root),diagnostics=JSON.stringify(result.issues);
  for(const secret of secrets) {
    const issue=result.issues.find(issue=>issue.rule===secret.rule && matchesFile(issue,`tools/${secret.rule}.js`));
    assert.ok(issue,secret.rule);assert.equal(issue.level,'error');assert.ok(Number.isInteger(issue.line) && issue.line>0);
    assert.equal(diagnostics.includes(secret.value),false,secret.rule);
  }
});

test('fixture prefixes do not suppress credential scanning across files',async t=>{
  const root=await fixture(t),file='tools/fixture-example.js';
  // repo-check: allow-secret credential-literal -- Anonymous fixture proves that a fixture prefix is not a global exemption.
  await write(root,file,"// Anonymous fixture only\nconst password = 'fixture-synthetic-password-00000';\n");
  const result=await inspect(root);
  assert.ok(forFile(result,file).some(issue=>issue.rule==='credential-literal'));
});

test('fixture allow-secret comments suppress only the exact rule on the same or next line',async t=>{
  const root=await fixture(t),file='tools/tests/allowed.fixture.cjs';
  const token=githubPrefix+'B'.repeat(36),cloud=cloudPrefix+'G'.repeat(16);
  await write(root,file,`// repo-check: allow-secret github-token -- anonymous test value\nconst first = '${token}';\nconst second = '${token}'; // repo-check: allow-secret github-token -- anonymous test value\n`);
  assert.ok(!forFile(await inspect(root),file).some(issue=>issue.rule==='github-token'));
  await write(root,file,`// repo-check: allow-secret github-token -- anonymous test value\nconst first = '${token}';\nconst second = '${token}';\n`);
  const adjacent=await inspect(root);
  assert.equal(forFile(adjacent,file).filter(issue=>issue.rule==='github-token').length,1);
  assert.equal(forFile(adjacent,file).find(issue=>issue.rule==='github-token').line,3);
  await write(root,file,`// repo-check: allow-secret github-token -- anonymous test value\nconst key = '${cloud}';\n`);
  assert.ok(forFile(await inspect(root),file).some(issue=>issue.rule==='cloud-key'));
});

test('inline waivers apply only to the current line and standalone waivers only to the next line',async t=>{
  const root=await fixture(t),file='tools/tests/waiver-scope.fixture.cjs',token=githubPrefix+'N'.repeat(36);
  await write(root,file,`const first='${token}'; // repo-check: allow-secret github-token -- anonymous inline fixture\nconst second='${token}';\n`);
  assert.deepEqual(forFile(await inspect(root),file).filter(issue=>issue.rule==='github-token').map(issue=>issue.line),[2]);
  await write(root,file,`// repo-check: allow-secret github-token -- anonymous fixture ${token}\nconst first='${token}';\nconst second='${token}';\n`);
  assert.deepEqual(forFile(await inspect(root),file).filter(issue=>issue.rule==='github-token').map(issue=>issue.line),[1,3]);
});

test('exceptions require a reason and cannot reach beyond the immediately next line',async t=>{
  const root=await fixture(t),file='tools/tests/invalid-exception.fixture.cjs',token=githubPrefix+'C'.repeat(36);
  for(const source of [
    `// repo-check: allow-secret github-token\nconst token = '${token}';\n`,
    `// repo-check: allow-secret github-token --\nconst token = '${token}';\n`,
    `// repo-check: allow-secret github-token -- short\nconst token = '${token}';\n`,
    `// repo-check: allow-secret github-token -- anonymous test value\n\nconst token = '${token}';\n`
  ]) {
    await write(root,file,source);
    assert.ok(forFile(await inspect(root),file).some(issue=>issue.rule==='github-token'));
  }
});

test('production files cannot bypass secret checks with fixture exceptions',async t=>{
  const root=await fixture(t),file='tools/production.js',token=githubPrefix+'E'.repeat(36);
  await write(root,file,`// repo-check: allow-secret github-token -- anonymous test value\nconst token = '${token}';\n`);
  assert.ok(forFile(await inspect(root),file).some(issue=>issue.rule==='github-token'));
});

test('comment-like text inside a JavaScript string cannot waive the next secret line',async t=>{
  const root=await fixture(t),file='tools/tests/string-exception.fixture.cjs',token=githubPrefix+'H'.repeat(36);
  await write(root,file,`const annotation = "; // repo-check: allow-secret github-token -- anonymous fixture string";\nconst access = '${token}';\n`);
  assert.ok(forFile(await inspect(root),file).some(issue=>issue.rule==='github-token'));
});

test('template strings, HTML attributes and raw text cannot create secret waivers',async t=>{
  const root=await fixture(t),token=githubPrefix+'J'.repeat(36);
  const directive='repo-check: allow-secret github-token -- anonymous fake comment fixture';
  const sources=[
    {name:'template',extension:'cjs',source:`const annotation = \`\n// ${directive}\`;\nconst access = '${token}';\n`},
    {name:'nested-template',extension:'cjs',source:`const access = '${token}'; const note = \`outer \${\`// ${directive}\`}\`;\n`},
    {name:'attribute',extension:'html',source:`<div data-comment="<!-- ${directive} -->"></div>\n${token}\n`},
    {name:'script-string',extension:'html',source:`<script>const annotation="<!-- ${directive} -->";\nconst access='${token}';</script>\n`},
    ...['textarea','style','title','xmp'].map(tag=>({name:tag,extension:'html',source:`<${tag}>\n<!-- ${directive} -->\n${token}\n</${tag}>\n`}))
  ];
  const missed=[];
  for(const {name,extension,source} of sources) {
    const file=`tools/tests/fake-${name}.fixture.${extension}`;
    await write(root,file,source);
    if(!forFile(await inspect(root),file).some(issue=>issue.rule==='github-token'))missed.push(name);
  }
  assert.deepEqual(missed,[],'Literal contexts cannot create synthetic secret waivers.');
});

test('a real single-line HTML comment can waive only its exact synthetic secret rule',async t=>{
  const root=await fixture(t),file='tools/tests/allowed.fixture.html',token=githubPrefix+'K'.repeat(36),cloud=cloudPrefix+'Q'.repeat(16);
  const annotation='<!-- repo-check: allow-secret github-token -- anonymous HTML fixture -->';
  for(const source of [`${annotation}\n${token}\n`,`<div>anonymous fixture</div>${annotation}${token}\n`]) {
    await write(root,file,source);
    assert.ok(!forFile(await inspect(root),file).some(issue=>issue.rule==='github-token'));
  }
  await write(root,file,`${annotation}\n${cloud}\n`);
  assert.ok(forFile(await inspect(root),file).some(issue=>issue.rule==='cloud-key'));
});

test('a tracked env file is refused without reading or exposing its synthetic contents',async t=>{
  const root=await fixture(t),token=githubPrefix+'L'.repeat(36);
  if(!await initializeGit(root,t))return;
  await write(root,'.env',`ACCESS=${token}\n`);
  await git(root,['add','--','.env']);
  const result=await inspect(root);
  assert.ok(forFile(result,'.env').some(issue=>issue.rule==='credential-file' && issue.level==='error'));
  assert.ok(!result.issues.some(issue=>issue.rule==='github-token'));
  assert.equal(JSON.stringify(result.issues).includes(token),false);
});

test('untracked local and Git-ignored env files are excluded from sensitive content scanning',async t=>{
  const token=githubPrefix+'M'.repeat(36);
  for(const mode of ['local','git-ignored']) {
    const root=await fixture(t);
    if(mode==='git-ignored') {
      if(!await initializeGit(root,t))return;
      await write(root,'.gitignore','.env\n.env.local\n');
    }
    await write(root,'.env',`ACCESS=${token}\n`);
    await write(root,'.env.local',`ACCESS=${token}\n`);
    const result=await inspect(root);
    assert.deepEqual(errors(result),[]);
    assert.ok(!result.issues.some(issue=>matchesFile(issue,'.env') || matchesFile(issue,'.env.local')));
    assert.equal(JSON.stringify(result.issues).includes(token),false);
  }
});

test('syntax diagnostics never echo a secret from the malformed source line',async t=>{
  const root=await fixture(t),file='tools/malformed-secret.js',token=githubPrefix+'D'.repeat(36);
  await write(root,file,`const access='${token}'; const broken = ;\n`);
  const result=await inspect(root);
  assertErrorFor(result,file);
  assert.ok(forFile(result,file).some(issue=>/syntax|语法/i.test(issue.rule+' '+issue.message)));
  assert.equal(JSON.stringify(result.issues).includes(token),false);
});

test('enabled test execution reports synthetic child failures as errors',async t=>{
  const root=await fixture(t),file=`${packageRoot}/tests/failure.test.cjs`;
  await write(root,file,"const test=require('node:test');test('anonymous failure',()=>{throw new Error('synthetic failing test');});\n");
  const result=await checkRepository(root,{runTests:true});
  assert.ok(errors(result).some(issue=>/test|测试/i.test(issue.rule+' '+issue.message)),JSON.stringify(result.issues));
});

test('enabled test execution accepts a passing anonymous child test',async t=>{
  const root=await fixture(t),file=`${packageRoot}/tests/pass.test.cjs`,marker=path.join(root,'passed-marker');
  await write(root,file,"const test=require('node:test');const fs=require('node:fs');const path=require('node:path');test('anonymous pass',()=>fs.writeFileSync(path.resolve(__dirname,'../../../passed-marker'),'passed'));\n");
  const result=await checkRepository(root,{runTests:true});
  assert.deepEqual(errors(result),[]);
  await access(marker);
});

test('static errors prevent test execution even when runTests is requested',async t=>{
  const root=await fixture(t),file=`${packageRoot}/tests/not-run.test.cjs`,marker=path.join(root,'executed-marker');
  await write(root,'tools/malformed.js','const malformed = ;\n');
  await write(root,file,"const fs=require('node:fs');const path=require('node:path');fs.writeFileSync(path.resolve(__dirname,'../../../executed-marker'),'unexpected');\n");
  const result=await checkRepository(root,{runTests:true});
  assert.ok(errors(result).some(issue=>issue.rule==='syntax'));
  await assert.rejects(access(marker),{code:'ENOENT'});
});
