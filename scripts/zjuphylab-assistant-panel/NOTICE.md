# 来源与著作权说明

本目录选课面板及新增的独立日历实现由 Ayanami-WU 维护，协作贡献为 Codex，适用本目录 MIT LICENSE。

日历功能参考以下项目的功能与接口流程：

- **5dbwat4** 的 [zjuphylab.ics](https://github.com/5dbwat4/zjuphylab.ics)：浙江大学物理实验课表转 iCalendar 的原项目。原日历转换贡献可追溯至 `d53231b`。
- **Ayanami-WU** 的 [zjuphylab-ics-beta](https://github.com/Ayanami-WU/zjuphylab-ics-beta)：`47a6792` 增加多日期、UTC 时间和描述处理，`93ed3ff` 为后续依赖修复。本次也核对了本地项目当前源码。

本脚本根据已确认的学校接口字段和 [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) 独立编写浏览器读取与序列化逻辑，没有复制上述项目的 Node/TypeScript 实现、签名算法、登录代码或 `ics` 库。网页签名 URL 由学校页面已有 `setRequestUrl` 方法生成；脚本只允许两条课表 GET 接口。

2026-10-03 核对的原项目 `package.json` 标注 `LGPL-3.0-or-later`，但 `LICENSE` 文件内容为 LGPL 2.1。原项目和其代码的许可归属保持原样，本目录的 MIT 声明不适用于原项目，也不把原项目重新许可为 MIT。如果后续直接移植原代码，应另行核对许可并保留相应声明。

日历导出使用实际日期、开始时间、教师、地点、课程和学期；多日期展开为独立事件，UTC+8 转为 UTC。结束时间未提供时使用界面中明确可修改的时长设置（默认 145 分钟），不推测上午/下午对应的节次。
