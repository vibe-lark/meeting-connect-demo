# MeetBack 会议同步台

飞书会议开放能力的最小真实 demo：在自研页面完成飞书登录、发起真实会议，并把会后的妙记和智能纪要回写到真实多维表格。

Showcase:

```text
https://meeting-connect.dev.solutionsuite.cn
```

最小可演示链路：

1. 自研页面先完成飞书 SSO 登录，当前用户成为会议 Owner。
2. 自研页面填写会议主题并发起真实飞书视频会议。
3. 服务端用飞书自建应用凭证换取 `tenant_access_token`，并用 SSO 当前用户 `open_id` 作为 `owner_id` 调用预约会议接口。
4. 页面展示会议号和入会链接，并自动写入真实 Feishu Meeting Base。
5. 飞书推送 `vc.meeting.recording_ready_v1` 后，服务端自动读取妙记和智能纪要 AI 产物，并更新同一条 Base 记录。
6. 如果事件延迟，服务端会用真实飞书接口按会议号轮询实际会议和录制结果，拿到妙记链接后走同一套同步逻辑。
7. 页面展示发起会议、会议状态、数据表记录和折叠的技术验收详情。

页面视觉按 Feishu Design System 方向收敛：使用 B500 主色、4px 间距刻度、1200px 内容宽度、3px 表单/按钮圆角、6px 卡片圆角、紧凑表格密度，并在移动端把表格转换为带字段名的记录卡。

最终验收可运行：

```bash
npm run audit:completion
```

现场排查当前状态可运行：

```bash
npm run status:demo
```

检查飞书妙记读取权限可运行：

```bash
npm run check:permissions
```

`check:permissions` 会分别检查 Minutes 基础信息接口和 AI 产物接口。AI 产物接口 HTTP 成功但返回空数据时会输出 `WARN`；这只说明接口可达，不代表已经拿到可验收的智能纪要内容。

权限开通后，如果事件日志里已经有真实 `minute_token`，可以直接重试最近一次会后同步：

```bash
npm run retry:summary
```

`retry:summary` 会访问公开 Demo 接口，从事件日志里找最近一次真实 `minute_token`，再调用同一套 Minutes 读取与 Base 回写逻辑。

如果正在等待开放平台权限发布，可以让脚本自动等待并重试：

```bash
npm run watch:summary
```

`audit:completion` 会访问公开 Demo 接口并检查真实 Base、会议记录、`recording_ready` 事件、无同步提示的 Minutes AI 产物和纪要字段。未收到真实会后事件、`artifacts` 没有 summary/chapter/todo 内容，或只写入默认兜底文案时都会失败，这是预期的验收保护。

注意：`npm test` 只证明解析、状态和 UI 规则被保护；真实闭环仍必须以 `npm run audit:completion` 通过为准。

如果已经结束会议、正在等待飞书生成妙记，可以运行：

```bash
npm run watch:completion
```

默认每 15 秒重试一次，最多等待 15 分钟。可用 `WATCH_TIMEOUT_MS` 和 `WATCH_INTERVAL_MS` 调整。

客户现场验收步骤见 [docs/acceptance-runbook.md](docs/acceptance-runbook.md)。

如果飞书侧已经生成妙记但事件延迟，可在页面“技术验收”里的“手动补同步”粘贴真实妙记 URL / token，服务会复用同一套 Minutes 读取与 Base 回写逻辑。这个兜底不替代最终验收，最终验收仍以真实 `recording_ready` 事件和 `npm run audit:completion` 为准。

服务端还内置了后台轮询兜底，默认每 60 秒调用飞书真实接口按会议号查询实际会议和录制结果。可用 `RECORDING_POLL_INTERVAL_MS=0` 关闭。

## 运行

```bash
npm install
cp .env.example .env
npm run dev
```

