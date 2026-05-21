import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isInternetReadableBasePermission } from '../src/meeting-sync.js';

const feishuBaseUrl = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn';
const dataDir = path.resolve('data');
const baseConfigPath = path.join(dataDir, 'base-config.json');

const fields = [
  { field_name: '会议主题', type: 1 },
  { field_name: '预约ID', type: 1 },
  {
    field_name: '会议状态',
    type: 3,
    ui_type: 'SingleSelect',
    property: {
      options: [
        { name: '已创建', color: 0 },
        { name: '纪要已同步', color: 2 },
        { name: '已过期', color: 4 },
        { name: '处理中', color: 1 }
      ]
    }
  },
  { field_name: '会议号', type: 1 },
  { field_name: '会议链接', type: 15, ui_type: 'Url' },
  { field_name: '归属人ID', type: 1 },
  { field_name: '归属人', type: 1 },
  { field_name: '纪要标题', type: 1 },
  { field_name: '妙记链接', type: 15, ui_type: 'Url' },
  { field_name: '智能纪要链接', type: 15, ui_type: 'Url' },
  { field_name: '关键结论', type: 1 },
  { field_name: '待办事项', type: 1 },
  { field_name: '飞书产物', type: 1 },
  { field_name: '创建时间', type: 5, ui_type: 'DateTime', property: { date_formatter: 'yyyy-MM-dd HH:mm' } },
  { field_name: '更新时间', type: 5, ui_type: 'DateTime', property: { date_formatter: 'yyyy-MM-dd HH:mm' } }
];

main().catch((error) => {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});

async function main() {
  const existing = await readJsonIfExists(baseConfigPath);
  if (existing?.appToken && existing?.tableId) {
    console.log(`Meeting Base already exists: ${existing.url}`);
    console.log(`app_token=${existing.appToken}`);
    console.log(`table_id=${existing.tableId}`);
    const token = await getTenantAccessToken();
    await ensureFields(token, existing.appToken, existing.tableId);
    if (!isInternetReadableBasePermission(existing.publicPermission)) {
      const permission = await openInternetReadable(token, existing.appToken);
      const updated = {
        ...existing,
        publicPermission: permission,
        publicPermissionUpdatedAt: new Date().toISOString()
      };
      await writeFile(baseConfigPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
      console.log('Updated Meeting Base public permission.');
    }
    return;
  }

  const token = await getTenantAccessToken();
  const created = await createBase(token);
  const permission = await openInternetReadable(token, created.appToken);

  const config = {
    appToken: created.appToken,
    tableId: created.tableId,
    url: created.url,
    publicPermission: permission,
    createdAt: new Date().toISOString()
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(baseConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log(`Created Meeting Base: ${created.url}`);
  console.log(`app_token=${created.appToken}`);
  console.log(`table_id=${created.tableId}`);
}

async function ensureFields(token, appToken, tableId) {
  const currentFields = await listFields(token, appToken, tableId);
  const existingNames = new Set(currentFields.map((field) => field.field_name || field.name).filter(Boolean));
  for (const field of fields) {
    if (existingNames.has(field.field_name)) continue;
    await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`, {
      method: 'POST',
      token,
      body: field
    });
    console.log(`Added field: ${field.field_name}`);
  }
}

async function listFields(token, appToken, tableId) {
  const data = await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`, {
    method: 'GET',
    token,
    query: { page_size: '100' }
  });
  return data.items || [];
}

async function createBase(token) {
  const app = await feishuRequest('/open-apis/bitable/v1/apps', {
    method: 'POST',
    token,
    body: {
      name: `Meeting Connect 会议数据表 ${new Date().toISOString().slice(0, 10)}`,
      time_zone: 'Asia/Shanghai'
    }
  });

  const appToken = app.app_token;
  const tableId = app.default_table_id;
  if (!appToken || !tableId) {
    throw new Error('Feishu did not return app_token/default_table_id.');
  }

  for (const field of fields) {
    await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`, {
      method: 'POST',
      token,
      body: field
    });
  }

  return {
    appToken,
    tableId,
    url: app.url
  };
}

async function openInternetReadable(token, appToken) {
  return feishuRequest(`/open-apis/drive/v2/permissions/${encodeURIComponent(appToken)}/public`, {
    method: 'PATCH',
    token,
    query: { type: 'bitable' },
    body: {
      external_access_entity: 'open',
      security_entity: 'anyone_can_view',
      comment_entity: 'anyone_can_view',
      share_entity: 'anyone',
      manage_collaborator_entity: 'collaborator_can_view',
      link_share_entity: 'anyone_readable',
      copy_entity: 'anyone_can_view'
    }
  });
}

async function getTenantAccessToken() {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET in .env.');
  }

  const response = await fetch(`${feishuBaseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw makeFeishuError(response.status, 'TENANT_TOKEN_FAILED', payload);
  }
  return payload.tenant_access_token;
}

async function feishuRequest(pathname, { method, token, query, body }) {
  const url = new URL(pathname, feishuBaseUrl);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw makeFeishuError(response.status, `${method} ${url.pathname} failed`, payload);
  }
  return payload.data?.app || payload.data?.field || payload.data?.member || payload.data?.permission_public || payload.data;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function makeFeishuError(status, message, payload) {
  const error = new Error(`${message}: ${payload.msg || payload.error_description || 'unknown Feishu error'} (${status || 'no status'})`);
  const safePayload = { ...payload };
  delete safePayload.tenant_access_token;
  delete safePayload.access_token;
  delete safePayload.refresh_token;
  error.details = safePayload;
  return error;
}
