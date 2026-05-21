# TDD: 飞书会议与智能纪要同步 Demo

## 目标

用自动化测试保护最小真实链路中的关键解析、匹配和同步逻辑，避免客户演示时因为飞书事件结构、妙记 URL、Encrypt Key 或 AI 产物字段变化导致同步失败。

## 测试入口

```bash
npm test
```

当前测试文件：

- `test/meeting-sync.test.js`
- `test/frontend-status.test.js`
- `test/mobile-table.test.js`
- `test/design-system.test.js`
- `test/watch-completion.test.js`

## 覆盖范围

| 需求 | 测试覆盖 |
| --- | --- |
| 妙记 URL / `minute_token` 解析 | `extractMinuteToken parses Feishu minutes URLs` |
| 飞书 Challenge 校验 | `extractFeishuChallenge supports top-level and event-level verification bodies` |
| 手动兜底必须是真实妙记输入 | `hasRealSummaryInput rejects empty manual sync input` |
| Encrypt Key 加密事件解密 | `decryptFeishuPayload decrypts the official Encrypt Key sample`、`normalizeFeishuEventBody decrypts encrypted event JSON` |
| `recording_ready` 事件标准化 | `normalizeFeishuEvent extracts recording_ready payload from v2 event body`、`normalizeFeishuEvent supports top-level event_type payloads` |
| 按会议号匹配原会议记录 | `findRecordKeyForRecordingEvent matches by normalized meeting number` |
| 事件延迟时按会议号查询实际会议 | `findMeetingIdFromListByNoPayload finds matching meeting in nested list response` |
| 从录制查询结果抽取真实妙记链接 | `buildRecordingReadyEventFromRecordingPayload extracts real minute URL from recording payload` |
| 妙记与智能纪要字段映射 | `buildSummaryFromMinutes maps minute info, AI artifacts, and note artifacts`、`buildSummaryFromMinutes maps documented Feishu artifacts fields` |
| 同一条会议记录更新为纪要已同步 | `buildMeetingFromRecordingSync updates the matched reserve record` |
| 前端状态只认可真实 AI 产物 | `frontend status marks summary complete only for verified minutes artifacts`、`frontend status surfaces minutes permission warning from synced record artifacts` |
| OAuth 权限缺失提示 | `frontend oauth badge asks for reauthorization when minutes permissions are missing` |
| 移动端表格不横向裁切 | `mobile tables render as labeled rows instead of clipped wide tables` |
| Feishu Design System 基线 | `page styling follows the Feishu design system spacing and density baseline`、`mobile workflow keeps the primary action visible before secondary status badges` |
| 完成等待脚本先重试再审计 | `completion watcher retries latest summary before each audit` |

## 不用测试替代真实验收

这些测试只证明代码能正确处理已知输入形态。最终验收仍以真实运行结果为准：

1. 页面创建真实飞书会议。
2. 飞书生成真实妙记 / 智能纪要。
3. 服务收到 `vc.meeting.recording_ready_v1`，或轮询拿到真实录制结果。
4. 服务用 Minutes API 读取真实 AI 产物。
5. 同一条 Meeting Base 记录被回写纪要字段。

最终门禁命令：

```bash
npm run audit:completion
```
