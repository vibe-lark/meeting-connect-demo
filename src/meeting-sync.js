import crypto from 'node:crypto';

export const RECORDING_READY_EVENT = 'vc.meeting.recording_ready_v1';
export const DEFAULT_OAUTH_SCOPE = [
  'minutes:minutes.basic:read',
  'minutes:minutes.artifacts:read',
  'vc:record',
  'vc:note:read',
  'offline_access'
].join(' ');

export const DEFAULT_SUMMARY_HIGHLIGHT = '飞书妙记已生成，系统已完成自动同步。';
export const DEFAULT_SUMMARY_ACTION = '打开飞书妙记查看完整纪要和后续行动项。';
export const NO_SMART_NOTE_TEXT = '无智能纪要';
export const SMART_NOTE_RETRY_TEXT = '智能纪要重试';
export const MAX_SMART_NOTE_RETRIES = 30;

export function buildFeishuOAuthAuthorizeUrl({ appId, redirectUri, state, scope = DEFAULT_OAUTH_SCOPE, baseUrl = 'https://accounts.feishu.cn' }) {
  const url = new URL('/open-apis/authen/v1/authorize', baseUrl);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (scope) url.searchParams.set('scope', scope);
  return url.toString();
}

export function buildMinutesPermissionAuthUrl(appId = '') {
  if (!appId) return '';
  const url = new URL(`/app/${encodeURIComponent(appId)}/auth`, 'https://open.feishu.cn');
  url.searchParams.set('q', 'minutes:minutes.basic:read minutes:minutes.artifacts:read');
  url.searchParams.set('op_from', 'openapi');
  url.searchParams.set('token_type', 'user');
  return url.toString();
}

export function buildOAuthCallbackDiagnostic({ query = {}, status = 'UNKNOWN', error = null, now = Date.now() } = {}) {
  return {
    at: new Date(now).toISOString(),
    status,
    hasCode: Boolean(String(query.code || '').trim()),
    hasState: Boolean(String(query.state || '').trim()),
    errorCode: error?.code || '',
    errorMessage: error?.message || ''
  };
}

export function normalizeOAuthTokenPayload(payload = {}, now = Date.now()) {
  const data = payload.data || payload;
  const expiresIn = Number(data.expires_in || data.expire || 0);
  const refreshExpiresIn = Number(data.refresh_expires_in || data.refresh_expire || 0);
  return {
    accessToken: data.access_token || '',
    refreshToken: data.refresh_token || '',
    tokenType: data.token_type || 'Bearer',
    openId: data.open_id || data.openid || '',
    unionId: data.union_id || '',
    name: data.name || data.user?.name || '',
    scope: data.scope || '',
    expiresAt: expiresIn ? now + expiresIn * 1000 : 0,
    refreshExpiresAt: refreshExpiresIn ? now + refreshExpiresIn * 1000 : 0,
    updatedAt: new Date(now).toISOString()
  };
}

export function buildReserveApplyBody({
  topic = '客户方案演示会议',
  endTime,
  ownerId = '',
  password = '',
  actionPermissions = []
} = {}) {
  return {
    end_time: String(endTime),
    owner_id: ownerId,
    meeting_settings: {
      topic,
      meeting_initial_type: 1,
      auto_record: true,
      ...(password !== undefined && password !== '' ? { password } : {}),
      action_permissions: actionPermissions
    }
  };
}

export function normalizeFeishuUserInfoPayload(payload = {}) {
  const data = payload.data || payload;
  return {
    openId: data.open_id || data.openid || data.sub || '',
    unionId: data.union_id || '',
    name: data.name || data.cn_name || data.en_name || '',
    avatarUrl: data.avatar_url || data.picture || ''
  };
}

