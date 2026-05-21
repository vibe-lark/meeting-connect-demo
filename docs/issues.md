# Issue 拆解: 飞书会议与智能纪要同步 Demo

## 已完成

### Issue 1: 自研页面创建真实飞书会议

- 状态：已完成
- 验收：
  - 页面调用 `POST /api/meetings`。
  - 服务端调用 `POST /open-apis/vc/v1/reserves/apply`。
  - 会议归属人来自页面 SSO 当前用户 `open_id`，未登录时禁止创建会议。
  - 创建结果包含会议号和入会链接。
- 验证：
  - 通过页面或 API 创建会议。

### Issue 2: 使用真实 Meeting Base 作为演示数据源

- 状态：已完成
- 验收：
  - `npm run bootstrap:base` 可创建真实 Base。
  - 服务读取 `data/base-config.json` 并复用同一个 Base。
  - 新建会议写入同一张 Base 表。
- 验证：
  - `GET /api/config/status` 返回 `tableStorage=FEISHU_BITABLE`。

### Issue 3: 飞书事件回调 Challenge

- 状态：已完成
- 验收：
  - `POST /api/feishu/events` 收到顶层 `challenge` 时原样返回。
  - `POST /api/feishu/events` 收到 `event.challenge` 时原样返回。
  - 配置 `FEISHU_ENCRYPT_KEY` 后可解密飞书加密事件。
- 验证：
  - `curl -X POST https://meeting-connect.dev.solutionsuite.cn/api/feishu/events ...`
  - `/api/feishu/events/status` 会记录 `url_verification/VERIFIED`，用于区分“回调地址可通”和“会后事件未到”。

## 已实现但待真实会后验收

### Issue 4: 自动处理 recording_ready 事件

- 状态：代码已完成；轮询兜底已发现真实妙记 token；等待 Minutes 基础信息和 AI 产物权限同时生效后完成会后同步验收
- 验收：
  - 识别 `vc.meeting.recording_ready_v1`。
  - 兼容 `header.event_type` 与顶层 `event_type`。
  - 兼容明文事件与 Encrypt Key 加密事件。
  - 从事件 URL 提取 `minute_token`。
  - 按会议号匹配已有记录。
  - 未匹配时创建一条来自事件的记录，避免纪要丢失。
- 验证：
  - `npm test`
  - Challenge 回调已通过公网 HTTPS 验证。
  - 当前 `/api/feishu/events/status` 已记录轮询生成的 `vc.meeting.recording_ready_v1` 处理记录；审计脚本会拒绝把默认兜底文案当成真实 AI 产物。

### Issue 4.1: 事件延迟时后台轮询录制结果

- 状态：已完成，等待真实会议结束后验收
- 验收：
  - 后台定时按会议号调用 `GET /open-apis/vc/v1/meetings/list_by_no`。
  - 找到实际会议 ID 后调用 `GET /open-apis/vc/v1/meetings/:meeting_id/recording`。
  - 从真实录制响应里解析妙记 URL 和 `minute_token`。
  - 页面 SSO user token 可用时，先调用“授权录制文件”接口补充录制权限。
  - 复用 `syncRecordingReadyEvent()` 更新同一条 Base 记录。
  - 轮询间隔默认 60 秒，可用 `RECORDING_POLL_INTERVAL_MS=0` 关闭。
  - 读取失败后 10 分钟退避，避免重复刷失败日志。
- 验证：
  - `npm test` 覆盖 `list_by_no` 响应解析和录制响应解析。
  - 旧会议轮询已经拿到真实妙记 token；如果 Minutes API 返回 `permission deny`，需确认 SSO 授权包含 `minutes:minutes.basic:read` 和 `minutes:minutes.artifacts:read`。
  - 当前主路径不依赖手填 `FEISHU_USER_ACCESS_TOKEN`，使用页面 SSO 保存并自动刷新的 user token。
  - `npm run check:permissions` 可用最新真实 `minute_token` 检查 Minutes 权限并输出缺失 scope。

### Issue 5: 读取妙记和智能纪要 AI 产物

- 状态：代码已完成，已拿到真实 `minute_token`，等待开放平台补齐 Minutes 基础信息和 AI 产物读取权限后重试
- 验收：
  - 调用 `GET /open-apis/minutes/v1/minutes/:minute_token`。
  - 调用 `GET /open-apis/minutes/v1/minutes/:minute_token/artifacts`。
  - 兼容飞书文档返回字段 `summary_content`、`assignees`。
  - 事件延迟时，页面可粘贴真实妙记 URL / token 复用同一套同步逻辑。
  - 手动同步不允许空输入生成假纪要。
  - 有 `note_id` 且 SSO user token 可用时调用 `GET /open-apis/vc/v1/notes/:note_id`。
  - 没有 user token 时阻止读取妙记，提示先完成页面 SSO 登录。
- 验证：
  - 单元测试覆盖纪要聚合。
  - `npm run check:permissions` 会检查 `minutes:minutes.basic:read` 和 `minutes:minutes.artifacts:read` 是否真正可读。
  - 权限生效后需要重新验证 `GET /open-apis/minutes/v1/minutes/:minute_token` 和 `/artifacts` 的生产返回。

### Issue 6: 自动回写同一条 Meeting Base 记录

- 状态：会议创建回写已完成；会后纪要回写等待真实会后事件验收
- 验收：
  - 会议创建时新增 Base 记录。
  - 会后同步时更新同一条 Base 记录。
  - 字段 `纪要标题`、`关键结论`、`待办事项`、`飞书产物` 有内容。
  - 页面刷新后可从会议数据表选择已有记录继续处理。
- 验证：
  - 新建会议已写入真实 Base，`bitableSyncStatus=SYNCED`。
  - 会后纪要字段需要真实 `recording_ready` 事件处理成功后，由 `npm run audit:completion` 验证。

### Issue 7: TDD 与最终验收

- 状态：TDD 已完成；最终真实链路验收未完成
- 验收：
  - 增加 `npm test`。
  - 覆盖 token 解析、Challenge 提取、事件标准化、后台轮询解析、摘要构建、记录匹配。
  - 完成 HTTPS Challenge、模拟事件、API 状态检查。
- 验证：
  - `npm test`
  - `node --check src/server.js`
  - `curl` 验证公开 URL。
  - `npm run audit:completion` 会拒绝 fallback-only 的 `SUMMARY_READY`，只有包含可验证 AI 产物且无同步提示的记录才算最终通过。

### Issue 8: Feishu Design System 视觉精修

- 状态：已完成
- 验收：
  - 页面使用 B500 主色、4px 间距刻度和 1200px 内容宽度。
  - 表单和按钮保持 3px 圆角、32px 高度，卡片保持 6px 圆角。
  - 状态分组、步骤条、空态、表格密度和按钮层级符合自研业务控制台场景。
  - 移动端顶部优先展示登录主操作，会议表和事件表转换为带字段名的记录卡。
- 验证：
  - `node --test test/design-system.test.js`
  - `npm test`
