# 工具

`check.mjs` 提供仓库级静态检查和显式本地测试。使用 Node.js 运行，无需安装外部依赖。

工具代码采用 MIT 许可证，见本目录 [LICENSE](LICENSE)。

## 运行

在仓库根目录执行：

```sh
node tools/check.mjs
node tools/check.mjs --test
node tools/check.mjs --strict
node tools/check.mjs --test --strict
node tools/check.mjs --help
```

- 默认只做静态检查，不执行浏览器脚本，也不打开或操作学校页面。
- `--test` 在静态检查后，显式执行 `scripts/<slug>/tests/*.test.cjs` 和 `tools/tests/*.test.mjs` 中的本地测试；只发现这些目录的直接子文件，没有测试的脚本不视为测试通过。
- `--strict` 将警告也视为失败；默认情况下，错误导致非零退出，警告保留提示。
- `--help` 显示命令用法。

命令不修改文件，也不生成索引。发现错误时退出码为 `1`，未知参数为 `2`；静态检查有错误时不执行测试。测试失败只显示固定提示，需要查看详情时可在本地对对应文件运行 `node --test`。

## 检查范围

- Userscript 元数据，以及控制台脚本的类型、目标页面和副作用声明。
- 脚本目录中的 README、CHANGELOG 和 LICENSE，以及版本号一致性。
- `@match` 范围和额外权限；需要人工审查的配置会产生警告。
- JavaScript 语法，通过 `node --check` 验证。
- 可能的凭据或其他敏感信息。诊断只输出文件、行号和规则，不回显匹配值。

有 Git 时，读取已跟踪文件和未被忽略的新文件；本地被忽略的 `.env` 不读取，误纳入仓库的 `.env` 配置会报错并跳过内容读取。脱离 Git 的源码目录也可检查。符号链接拒绝读取，超过 2 MiB 的文件会提示跳过，二进制文件和依赖、构建输出、工作区配置目录不参与内容扫描。

敏感规则包括私钥标记、GitHub Token 形状、云访问密钥形状和带引号的凭据字面量。明确的 `demo-`、`example-`、`fake-`、`mock-`、`sample-`、`synthetic-`、`test-` 占位前缀只影响凭据字面量启发式，不豁免高置信 token 或整个测试目录。该扫描不覆盖所有凭据格式。

敏感信息检查基于规则，不能替代人工核对。模拟数据也会接受检查；伪造 fixture 确需例外时，在对应代码行的前一行添加独立注释，例如：

```js
// repo-check: allow-secret credential-literal -- 仅用于本地测试的伪造认证字段
```

HTML 可使用等价的 `<!-- repo-check: allow-secret credential-literal -- 仅用于本地测试的伪造认证字段 -->` 注释。单独成行的注释只作用于下一行；检测行末尾的注释只作用于当前行。每条注释仅豁免一个目标行的指定规则。允许的规则名为 `private-key`、`github-token`、`cloud-key`、`credential-literal`，原因至少 6 个字符。

例外只允许出现在 `scripts/<slug>/tests/` 或 `tools/tests/` 内，不对整个文件或目录豁免，也不允许生产脚本通过注释隐藏凭据。

静态检查和本地测试不能证明真实网站兼容、扩展安装成功或真实业务提交正确。各脚本 README 仍应分别记录模拟验证、真实页面只读验证和实际业务验证。本次工具不生成目录索引。

## 验证记录

2026-10-03 在 Node.js 26.10.0 执行：

- `node tools/check.mjs --test --strict`：2 个脚本、9 个 JavaScript 文件，0 错误、0 警告；4 个测试文件共 87 项通过。
- 工具自身的 41 项回归覆盖正常目录、元数据/版本/许可证错误、校园端口、过宽匹配、敏感诊断脱敏、局部例外、符号链接和测试执行边界。
- `node tools/check.mjs --help` 和 `git diff --check` 通过。