编辑 `.env`。不要提交本地 `.env`；仓库只保留 `.env.example`：

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=replace_with_app_secret
FEISHU_USER_ID_TYPE=open_id
```

如果飞书事件订阅里开启了 Encrypt Key，再补充：

```bash
FEISHU_ENCRYPT_KEY=replace_with_encrypt_key
```

如果没有开启 Encrypt Key，可以保持为空；回调接口同时支持明文事件和加密事件。

页面主流程使用飞书 SSO 当前用户作为会议 Owner，未登录时不能发起会议。

服务端读取妙记 AI 产物和智能纪要时，优先使用页面“飞书 SSO 登录”保存的 refreshable user token，不要求现场手动填写 `user_access_token`。

飞书开放平台里需要配置网页应用回调地址：

```text
https://meeting-connect.dev.solutionsuite.cn/api/feishu/oauth/callback
```

如需直接触发一次带有效 `state` 的飞书授权，可打开：

```text
https://meeting-connect.dev.solutionsuite.cn/api/feishu/oauth/start
```

授权完成后 token 会保存在本机运行态文件：

```text
data/feishu-user-tokens.json
```

旧版兼容脚本可能会读取 `data/feishu-user-token.json`；页面主流程使用按浏览器 session 隔离的 `data/feishu-user-tokens.json`。

如需覆盖回调地址或授权范围，可在 `.env` 中配置：

```bash
FEISHU_OAUTH_REDIRECT_URI=https://meeting-connect.dev.solutionsuite.cn/api/feishu/oauth/callback
FEISHU_OAUTH_SCOPE=minutes:minutes.basic:read minutes:minutes.artifacts:read vc:record vc:note:read offline_access
```

`FEISHU_USER_ACCESS_TOKEN` 仍保留为兼容兜底，但当前 demo 主路径走页面 SSO 登录，并通过 refresh token 自动刷新用户身份。

本机调试时打开：

```text
http://localhost:3107
```

客户和远程访问请使用公网 HTTPS 演示入口，不要直接访问机器 IP 的 HTTP 地址，否则浏览器会因为非可信源或 HTTPS 资源混用拦截脚本和样式：

```text
https://meeting-connect.dev.solutionsuite.cn
```

飞书事件回调 URL：

```text
https://meeting-connect.dev.solutionsuite.cn/api/feishu/events
```

## 飞书权限

根据 `feishu-openapi-doc-rag` 本地索引检索结果，本 demo 用到：

- 自建应用获取 `tenant_access_token`
  - `POST /open-apis/auth/v3/tenant_access_token/internal`
- 自建应用获取 `app_access_token`
  - `POST /open-apis/auth/v3/app_access_token/internal`
- 飞书 SSO / 网页授权登录
  - 授权页：`GET https://accounts.feishu.cn/open-apis/authen/v1/authorize`
  - 授权参数：按官方 SSO 授权码接口使用 `client_id`、`redirect_uri`、`response_type=code`、`state`、`scope`
  - 换取 user token：`POST /open-apis/authen/v1/access_token`
  - 刷新 user token：`POST /open-apis/authen/v1/refresh_access_token`
- 预约会议
  - `POST /open-apis/vc/v1/reserves/apply`
  - 权限：`vc:reserve`
- 获取预约
  - `GET /open-apis/vc/v1/reserves/:reserve_id`
  - 权限：`vc:reserve:readonly`
- 获取智能纪要详情
  - `GET /open-apis/vc/v1/notes/:note_id`
  - 权限：`vc:note:read`
  - Token：`user_access_token`
- 接收录制完成事件
  - `POST /api/feishu/events`
  - 事件：`vc.meeting.recording_ready_v1`
  - 明文事件和 Encrypt Key 加密事件均可处理
- 事件延迟时轮询实际会议和录制
  - `GET /open-apis/vc/v1/meetings/list_by_no`
  - `GET /open-apis/vc/v1/meetings/:meeting_id/recording`
- 可选授权录制文件
  - `PATCH /open-apis/vc/v1/meetings/:meeting_id/recording/set_permission`
  - Token：`user_access_token`
  - 权限：`vc:record`
- 获取妙记信息
  - `GET /open-apis/minutes/v1/minutes/:minute_token`
  - 权限：`minutes:minutes.basic:read`
  - Token：`user_access_token`
- 获取妙记 AI 产物
  - `GET /open-apis/minutes/v1/minutes/:minute_token/artifacts`
  - 权限：`minutes:minutes.artifacts:read`
  - Token：`user_access_token`

注意：预约会议接口用 `tenant_access_token` 时，`owner_id` 必填。页面主流程使用 SSO 当前用户 `open_id`，未登录时禁止发起会议。

## 数据表演示

Meeting Base 必须是真实 Feishu Base。首次配置时运行：

```bash
npm run bootstrap:base
```

脚本会：

1. 创建一个 Feishu Base。
2. 创建会议记录所需字段。
3. 设置互联网获得链接的人可阅读。
5. 保存运行态配置到：

```text
data/base-config.json
```

后续服务始终复用这个 Base，不再重复创建。会议和纪要写入失败时才使用本地兜底缓存：

```text
data/meeting-records.json
```

如需强制接入另一个已知 Base，可在 `.env` 中覆盖：

```bash
FEISHU_BITABLE_APP_TOKEN=bascnxxxxxxxxxxxx
FEISHU_BITABLE_TABLE_ID=tblxxxxxxxxxxxx
```

目标数据表建议准备这些字段，字段名需保持一致：

- `会议主题`
- `预约ID`
- `会议状态`
- `会议号`
- `会议链接`
- `归属人ID`
- `归属人`
- `纪要标题`
- `妙记链接`
- `智能纪要链接`
- `关键结论`
- `待办事项`
- `飞书产物`
- `创建时间`
- `更新时间`

真实多维表格同步用到：

- 新增记录：`POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records`
- 更新记录：`PUT /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id`
- 权限：`base:record:create`、`base:record:update`，或 `bitable:app`
