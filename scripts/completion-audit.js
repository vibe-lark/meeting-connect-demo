const baseUrl = process.env.DEMO_BASE_URL || 'https://meeting-connect.dev.solutionsuite.cn';

import { findLatestMinutesSyncCandidate, hasVerifiedMinutesSummary } from '../src/meeting-sync.js';

const checks = [];
let missingMinutesPermission = false;
let fallbackOnlySummary = false;
let hasMinutesReadWarning = false;
let hasMissingBasicReadWarning = false;

main().catch((error) => {
  console.error(`Completion audit failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const [config, records, events, oauth] = await Promise.all([
    getJson('/api/config/status'),
    getJson('/api/records'),
    getJson('/api/feishu/events/status'),
    getJson('/api/feishu/oauth/status')
  ]);

  check('飞书应用配置存在', config.hasAppId && config.hasAppSecret);
  check('SSO 当前用户可作为 Owner', Boolean(oauth.openId));
  check('使用真实 Feishu Base', config.tableStorage === 'FEISHU_BITABLE' && Boolean(config.baseUrl));
  check('飞书用户登录态可用', oauth.authenticated || oauth.authorized || oauth.canRefresh);

  const meetingRecords = Array.isArray(records.records) ? records.records : [];
  check('页面只展示当前 Owner 会议记录', meetingRecords.every((record) => !record.ownerId || record.ownerId === oauth.openId));
  check('页面只连接当前 Meeting Base', config.baseUrl === 'https://digitalsolution.feishu.cn/base/XJ4tblKyuaH2oks20jfcpn1wnne');

  const syncedMeeting = meetingRecords.find((record) => record.bitableSyncStatus === 'SYNCED' && record.meetingNo && record.meetingUrl);
  check('真实会议记录已写入 Base', Boolean(syncedMeeting));
  const latestSummaryCandidate = findLatestMinutesSyncCandidate(meetingRecords);
  hasMinutesReadWarning = Boolean(
    latestSummaryCandidate
    && Array.isArray(latestSummaryCandidate.artifacts)
    && latestSummaryCandidate.artifacts.some((item) => (
      item?.type === '同步提示'
      && /minutes:minutes|Missing scopes|permission/i.test(item.message || '')
    ))
  );
  hasMissingBasicReadWarning = Boolean(
    latestSummaryCandidate
    && Array.isArray(latestSummaryCandidate.artifacts)
    && latestSummaryCandidate.artifacts.some((item) => (
      item?.type === '同步提示'
      && /minutes\.basic:read|minutes:minutes\.basic:read|minutes:minutes:readonly/i.test(item.message || '')
    ))
  );

  const eventLog = Array.isArray(events.events) ? events.events : [];
  missingMinutesPermission = eventLog.some((event) => (
    event.type === 'vc.meeting.recording_ready_v1'
    && event.status === 'FAILED'
    && /minutes:minutes\.artifacts:read|permission deny/i.test(event.error || '')
  ));
  check('飞书妙记用户权限可读取', (oauth.authorized || oauth.canRefresh) && !missingMinutesPermission && !hasMinutesReadWarning);

  const syncedRecordingEvent = eventLog.find((event) => event.type === 'vc.meeting.recording_ready_v1' && event.status === 'SYNCED');
  check('真实 recording_ready 事件已同步', Boolean(syncedRecordingEvent));

  fallbackOnlySummary = Boolean(latestSummaryCandidate && !hasVerifiedMinutesSummary(latestSummaryCandidate));
  const completedSummary = meetingRecords.find((record) => hasVerifiedMinutesSummary(record));
  check('Base 同一条记录已写入纪要字段', Boolean(completedSummary));

  for (const item of checks) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
  }

  const failed = checks.filter((item) => !item.ok);
  if (failed.length) {
    console.error(`\n未完成：${failed.map((item) => item.name).join('、')}`);
    if (missingMinutesPermission) {
      console.error(`\n妙记读取失败：minutes:minutes.artifacts:read 是用户授权权限，请先在页面点击“飞书授权登录”。`);
      console.error(`登录入口：${baseUrl}`);
      console.error(`授权后运行：npm run check:permissions && npm run retry:summary && npm run audit:completion`);
    } else if (fallbackOnlySummary) {
      console.error(`\n纪要字段仍未完成：当前记录没有可验证的智能纪要文档 doc_token，或包含同步提示。`);
      if (hasMissingBasicReadWarning) {
        console.error(`当前记录包含 minutes:minutes.basic:read 缺失提示，请重新完成 SSO 授权。`);
      } else {
        console.error(`如果已经拿到妙记但没有智能纪要文档，请确认会议里已开启智能纪要，并等待飞书生成以“智能纪要”开头的文档。`);
      }
      console.error(`请确认用户授权包含 minutes:minutes.basic:read、minutes:minutes.artifacts:read 和 vc:note:read。`);
      console.error(`重新授权入口：${baseUrl}/api/feishu/oauth/start`);
      console.error(`授权后运行：npm run check:permissions && npm run retry:summary && npm run audit:completion`);
    } else if (!oauth.authorized && !oauth.canRefresh) {
      console.error(`\n用户授权未完成：请先在页面点击“飞书授权登录”。`);
      console.error(`登录入口：${baseUrl}`);
    }
    process.exit(1);
  }

  console.log('\n完成：真实会议会后纪要已自动同步到 Base。');
}

async function getJson(pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}`);
  }
  return payload;
}

function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
}