export function parseCookieHeader(header = '') {
  return String(header || '').split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return cookies;
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

export function buildSessionCookie(name, value, { secure = true, maxAgeSeconds = 30 * 24 * 3600 } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`
  ].filter(Boolean).join('; ');
}

export function resolveFeishuErrorStatus(httpStatus = 0, feishuCode = 0) {
  const status = Number(httpStatus || 0);
  const code = Number(feishuCode || 0);
  if (status >= 400) return status;
  if (code === 20026) return 401;
  if (code === 99991679) return 403;
  return 502;
}

export function isUserTokenUsable(tokenRecord = {}, now = Date.now(), skewMs = 5 * 60 * 1000) {
  if (!tokenRecord) return false;
  return Boolean(tokenRecord.accessToken && Number(tokenRecord.expiresAt || 0) - now > skewMs);
}

export function resolveMeetingOwner(tokenRecord = {}, { now = Date.now() } = {}) {
  if (!tokenRecord?.openId) return null;
  const canUseAccessToken = isUserTokenUsable(tokenRecord, now);
  const canRefresh = Boolean(tokenRecord.refreshToken && Number(tokenRecord.refreshExpiresAt || 0) > now);
  if (!canUseAccessToken && !canRefresh) return null;
  return {
    openId: tokenRecord.openId,
    name: tokenRecord.name || '',
    source: 'SSO'
  };
}

export function isInternetReadableBasePermission(permission = {}) {
  return permission.external_access_entity === 'open'
    && permission.link_share_entity === 'anyone_readable'
    && permission.security_entity === 'anyone_can_view';
}

export function hasVerifiedMinutesSummary(record = {}) {
  if (record.status !== 'SUMMARY_READY' || record.bitableSyncStatus !== 'SYNCED') return false;
  if (!record.summaryTitle || !Array.isArray(record.highlights) || !Array.isArray(record.artifacts)) return false;

  const hasSyncWarning = record.artifacts.some((item) => item?.type === '同步提示');
  if (hasSyncWarning) return false;

  const hasAiArtifact = record.artifacts.some((item) => item?.type === 'AI产物' || item?.type === '智能纪要');
  const hasSmartNoteDocument = record.artifacts.some((item) => ['智能纪要文档', '纪要文档', '飞书文档'].includes(item?.type) && item.docToken);
  const hasRealHighlight = record.highlights.some((item) => item && item !== DEFAULT_SUMMARY_HIGHLIGHT);
  const hasRealAction = Array.isArray(record.actions) && record.actions.some((item) => item && item !== DEFAULT_SUMMARY_ACTION);
  return hasSmartNoteDocument && hasAiArtifact && (hasRealHighlight || hasRealAction);
}

export function needsSmartNoteDocumentRetry(record = {}) {
  if (record.status !== 'SUMMARY_READY' || record.bitableSyncStatus !== 'SYNCED') return false;
  if (!record.minuteToken) return false;
  if (hasNoSmartNote(record)) return false;
  if (getSmartNoteRetryCount(record) >= MAX_SMART_NOTE_RETRIES) return false;
  return !hasVerifiedMinutesSummary(record);
}

export function hasNoSmartNote(record = {}) {
  return Array.isArray(record?.artifacts)
    && record.artifacts.some((item) => item?.type === NO_SMART_NOTE_TEXT);
}

export function getSmartNoteRetryCount(recordOrSummary = {}) {
  const artifact = Array.isArray(recordOrSummary.artifacts)
    ? recordOrSummary.artifacts.find((item) => item?.type === SMART_NOTE_RETRY_TEXT)
    : null;
  const count = Number(artifact?.count ?? artifact?.value ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function resolveSmartNoteRetrySummary({ previousRecord = null, summary = {} } = {}) {
  if (hasVerifiedMinutesSummary({
    status: 'SUMMARY_READY',
    bitableSyncStatus: 'SYNCED',
    summaryTitle: summary.title,
    highlights: summary.highlights || [],
    actions: summary.actions || [],
    artifacts: summary.artifacts || []
  }) || hasNoSmartNote(summary)) {
    return summary;
  }

  const retryCount = Math.min(getSmartNoteRetryCount(previousRecord) + 1, MAX_SMART_NOTE_RETRIES);
  const artifacts = [
    ...(Array.isArray(summary.artifacts) ? summary.artifacts.filter((item) => item?.type !== SMART_NOTE_RETRY_TEXT && item?.type !== NO_SMART_NOTE_TEXT) : []),
    { type: SMART_NOTE_RETRY_TEXT, count: retryCount }
  ];

  if (retryCount >= MAX_SMART_NOTE_RETRIES) {
    return {
      ...summary,
      title: NO_SMART_NOTE_TEXT,
      highlights: [NO_SMART_NOTE_TEXT],
      actions: [],
      artifacts: [
        ...artifacts,
        { type: NO_SMART_NOTE_TEXT }
      ]
    };
  }

  return {
    ...summary,
    artifacts
  };
}

export function findLatestMinutesSyncCandidate(records = []) {
  return [...records]
    .filter((record) => (
      record?.status === 'SUMMARY_READY'
      && record?.bitableSyncStatus === 'SYNCED'
      && Boolean(record?.minuteToken)
    ))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
}

export function hasMinutesArtifactsContent(artifacts = {}) {
  return Boolean(
    normalizeSummaryItems(artifacts.summary).length
    || normalizeChapterItems(artifacts.minute_chapters || artifacts.chapters).length
    || normalizeTodoItems(artifacts.minute_todos || artifacts.todos).length
  );
}

export function extractMinuteToken(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/minutes\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  } catch {
    const match = url.match(/\/minutes\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }
}

export function normalizeMeetingNo(value) {
  return String(value || '').replace(/\D/g, '');
}

export function hasRealSummaryInput(input = {}) {
  return Boolean(
    String(input.minuteUrl || '').trim()
    || String(input.minuteToken || '').trim()
    || String(input.noteId || '').trim()
  );
}

export function normalizeFeishuEvent(body) {
  const event = body?.event || {};
  const meeting = event.meeting || body?.meeting || {};
  const minuteUrl = event.url || event.recording_url || event.recording?.url || body?.url || '';
  const meetingNo = normalizeMeetingNo(meeting.meeting_no || meeting.meetingNo || body?.meeting_no);

  return {
    type: body?.header?.event_type || body?.event_type || body?.type || body?.schema || 'unknown',
    meetingId: meeting.id || meeting.meeting_id || body?.meeting_id || '',
    meetingNo,
    minuteUrl,
    minuteToken: extractMinuteToken(minuteUrl),
    duration: Number(event.duration || body?.duration || 0)
  };
}

export function findMeetingIdFromListByNoPayload(payload, meetingNo = '') {
  const expectedNo = normalizeMeetingNo(meetingNo);
  const candidates = findObjectsDeep(payload).filter((item) => {
    const itemNo = normalizeMeetingNo(item.meeting_no || item.meetingNo || item.no);
    return !expectedNo || !itemNo || itemNo === expectedNo;
  });

  const matched = candidates.find((item) => item.id || item.meeting_id || item.meetingId);
  return matched?.id || matched?.meeting_id || matched?.meetingId || '';
}

export function findFirstMinuteUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    return extractMinuteToken(value) ? value : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findFirstMinuteUrl(item);
      if (url) return url;
    }
    return '';
  }
  if (typeof value === 'object') {
    const preferredKeys = ['url', 'recording_url', 'recordingUrl', 'minute_url', 'minuteUrl'];
    for (const key of preferredKeys) {
      const url = findFirstMinuteUrl(value[key]);
      if (url) return url;
    }
    for (const item of Object.values(value)) {
      const url = findFirstMinuteUrl(item);
      if (url) return url;
    }
  }
  return '';
}

export function buildRecordingReadyEventFromRecordingPayload(payload, fallback = {}) {
  const minuteUrl = findFirstMinuteUrl(payload);
  const minuteToken = extractMinuteToken(minuteUrl);
  if (!minuteToken) return null;
  return {
    type: RECORDING_READY_EVENT,
    meetingId: fallback.meetingId || '',
    meetingNo: normalizeMeetingNo(fallback.meetingNo),
    minuteUrl,
    minuteToken,
    duration: Number(payload?.duration || payload?.recording?.duration || fallback.duration || 0)
  };
}

export function normalizeFeishuEventBody(body, encryptKey = '') {
  if (!body?.encrypt) return body || {};
  if (!encryptKey) {
    throw new Error('收到飞书加密事件，但未配置 FEISHU_ENCRYPT_KEY。');
  }
  return JSON.parse(decryptFeishuPayload(body.encrypt, encryptKey));
}

export function decryptFeishuPayload(encrypt, encryptKey) {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const encrypted = Buffer.from(encrypt, 'base64');
  const iv = encrypted.subarray(0, 16);
  const data = encrypted.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return stripPkcs7Padding(decrypted).toString('utf8');
}

export function extractFeishuChallenge(body) {
  return body?.challenge || body?.event?.challenge || '';
}

function stripPkcs7Padding(buffer) {
  if (!buffer.length) return buffer;
  const padLength = buffer[buffer.length - 1];
  if (padLength < 1 || padLength > 16) return buffer;
  return buffer.subarray(0, buffer.length - padLength);
}

export function findRecordKeyForRecordingEvent(records, event) {
  const eventMeetingNo = normalizeMeetingNo(event?.meetingNo);
  if (!eventMeetingNo) return '';

  for (const [key, record] of records.entries()) {
    if (normalizeMeetingNo(record.meetingNo) === eventMeetingNo) {
      return key;
    }
  }
  return '';
}

export function buildSummaryFromMinutes({ minute = {}, artifacts = {}, note = null, minuteToken = '', noteWarning = '', baseUrl = '' }) {
  const minuteUrl = minute.url || minute.minute_url || (minuteToken ? `https://meetings.feishu.cn/minutes/${minuteToken}` : '');
  const noteId = minute.note_id || minute.noteId || minute.note?.id || artifacts.note_id || '';
  const highlights = uniqueNonEmpty([
    ...normalizeSummaryItems(artifacts.summary),
    ...normalizeChapterItems(artifacts.minute_chapters || artifacts.chapters)
  ]);
  const actions = uniqueNonEmpty(normalizeTodoItems(artifacts.minute_todos || artifacts.todos));
  const noteArtifacts = normalizeNoteArtifacts(note?.artifacts || [], { baseUrl });
  const aiArtifacts = normalizeAiArtifactMarkers(artifacts);
  const noSmartNote = Boolean(minuteUrl)
    && !noteWarning
    && !noteId
    && aiArtifacts.length === 0
    && !noteArtifacts.some((item) => item.type === '智能纪要文档');
  const artifactsList = [
    minuteUrl ? { type: '妙记', url: minuteUrl, token: minuteToken } : null,
    noteId ? { type: '智能纪要', noteId } : null,
    ...aiArtifacts,
    ...noteArtifacts,
    noSmartNote ? { type: NO_SMART_NOTE_TEXT } : null,
    noteWarning ? { type: '同步提示', message: noteWarning } : null
  ].filter(Boolean);

  return {
    source: 'FEISHU_MINUTES',
    title: noSmartNote ? NO_SMART_NOTE_TEXT : minute.title || minute.topic || '飞书妙记已同步',
    syncedAt: new Date().toISOString(),
    minuteToken,
    noteId,
    duration: Number(minute.duration || artifacts.duration || 0),
    highlights: noSmartNote ? [NO_SMART_NOTE_TEXT] : highlights.length ? highlights : [DEFAULT_SUMMARY_HIGHLIGHT],
    actions: noSmartNote ? [] : actions.length ? actions : [DEFAULT_SUMMARY_ACTION],
    artifacts: artifactsList,
    references: normalizeReferences(note?.references || [])
  };
}

export function getRecordMinuteUrl(record = {}) {
  const artifact = Array.isArray(record.artifacts)
    ? record.artifacts.find((item) => item?.type === '妙记' && (item.url || item.token))
    : null;
  const token = record.minuteToken || artifact?.token || '';
  return record.minuteUrl || artifact?.url || (token ? `https://meetings.feishu.cn/minutes/${token}` : '');
}

export function getRecordSmartNoteUrl(record = {}, { baseUrl = '' } = {}) {
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  const docArtifact = artifacts.find((item) => ['智能纪要文档', '纪要文档', '飞书文档'].includes(item?.type) && (item.url || item.docToken));
  if (docArtifact?.url) {
    return docArtifact.url;
  }
  if (docArtifact?.docToken) {
    return buildFeishuDocUrl(docArtifact.docToken, baseUrl);
  }
  return '';
}

export function buildRecordFromBitableRecord(item = {}) {
  const fields = item.fields || {};
  const artifacts = parseBitableArtifacts(fields['飞书产物']);
  const minuteUrl = parseBitableUrl(fields['妙记链接']);
  return {
    id: parseBitableText(fields['预约ID']) || item.record_id || item.id || '',
    reserveId: parseBitableText(fields['预约ID']) || item.record_id || item.id || '',
    topic: parseBitableText(fields['会议主题']),
    status: statusFromText(parseBitableText(fields['会议状态'])),
    meetingNo: parseBitableText(fields['会议号']),
    meetingUrl: parseBitableUrl(fields['会议链接']),
    password: '',
    ownerId: parseBitableText(fields['归属人ID']),
    ownerName: parseBitableText(fields['归属人']),
    endTime: '',
    meetingId: '',
    minuteToken: extractMinuteToken(minuteUrl) || artifacts.find((artifact) => artifact.type === '妙记')?.token || '',
    minuteUrl,
    duration: 0,
    summarySource: '',
    summaryTitle: parseBitableText(fields['纪要标题']),
    highlights: parseBitableLines(fields['关键结论']),
    actions: parseBitableLines(fields['待办事项']),
    artifacts,
    createdAt: parseBitableTime(fields['创建时间']),
    updatedAt: parseBitableTime(fields['更新时间']),
    bitableRecordId: item.record_id || item.id || '',
    bitableRecordUrl: item.record_url || item.shared_url || '',
    bitableSyncStatus: 'SYNCED',
    bitableSyncError: ''
  };
}

function parseBitableText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => parseBitableText(item)).filter(Boolean).join('');
  }
  if (typeof value === 'object') {
    return String(value.text || value.name || value.value || value.link || value.url || '').trim();
  }
  return '';
}

function parseBitableUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => parseBitableUrl(item)).find(Boolean) || '';
  }
  if (typeof value === 'object') {
    return value.link || value.url || value.text || '';
  }
  return '';
}

function parseBitableLines(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseBitableLines(item)).filter(Boolean);
  }
  return parseBitableText(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function parseBitableArtifacts(value) {
  return parseBitableLines(value).map((line) => {
    const index = line.indexOf(':');
    const type = index === -1 ? line : line.slice(0, index);
    const artifactValue = index === -1 ? '' : line.slice(index + 1);
    if (type === '妙记') {
      return {
        type,
        ...(extractMinuteToken(artifactValue) ? { url: artifactValue, token: extractMinuteToken(artifactValue) } : { token: artifactValue })
      };
    }
    if (['智能纪要文档', '纪要文档', '飞书文档', '逐字稿文档'].includes(type)) {
      const docToken = extractFeishuDocToken(artifactValue);
      return artifactValue.startsWith('http')
        ? { type, url: artifactValue, ...(docToken ? { docToken } : {}) }
        : { type, docToken: artifactValue };
    }
    if (type === '智能纪要') return { type, noteId: artifactValue };
    if (type === 'AI产物') return { type, kind: artifactValue };
    if (type === SMART_NOTE_RETRY_TEXT) return { type, count: Number(artifactValue || 0) || 0 };
    if (type === '同步提示') return { type, message: artifactValue };
    return artifactValue ? { type, value: artifactValue } : { type };
  });
}

function parseBitableTime(value) {
  const text = parseBitableText(value);
  const timestamp = Number(text);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp).toISOString();
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function statusFromText(value) {
  const text = parseBitableText(value);
  const map = {
    已创建: 'RESERVED',
    纪要已同步: 'SUMMARY_READY',
    已过期: 'EXPIRED',
    处理中: 'PROCESSING'
  };
  return map[text] || text || 'RESERVED';
}

export function buildFeishuDocUrl(docToken = '', baseUrl = '') {
  if (!docToken) return '';
  const origin = baseUrl ? new URL(baseUrl).origin : 'https://feishu.cn';
  return `${origin}/docx/${encodeURIComponent(docToken)}`;
}

function extractFeishuDocToken(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const match = url.pathname.match(/\/docx\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function normalizeAiArtifactMarkers(artifacts = {}) {
  const markers = [];
  if (normalizeSummaryItems(artifacts.summary).length) {
    markers.push({ type: 'AI产物', kind: 'summary' });
  }
  if (normalizeChapterItems(artifacts.minute_chapters || artifacts.chapters).length) {
    markers.push({ type: 'AI产物', kind: 'chapters' });
  }
  if (normalizeTodoItems(artifacts.minute_todos || artifacts.todos).length) {
    markers.push({ type: 'AI产物', kind: 'todos' });
  }
  return markers;
}

export function buildMeetingFromRecordingSync({ event, recordKey, existingRecord = null, existingMeeting = null, minute = {}, summary, ownerId = '' }) {
  return {
    ...(existingMeeting || {}),
    id: existingMeeting?.id || recordKey,
    reserveId: recordKey,
    meetingId: event.meetingId || existingMeeting?.meetingId || '',
    topic: existingRecord?.topic || existingMeeting?.topic || minute.title || '飞书视频会议',
    meetingNo: event.meetingNo || existingRecord?.meetingNo || existingMeeting?.meetingNo || '',
    password: existingRecord?.password || existingMeeting?.password || '',
    url: existingRecord?.meetingUrl || existingMeeting?.url || event.minuteUrl || '',
    appLink: existingMeeting?.appLink || '',
    liveLink: existingMeeting?.liveLink || '',
    endTime: existingRecord?.endTime || existingMeeting?.endTime || '',
    status: 'SUMMARY_READY',
    createdAt: existingRecord?.createdAt || existingMeeting?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ownerId: existingRecord?.ownerId || existingMeeting?.ownerId || ownerId,
    ownerName: existingRecord?.ownerName || existingMeeting?.ownerName || '',
    minuteToken: event.minuteToken,
    minuteUrl: event.minuteUrl,
    duration: event.duration || summary.duration,
    summary
  };
}

function normalizeSummaryItems(summary) {
  if (!summary) return [];
  if (typeof summary === 'string') return [summary];
  if (Array.isArray(summary)) {
    return summary.map((item) => {
      if (typeof item === 'string') return item;
      return item.content || item.summary || item.text || item.title || '';
    });
  }
  return [summary.content || summary.summary || summary.text || ''];
}

function normalizeChapterItems(chapters) {
  if (!Array.isArray(chapters)) return [];
  return chapters.map((chapter) => {
    const title = chapter.title || chapter.topic || '';
    const content = chapter.summary_content || chapter.summary || chapter.content || chapter.text || '';
    return title && content ? `${title}：${content}` : title || content;
  });
}

function normalizeTodoItems(todos) {
  if (!Array.isArray(todos)) return [];
  return todos.map((todo) => {
    if (typeof todo === 'string') return todo;
    const content = todo.content || todo.text || todo.task || todo.title || '';
    const owners = Array.isArray(todo.owners)
      ? todo.owners.map((owner) => owner.name || owner.user_name || owner.id || '').filter(Boolean).join('、')
      : Array.isArray(todo.assignees)
        ? todo.assignees.map((owner) => {
            if (typeof owner === 'string') return owner;
            return owner.name || owner.user_name || owner.id || '';
          }).filter(Boolean).join('、')
      : '';
    return owners ? `${content} - ${owners}` : content;
  });
}

function normalizeNoteArtifacts(artifacts, { baseUrl = '' } = {}) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.map((item) => {
    const docToken = item.doc_token || item.docToken || '';
    const normalized = {
      type: item.artifact_type === 1 ? '智能纪要文档' : item.artifact_type === 2 ? '逐字稿文档' : '飞书文档',
      docToken,
      ...(docToken ? { url: buildFeishuDocUrl(docToken, baseUrl) } : {})
    };
    const createTime = item.create_time || item.createTime || '';
    return createTime ? { ...normalized, createTime } : normalized;
  }).filter((item) => item.docToken);
}

function normalizeReferences(references) {
  if (!Array.isArray(references)) return [];
  return references.map((item) => ({
    type: item.reference_type === 1 ? '会中共享文档' : '引用文档',
    docToken: item.doc_token || item.docToken || ''
  })).filter((item) => item.docToken);
}

function uniqueNonEmpty(items) {
  return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));
}

function findObjectsDeep(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => findObjectsDeep(item));
  if (typeof value !== 'object') return [];
  return [
    value,
    ...Object.values(value).flatMap((item) => findObjectsDeep(item))
  ];
}
