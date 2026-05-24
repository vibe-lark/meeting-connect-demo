import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildFeishuDocUrl,
  buildRecordFromBitableRecord,
  getRecordSmartNoteUrl
} from '../src/meeting-sync.js';

const feishuBaseUrl = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn';
const dataDir = path.resolve('data');
const baseConfigPath = path.join(dataDir, 'base-config.json');
const DOC_ARTIFACT_TYPES = ['智能纪要文档', '纪要文档', '飞书文档', '逐字稿文档'];

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const baseConfig = await readJson(baseConfigPath);
  const token = await getTenantAccessToken();
  const rawRecords = await listBitableRecords(baseConfig, token);
  let updated = 0;
  let cleared = 0;
  let skipped = 0;

  for (const rawRecord of rawRecords) {
    const record = buildRecordFromBitableRecord(rawRecord);
    const artifacts = withDocumentUrls(record.artifacts || [], baseConfig.url);
    const smartNoteUrl = getRecordSmartNoteUrl({ ...record, artifacts }, { baseUrl: baseConfig.url });
    const existingSmartNoteUrl = parseBitableUrl(rawRecord.fields?.['智能纪要链接']);
    if (!smartNoteUrl) {
      if (existingSmartNoteUrl) {
        await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(baseConfig.appToken)}/tables/${encodeURIComponent(baseConfig.tableId)}/records/${encodeURIComponent(record.bitableRecordId)}`, {
          method: 'PUT',
          token,
          body: { fields: { '智能纪要链接': null } }
        });
        cleared += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(baseConfig.appToken)}/tables/${encodeURIComponent(baseConfig.tableId)}/records/${encodeURIComponent(record.bitableRecordId)}`, {
      method: 'PUT',
      token,
      body: {
        fields: {
          '飞书产物': artifacts.map((item) => `${item.type || '产物'}:${artifactValueForBitable(item)}`).join('\n'),
          '智能纪要链接': { text: '打开智能纪要', link: smartNoteUrl }
        }
      }
    });
    updated += 1;
  }

  console.log(`Backfilled ${updated} Base records with smart note links. Cleared ${cleared} stale smart note links. Skipped ${skipped} records without smart note documents.`);
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

async function listBitableRecords(baseConfig, token) {
  const fieldNameById = await getBitableFieldNameMap(baseConfig, token);
  const items = [];
  let pageToken = '';
  do {
    const data = await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(baseConfig.appToken)}/tables/${encodeURIComponent(baseConfig.tableId)}/records`, {
      method: 'GET',
      token,
      query: {
        page_size: '100',
        text_field_as_array: 'true',
        ...(pageToken ? { page_token: pageToken } : {}),
        user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id'
      }
    });
    items.push(...(data.items || data.records || []));
    pageToken = data.page_token || data.next_page_token || '';
    if (!data.has_more && !pageToken) break;
  } while (pageToken);

  return items.map((item) => normalizeBitableRecordFieldNames(item, fieldNameById));
}

async function getBitableFieldNameMap(baseConfig, token) {
  const data = await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(baseConfig.appToken)}/tables/${encodeURIComponent(baseConfig.tableId)}/fields`, {
    method: 'GET',
    token,
    query: { page_size: '100' }
  });
  return Object.fromEntries((data.items || []).map((field) => [
    field.field_id || field.id,
    field.field_name || field.name
  ]).filter(([id, name]) => id && name));
}

function normalizeBitableRecordFieldNames(item, fieldNameById) {
  const fields = {};
  for (const [key, value] of Object.entries(item.fields || {})) {
    fields[fieldNameById[key] || key] = value;
  }
  return { ...item, fields };
}

function withDocumentUrls(artifacts, baseUrl) {
  return artifacts.map((item) => {
    if (!DOC_ARTIFACT_TYPES.includes(item.type) || item.url || !item.docToken) return item;
    return { ...item, url: buildFeishuDocUrl(item.docToken, baseUrl) };
  });
}

function artifactValueForBitable(item = {}) {
  if (DOC_ARTIFACT_TYPES.includes(item.type)) {
    return item.url || item.docToken || '';
  }
  return item.noteId || item.url || item.token || item.message || item.kind || item.value || '';
}

function parseBitableUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(parseBitableUrl).find(Boolean) || '';
  if (typeof value === 'object') return value.link || value.url || value.text || '';
  return '';
}

async function feishuRequest(pathname, { method, token, body, query = null }) {
  const url = new URL(pathname, feishuBaseUrl);
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(`请求 Base 失败：${payload.msg || response.status}`);
  }
  return payload.data || payload;
}
