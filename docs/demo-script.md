# 客户 Demo 演示脚本

## 演示目标

在自研业务页面内完成：

1. 一键创建真实飞书视频会议。
2. 返回会议号、密码、入会链接。
3. 会后把智能纪要结果同步回自研页面。

## 现场流程

1. 打开 demo 页面。
2. 确认页面显示 SSO 当前用户；如未登录，点击“飞书 SSO 登录”。
3. 填写会议主题，例如“客户方案演示会议”。
4. 点击“发起飞书会议”。
5. 页面出现飞书会议号和入会链接后，点击“打开飞书会议”。
6. 观察下方“会议数据表”，会议记录已自动写入真实 Meeting Base。
7. 会议结束并生成妙记后，飞书向事件 URL 推送 `recording_ready`。
8. 系统自动读取妙记和智能纪要 AI 产物，更新同一条 Meeting Base 记录。
9. 打开 Meeting Base，展示纪要标题、关键结论、待办事项和飞书产物。
10. 如需排查事件是否送达，展开页面底部“技术验收详情”。

## 真实链路

- 会议创建是真实飞书 OpenAPI 调用。
- 服务端会用 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 换取 `tenant_access_token`。
- 创建会议走飞书视频会议预约接口，Owner 使用 SSO 当前用户 `open_id`。
- 每次创建会议和同步纪要都会自动保存到 Meeting Base；Meeting Base 由 API 创建并始终复用同一个。
- 事件回调地址：`https://meeting-connect.dev.solutionsuite.cn/api/feishu/events`

## 自动同步链路

会后自动同步依赖飞书事件：

1. 订阅 `vc.meeting.recording_ready_v1`。
2. 事件里包含妙记 URL，服务端提取 `minute_token`。
3. 服务端读取 Minutes 基础信息和 AI 产物。
4. 使用 SSO 用户 token 读取 Minutes AI 产物、Note 详情和文档产物。
5. 如果用户授权失效，页面会提示重新登录或重试同步。

页面上的“同步纪要到数据表”按钮保留为应急演示入口，正式演示优先展示自动同步。

## Demo 前检查

- 飞书应用已安装到目标租户。
- 应用已开通 `vc:reserve`、`vc:reserve:readonly`、Minutes 基础信息读取、Minutes AI 产物读取、多维表格记录写入权限。
- 应用已订阅 `vc.meeting.recording_ready_v1`，并发布最新版本。
- SSO 当前用户属于同一租户，并具备创建会议、读取妙记和刷新用户 token 所需授权。
- 运行 `npm run bootstrap:base` 创建真实 Meeting Base，并确认页面顶部显示“同步真实 Base”。
- 如果演示 Note 详情读取，还需要 SSO 用户授权包含 `vc:note:read`。
- `npm run check:permissions` 里 `/artifacts` 返回 `PASS` 只代表接口可访问；如果同时出现空产物 `WARN`，仍需等待飞书生成 AI 产物或重新授权后重试。
- 页面顶部“已同步纪要”和步骤条以真实 AI 产物为准；如果只拿到妙记线索但缺少 Minutes 权限，会显示“等待 AI 产物”。
- 页面底部“技术验收详情”里的事件 `SYNCED` 只表示事件已被处理；最终是否闭环仍以 `npm run audit:completion` 通过、Base 同一条记录写入真实 AI 产物为准。
