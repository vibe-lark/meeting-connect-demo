# PRD: 飞书会议与智能纪要同步 Demo

## 目标

给客户演示一个最小可用闭环：业务人员在自研页面发起真实飞书视频会议，会议结束并生成妙记/智能纪要后，系统自动把纪要结果同步到同一个演示数据源。同步到自研页面的展示可用真实飞书多维表格代替。

## 用户与场景

- 演示用户：客户现场观看 Demo 的业务负责人和技术负责人。
- 操作人：Demo 主持人，通过自研页面 SSO 登录后点击创建会议，不手工复制纪要内容。
- 会议归属人：使用 SSO 后的当前飞书用户，页面不提供手工选择归属人的入口。

## 范围

### 必须包含

- 自研页面能创建真实飞书视频会议。
- 创建会议后自动写入真实飞书多维表格 Meeting Base。
- Meeting Base 始终复用同一个 Base，不为每次演示重新创建。
- 飞书事件回调 URL 能通过 Challenge 校验。
- 收到 `vc.meeting.recording_ready_v1` 事件后，自动读取妙记/智能纪要信息。
- 如果飞书事件延迟，服务端用真实飞书会议查询和录制查询接口做后台轮询兜底。
- 自动用会议号匹配原会议记录，并更新同一条 Base 记录。
- 页面和文档使用中文优先表达。

### 可以简化

- 自研页面的“会后同步展示”可由多维表格承担，不要求另做复杂详情页。
- 如果飞书 Note 详情接口需要 user access token，而当前环境没有配置，可以先用 Minutes API 的 AI 产物完成纪要摘要、章节和待办同步，并在状态中保留 Note 详情缺失原因。
- 手动兜底同步必须使用真实飞书妙记 URL、`minute_token` 或真实 `note_id`，不能生成演示假纪要。

### 不包含

- 不做多租户管理。
- 不做手工选择会议归属人；Owner 来自 SSO 当前用户。
- 不做生产级队列、重试后台和审计系统。
- 不保存或展示 app secret、access token 等敏感信息。

## 数据源

Meeting Base 是演示数据源和事实来源。当前 Base 配置保存在 `data/base-config.json`，服务启动时读取并复用。

推荐字段：

- `会议主题`
- `预约ID`
- `会议状态`
- `会议号`
- `会议链接`
- `归属人ID`
- `纪要标题`
- `关键结论`
- `待办事项`
- `飞书产物`
- `创建时间`
- `更新时间`

本地 `data/meeting-records.json` 只作为兜底缓存，不能在客户演示中被称为 Base。

## 事件流

1. 用户在自研页面点击飞书 SSO 登录。
2. 服务端用授权 code 换取 user token，并保存当前用户 `open_id`。
3. 页面调用 `POST /api/meetings`。
4. 服务端用自建应用凭证换取 `tenant_access_token`。
5. 服务端用当前 SSO 用户的 `open_id` 作为 `owner_id` 调用飞书视频会议预约 API 创建真实会议，并开启自动录制。
6. 服务端新增或更新 Meeting Base 记录。
7. 会议结束后飞书推送 `vc.meeting.recording_ready_v1` 到 `POST /api/feishu/events`。
8. 如果事件延迟，后台轮询按会议号调用 `meetings/list_by_no` 找实际会议，再调用 `meetings/:meeting_id/recording` 读取录制/妙记链接。
9. 服务端从事件或轮询结果里的妙记 URL 提取 `minute_token`。
10. 服务端调用 Minutes API 读取妙记基础信息和 AI 产物。
11. 服务端按会议号匹配原记录，更新纪要标题、关键结论、待办事项和飞书产物。

## 命令

- 安装依赖：`npm install`
- 启动开发服务：`npm run dev`
- 启动普通服务：`npm start`
- 创建或修复 Meeting Base：`npm run bootstrap:base`
- 检查飞书妙记读取权限：`npm run check:permissions`
- 查看现场 Demo 状态：`npm run status:demo`
- 测试：`npm test`

## 验收标准

- `POST /api/feishu/events` 对包含 `challenge` 的请求返回同名 challenge。
- SSO 登录完成后，页面展示当前用户，并用当前用户作为会议 Owner。
- `POST /api/meetings` 能以当前 SSO 用户作为 Owner 创建真实飞书会议，并写入真实 Meeting Base。
- 单元测试覆盖 `vc.meeting.recording_ready_v1` 事件处理；最终验收必须收到真实飞书 `vc.meeting.recording_ready_v1` 事件。
- 收到真实会后事件，或后台轮询拿到真实录制/妙记链接后，同会议号记录进入会后同步流程；只有成功读取 Minutes AI 产物且无同步提示时，页面才计为“已同步纪要”。
- Base 中同一条记录出现真实纪要标题、关键结论、待办事项和飞书产物；默认兜底文案或同步提示不能算最终通过。
- 自动同步逻辑有单元测试覆盖：minute token 解析、事件标准化、轮询结果解析、纪要聚合、记录匹配。
- 文档包含客户演示操作步骤和用到的飞书 OpenAPI 清单。

## 风险与约束

- 真实会议结束后是否能生成妙记，取决于会议录制、妙记、应用权限和租户设置。
- 页面未完成 SSO 登录时不能发起会议，因为 Owner 必须来自当前飞书用户。
- `vc/v1/notes/:note_id` 和 Minutes artifacts 读取依赖 SSO 用户授权；没有用户授权时应提示登录。
- 录制文件查询可使用 `tenant_access_token` 读取租户范围内录制文件；`user_access_token` 读取范围受会议归属人约束。
- 飞书事件需要应用发布后生效，后台权限变更后也需要重新发布。
