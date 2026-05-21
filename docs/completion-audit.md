# Completion Audit: Meeting Connect Demo

## Objective

在自研页面上直接发起飞书视频会议；会议结束并生成妙记/智能纪要后，自动同步到自研页面。同步展示可用真实飞书多维表格代替。

## Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| 自研页面发起真实飞书视频会议 | `POST /api/meetings` 调用飞书预约会议 API；Owner 来自 SSO 当前用户 | Done |
| SSO 当前用户作为 Owner | `/api/feishu/oauth/status` 返回当前用户 `openId`，创建会议时作为 `owner_id` | Done |
| 飞书用户登录态可用 | `/api/feishu/oauth/status` 返回 `authenticated=true`；这只代表页面可识别当前用户，不代表 Minutes 读取权限已完成 | Done |
| 使用真实 Base | `/api/config/status` 返回 `tableStorage=FEISHU_BITABLE` | Done |
| Base 写入 | 新 Base `XJ4tblKyuaH2oks20jfcpn1wnne` 已验证 OpenAPI 写入成功 | Done |
| 页面数据干净度 | `npm run audit:completion` 检查页面记录只属于当前 SSO Owner，且只连接当前 Meeting Base | Done |
| Feishu Design System 风格收敛 | 页面采用 B500 主色、4px 间距刻度、1200px 内容宽度、3px 表单/按钮、6px 卡片、分层状态卡、折叠技术日志；`test/design-system.test.js` 覆盖桌面密度和移动端主操作顺序；移动端会议表和事件表转为带字段名的记录卡 | Done |
| PRD | `docs/PRD.md` | Done |
| Issue 拆解 | `docs/issues.md` | Done |
| TDD | `docs/TDD.md`、`test/meeting-sync.test.js`、`test/frontend-status.test.js`、`test/mobile-table.test.js`，`npm test` 32/32 passing | Done |
| Challenge 校验 | `POST /api/feishu/events` 同时支持顶层 `challenge` 与 `event.challenge`，公开 HTTPS 已验证 | Done |
| recording_ready 事件入口 | `src/server.js` 处理 `vc.meeting.recording_ready_v1`；事件标准化兼容 `header.event_type`、顶层 `event_type`、Encrypt Key 加密事件 | Done |
| 事件延迟轮询兜底 | 后台按会议号调用 `meetings/list_by_no`，再调用 `meetings/:meeting_id/recording`，拿到真实妙记链接后复用同一套同步逻辑 | Done |
| 妙记与智能纪要读取 | `GET /open-apis/minutes/v1/minutes/:minute_token`、`GET /open-apis/minutes/v1/minutes/:minute_token/artifacts`、可选 `GET /open-apis/vc/v1/notes/:note_id`；AI 产物字段覆盖飞书文档的 `summary_content`、`assignees` | Blocked |
| 妙记读取权限检查 | `npm run check:permissions` 和 `npm run audit:completion` 会识别缺失的 `minutes:minutes.basic:read`、`minutes:minutes.artifacts:read`、空 `/artifacts` 产物或 fallback-only 纪要 | Blocked |
| 自动回写 Base | `syncRecordingReadyEvent()` 调用 `saveMeetingRecord()`，复用同一条 Base record | Done |
| 事件可观测 | `/api/feishu/events/status` 和页面“飞书事件状态”；Challenge 会记录为 `url_verification/VERIFIED` | Done |
| 自动化完成审计脚本 | `npm run audit:completion` 检查公开服务、真实 Base、当前 Owner 数据、会议记录、真实 recording_ready 事件、无同步提示的 AI 产物和纪要字段 | Done |
| 自动化完成审计结果 | 当前真实运行结果仍失败：`飞书妙记用户权限可读取`、`Base 同一条记录已写入纪要字段` | Blocked |
| 会后等待验收 | `npm run watch:completion` 每 15 秒轮询完成审计，默认最多等待 15 分钟 | Done |
| 真实验收 Runbook | `docs/acceptance-runbook.md` 记录开放平台检查、会议侧操作、服务侧验证和无事件排查 | Done |
| 事件延迟兜底 | 页面“技术验收”的“手动补同步”支持粘贴真实妙记 URL / token，复用 Minutes 读取与 Base 回写逻辑；空输入会拒绝，避免生成假纪要；不替代最终事件验收 | Done |
| 已有记录继续处理 | 页面刷新后可在会议数据表点击“处理”，恢复当前会议并继续同步纪要 | Done |
| 真实会后事件验收 | 当前 `/api/feishu/events/status` 已记录轮询发现的真实 `vc.meeting.recording_ready_v1`；最终还需要 Minutes 基础信息和 AI 产物真实读取成功，不能只写入默认兜底文案 | Blocked |

