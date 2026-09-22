# 脚本收录规范

## 1. 命名与目录

使用小写短横线命名，例如：

```text
scripts/zju-lab-course-panel/
├── zju-lab-course-panel.user.js
├── README.md
└── CHANGELOG.md
```

`script-slug` 应体现网站或功能，不使用账号、姓名、课程成绩等个人信息。

## 2. Userscript 元数据

可安装脚本应在文件顶部保留元数据块：

```js
// ==UserScript==
// @name         ZJU 示例脚本
// @namespace    https://github.com/Ayanami-WU/Some-ZJU-Scripts
// @version      0.1.0
// @description  简短、准确地描述功能
// @author       Ayanami-WU
// @match        https://example.zju.edu.cn/example/*
// @run-at       document-idle
// @grant        none
// @license      TODO
// @supportURL   https://github.com/Ayanami-WU/Some-ZJU-Scripts/issues
// ==/UserScript==
```

要求：

- `@match` 只覆盖实际需要的协议、主机和路径。
- 默认使用 `@grant none`；需要存储、跨域或其他权限时必须在 README 中说明原因。
- `@require`、`@connect`、`@updateURL` 和 `@downloadURL` 只有在实际使用并经过审查后才添加。
- 版本号使用语义化版本格式，并与 CHANGELOG 保持一致。

## 3. 控制台片段

控制台片段不应伪装成可安装脚本。文件顶部至少写明：

```js
/**
 * Script type: console-snippet
 * Target: https://example.zju.edu.cn/example
 * Side effects: read-only
 */
```

README 必须说明：用户需要先打开什么页面、脚本读取什么数据、是否会修改页面，以及如何判断运行结果。

## 4. 副作用等级

在 README 中使用以下等级之一：

- `read-only`：只读取 DOM 或前端状态并展示结果。
- `page-enhancement`：只增加本地界面、标记或辅助信息。
- `page-write`：修改表单、页面状态或本地存储，但不主动提交真实业务请求。
- `business-submit`：会触发选课、报名、提交等真实业务操作，必须逐项说明确认、暂停、超时和结果核验机制。

## 5. 数据与安全

仓库不得包含真实凭据、Cookie、Token、个人信息、答题结果、成绩数据或未经授权复制的业务数据。页面中存在敏感字段时，只保留脱敏后的 fixture 或伪造示例。

如果脚本能够读出本不应发送到浏览器端的数据，应将其定位为授权调试或安全审计工具，并在 README 中说明这一边界，不包装成绕过权限或规则的功能。

## 6. 验证记录

README 中区分以下状态：

- 静态检查：语法、元数据和选择器检查；
- 模拟页面验证：使用本地 fixture 或测试页面；
- 真实页面只读验证；
- 真实业务流程验证。

没有执行的验证必须明确写“未执行”。
