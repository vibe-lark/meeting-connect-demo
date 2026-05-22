const DEFAULT_SUMMARY_HIGHLIGHT = '飞书妙记已生成，系统已完成自动同步。';
const DEFAULT_SUMMARY_ACTION = '打开飞书妙记查看完整纪要和后续行动项。';

export function isVerifiedRecordSummary(record = {}) {
  if (!record) return false;
  if (record.status !== 'SUMMARY_READY' || record.bitableSyncStatus !== 'SYNCED') return false;
  if (!record.summaryTitle || !Array.isArray(record.highlights) || !Array.isArray(record.artifacts)) return false;
  const hasWarning = record.artifacts.some((item) => item?.type === '同步提示');
  const hasAiArtifact = record.artifacts.some((item) => item?.type === 'AI产物' || item?.type === '智能纪要');
  const hasSmartNoteDocument = record.artifacts.some((item) => ['智能纪要文档', '纪要文档', '飞书文档'].includes(item?.type) && item.docToken);
  const hasRealHighlight = record.highlights.some((item) => item && item !== DEFAULT_SUMMARY_HIGHLIGHT);
  const hasRealAction = Array.isArray(record.actions) && record.actions.some((item) => item && item !== DEFAULT_SUMMARY_ACTION);
  return !hasWarning && hasSmartNoteDocument && hasAiArtifact && (hasRealHighlight || hasRealAction);
}

export function hasMinuteLink(record = {}) {
  if (record.minuteUrl || record.minuteToken) return true;
  return Array.isArray(record.artifacts)
    && record.artifacts.some((item) => item?.type === '妙记' && (item.url || item.token));
}

export function getSummaryStepState({ latestRecord = null, recordingEvent = null } = {}) {
  if (isVerifiedRecordSummary(latestRecord)) {
    return { status: 'ok', text: '纪要已回写' };
  }
  if (latestRecord?.status === 'SUMMARY_READY') {
    return { status: 'warn', text: '等待智能纪要' };
  }
  if (recordingEvent?.status === 'FAILED') {
    return { status: 'warn', text: recordingEvent.error || '同步失败' };
  }
  if (recordingEvent?.status === 'SYNCED') {
    return { status: 'warn', text: '等待智能纪要' };
  }
  if (recordingEvent) {
    return { status: 'info', text: eventStatusText(recordingEvent.status) };
  }
  return { status: 'pending', text: '等待会议结束' };
}

export function getSummaryDisplayState(record = {}) {
  if (!record?.summaryTitle) return null;
  const verified = isVerifiedRecordSummary(record);
  if (verified) {
    return {
      verified: true,
      title: record.summaryTitle,
      description: ''
    };
  }
  return {
    verified: false,
    title: '已拿到妙记，等待智能纪要',
    description: '请确认会议里已经开启智能纪要；生成后点击重试同步或等待系统自动回写。'
  };
}

export function getRecordStatusText(recordOrStatus) {
  const record = typeof recordOrStatus === 'object' ? recordOrStatus : null;
  const status = record ? record.status : recordOrStatus;
  if (status === 'SUMMARY_READY' && record && !isVerifiedRecordSummary(record)) {
    return '等待智能纪要';
  }
  const map = {
    RESERVED: '已创建，等待参会人加入',
    SUMMARY_READY: '纪要已同步',
    EXPIRED: '预约已过期'
  };
  return map[status] || '处理中';
}

export function findMinutesPermissionWarning({ records = [], events = [] } = {}) {
  const latestRecord = [...records]
    .filter((record) => record?.summaryTitle || record?.minuteToken || hasMinuteLink(record))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
  const warningRecord = latestRecord && Array.isArray(latestRecord.artifacts)
    && latestRecord.artifacts.some((item) => isMinutesPermissionWarning(item?.message))
    ? latestRecord
    : null;
  if (warningRecord) {
    const artifact = warningRecord.artifacts.find((item) => isMinutesPermissionWarning(item?.message));
    return { message: artifact.message || '' };
  }

  const failedEvent = [...events]
    .filter((event) => event?.type === 'vc.meeting.recording_ready_v1')
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  if (failedEvent?.status === 'FAILED' && isMinutesPermissionWarning(failedEvent.error)) {
    return { message: failedEvent.error || '' };
  }
  return null;
}

export function getOAuthDisplayState({ authenticated = false, openId = '', name = '', updatedAt = '', permissionWarning = null, formatTime = (value) => value } = {}) {
  const displayName = name || maskOwnerId(openId);
  if (authenticated && permissionWarning) {
    return {
      statusText: '需补授权',
      statusClass: 'status-badge warn',
      buttonText: '补充妙记授权',
      metricText: displayName,
      detailText: `当前登录人：${displayName || '已授权用户'}；需要补充读取妙记权限，完成后重试同步。`
    };
  }

  if (authenticated) {
    return {
      statusText: `已登录：${displayName || '飞书用户'}`,
      statusClass: 'status-badge ok',
      buttonText: '已登录',
      metricText: displayName,
      detailText: `当前登录人：${displayName || '飞书用户'}；创建会议时会使用该用户作为会议归属人。`
    };
  }

  return {
    statusText: '需要飞书登录',
    statusClass: 'status-badge warn',
    buttonText: '飞书登录',
    metricText: '未登录',
    detailText: ''
  };
}

export function eventStatusText(status) {
  const map = {
    PROCESSING: '同步中',
    SYNCED: '已同步',
    FAILED: '同步失败',
    IGNORED: '已忽略'
  };
  return map[status] || '等待事件';
}

function isMinutesPermissionWarning(value) {
  return /minutes:minutes\.(basic:read|artifacts:read)|Missing scopes|permission deny/i.test(String(value || ''));
}

function maskOwnerId(ownerId) {
  if (!ownerId) return '未配置';
  if (ownerId.length <= 14) return ownerId;
  return `${ownerId.slice(0, 7)}...${ownerId.slice(-6)}`;
}
