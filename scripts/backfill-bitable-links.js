import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getRecordMinuteUrl, getRecordSmartNoteUrl } from '../src/meeting-sync.js';

const feishuBaseUrl = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn';
const dataDir = path.resolve('data');
const recordsPath = path.join(dataDir, 'meeting-records.json');
const baseConfigPath = path.join(dataDir, 'base-config.json');
const userTokenPath = path.join(dataDir, 'feishu-user-token.json');

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const [recordsPayload, baseConfig, userToken] = await Promise.all([
    readJson(recordsPath),
    readJson(baseConfigPath),
    readJson(userTokenPath).catch(() => null)
  ]);
  const token = await getTenantAccessToken();
  const records = (recordsPayload.records || []).filter((record) => record.bitableRecordId);
  let updated = 0;

  for (const record of records) {
    const minuteUrl = getRecordMinuteUrl(record);
    const smartNoteUrl = getRecordSmartNoteUrl(record, { baseUrl: baseConfig.url });
    const fields = {
      '归属人': record.ownerName || (record.ownerId === userToken?.openId ? userToken.name : '') || record.ownerId || ''
    };
    if (minuteUrl) fields['妙记链接'] = { text: '打开妙记', link: minuteUrl };
    if (smartNoteUrl) fields['智能纪要链接'] = { text: '打开智能纪要', link: smartNoteUrl };
    await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(baseConfig.appToken)}/tables/${encodeURIComponent(baseConfig.tableId)}/records/${encodeURIComponent(record.bitableRecordId)}`, {
      method: 'PUT',
      token,
      body: { fields }
    });
    updated += 1;
  }

  console.log(`Backfilled ${updated} Base records with owner/minutes links.`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function getTenantAccessToken() {
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
    throw new Error(`获取 tenant_access_token 失败：${payload.msg || response.status}`);
  }
  return payload.tenant_access_token;
}

async function feishuRequest(pathname, { method, token, body }) {
  const response = await fetch(`${feishuBaseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(`更新 Base 记录失败：${payload.msg || response.status}`);
  }
  return payload.data || payload;
}
