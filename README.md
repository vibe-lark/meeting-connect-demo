# MeetBack 会议同步台

飞书会议开放能力 demo：在自研页面发起真实飞书会议，并把会后的妙记线索和智能纪要文档回写到真实多维表格。

## 体验方式

体验地址：[https://meeting-connect.dev.solutionsuite.cn](https://meeting-connect.dev.solutionsuite.cn)

体验流程：

1. 打开体验地址，点击“飞书登录”完成授权。
2. 填写会议主题，点击创建会议。
3. 进入飞书会议，开启录制和智能纪要。
4. 结束会议，等待飞书生成妙记和智能纪要文档。
5. 回到页面查看会议状态、妙记链接、智能纪要链接和多维表格回写结果。

## 部署方式

### 部署流程

1. 安装依赖：

```bash
npm install
```

2. 创建环境变量文件：

```bash
cp .env.example .env
```

3. 配置 `.env`：

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=replace_with_app_secret
FEISHU_USER_ID_TYPE=open_id
FEISHU_OAUTH_REDIRECT_URI=https://meeting-connect.dev.solutionsuite.cn/api/feishu/oauth/callback
FEISHU_OAUTH_SCOPE=minutes:minutes.basic:read minutes:minutes.artifacts:read vc:record vc:note:read offline_access
```

如果飞书事件订阅开启了 Encrypt Key，再配置：

```bash
FEISHU_ENCRYPT_KEY=replace_with_encrypt_key
```

4. 在飞书开放平台配置网页应用回调地址：

```text
https://meeting-connect.dev.solutionsuite.cn/api/feishu/oauth/callback
```

5. 在飞书开放平台配置事件订阅地址：

```text
https://meeting-connect.dev.solutionsuite.cn/api/feishu/events
```

6. 创建或修复演示用多维表格：

```bash
npm run bootstrap:base
```

7. 启动服务：

```bash
npm run start
```

本地开发可使用：

```bash
npm run dev
```

8. 验证部署：

```bash
npm test
npm run status:demo
npm run audit:completion
```

### 需要的接口

飞书认证：

- `POST /open-apis/auth/v3/tenant_access_token/internal`
- `POST /open-apis/auth/v3/app_access_token/internal`
- `GET https://accounts.feishu.cn/open-apis/authen/v1/authorize`
- `POST /open-apis/authen/v1/access_token`
- `POST /open-apis/authen/v1/refresh_access_token`

飞书会议：

- `POST /open-apis/vc/v1/reserves/apply`
- `GET /open-apis/vc/v1/reserves/:reserve_id`
- `GET /open-apis/vc/v1/meetings/list_by_no`
- `GET /open-apis/vc/v1/meetings/:meeting_id/recording`
- `PATCH /open-apis/vc/v1/meetings/:meeting_id/recording/set_permission`

飞书妙记和智能纪要：

- `GET /open-apis/minutes/v1/minutes/:minute_token`
- `GET /open-apis/minutes/v1/minutes/:minute_token/artifacts`
- `GET /open-apis/vc/v1/notes/:note_id`

飞书多维表格：

- `POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records`
- `PUT /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id`

事件回调：

- `POST /api/feishu/events`
- 订阅事件：`vc.meeting.recording_ready_v1`

必要权限：

- `vc:reserve`
- `vc:reserve:readonly`
- `vc:record`
- `vc:note:read`
- `minutes:minutes.basic:read`
- `minutes:minutes.artifacts:read`
- `offline_access`
- `base:record:create`
- `base:record:update`
