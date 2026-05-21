# 飞书 OpenAPI 检索证据

检索方式来自 `https://github.com/vibe-lark/feishu-openapi-doc-rag`：

```bash
python3 skills/feishu-openapi-doc-rag/scripts/bootstrap_index_from_cdn.py
PYTHONPATH=skills/feishu-openapi-doc-rag/vendor python3 -m openapi_doc_cli grep "视频会议 预约" --limit 30
PYTHONPATH=skills/feishu-openapi-doc-rag/vendor python3 -m openapi_doc_cli show developer_6960861158129008643 --head 220
PYTHONPATH=skills/feishu-openapi-doc-rag/vendor python3 -m openapi_doc_cli show developer_6960861158128959491 --head 220
PYTHONPATH=skills/feishu-openapi-doc-rag/vendor python3 -m openapi_doc_cli show developer_7181729161035628545 --head 220
PYTHONPATH=skills/feishu-openapi-doc-rag/vendor python3 -m openapi_doc_cli show developer_7621494177948142790 --head 220
PYTHONPATH=skills/feishu-openapi-doc-rag/vendor python3 -m openapi_doc_cli show developer_7621600266278522080 --head 220
```

## 创建真实会议

文档：服务端 API / 视频会议 / 预约 / 预约会议  
文档 ID：`developer_6960861158129008643`  
URL：`https://open.feishu.cn/document/server-docs/vc-v1/reserve/apply`

核心请求：

```text
POST https://open.feishu.cn/open-apis/vc/v1/reserves/apply
Authorization: Bearer tenant_access_token
Content-Type: application/json; charset=utf-8
```

关键字段：

- `owner_id`：使用 `tenant_access_token` 时必填。
- `end_time`：预约到期时间，Unix 秒。
- `meeting_settings.topic`：会议主题。
- `meeting_settings.meeting_initial_type`：多人会议使用 `1`。
- `meeting_settings.auto_record`：是否自动录制。

核心返回：

- `reserve.id`
- `reserve.meeting_no`
- `reserve.password`
- `reserve.url`
- `reserve.app_link`

## 获取预约

文档：服务端 API / 视频会议 / 预约 / 获取预约  
文档 ID：`developer_6921909217674936347`  
URL：`https://open.feishu.cn/document/server-docs/vc-v1/reserve/get`

核心请求：

```text
GET https://open.feishu.cn/open-apis/vc/v1/reserves/:reserve_id
Authorization: Bearer tenant_access_token
```

## 获取智能纪要详情

文档：服务端 API / 视频会议 / 纪要 / 获取纪要详情  
文档 ID：`developer_7621600266278522080`  
URL：`https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/vc-v1/note/get`

核心请求：

```text
GET https://open.feishu.cn/open-apis/vc/v1/notes/:note_id
Authorization: Bearer user_access_token
```

关键限制：

- 只能获取用户可见的纪要文档和关联产物。
- 该接口需要 `user_access_token`，不是 `tenant_access_token`。
- 权限要求：`vc:note:read`。

## 录制完成事件

文档：事件 / 视频会议 / 录制完成  
文档 ID：`developer_6960861158128959491`

本 demo 订阅事件：

```text
vc.meeting.recording_ready_v1
```

服务端处理：

- 从 `event.meeting.meeting_no` 匹配 Meeting Base 里的原会议记录。
- 从 `event.url` 提取 `minute_token`。
- 调用 Minutes API 读取妙记和 AI 产物。

## 获取妙记信息

文档：妙记 / 获取妙记信息  
文档 ID：`developer_7181729161035628545`

核心请求：

```text
GET https://open.feishu.cn/open-apis/minutes/v1/minutes/:minute_token
Authorization: Bearer user_access_token
```

核心返回：

- 妙记标题
- 妙记 URL
- `note_id`

当前运行态验证：

- 使用 `tenant_access_token` 读取当前验收 `minute_token` 返回 `permission deny`。
- 使用已保存的 SSO `user_access_token` 读取时返回 `99991679`，提示用户身份缺少 `minutes:minutes.basic:read`。
- 因此当前 demo 的 Minutes 基础信息读取必须依赖页面 SSO 授权后的用户身份。

## 获取妙记 AI 产物

文档：妙记 / 获取妙记 AI 产物  
文档 ID：`developer_7621494177948142790`

核心请求：

```text
GET https://open.feishu.cn/open-apis/minutes/v1/minutes/:minute_token/artifacts
Authorization: Bearer user_access_token
```

同步到 Base：

- `summary` 写入 `关键结论`
- `minute_chapters` 写入 `关键结论`
- `minute_todos` 写入 `待办事项`

当前运行态验证：

- 使用 `tenant_access_token` 读取 `/artifacts` 返回应用身份权限缺失 `minutes:minutes.artifacts:read`。
- 使用已保存的 SSO `user_access_token` 读取 `/artifacts` 可返回 `code=0`，但当前数据为空对象，还没有可验收的 summary/chapter/todo 内容。

## 多维表格新增记录

文档：服务端 API / 云文档 / 多维表格 / 记录 / 新增记录  
文档 ID：`developer_6952707657162522626`  
URL：`https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create`

核心请求：

```text
POST https://open.feishu.cn/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records
Authorization: Bearer tenant_access_token
Content-Type: application/json; charset=utf-8
```

权限要求：

- `base:record:create`
- 或 `bitable:app`

## 创建多维表格

文档：服务端 API / 云文档 / 多维表格 / 多维表格 / 创建多维表格  
文档 ID：`developer_7047733935745007620`  
URL：`https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/create`

核心请求：

```text
POST https://open.feishu.cn/open-apis/bitable/v1/apps
Authorization: Bearer tenant_access_token
Content-Type: application/json; charset=utf-8
```

核心返回：

- `app.app_token`
- `app.default_table_id`
- `app.url`

权限要求：

- `base:app:create`
- 或 `bitable:app`

## 更新云文档权限设置

文档：服务端 API / 云文档 / 权限 / 设置 / 更新云文档权限设置  
文档 ID：`developer_7224057619119128580`  
URL：`https://open.feishu.cn/document/server-docs/docs/permission/permission-public/patch-2`

核心请求：

```text
PATCH https://open.feishu.cn/open-apis/drive/v2/permissions/:token/public?type=bitable
Authorization: Bearer tenant_access_token
Content-Type: application/json; charset=utf-8
```

本 demo 设置：

- `external_access_entity=open`
- `link_share_entity=anyone_readable`

## 多维表格更新记录

文档：服务端 API / 云文档 / 多维表格 / 记录 / 更新记录  
文档 ID：`developer_6952707657162637314`  
URL：`https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update`

核心请求：

```text
PUT https://open.feishu.cn/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id
Authorization: Bearer tenant_access_token
Content-Type: application/json; charset=utf-8
```

权限要求：

- `base:record:update`
- 或 `bitable:app`
