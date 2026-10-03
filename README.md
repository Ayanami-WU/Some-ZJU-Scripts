# Some-ZJU-Scripts

面向 ZJU 相关网站的独立 Userscript 与浏览器控制台片段收集。

本仓库采用类似 GreasyFork 的组织方式：每个脚本只针对一个明确的网站或页面，拥有独立目录、版本、说明和验证记录；仓库本身只提供收集、索引和规范，不把所有脚本做成一个绑定多个站点的“大脚本”。

> 当前仓库已建立规范与模板，并收录大学物理实验选课辅助脚本。

## 当前收录

- zjuphylab-assistant-panel：大学物理实验选课辅助面板。
- zju-elang-answer-grabber：E-Lang 前端题目数据读取辅助面板（原作者授权再发布）。

具体脚本的使用边界、权限和验证状态以各自目录中的 README 为准。

## 目录结构

```text
scripts/<script-slug>/
├── <script-slug>.user.js   # 可由 Tampermonkey/Violentmonkey 安装的脚本
├── README.md               # 面向使用者的说明
└── CHANGELOG.md            # 版本变更记录

templates/
├── userscript.user.js      # Userscript 模板
├── console-snippet.js      # 控制台片段模板
└── README.md               # 脚本说明模板

docs/
└── script-spec.md          # 收录规范
```

## 脚本类型

- `userscript`：带有 GreasyFork 风格元数据头，可由用户脚本管理器安装。
- `console-snippet`：需要用户在指定页面的开发者工具控制台手动运行，不伪装成可安装 Userscript。

## 收录原则

- 一个脚本对应一个明确的网站、页面或业务功能。
- `@match` 尽量精确，避免无必要的全站匹配。
- 默认使用 `@grant none`，额外权限、跨域请求和外部依赖必须在说明中解释。
- 不提交账号、密码、Cookie、Token、个人信息、真实业务数据或带隐私的截图。
- 会修改页面数据或触发真实业务提交的脚本，必须明确标注副作用，并保留人工确认与最终核验步骤。
- 每个脚本独立版本化，说明兼容范围、已知限制和验证结果。

## 使用边界

这些脚本只应在本人有权访问和操作的 ZJU 网站、测试环境或经授权的调试场景中使用。脚本是否能读取到前端数据，不代表用户获得了绕过权限、考试规则或业务流程的授权。

## 开发与提交

新增或修改脚本前，请先阅读 [`docs/script-spec.md`](docs/script-spec.md) 和 [`CONTRIBUTING.md`](CONTRIBUTING.md)。模板位于 [`templates/`](templates/)。

后续将补充元数据检查、语法检查和目录索引生成工具。