## Current Blocker

最终验收当前阻塞在真实 Minutes AI 产物：

1. 新 Base 已创建并开放互联网可读。
2. SSO 当前用户已可作为 Owner 创建真实会议。
3. 当前页面只展示新 Base / 新 Owner 的 2 条真实会议记录，旧 App、旧 Owner、旧 Base 记录没有混入。
4. 最新新建会议为 `656886010`，Reserve ID `7642215258644581316`，Base record `recvkelrItpU83`，状态 `RESERVED`，已写入同一个 Meeting Base。
5. 旧验收会议 `922353176` 已拿到真实 `minute_token=obcnqqpk4d491hw128ekgggg`，但保存的 SSO user token 仍缺 `minutes:minutes.basic:read`，所以 `minutes/:token` 读取失败。
6. 当前 `/artifacts` 端点可访问，但返回空产物；这还不能算已拿到真实 AI 纪要内容。
7. 飞书推送事件或后台轮询拿到真实妙记后，必须成功读取 `minutes/:token`，并从 `/artifacts` 拿到 summary/chapter/todo 内容，`npm run audit:completion` 才会认可纪要字段回写。

## Latest Live Audit

验证时间：2026-05-21 14:32 CST。

- 公开 Demo：`https://meeting-connect.dev.solutionsuite.cn` 可访问。
- `/api/feishu/oauth/status` 可用于确认当前浏览器 session 的 SSO 授权状态和最近一次回调结果。
- `/api/feishu/oauth/status` 返回当前 SSO 用户 `ou_8fae58c6480696bebd6418da213ecde8`，`authenticated=true`，`authorized=true`，`canRefresh=true`。
- `npm test`：32/32 passing。
- `npm run check:permissions`：`/open-apis/minutes/v1/minutes/:minute_token` 仍返回飞书 `99991679`，缺少 `minutes:minutes.basic:read`；`/artifacts` 可访问但没有可验收 AI summary/chapter/todo 内容。
- `npm run audit:completion`：仍失败 `飞书妙记用户权限可读取` 和 `Base 同一条记录已写入纪要字段`。
- 桌面和移动端页面已截图复核：`test-results/live-desktop-audit.png`、`test-results/live-mobile-audit.png`。
- OAuth callback 诊断已上线：`/api/feishu/oauth/status` 会返回 `lastCallback`；当前为 `null`，表示重新授权尚未回调到服务端。该字段不包含 OAuth code、state、access token 或 refresh token。

结论：本地代码、页面、Base 接入、当前 Owner 和页面数据干净度均已有证据；最终闭环必须等待重新完成飞书 SSO 用户授权，并基于真实妙记 AI 产物重试同步。

## Next Action

先在飞书开放平台确认并发布 Minutes user 权限，再打开 `https://meeting-connect.dev.solutionsuite.cn/api/feishu/oauth/start` 重新完成 SSO 授权，确认授权包含 `minutes:minutes.basic:read minutes:minutes.artifacts:read vc:record vc:note:read offline_access`。授权后运行 `npm run check:permissions && npm run retry:summary && npm run audit:completion`；如需新样本，从 Demo 页面重新发起一场真实会议，实际入会并结束。
