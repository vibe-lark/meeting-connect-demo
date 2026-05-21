const baseUrl = process.env.DEMO_BASE_URL || 'https://meeting-connect.dev.solutionsuite.cn';

import { hasVerifiedMinutesSummary } from '../src/meeting-sync.js';

main().catch((error) => {
  console.error(`Demo status failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const [config, records, events, oauth] = await Promise.all([
    getJson('/api/config/status'),
    getJson('/api/records'),
    getJson('/api/feishu/events/status'),
    getJson('/api/feishu/oauth/status')
  ]);

  const latestRecord = Array.isArray(records.records) ? records.records[0] : null;
  const eventLog = Array.isArray(events.events) ? events.events : [];
  const latestRecordingEvent = eventLog.find((event) => event.type === 'vc.meeting.recording_ready_v1') || null;
  const latestChallengeEvent = eventLog.find((event) => event.type === 'url_verification') || null;
  const readyForCompletion = Boolean(
    latestRecord
    && hasVerifiedMinutesSummary(latestRecord)
    && eventLog.some((event) => event.type === 'vc.meeting.recording_ready_v1' && event.status === 'SYNCED')
  );
  const missingMinutesPermission = eventLog.some((event) => (
    event.type === 'vc.meeting.recording_ready_v1'
    && event.status === 'FAILED'
    && /minutes:minutes\.artifacts:read|permission deny/i.test(event.error || '')
  ));

  console.log(`Demo URL: ${baseUrl}`);
  console.log(`Feishu app: ${config.hasAppId && config.hasAppSecret ? 'READY' : 'MISSING'}`);
  console.log(`Current owner: ${oauth.openId || '-'}`);
  console.log(`Storage: ${config.tableStorage || '-'} ${config.baseUrl || ''}`.trim());
  console.log(`Latest meeting: ${latestRecord ? `${latestRecord.meetingNo} ${latestRecord.status} ${latestRecord.meetingUrl}` : '-'}`);
  console.log(`Latest Base record: ${latestRecord?.bitableRecordId || '-'} ${latestRecord?.bitableSyncStatus || '-'}`);
  console.log(`Challenge: ${latestChallengeEvent ? formatEvent(latestChallengeEvent) : '-'}`);
  console.log(`Latest recording event: ${latestRecordingEvent ? formatEvent(latestRecordingEvent) : '-'}`);
  console.log(`Completion: ${formatCompletion(readyForCompletion, missingMinutesPermission, Boolean(latestRecordingEvent?.status === 'SYNCED'))}`);
}

async function getJson(pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}`);
  }
  return payload;
}

function formatEvent(event) {
  return [
    event.type,
    event.status,
    event.source ? `source=${event.source}` : '',
    event.error ? `error=${event.error}` : ''
  ].filter(Boolean).join(' ');
}

function formatCompletion(readyForCompletion, missingMinutesPermission, hasSyncedRecordingEvent) {
  if (readyForCompletion) {
    return 'READY';
  }
  if (missingMinutesPermission) {
    return 'BLOCKED_MISSING_MINUTES_PERMISSION';
  }
  if (hasSyncedRecordingEvent) {
    return 'WAITING_FOR_VERIFIED_MINUTES_ARTIFACTS';
  }
  return 'WAITING_FOR_REAL_RECORDING_READY';
}
