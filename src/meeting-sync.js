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
  const hasRealHighlight = record.highlights.some((item) => item && item !== DEFAULT_SUMMARY_HIGHLIGHT);
  const hasRealAction = Array.isArray(record.actions) && record.actions.some((item) => item && item !== DEFAULT_SUMMARY_ACTION);
  return hasAiArtifact && (hasRealHighlight || hasRealAction);
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

export function buildSummaryFromMinutes({ minute = {}, artifacts = {}, note = null, minuteToken = '', noteWarning = '' }) {
  const minuteUrl = minute.url || minute.minute_url || (minuteToken ? `https://meetings.feishu.cn/minutes/${minuteToken}` : '');
  const noteId = minute.note_id || minute.noteId || minute.note?.id || artifacts.note_id || '';
  const highlights = uniqueNonEmpty([
    ...normalizeSummaryItems(artifacts.summary),
    ...normalizeChapterItems(artifacts.minute_chapters || artifacts.chapters)
  ]);
  const actions = uniqueNonEmpty(normalizeTodoItems(artifacts.minute_todos || artifacts.todos));
  const noteArtifacts = normalizeNoteArtifacts(note?.artifacts || []);
  const aiArtifacts = normalizeAiArtifactMarkers(artifacts);
  const artifactsList = [
    minuteUrl ? { type: '妙记', url: minuteUrl, token: minuteToken } : null,
    noteId ? { type: '智能纪要', noteId } : null,
    ...aiArtifacts,
    ...noteArtifacts,
    noteWarning ? { type: '同步提示', message: noteWarning } : null
  ].filter(Boolean);

  return {
    source: 'FEISHU_MINUTES',
    title: minute.title || minute.topic || '飞书妙记已同步',
    syncedAt: new Date().toISOString(),
    minuteToken,
    noteId,
    duration: Number(minute.duration || artifacts.duration || 0),
    highlights: highlights.length ? highlights : [DEFAULT_SUMMARY_HIGHLIGHT],
    actions: actions.length ? actions : [DEFAULT_SUMMARY_ACTION],
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
  const docArtifact = artifacts.find((item) => ['纪要文档', '飞书文档'].includes(item?.type) && item.docToken);
  if (docArtifact?.docToken) {
    return buildFeishuDocUrl(docArtifact.docToken, baseUrl);
  }
  return getRecordMinuteUrl(record);
}

export function buildFeishuDocUrl(docToken = '', baseUrl = '') {
  if (!docToken) return '';
  const origin = baseUrl ? new URL(baseUrl).origin : 'https://feishu.cn';
  return `${origin}/docx/${encodeURIComponent(docToken)}`;
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

export function buildMeetingFromRecordingSync({ event, recordKey, existingRecord = null, existingMeeting = null, minute = {}, summary, defaultOwnerId }) {
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
    ownerId: existingRecord?.ownerId || existingMeeting?.ownerId || defaultOwnerId,
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

function normalizeNoteArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.map((item) => {
    const normalized = {
      type: item.artifact_type === 1 ? '纪要文档' : item.artifact_type === 2 ? '逐字稿文档' : '飞书文档',
      docToken: item.doc_token || item.docToken || ''
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
