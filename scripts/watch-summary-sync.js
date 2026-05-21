const baseUrl = process.env.DEMO_BASE_URL || 'https://meeting-connect.dev.solutionsuite.cn';
const timeoutMs = Number(process.env.WATCH_TIMEOUT_MS || 15 * 60 * 1000);
const intervalMs = Number(process.env.WATCH_INTERVAL_MS || 15 * 1000);

import { hasVerifiedMinutesSummary } from '../src/meeting-sync.js';

main().catch((error) => {
  console.error(`Watch summary sync failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const result = await retryLatestSummary().catch((error) => ({ ok: false, error }));
    if (result.ok) {
      console.log(`PASS attempt=${attempt} summary synced`);
      console.log(`Record: ${result.record.reserveId} ${result.record.bitableSyncStatus}`);
      console.log(`Summary: ${result.record.summaryTitle || '-'}`);
      return;
    }

    console.log(`WAIT attempt=${attempt} ${simplifyError(result.error.message)}`);
    await sleep(intervalMs);
  }

  throw new Error(`等待超时：${Math.round(timeoutMs / 1000)} 秒内没有完成真实妙记同步。`);
}

async function retryLatestSummary() {
  const payload = await postJson('/api/feishu/events/retry-latest-summary', {});
  const record = payload.record || {};
  if (!hasVerifiedMinutesSummary(record)) {
    throw new Error(`重试返回未完成状态：${record.status || '-'} ${record.bitableSyncStatus || '-'}`);
  }
  return { ok: true, record };
}

async function postJson(pathname, body) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = payload.error?.message || payload.message || payload.error?.code || payload.code || 'unknown error';
    throw new Error(errorMessage);
  }
  return payload;
}

function simplifyError(message) {
  if (/minutes:minutes\.(basic:read|artifacts:read)/i.test(message)) {
    return '需要用户授权 minutes:minutes.basic:read 和 minutes:minutes.artifacts:read，请先在页面完成飞书授权登录';
  }
  if (/permission deny/i.test(message)) {
    return 'permission deny，请确认已用会议归属人完成飞书授权登录';
  }
  return message;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
