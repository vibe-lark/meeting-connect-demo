import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';

import { hasMinutesArtifactsContent, normalizeOAuthTokenPayload } from '../src/meeting-sync.js';

const feishuBaseUrl = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn';
const demoBaseUrl = process.env.DEMO_BASE_URL || 'https://meeting-connect.dev.solutionsuite.cn';
const eventLogPath = new URL('../data/feishu-event-log.json', import.meta.url);
const userTokenPath = new URL('../data/feishu-user-token.json', import.meta.url);

main().catch((error) => {
  console.error(`Permission check failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const tokenRecord = await getStoredUserToken();
  const minuteToken = await getLatestMinuteToken();
  if (!minuteToken) {
    console.log('No real minute_token found yet. Finish a real meeting first, then rerun this check.');
    return;
  }
  if (!tokenRecord?.accessToken) {
    console.log(`Checking minute_token: ${minuteToken}`);
    console.log('BLOCKED 用户授权未完成：minutes:minutes.basic:read 和 minutes:minutes.artifacts:read 是用户授权权限，请先在页面点击“飞书授权登录”。');
    console.log(`Login: ${demoBaseUrl}/api/feishu/oauth/start`);
    process.exitCode = 1;
    return;
  }

  console.log(`Checking minute_token: ${minuteToken}`);
  console.log('Using token: stored user_access_token');
  const results = await Promise.all([
    checkEndpoint(`/open-apis/minutes/v1/minutes/${encodeURIComponent(minuteToken)}`, tokenRecord.accessToken),
    checkEndpoint(`/open-apis/minutes/v1/minutes/${encodeURIComponent(minuteToken)}/artifacts`, tokenRecord.accessToken, {
      validateContent: hasMinutesArtifactsContent,
      emptyContentMessage: 'artifacts endpoint returned no AI summary/chapter/todo content yet'
    })
  ]);
  if (results.some((ok) => !ok)) {
    process.exitCode = 1;
  }
}

async function getStoredUserToken() {
  let parsed = null;
  try {
    parsed = JSON.parse(await readFile(userTokenPath, 'utf8'));
    if (parsed.accessToken && Number(parsed.expiresAt || 0) - Date.now() > 5 * 60 * 1000) {
      return parsed;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!parsed?.refreshToken || Number(parsed.refreshExpiresAt || 0) <= Date.now()) {
    return null;
  }
  let refreshed;
  try {
    refreshed = await refreshUserAccessToken(parsed.refreshToken);
  } catch (error) {
    const invalidated = {
      ...parsed,
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
      refreshExpiresAt: 0,
      invalidatedAt: new Date().toISOString(),
      refreshError: error.message
    };
    await writeFile(userTokenPath, `${JSON.stringify(invalidated, null, 2)}\n`, 'utf8');
    console.log(`BLOCKED 用户授权已失效：${error.message}`);
    console.log(`Login: ${demoBaseUrl}/api/feishu/oauth/start`);
    return null;
  }
  const merged = {
    ...parsed,
    ...refreshed,
    refreshToken: refreshed.refreshToken || parsed.refreshToken,
    refreshExpiresAt: refreshed.refreshExpiresAt || parsed.refreshExpiresAt,
    refreshError: ''
  };
  await writeFile(userTokenPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

async function refreshUserAccessToken(refreshToken) {
  const appAccessToken = await getAppAccessToken();
  const response = await fetch(`${feishuBaseUrl}/open-apis/authen/v1/refresh_access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(`刷新 user token 失败：${payload.msg || response.status}`);
  }
  return normalizeOAuthTokenPayload(payload);
}

async function getAppAccessToken() {
  const response = await fetch(`${feishuBaseUrl}/open-apis/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0 || !payload.app_access_token) {
    throw new Error(`获取 app_access_token 失败：${payload.msg || response.status}`);
  }
  return payload.app_access_token;
}

async function getLatestMinuteToken() {
  const parsed = JSON.parse(await readFile(eventLogPath, 'utf8'));
  const event = parsed.events?.find((item) => item.minuteToken);
  return event?.minuteToken || '';
}

async function checkEndpoint(pathname, token, { validateContent = null, emptyContentMessage = '' } = {}) {
  const response = await fetch(new URL(pathname, feishuBaseUrl), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.code === 0) {
    console.log(`PASS ${pathname}`);
    if (validateContent && !validateContent(payload.data || {})) {
      console.log(`  WARN ${emptyContentMessage}`);
    }
    return true;
  }

  const missingScopes = payload.error?.permission_violations
    ?.map((item) => item.subject)
    .filter(Boolean);
  console.log(`FAIL ${pathname}`);
  console.log(`  code: ${payload.code || response.status}`);
  console.log(`  msg: ${payload.msg || payload.error?.message || 'unknown error'}`);
  if (missingScopes?.length) {
    console.log(`  missing scopes: ${missingScopes.join(', ')}`);
    console.log(`  demo oauth start: ${demoBaseUrl}/api/feishu/oauth/start`);
  }
  if (payload.msg?.includes('https://open.feishu.cn/')) {
    const link = payload.msg.match(/https:\/\/open\.feishu\.cn\/\S+/)?.[0];
    if (link) console.log(`  auth link: ${link}`);
  }
  return false;
}
