const baseUrl = process.env.DEMO_BASE_URL || 'https://meeting-connect.dev.solutionsuite.cn';

import { hasVerifiedMinutesSummary } from '../src/meeting-sync.js';

main().catch((error) => {
  console.error(`Retry summary sync failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const response = await postJson('/api/feishu/events/retry-latest-summary', {});

  const syncedRecord = response.record || {};
  const event = response.event || {};
  console.log(`Retrying meeting ${event.meetingNo || syncedRecord.meetingNo || '-'} reserveId=${syncedRecord.reserveId || '-'} minute_token=${event.minuteToken || syncedRecord.minuteToken || '-'}`);
  console.log(`Sync status: ${syncedRecord.status || '-'} ${syncedRecord.bitableSyncStatus || '-'}`);
  console.log(`Base record: ${syncedRecord.bitableRecordId || '-'}`);
  console.log(`Summary title: ${syncedRecord.summaryTitle || '-'}`);
  if (!hasVerifiedMinutesSummary(syncedRecord)) {
    const hasSyncWarning = Array.isArray(syncedRecord.artifacts)
      && syncedRecord.artifacts.some((item) => item?.type === '同步提示');
    if (hasSyncWarning) {
      throw new Error('最近一次同步仍包含 Minutes 同步提示，请重新完成 SSO 授权后运行 npm run check:permissions。');
    }
    throw new Error('最近一次同步仍没有可验证的智能纪要文档；请确认会议已开启智能纪要，并等待飞书生成以“智能纪要”开头的文档。');
  }
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
    throw new Error(`${pathname} returned HTTP ${response.status}: ${errorMessage}`);
  }
  return payload;
}
