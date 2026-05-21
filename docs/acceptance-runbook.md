# 真实会后同步验收 Runbook

## 目标

证明完整链路已经跑通：

1. 自研页面创建真实飞书视频会议。
2. 参会人实际入会并产生可录制内容。
3. 会议结束后，飞书生成妙记 / 智能纪要。
4. 飞书推送 `vc.meeting.recording_ready_v1`，或后台轮询拿到真实录制/妙记链接。
5. 服务自动读取妙记 AI 产物并更新真实 Meeting Base。

## 当前验收入口

- Demo 页面：`https://meeting-connect.dev.solutionsuite.cn`
- 事件回调：`https://meeting-connect.dev.solutionsuite.cn/api/feishu/events`
- Meeting Base：`https://digitalsolution.feishu.cn/base/XJ4tblKyuaH2oks20jfcpn1wnne`
- 当前验收会议：以 Demo 页面最新创建记录为准。
- 当前会议号：以 Demo 页面最新创建记录为准。
- 当前预约 ID：以 Demo 页面最新创建记录为准。
- 当前 Base 记录 ID：以 Demo 页面最新创建记录为准。

## 飞书开放平台检查

在开发者后台确认：

1. 事件订阅方式为“将事件发送至开发者服务器”。
2. 请求地址配置为 `https://meeting-connect.dev.solutionsuite.cn/api/feishu/events`。
3. 已订阅事件 `vc.meeting.recording_ready_v1`。
4. 应用版本已发布，权限已生效。
5. 如果开启 Encrypt Key，服务端 `.env` 需要配置同一个 `FEISHU_ENCRYPT_KEY` 并重启服务；如果未开启则保持为空。
6. 如果 Minutes API 返回 `permission deny`，确认当前 SSO 用户授权包含 `minutes:minutes.basic:read`、`minutes:minutes.artifacts:read`、`vc:record`、`vc:note:read`、`offline_access`，并从页面重新登录刷新 user token。
7. 重新授权必须从 Demo 页面或 `/api/feishu/oauth/start` 发起，服务会生成带有效 `state` 的官方 `client_id` 授权 URL；不要复用旧的飞书授权页。
8. 如果开放平台刚新增或发布 Minutes 用户权限，必须再次完成 SSO 授权；仅在开放平台保存权限不会更新已经保存的 user token。可用 `/api/feishu/oauth/status` 确认 token 状态已经刷新。
9. 权限排查入口使用开放平台应用权限页，并用 user 权限筛选 `minutes:minutes.basic:read minutes:minutes.artifacts:read`。

## 会议侧操作

1. 打开 Demo 页面。
2. 确认页面显示 SSO 当前用户；未登录时先完成飞书 SSO 登录。
3. 从页面发起一场新的真实会议。
4. 使用同租户账号入会，确认会议允许录制，且有实际音频内容。
5. 结束会议。
6. 等待飞书完成录制上传和妙记生成。

服务端默认每 60 秒轮询一次真实飞书会议和录制结果，所以事件日志里可能看到 `source=POLLING` 的 `vc.meeting.recording_ready_v1` 同步记录。这仍然使用真实飞书录制/妙记接口，不生成假数据。

## 服务侧验证

先看事件是否到达：

```bash
curl -skS https://meeting-connect.dev.solutionsuite.cn/api/feishu/events/status
```

持续等待完成：

```bash
npm run watch:completion
```

`watch:completion` 每轮会先复用最近一次真实 `minute_token` 尝试重新同步纪要，再运行最终审计。这样在重新完成 SSO 授权后，不需要手动分开执行 `retry:summary` 和 `audit:completion`。

单次最终审计：

```bash
npm run audit:completion
```

如果遇到 `permission deny`，检查缺失权限：

```bash
npm run check:permissions
```

快速查看现场状态：

```bash
npm run status:demo
```

如果用户已经点过授权但 token 没刷新，检查最近一次 OAuth callback 是否真的打到服务端：

```bash
curl -sS https://meeting-connect.dev.solutionsuite.cn/api/feishu/oauth/status | jq '{updatedAt,lastCallback}'
```

`lastCallback=null` 表示还没有新的飞书授权回调进入服务端；`lastCallback.status=FAILED` 表示回调到了但换 token 失败，可继续看 `errorCode` 和 `errorMessage`。该诊断不会保存或返回 OAuth code、state、access token 或 refresh token。

权限补齐后，复用最近一次真实 `minute_token` 重试回写：

```bash
npm run retry:summary
```

也可以直接在 Demo 页面“飞书事件状态”区域点击“重试最近同步”，页面按钮和命令行走同一个后端重试接口。

如果正在等待开放平台权限发布，可以运行：

```bash
npm run watch:summary
```

脚本会持续调用同一个重试接口，直到 Base 写入纪要字段或等待超时。

常见 Completion 状态：

- `READY`：真实会后纪要已经同步到 Base。
- `BLOCKED_MISSING_MINUTES_PERMISSION`：已拿到真实妙记线索，但 SSO 用户授权缺少 `minutes:minutes.basic:read`、`minutes:minutes.artifacts:read`、`offline_access` 或相关妙记读取权限。
- `WAITING_FOR_VERIFIED_MINUTES_ARTIFACTS`：已经拿到 `recording_ready`，但当前纪要仍是默认兜底、包含同步提示，或 `/artifacts` 虽可访问但还没有 summary/chapter/todo 内容，还不能算真实 AI 产物闭环。
- `WAITING_FOR_REAL_RECORDING_READY`：还在等待真实会议结束、飞书生成妙记或事件/轮询拿到录制结果。

通过标准：

```text
PASS 真实 recording_ready 事件已同步
PASS Base 同一条记录已写入纪要字段
```

## 如果没有事件

1. 在飞书开发者后台的“日志检索 > 事件日志检索”确认平台是否推送过事件。
2. 确认会议确实是通过 OpenAPI 预约创建的会议。
3. 确认会议实际开始并结束，而不是仅创建预约。
4. 确认录制 / 妙记已在飞书侧生成。
5. 等待后台轮询，或查看 `/api/feishu/events/status` 是否有 `source=POLLING` 的同步记录。
6. 如果事件日志出现 `permission deny`，先确认 SSO 用户授权包含 `minutes:minutes.basic:read` 和 `minutes:minutes.artifacts:read`；如果要走录制授权接口，还需要授权包含 `vc:record`。
7. 如果 `npm run check:permissions` 显示 `/artifacts` 为 `PASS` 但有空产物 `WARN`，说明接口可达但飞书还没有返回可验收的 AI 产物内容，继续等待或重新生成一场有实际语音内容的新会议。
8. 如果飞书侧有妙记链接但事件未推送，可用真实妙记 URL 或 `minute_token` 构造一次事件请求做同步验证。
9. 也可以在 Demo 页面“技术验收”的“手动补同步”区域粘贴真实妙记 URL / token，手动触发同一套 Minutes 读取与 Base 回写逻辑。最终验收仍以真实飞书会后产物为准。
