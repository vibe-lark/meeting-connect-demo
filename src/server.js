import 'dotenv/config';
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import {
  RECORDING_READY_EVENT,
  DEFAULT_OAUTH_SCOPE,
  buildFeishuOAuthAuthorizeUrl,
  buildMinutesPermissionAuthUrl,
  buildOAuthCallbackDiagnostic,
  buildMeetingFromRecordingSync,
  buildRecordFromBitableRecord,
  buildReserveApplyBody,
  buildRecordingReadyEventFromRecordingPayload,
  buildSessionCookie,
  buildSummaryFromMinutes,
  extractFeishuChallenge,
  extractMinuteToken,
  findMeetingIdFromListByNoPayload,
  findRecordKeyForRecordingEvent,
  getRecordMinuteUrl,
  getRecordSmartNoteUrl,
  hasRealSummaryInput,
  needsSmartNoteDocumentRetry,
  resolveSmartNoteRetrySummary,
  isUserTokenUsable,
  normalizeFeishuUserInfoPayload,
  normalizeMeetingNo,
  normalizeOAuthTokenPayload,
  normalizeFeishuEventBody,
  normalizeFeishuEvent,
  parseCookieHeader,
  resolveFeishuErrorStatus,
  resolveMeetingOwner
} from './meeting-sync.js';

const app = express();
const port = Number(process.env.PORT || 3107);
const feishuBaseUrl = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn';
const dataDir = path.resolve('data');
const recordsPath = path.join(dataDir, 'meeting-records.json');
const eventLogPath = path.join(dataDir, 'feishu-event-log.json');
const baseConfigPath = path.join(dataDir, 'base-config.json');
const userTokenPath = path.join(dataDir, 'feishu-user-token.json');
const userTokenStorePath = path.join(dataDir, 'feishu-user-tokens.json');
const oauthStatePath = path.join(dataDir, 'feishu-oauth-states.json');
const oauthDiagnosticPath = path.join(dataDir, 'feishu-oauth-diagnostic.json');
const sessionCookieName = 'mc_session';
const generatedBaseConfig = await readJsonIfExists(baseConfigPath);
const bitableConfig = {
  appToken: process.env.FEISHU_BITABLE_APP_TOKEN || generatedBaseConfig?.appToken || '',
  tableId: process.env.FEISHU_BITABLE_TABLE_ID || generatedBaseConfig?.tableId || '',
  url: generatedBaseConfig?.url || ''
};

app.use(helmet({
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: '128kb' }));
app.use(express.static('public'));

const meetings = new Map();
const records = new Map();
let eventLog = [];
let tenantTokenCache = null;
let appTokenCache = null;
let userTokenStore = { sessions: {}, users: {} };
let recordingPollInFlight = false;
const recordingPollBackoff = new Map();
let bitableFieldNameCache = null;

app.set('trust proxy', true);
await loadRecords();
await loadEventLog();
await loadUserToken();

const createMeetingSchema = z.object({
  topic: z.string().trim().min(1).max(120).default('客户方案演示会议'),
  durationMinutes: z.coerce.number().int().min(5).max(1440).default(60),
  password: z.string().regex(/^\d{4,9}$/).optional().or(z.literal(''))
});

const syncSummarySchema = z.object({
  noteId: z.string().trim().min(1).optional(),
  minuteUrl: z.string().trim().min(1).optional(),
  minuteToken: z.string().trim().min(1).optional(),
  userAccessToken: z.string().trim().min(1).optional()
});

app.post('/api/feishu/events', async (req, res, next) => {
  try {
    const eventBody = normalizeFeishuEventBody(req.body, process.env.FEISHU_ENCRYPT_KEY);
    const challenge = extractFeishuChallenge(eventBody);
    if (challenge) {
      await appendEventLog({ type: 'url_verification', status: 'VERIFIED' });
      return res.json({ challenge });
    }

    const event = normalizeFeishuEvent(eventBody);
    const eventType = event.type;
    console.log(`[feishu:event] ${eventType}`);
    if (eventType === RECORDING_READY_EVENT) {
      await appendEventLog({ type: eventType, status: 'PROCESSING', meetingNo: event.meetingNo, minuteToken: event.minuteToken });
      processRecordingReadyInBackground(event);
      return res.json({ code: 0, msg: 'ok', accepted: true });
    }

    await appendEventLog({ type: eventType, status: 'IGNORED' });
    res.json({ code: 0, msg: 'ok', ignored: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/config/status', (req, res) => {
  res.json({
    hasAppId: Boolean(process.env.FEISHU_APP_ID),
    hasAppSecret: Boolean(process.env.FEISHU_APP_SECRET),
    userIdType: process.env.FEISHU_USER_ID_TYPE || 'open_id',
    tableStorage: bitableConfig.appToken && bitableConfig.tableId ? 'FEISHU_BITABLE' : 'LOCAL_FALLBACK_CACHE',
    baseUrl: bitableConfig.url,
    minutesPermissionAuthUrl: buildMinutesPermissionAuthUrl(process.env.FEISHU_APP_ID || '')
  });
});

app.get('/api/feishu/oauth/status', async (req, res) => {
  try {
    const sessionId = getSessionId(req, res, { create: true });
    const tokenRecord = await getStoredUserToken({ sessionId, refresh: true });
    const usable = isUserTokenUsable(tokenRecord);
    const canRefresh = isUserTokenRefreshable(tokenRecord);
    res.json({
      authorized: usable,
      canRefresh,
      authenticated: usable || canRefresh,
      openId: tokenRecord?.openId || '',
      name: tokenRecord?.name || '',
      scope: tokenRecord?.scope || '',
      updatedAt: tokenRecord?.updatedAt || '',
      expiresAt: tokenRecord?.expiresAt ? new Date(tokenRecord.expiresAt).toISOString() : '',
      refreshExpiresAt: tokenRecord?.refreshExpiresAt ? new Date(tokenRecord.refreshExpiresAt).toISOString() : '',
      redirectUri: getOAuthRedirectUri(req),
      refreshError: tokenRecord?.refreshError || '',
      lastCallback: await readJsonIfExists(oauthDiagnosticPath)
    });
  } catch (error) {
    res.json({
      authorized: false,
      canRefresh: false,
      authenticated: false,
      openId: '',
      name: '',
      scope: '',
      updatedAt: '',
      expiresAt: '',
      refreshExpiresAt: '',
      redirectUri: getOAuthRedirectUri(req),
      lastCallback: await readJsonIfExists(oauthDiagnosticPath),
      error: error.message
    });
  }
});

app.get('/api/feishu/oauth/login-url', async (req, res, next) => {
  try {
    res.json(await createOAuthLoginPayload(req, res));
  } catch (error) {
    next(error);
  }
});

app.get('/api/feishu/oauth/start', async (req, res, next) => {
  try {
    const payload = await createOAuthLoginPayload(req, res);
    res.redirect(payload.url);
  } catch (error) {
    next(error);
  }
});

app.get('/api/feishu/oauth/callback', async (req, res, next) => {
  try {
    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    if (!code) {
      return sendError(res, 422, 'OAUTH_CODE_MISSING', '飞书授权回调缺少 code。');
    }
    const stateRecord = await verifyOAuthState(state);
    const tokenRecord = await exchangeUserAccessToken(code);
    setSessionCookie(res, stateRecord.sessionId, req);
    await saveUserToken(tokenRecord, { sessionId: stateRecord.sessionId });
    await saveOAuthCallbackDiagnostic(buildOAuthCallbackDiagnostic({
      query: req.query,
      status: 'SUCCESS'
    }));
    res.redirect('/?feishu_auth=success');
  } catch (error) {
    await saveOAuthCallbackDiagnostic(buildOAuthCallbackDiagnostic({
      query: req.query,
      status: 'FAILED',
      error
    }));
    next(error);
  }
});

app.get('/api/records', async (req, res, next) => {
  try {
    const currentUser = await getCurrentFeishuUser(req, { required: true });
    await refreshRecordsFromStore();
    const userRecords = Array.from(records.values())
      .filter((record) => record.ownerId === currentUser.openId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({
      records: userRecords,
      storage: {
        mode: bitableConfig.appToken && bitableConfig.tableId ? 'FEISHU_BITABLE' : 'LOCAL_FALLBACK_CACHE',
        baseUrl: bitableConfig.url,
        localPath: recordsPath
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/feishu/events/status', async (req, res, next) => {
  try {
    const currentUser = await getCurrentFeishuUser(req, { required: true });
    await refreshRecordsFromStore();
    const meetingNos = new Set(Array.from(records.values())
      .filter((record) => record.ownerId === currentUser.openId)
      .map((record) => normalizeMeetingNo(record.meetingNo))
      .filter(Boolean));
    res.json({
      events: eventLog.filter((event) => !event.meetingNo || meetingNos.has(normalizeMeetingNo(event.meetingNo))).slice(0, 20)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/feishu/events/retry-latest-summary', async (req, res, next) => {
  try {
    const currentUser = await getCurrentFeishuUser(req, { required: true });
    await refreshRecordsFromStore();
    const retryEvent = findLatestRetryableRecordingEvent(currentUser.openId);
    if (!retryEvent) {
      return sendError(res, 404, 'RETRYABLE_RECORDING_EVENT_NOT_FOUND', '还没有找到可重试的真实妙记 token。请先结束一场真实会议并等待妙记生成。');
    }

    const record = await syncRecordingReadyEvent(retryEvent, { ownerId: currentUser.openId });
    await appendEventLog({
      type: RECORDING_READY_EVENT,
      status: 'SYNCED',
      source: 'MANUAL_RETRY',
      meetingNo: retryEvent.meetingNo,
      minuteToken: retryEvent.minuteToken,
      reserveId: record.reserveId
    });
    res.json({ record, event: retryEvent });
  } catch (error) {
    next(error);
  }
});

app.post('/api/meetings/:reserveId/sync-recording', async (req, res, next) => {
  try {
    const currentUser = await getCurrentFeishuUser(req, { required: true });
    const record = await getRecordByReserveId(req.params.reserveId);
    if (!record) {
      return sendError(res, 404, 'MEETING_RECORD_NOT_FOUND', '多维表格里没有找到这场会议记录。');
    }
    if (record.ownerId && record.ownerId !== currentUser.openId) {
      return sendError(res, 403, 'MEETING_FORBIDDEN', '这场会议不属于当前登录人。');
    }
    if (!record.meetingNo) {
      return sendError(res, 422, 'MEETING_NO_MISSING', '这条会议记录没有会议号，无法拉取会后产物。');
    }

    const token = await getTenantAccessToken();
    const event = await buildRecordingReadyEventForRecord(record, token);
    await appendEventLog({ type: RECORDING_READY_EVENT, status: 'PROCESSING', source: 'MANUAL_PULL', meetingNo: event.meetingNo, minuteToken: event.minuteToken, reserveId: record.reserveId });
    const syncedRecord = await syncRecordingReadyEvent(event, { ownerId: currentUser.openId });
    await appendEventLog({ type: RECORDING_READY_EVENT, status: 'SYNCED', source: 'MANUAL_PULL', meetingNo: event.meetingNo, minuteToken: event.minuteToken, reserveId: syncedRecord.reserveId });
    res.json({ record: syncedRecord, event });
  } catch (error) {
    await appendEventLog({ type: RECORDING_READY_EVENT, status: 'FAILED', source: 'MANUAL_PULL', reserveId: req.params.reserveId, error: error.message }).catch(() => {});
    next(error);
  }
});

app.post('/api/meetings', async (req, res, next) => {
  try {
    const input = createMeetingSchema.parse(req.body);
    const currentUser = await getCurrentFeishuUser(req, { required: true });
    const token = await getTenantAccessToken();
    const endTime = Math.floor(Date.now() / 1000) + input.durationMinutes * 60;
    const reserve = await feishuRequest('/open-apis/vc/v1/reserves/apply', {
      method: 'POST',
      token,
      query: { user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id' },
      body: buildReserveApplyBody({
        topic: input.topic,
        endTime,
        ownerId: currentUser.openId,
        password: input.password,
        actionPermissions: buildOpenFeishuUserPermissions()
      })
    });

    const meeting = {
      id: reserve.id,
      reserveId: reserve.id,
      topic: input.topic,
      meetingNo: reserve.meeting_no,
      password: reserve.password,
      url: reserve.url,
      appLink: reserve.app_link,
      liveLink: reserve.live_link,
      endTime: reserve.end_time,
      status: 'RESERVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: currentUser.openId,
      ownerName: currentUser.name,
      summary: null
    };
    meetings.set(meeting.reserveId, meeting);
    const record = await saveMeetingRecord(meeting, token);
    res.status(201).json({ meeting, record });
  } catch (error) {
    next(error);
  }
});

app.get('/api/meetings/:reserveId', async (req, res, next) => {
  try {
    const currentUser = await getCurrentFeishuUser(req, { required: true });
    await refreshRecordsFromStore();
    const cached = meetings.get(req.params.reserveId);
    const cachedRecord = records.get(req.params.reserveId);
    if ((cachedRecord?.ownerId || cached?.ownerId) && (cachedRecord?.ownerId || cached?.ownerId) !== currentUser.openId) {
      return sendError(res, 403, 'MEETING_FORBIDDEN', '这场会议不属于当前登录人。');
    }
    const token = await getTenantAccessToken();
    const reserve = await feishuRequest(`/open-apis/vc/v1/reserves/${encodeURIComponent(req.params.reserveId)}`, {
      method: 'GET',
      token,
      query: { user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id' }
    });

    const meeting = {
      ...(cached || {}),
      reserveId: reserve.id,
      topic: reserve.meeting_settings?.topic || cached?.topic || '飞书视频会议',
      meetingNo: reserve.meeting_no,
      password: reserve.password,
      url: reserve.url,
      appLink: reserve.app_link,
      liveLink: reserve.live_link,
      endTime: reserve.end_time,
      status: reserve.expire_status === 2 ? 'EXPIRED' : cached?.summary ? 'SUMMARY_READY' : 'RESERVED',
      updatedAt: new Date().toISOString(),
      summary: cached?.summary || null
    };
    meetings.set(req.params.reserveId, meeting);
    res.json({ meeting });
  } catch (error) {
    next(error);
  }
});

app.post('/api/meetings/:reserveId/sync-summary', async (req, res, next) => {
  try {
    const currentUser = await getCurrentFeishuUser(req, { required: true });
    const input = syncSummarySchema.parse(req.body);
    await refreshRecordsFromStore();
    const existing = meetings.get(req.params.reserveId);
    if (!existing) {
      return sendError(res, 404, 'MEETING_NOT_FOUND', '当前服务内没有找到这场会议，请先发起会议。');
    }
    if (existing.ownerId && existing.ownerId !== currentUser.openId) {
      return sendError(res, 403, 'MEETING_FORBIDDEN', '这场会议不属于当前登录人。');
    }

    if (!hasRealSummaryInput(input)) {
      return sendError(res, 422, 'REAL_SUMMARY_INPUT_REQUIRED', '请填写真实飞书妙记 URL、minute_token 或智能纪要 note_id。');
    }

    if (input.minuteUrl || input.minuteToken) {
      const minuteToken = input.minuteToken || extractMinuteToken(input.minuteUrl);
      if (!minuteToken) {
        return sendError(res, 422, 'MINUTE_TOKEN_MISSING', '请填写有效的飞书妙记 URL 或 minute_token。');
      }
      const record = await syncRecordingReadyEvent({
        type: RECORDING_READY_EVENT,
        meetingId: existing.meetingId || '',
        meetingNo: existing.meetingNo || '',
        minuteUrl: input.minuteUrl || `https://meetings.feishu.cn/minutes/${minuteToken}`,
        minuteToken,
        duration: 0
      }, { ownerId: currentUser.openId });
      return res.json({ meeting: meetings.get(record.reserveId), record });
    }

    const summary = await getRealNoteSummary(input.noteId, input.userAccessToken || await getUserAccessToken({ req, required: true }));

    const meeting = {
      ...existing,
      status: 'SUMMARY_READY',
      updatedAt: new Date().toISOString(),
      summary
    };
    meetings.set(req.params.reserveId, meeting);
    const token = await getTenantAccessToken();
    const record = await saveMeetingRecord(meeting, token);
    res.json({ meeting, record });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof z.ZodError) {
    return sendError(res, 422, 'VALIDATION_ERROR', '请求参数不符合 demo 接口要求。', error.flatten());
  }
  if (error instanceof FeishuApiError) {
    return sendError(res, error.status, error.code, error.message, error.details);
  }
  console.error(error);
  sendError(res, 500, 'INTERNAL_ERROR', '服务暂时不可用，请查看服务端日志。');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Meeting Connect demo is running on http://0.0.0.0:${port}`);
});

startRecordingPolling();

async function getTenantAccessToken() {
  ensureFeishuAppConfigured();
  if (tenantTokenCache && tenantTokenCache.expiresAt - Date.now() > 30 * 60 * 1000) {
    return tenantTokenCache.token;
  }

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
    throw new FeishuApiError(resolveFeishuErrorStatus(response.status, payload.code), 'TENANT_TOKEN_FAILED', payload.msg || '获取 tenant_access_token 失败。', redactFeishuPayload(payload));
  }

  tenantTokenCache = {
    token: payload.tenant_access_token,
    expiresAt: Date.now() + Number(payload.expire || 7200) * 1000
  };
  return tenantTokenCache.token;
}

async function getAppAccessToken() {
  ensureFeishuAppConfigured();
  if (appTokenCache && appTokenCache.expiresAt - Date.now() > 30 * 60 * 1000) {
    return appTokenCache.token;
  }

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
    throw new FeishuApiError(resolveFeishuErrorStatus(response.status, payload.code), 'APP_TOKEN_FAILED', payload.msg || '获取 app_access_token 失败。', redactFeishuPayload(payload));
  }

  appTokenCache = {
    token: payload.app_access_token,
    expiresAt: Date.now() + Number(payload.expire || 7200) * 1000
  };
  return appTokenCache.token;
}

function ensureFeishuAppConfigured() {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    throw new FeishuApiError(500, 'FEISHU_CONFIG_MISSING', '缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET，请先配置 .env。');
  }
}

function getOAuthRedirectUri(req) {
  if (process.env.FEISHU_OAUTH_REDIRECT_URI) return process.env.FEISHU_OAUTH_REDIRECT_URI;
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = host?.endsWith('.dev.solutionsuite.cn')
    ? 'https'
    : req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}/api/feishu/oauth/callback`;
}

function getSessionId(req, res, { create = false } = {}) {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  const existing = cookies[sessionCookieName];
  if (existing) return existing;
  if (!create) return '';
  const sessionId = crypto.randomBytes(18).toString('hex');
  setSessionCookie(res, sessionId, req);
  return sessionId;
}

function setSessionCookie(res, sessionId, req) {
  res.setHeader('Set-Cookie', buildSessionCookie(sessionCookieName, sessionId, {
    secure: isSecureRequest(req)
  }));
}

function isSecureRequest(req) {
  return req.secure
    || req.get('x-forwarded-proto') === 'https'
    || req.get('host')?.endsWith('.dev.solutionsuite.cn');
}

async function createOAuthLoginPayload(req, res) {
  ensureFeishuAppConfigured();
  const sessionId = getSessionId(req, res, { create: true });
  const state = crypto.randomBytes(16).toString('hex');
  const stateRecord = { state, sessionId, createdAt: new Date().toISOString() };
  const redirectUri = getOAuthRedirectUri(req);
  await mkdir(dataDir, { recursive: true });
  await saveOAuthState(stateRecord);
  return {
    url: buildFeishuOAuthAuthorizeUrl({
      appId: process.env.FEISHU_APP_ID,
      redirectUri,
      state,
      scope: process.env.FEISHU_OAUTH_SCOPE || DEFAULT_OAUTH_SCOPE,
      baseUrl: process.env.FEISHU_ACCOUNTS_BASE_URL || 'https://accounts.feishu.cn'
    }),
    redirectUri
  };
}

async function verifyOAuthState(state) {
  if (!state) {
    throw new FeishuApiError(422, 'OAUTH_STATE_MISSING', '飞书授权回调缺少 state，请从页面按钮重新发起授权。');
  }
  const states = await readJsonIfExists(oauthStatePath) || { states: {} };
  const stateRecord = states.states?.[state] || await readJsonIfExists(path.join(dataDir, 'feishu-oauth-state.json'));
  const createdAt = Date.parse(stateRecord?.createdAt || '');
  const expired = !Number.isFinite(createdAt) || Date.now() - createdAt > 10 * 60 * 1000;
  if (!stateRecord?.state || stateRecord.state !== state || expired) {
    throw new FeishuApiError(403, 'OAUTH_STATE_INVALID', '飞书授权状态已失效，请从页面按钮重新发起授权。');
  }
  delete states.states?.[state];
  await writeFile(oauthStatePath, `${JSON.stringify(states, null, 2)}\n`, 'utf8').catch(() => {});
  return stateRecord;
}

async function saveOAuthState(stateRecord) {
  const existing = await readJsonIfExists(oauthStatePath) || { states: {} };
  const now = Date.now();
  const states = Object.fromEntries(Object.entries(existing.states || {}).filter(([, record]) => {
    const createdAt = Date.parse(record.createdAt || '');
    return Number.isFinite(createdAt) && now - createdAt <= 10 * 60 * 1000;
  }));
  states[stateRecord.state] = stateRecord;
  await writeFile(oauthStatePath, `${JSON.stringify({ states }, null, 2)}\n`, 'utf8');
}

async function exchangeUserAccessToken(code) {
  const appAccessToken = await getAppAccessToken();
  const payload = await feishuAuthenRequest('/open-apis/authen/v1/access_token', {
    token: appAccessToken,
    body: {
      grant_type: 'authorization_code',
      code
    }
  });
  const tokenRecord = normalizeOAuthTokenPayload(payload);
  if (!tokenRecord.accessToken || !tokenRecord.refreshToken) {
    throw new FeishuApiError(502, 'USER_TOKEN_INVALID', '飞书授权成功但未返回完整 user token。', redactFeishuPayload(payload));
  }
  return enrichUserTokenWithProfile(tokenRecord);
}

async function refreshUserAccessToken(refreshToken) {
  const appAccessToken = await getAppAccessToken();
  const payload = await feishuAuthenRequest('/open-apis/authen/v1/refresh_access_token', {
    token: appAccessToken,
    body: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }
  });
  const tokenRecord = normalizeOAuthTokenPayload(payload);
  if (!tokenRecord.accessToken) {
    throw new FeishuApiError(502, 'USER_TOKEN_REFRESH_INVALID', '飞书刷新 user token 未返回 access_token。', redactFeishuPayload(payload));
  }
  return enrichUserTokenWithProfile(tokenRecord);
}

async function enrichUserTokenWithProfile(tokenRecord) {
  if (!tokenRecord?.accessToken) return tokenRecord;
  try {
    const profile = normalizeFeishuUserInfoPayload(await getFeishuUserInfo(tokenRecord.accessToken));
    return {
      ...tokenRecord,
      openId: tokenRecord.openId || profile.openId,
      unionId: tokenRecord.unionId || profile.unionId,
      name: profile.name || tokenRecord.name || '',
      avatarUrl: profile.avatarUrl || tokenRecord.avatarUrl || ''
    };
  } catch (error) {
    return {
      ...tokenRecord,
      profileError: error.message
    };
  }
}

async function getFeishuUserInfo(userAccessToken) {
  const response = await fetch(`${feishuBaseUrl}/open-apis/authen/v1/user_info`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${userAccessToken}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new FeishuApiError(resolveFeishuErrorStatus(response.status, payload.code), 'FEISHU_USER_INFO_FAILED', buildFeishuErrorMessage(redactFeishuPayload(payload)), redactFeishuPayload(payload));
  }
  return payload.data || payload;
}

async function feishuAuthenRequest(path, { token, body }) {
  const response = await fetch(`${feishuBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new FeishuApiError(resolveFeishuErrorStatus(response.status, payload.code), 'FEISHU_AUTHEN_FAILED', buildFeishuErrorMessage(redactFeishuPayload(payload)), redactFeishuPayload(payload));
  }
  return payload.data || payload;
}

async function loadUserToken() {
  const store = await readJsonIfExists(userTokenStorePath);
  if (store?.users && store?.sessions) {
    userTokenStore = store;
    return;
  }
  const legacyToken = await readJsonIfExists(userTokenPath);
  userTokenStore = {
    sessions: {},
    users: legacyToken?.openId ? { [legacyToken.openId]: legacyToken } : {}
  };
}

async function saveUserToken(tokenRecord, { sessionId = '', openId = '' } = {}) {
  if (!tokenRecord?.openId && !openId) return;
  const userOpenId = tokenRecord.openId || openId;
  userTokenStore.users[userOpenId] = {
    ...(userTokenStore.users[userOpenId] || {}),
    ...tokenRecord,
    openId: userOpenId
  };
  if (sessionId) {
    userTokenStore.sessions[sessionId] = {
      openId: userOpenId,
      updatedAt: new Date().toISOString()
    };
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(userTokenStorePath, `${JSON.stringify(userTokenStore, null, 2)}\n`, 'utf8');
}

async function saveOAuthCallbackDiagnostic(diagnostic) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(oauthDiagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
}

async function getStoredUserToken({ req = null, sessionId = '', ownerId = '', refresh = true } = {}) {
  if (!Object.keys(userTokenStore.users || {}).length && !Object.keys(userTokenStore.sessions || {}).length) {
    await loadUserToken();
  }
  const effectiveSessionId = sessionId || (req ? getSessionId(req, null, { create: false }) : '');
  const openId = ownerId || userTokenStore.sessions?.[effectiveSessionId]?.openId || '';
  if (!openId) return null;
  const tokenRecord = userTokenStore.users?.[openId] || null;
  if (!tokenRecord) return null;
  if (isUserTokenUsable(tokenRecord) || !refresh) {
    if (refresh && tokenRecord.accessToken && !tokenRecord.name) {
      const enriched = await enrichUserTokenWithProfile(tokenRecord);
      await saveUserToken(enriched, { sessionId: effectiveSessionId, openId });
      return enriched;
    }
    return tokenRecord;
  }
  if (!isUserTokenRefreshable(tokenRecord)) return tokenRecord;

  let refreshed;
  try {
    refreshed = await refreshUserAccessToken(tokenRecord.refreshToken);
  } catch (error) {
    const invalidated = {
      ...tokenRecord,
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
      refreshExpiresAt: 0,
      invalidatedAt: new Date().toISOString(),
      refreshError: error.message
    };
    await saveUserToken(invalidated, { sessionId: effectiveSessionId, openId });
    return invalidated;
  }
  const merged = {
    ...tokenRecord,
    ...refreshed,
    openId,
    refreshToken: refreshed.refreshToken || tokenRecord.refreshToken,
    refreshExpiresAt: refreshed.refreshExpiresAt || tokenRecord.refreshExpiresAt,
    refreshError: ''
  };
  await saveUserToken(merged, { sessionId: effectiveSessionId, openId });
  return merged;
}

function isUserTokenRefreshable(tokenRecord = {}) {
  return Boolean(
    tokenRecord?.refreshToken
    && !tokenRecord.refreshError
    && Number(tokenRecord.refreshExpiresAt || 0) > Date.now()
  );
}

async function getUserAccessToken({ req = null, ownerId = '', required = false } = {}) {
  const tokenRecord = await getStoredUserToken({ req, ownerId, refresh: true });
  if (isUserTokenUsable(tokenRecord)) return tokenRecord.accessToken;
  if (process.env.FEISHU_USER_ACCESS_TOKEN) return process.env.FEISHU_USER_ACCESS_TOKEN;
  if (required) {
    throw new FeishuApiError(401, 'USER_OAUTH_REQUIRED', '需要先在页面点击“飞书授权登录”，授权后才能读取妙记/智能纪要。');
  }
  return '';
}

async function getCurrentFeishuUser(req, { required = false } = {}) {
  const tokenRecord = await getStoredUserToken({ req, refresh: true });
  const owner = resolveMeetingOwner(tokenRecord);
  if (owner) return owner;
  if (required) {
    throw new FeishuApiError(401, 'SSO_LOGIN_REQUIRED', '请先完成飞书 SSO 登录，再发起会议。');
  }
  return null;
}

async function feishuRequest(path, { method, token, query, body }) {
  const url = new URL(path, feishuBaseUrl);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    const redactedPayload = redactFeishuPayload(payload);
    throw new FeishuApiError(resolveFeishuErrorStatus(response.status, payload.code), 'FEISHU_API_FAILED', buildFeishuErrorMessage(redactedPayload), redactedPayload);
  }
  return payload.data?.reserve || payload.data?.note || payload.data?.record || payload.data?.minute || payload.data;
}

async function syncRecordingReadyEvent(event, { ownerId = '' } = {}) {
  if (!event.minuteToken) {
    throw new FeishuApiError(422, 'MINUTE_TOKEN_MISSING', '飞书录制完成事件里没有可解析的妙记 token。', event);
  }

  const token = await getTenantAccessToken();
  await refreshRecordsFromStore(token);
  const recordKey = findRecordKeyForRecordingEvent(records, event) || `event-${event.meetingNo || event.minuteToken}`;
  const existingRecord = records.get(recordKey);
  const existingMeeting = meetings.get(recordKey);
  const effectiveOwnerId = ownerId || existingRecord?.ownerId || existingMeeting?.ownerId || '';
  const minutesReadToken = await getUserAccessToken({ ownerId: effectiveOwnerId, required: true });
  const [minuteResult, artifactsResult] = await Promise.allSettled([
    getMinuteInfo(event.minuteToken, minutesReadToken),
    getMinuteArtifacts(event.minuteToken, minutesReadToken)
  ]);
  if (minuteResult.status === 'rejected' && artifactsResult.status === 'rejected') {
    throw new FeishuApiError(403, 'MINUTES_READ_FAILED', [
      `Minutes info failed: ${minuteResult.reason.message}`,
      `Minutes artifacts failed: ${artifactsResult.reason.message}`
    ].join('；'), {
      minute: minuteResult.reason.details || minuteResult.reason.message,
      artifacts: artifactsResult.reason.details || artifactsResult.reason.message
    });
  }

  const minute = minuteResult.status === 'fulfilled' ? minuteResult.value : {};
  const artifacts = artifactsResult.status === 'fulfilled' ? artifactsResult.value : {};
  const noteId = minute.note_id || minute.noteId || minute.note?.id || artifacts.note_id || '';
  let note = null;
  const noteWarnings = [];

  if (minuteResult.status === 'rejected') {
    noteWarnings.push(`Minutes 基础信息读取失败：${minuteResult.reason.message}`);
  }
  if (artifactsResult.status === 'rejected') {
    noteWarnings.push(`Minutes AI 产物读取失败：${artifactsResult.reason.message}`);
  }

  const userAccessToken = await getUserAccessToken({ ownerId: effectiveOwnerId }).catch(() => '');
  if (noteId && userAccessToken) {
    try {
      note = await getNoteDetail(noteId, userAccessToken);
    } catch (error) {
      noteWarnings.push(`Note 详情读取失败：${error.message}`);
    }
  } else if (noteId) {
    noteWarnings.push('未完成飞书授权登录，已先同步 Minutes AI 产物。');
  }

  const summary = resolveSmartNoteRetrySummary({
    previousRecord: existingRecord,
    summary: buildSummaryFromMinutes({
    minute: {
      ...minute,
      url: minute.url || event.minuteUrl
    },
    artifacts,
    note,
    minuteToken: event.minuteToken,
    noteWarning: noteWarnings.join('；'),
    baseUrl: bitableConfig.url
    })
  });

  const meeting = buildMeetingFromRecordingSync({
    event,
    recordKey,
    existingRecord,
    existingMeeting,
    minute,
    summary,
    ownerId: effectiveOwnerId
  });

  meetings.set(recordKey, meeting);
  return saveMeetingRecord(meeting, token);
}

function startRecordingPolling() {
  const intervalMs = Number(process.env.RECORDING_POLL_INTERVAL_MS || 60000);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

  setTimeout(() => {
    pollRecordings().catch((error) => console.error('[feishu:recording-poll]', error));
  }, Math.min(intervalMs, 15000));

  setInterval(() => {
    pollRecordings().catch((error) => console.error('[feishu:recording-poll]', error));
  }, intervalMs);
}

async function pollRecordings() {
  if (recordingPollInFlight) return;
  recordingPollInFlight = true;
  try {
    await refreshRecordsFromStore();
    const pendingRecords = Array.from(records.values())
      .filter((record) => normalizeMeetingNo(record.meetingNo) && (record.status !== 'SUMMARY_READY' || needsSmartNoteDocumentRetry(record)))
      .filter((record) => isRecentEnoughForPolling(record));
    if (!pendingRecords.length) return;

    const token = await getTenantAccessToken();
    for (const record of pendingRecords) {
      await pollSingleRecording(record, token);
    }
  } finally {
    recordingPollInFlight = false;
  }
}

async function pollSingleRecording(record, token) {
  if (isPollingBackedOff(record.reserveId)) return;

  try {
    const event = await buildRecordingReadyEventForRecord(record, token);

    await appendEventLog({ type: RECORDING_READY_EVENT, status: 'PROCESSING', source: 'POLLING', meetingNo: event.meetingNo, minuteToken: event.minuteToken });
    const syncedRecord = await syncRecordingReadyEvent(event, { ownerId: record.ownerId });
    recordingPollBackoff.delete(record.reserveId);
    await appendEventLog({ type: RECORDING_READY_EVENT, status: 'SYNCED', source: 'POLLING', meetingNo: event.meetingNo, minuteToken: event.minuteToken, reserveId: syncedRecord.reserveId });
  } catch (error) {
    recordingPollBackoff.set(record.reserveId, Date.now() + 10 * 60 * 1000);
    await appendEventLog({ type: RECORDING_READY_EVENT, status: 'FAILED', source: 'POLLING', meetingNo: record.meetingNo, reserveId: record.reserveId, error: error.message });
  }
}

async function buildRecordingReadyEventForRecord(record, token) {
  const meetingId = await findMeetingIdByNo(record, token);
  if (!meetingId) {
    throw new FeishuApiError(404, 'MEETING_ID_NOT_FOUND', '没有通过会议号找到对应的飞书会议。');
  }

  await ensureRecordingPermission(meetingId, record.ownerId);
  const recording = await getMeetingRecording(meetingId, token);
  const event = buildRecordingReadyEventFromRecordingPayload(recording, {
    meetingId,
    meetingNo: record.meetingNo,
    duration: record.duration
  });
  if (!event) {
    throw new FeishuApiError(404, 'MINUTES_RECORDING_NOT_FOUND', '已找到会议，但录制里还没有可解析的飞书妙记链接。');
  }
  return event;
}

async function findMeetingIdByNo(record, token) {
  const now = Math.floor(Date.now() / 1000);
  const createdAtSeconds = Math.floor(Date.parse(record.createdAt || new Date()) / 1000);
  const payload = await feishuRequest('/open-apis/vc/v1/meetings/list_by_no', {
    method: 'GET',
    token,
    query: {
      meeting_no: record.meetingNo,
      start_time: String(createdAtSeconds - 6 * 3600),
      end_time: String(now + 24 * 3600),
      page_size: 10,
      user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id'
    }
  });
  return findMeetingIdFromListByNoPayload(payload, record.meetingNo);
}

async function getMeetingRecording(meetingId, token) {
  return feishuRequest(`/open-apis/vc/v1/meetings/${encodeURIComponent(meetingId)}/recording`, {
    method: 'GET',
    token
  });
}

async function ensureRecordingPermission(meetingId, ownerId = '') {
  const userAccessToken = await getUserAccessToken({ ownerId }).catch(() => '');
  if (!userAccessToken) return;

  await feishuRequest(`/open-apis/vc/v1/meetings/${encodeURIComponent(meetingId)}/recording/set_permission`, {
    method: 'PATCH',
    token: userAccessToken,
    query: { user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id' },
    body: {
      permission_objects: [
        {
          id: ownerId,
          type: 1,
          permission: 1
        }
      ]
    }
  });
}

function isRecentEnoughForPolling(record) {
  const createdAt = Date.parse(record.createdAt || '');
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt < 7 * 24 * 3600 * 1000;
}

function isPollingBackedOff(recordId) {
  const blockedUntil = recordingPollBackoff.get(recordId);
  if (!blockedUntil) return false;
  if (Date.now() >= blockedUntil) {
    recordingPollBackoff.delete(recordId);
    return false;
  }
  return true;
}

function processRecordingReadyInBackground(event) {
  setImmediate(async () => {
    try {
      const recordKey = findRecordKeyForRecordingEvent(records, event);
      const ownerId = recordKey ? records.get(recordKey)?.ownerId : '';
      const record = await syncRecordingReadyEvent(event, { ownerId });
      await appendEventLog({ type: event.type, status: 'SYNCED', meetingNo: event.meetingNo, minuteToken: event.minuteToken, reserveId: record.reserveId });
    } catch (error) {
      console.error('[feishu:event:recording_ready]', error);
      await appendEventLog({ type: event.type, status: 'FAILED', meetingNo: event.meetingNo, minuteToken: event.minuteToken, error: error.message });
    }
  });
}

function findLatestRetryableRecordingEvent(ownerId = '') {
  const event = eventLog.find((item) => {
    const recordKey = findRecordKeyForRecordingEvent(records, item);
    const record = recordKey ? records.get(recordKey) : null;
    return (
      item.type === RECORDING_READY_EVENT
      && item.minuteToken
      && item.meetingNo
      && (!ownerId || record?.ownerId === ownerId)
    );
  });
  if (!event) return null;

  const recordKey = findRecordKeyForRecordingEvent(records, event);
  const record = recordKey ? records.get(recordKey) : null;
  return {
    type: RECORDING_READY_EVENT,
    meetingId: record?.meetingId || '',
    meetingNo: normalizeMeetingNo(event.meetingNo),
    minuteUrl: `https://meetings.feishu.cn/minutes/${event.minuteToken}`,
    minuteToken: event.minuteToken,
    duration: record?.duration || 0
  };
}

async function getMinuteInfo(minuteToken, tenantToken) {
  return feishuRequest(`/open-apis/minutes/v1/minutes/${encodeURIComponent(minuteToken)}`, {
    method: 'GET',
    token: tenantToken
  });
}

async function getMinuteArtifacts(minuteToken, tenantToken) {
  return feishuRequest(`/open-apis/minutes/v1/minutes/${encodeURIComponent(minuteToken)}/artifacts`, {
    method: 'GET',
    token: tenantToken
  });
}

async function getNoteDetail(noteId, userAccessToken) {
  return feishuRequest(`/open-apis/vc/v1/notes/${encodeURIComponent(noteId)}`, {
    method: 'GET',
    token: userAccessToken,
    query: { user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id' }
  });
}

async function saveMeetingRecord(meeting, tenantToken) {
  if (!hasBitableStorage()) {
    throw new FeishuApiError(500, 'BITABLE_NOT_CONFIGURED', '多维表格未配置，无法保存会议记录。');
  }
  await refreshRecordsFromStore(tenantToken);
  const now = new Date().toISOString();
  const existing = records.get(meeting.reserveId);
  const record = {
    id: meeting.reserveId,
    reserveId: meeting.reserveId,
    topic: meeting.topic,
    status: meeting.status,
    meetingNo: meeting.meetingNo || '',
    meetingUrl: meeting.url || meeting.appLink || '',
    password: meeting.password || '',
    ownerId: meeting.ownerId || existing?.ownerId || '',
    ownerName: meeting.ownerName || existing?.ownerName || '',
    endTime: meeting.endTime || '',
    meetingId: meeting.meetingId || existing?.meetingId || '',
    minuteToken: meeting.minuteToken || meeting.summary?.minuteToken || existing?.minuteToken || '',
    minuteUrl: meeting.minuteUrl || existing?.minuteUrl || '',
    duration: meeting.duration || meeting.summary?.duration || existing?.duration || 0,
    summarySource: meeting.summary?.source || '',
    summaryTitle: meeting.summary?.title || '',
    highlights: meeting.summary?.highlights || [],
    actions: meeting.summary?.actions || [],
    artifacts: meeting.summary?.artifacts || [],
    createdAt: existing?.createdAt || meeting.createdAt || now,
    updatedAt: now,
    bitableRecordId: existing?.bitableRecordId || '',
    bitableSyncStatus: 'LOCAL_SAVED',
    bitableSyncError: ''
  };

  await syncRecordToFeishuBitable(record, tenantToken);
  return records.get(record.reserveId);
}

async function syncRecordToFeishuBitable(record, tenantToken) {
  const fields = buildBitableFields(record);
  try {
    const existingBitableRecordId = record.bitableRecordId || await findBitableRecordIdByReserveId(record.reserveId, tenantToken);
    const bitableRecord = existingBitableRecordId
      ? await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(bitableConfig.appToken)}/tables/${encodeURIComponent(bitableConfig.tableId)}/records/${encodeURIComponent(existingBitableRecordId)}`, {
          method: 'PUT',
          token: tenantToken,
          query: { user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id' },
          body: { fields }
        })
      : await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(bitableConfig.appToken)}/tables/${encodeURIComponent(bitableConfig.tableId)}/records`, {
          method: 'POST',
          token: tenantToken,
          query: { user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id' },
          body: { fields }
        });

    records.set(record.reserveId, {
      ...record,
      bitableRecordId: bitableRecord.record_id || bitableRecord.id || record.bitableRecordId,
      bitableRecordUrl: bitableRecord.record_url || bitableRecord.shared_url || record.bitableRecordUrl || '',
      bitableSyncStatus: 'SYNCED',
      bitableSyncError: ''
    });
  } catch (error) {
    throw error;
  }
}

function buildBitableFields(record) {
  return {
    '会议主题': record.topic,
    '预约ID': record.reserveId,
    '会议状态': statusText(record.status),
    '会议号': record.meetingNo,
    '会议链接': record.meetingUrl ? { text: '打开飞书会议', link: record.meetingUrl } : '',
    '归属人ID': record.ownerId,
    '归属人': record.ownerName || record.ownerId,
    '纪要标题': record.summaryTitle,
    ...buildOptionalUrlFields(record),
    '关键结论': record.highlights.join('\n'),
    '待办事项': record.actions.join('\n'),
    '飞书产物': record.artifacts.map((item) => `${item.type || '产物'}:${artifactValueForBitable(item)}`).join('\n'),
    '创建时间': Date.parse(record.createdAt),
    '更新时间': Date.parse(record.updatedAt)
  };
}

function artifactValueForBitable(item = {}) {
  if (['智能纪要文档', '纪要文档', '飞书文档', '逐字稿文档'].includes(item.type)) {
    return item.url || item.docToken || '';
  }
  if (item.type === '智能纪要重试') {
    return String(item.count ?? item.value ?? 0);
  }
  return item.noteId || item.url || item.token || item.message || item.kind || item.value || '';
}

function buildOptionalUrlFields(record) {
  const minuteUrl = getRecordMinuteUrl(record);
  const smartNoteUrl = getRecordSmartNoteUrl(record, { baseUrl: bitableConfig.url });
  return {
    ...(minuteUrl ? { '妙记链接': { text: '打开妙记', link: minuteUrl } } : {}),
    ...(smartNoteUrl ? { '智能纪要链接': { text: '打开智能纪要', link: smartNoteUrl } } : {})
  };
}

function hasBitableStorage() {
  return Boolean(bitableConfig.appToken && bitableConfig.tableId);
}

async function refreshRecordsFromStore(token = null) {
  if (!hasBitableStorage()) return;
  const latestRecords = await listBitableMeetingRecords(token || await getTenantAccessToken());
  records.clear();
  meetings.clear();
  for (const record of latestRecords) {
    records.set(record.reserveId, record);
    meetings.set(record.reserveId, meetingFromRecord(record));
  }
}

async function listBitableMeetingRecords(token) {
  const fieldNameById = await getBitableFieldNameMap(token);
  const items = [];
  let pageToken = '';
  do {
    const data = await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(bitableConfig.appToken)}/tables/${encodeURIComponent(bitableConfig.tableId)}/records`, {
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

  const itemsWithRecordUrls = await Promise.all(items.map((item) => getBitableRecordWithSharedUrl(item, token).catch(() => item)));

  return itemsWithRecordUrls
    .map((item) => buildRecordFromBitableRecord(normalizeBitableRecordFieldNames(item, fieldNameById)))
    .filter((record) => record.reserveId)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function getBitableRecordWithSharedUrl(item, token) {
  const recordId = item.record_id || item.id;
  if (!recordId) return item;
  const data = await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(bitableConfig.appToken)}/tables/${encodeURIComponent(bitableConfig.tableId)}/records/${encodeURIComponent(recordId)}`, {
    method: 'GET',
    token,
    query: {
      text_field_as_array: 'true',
      with_shared_url: 'true',
      user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id'
    }
  });
  return data.record || data;
}

async function getBitableFieldNameMap(token) {
  if (bitableFieldNameCache) return bitableFieldNameCache;
  const data = await feishuRequest(`/open-apis/bitable/v1/apps/${encodeURIComponent(bitableConfig.appToken)}/tables/${encodeURIComponent(bitableConfig.tableId)}/fields`, {
    method: 'GET',
    token,
    query: { page_size: '100' }
  });
  bitableFieldNameCache = Object.fromEntries((data.items || []).map((field) => [
    field.field_id || field.id,
    field.field_name || field.name
  ]).filter(([id, name]) => id && name));
  return bitableFieldNameCache;
}

function normalizeBitableRecordFieldNames(item, fieldNameById) {
  const fields = {};
  for (const [key, value] of Object.entries(item.fields || {})) {
    fields[fieldNameById[key] || key] = value;
  }
  return { ...item, fields };
}

async function findBitableRecordIdByReserveId(reserveId, token) {
  if (!reserveId) return '';
  const current = records.get(reserveId);
  if (current?.bitableRecordId) return current.bitableRecordId;
  await refreshRecordsFromStore(token);
  return records.get(reserveId)?.bitableRecordId || '';
}

async function getRecordByReserveId(reserveId) {
  await refreshRecordsFromStore();
  return records.get(reserveId) || null;
}

function meetingFromRecord(record = {}) {
  return {
    reserveId: record.reserveId,
    topic: record.topic,
    meetingNo: record.meetingNo,
    password: record.password,
    url: record.meetingUrl,
    endTime: record.endTime,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ownerId: record.ownerId,
    ownerName: record.ownerName,
    minuteToken: record.minuteToken,
    minuteUrl: record.minuteUrl,
    bitableSyncStatus: record.bitableSyncStatus,
    summaryTitle: record.summaryTitle,
    highlights: record.highlights || [],
    actions: record.actions || [],
    artifacts: record.artifacts || [],
    summary: record.summaryTitle ? {
      source: record.summarySource,
      title: record.summaryTitle,
      minuteToken: record.minuteToken,
      minuteUrl: record.minuteUrl,
      highlights: record.highlights || [],
      actions: record.actions || [],
      artifacts: record.artifacts || []
    } : null
  };
}

async function loadRecords() {
  if (hasBitableStorage()) {
    await refreshRecordsFromStore();
    return;
  }
  try {
    const text = await readFile(recordsPath, 'utf8');
    const parsed = JSON.parse(text);
    for (const record of Array.isArray(parsed.records) ? parsed.records : []) {
      records.set(record.reserveId, record);
      meetings.set(record.reserveId, {
        reserveId: record.reserveId,
        topic: record.topic,
        meetingNo: record.meetingNo,
        password: record.password,
        url: record.meetingUrl,
        endTime: record.endTime,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ownerId: record.ownerId,
        ownerName: record.ownerName,
        summary: record.summaryTitle ? {
          source: record.summarySource,
          title: record.summaryTitle,
          highlights: record.highlights || [],
          actions: record.actions || [],
          artifacts: record.artifacts || [],
          references: []
        } : null
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function loadEventLog() {
  try {
    const text = await readFile(eventLogPath, 'utf8');
    const parsed = JSON.parse(text);
    eventLog = Array.isArray(parsed.events) ? parsed.events : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function persistRecords() {
  await mkdir(dataDir, { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    records: Array.from(records.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  };
  await writeFile(recordsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function appendEventLog(entry) {
  await mkdir(dataDir, { recursive: true });
  eventLog = [{
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    ...entry
  }, ...eventLog].slice(0, 50);
  await writeFile(eventLogPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), events: eventLog }, null, 2)}\n`, 'utf8');
}

async function getRealNoteSummary(noteId, userAccessToken) {
  if (!userAccessToken) {
    throw new FeishuApiError(422, 'USER_ACCESS_TOKEN_REQUIRED', '读取真实智能纪要需要先完成飞书 SSO 登录。');
  }
  const note = await feishuRequest(`/open-apis/vc/v1/notes/${encodeURIComponent(noteId)}`, {
    method: 'GET',
    token: userAccessToken,
    query: { user_id_type: process.env.FEISHU_USER_ID_TYPE || 'open_id' }
  });

  return {
    source: 'FEISHU_NOTE',
    title: '飞书智能纪要已同步',
    syncedAt: new Date().toISOString(),
    creatorId: note.creator_id,
    createTime: note.create_time,
    artifacts: (note.artifacts || []).map((item) => ({
      type: item.artifact_type === 1 ? '智能纪要文档' : item.artifact_type === 2 ? '逐字稿文档' : '未知产物',
      docToken: item.doc_token,
      createTime: item.create_time
    })),
    references: (note.references || []).map((item) => ({
      type: item.reference_type === 1 ? '会中共享文档' : '未知引用',
      docToken: item.doc_token
    })),
    highlights: ['已从飞书智能纪要接口读取到纪要元数据。'],
    actions: ['打开 doc_token 对应文档，展示纪要正文或跳转飞书文档。']
  };
}

function buildOpenFeishuUserPermissions() {
  return [1, 2, 3].map((permission) => ({
    permission,
    permission_checkers: [
      {
        check_field: 2,
        check_mode: 1,
        check_list: ['1']
      }
    ]
  }));
}


function statusText(status) {
  const map = {
    RESERVED: '已创建',
    SUMMARY_READY: '纪要已同步',
    EXPIRED: '已过期'
  };
  return map[status] || '处理中';
}

function redactFeishuPayload(payload) {
  const copy = { ...payload };
  delete copy.tenant_access_token;
  delete copy.app_access_token;
  delete copy.access_token;
  delete copy.refresh_token;
  return copy;
}

function buildFeishuErrorMessage(payload) {
  const baseMessage = payload.msg || payload.error?.message || '飞书 OpenAPI 调用失败。';
  const missingScopes = payload.error?.permission_violations
    ?.map((item) => item.subject)
    .filter(Boolean);
  return missingScopes?.length
    ? `${baseMessage} Missing scopes: ${missingScopes.join(', ')}`
    : baseMessage;
}

function sendError(res, status, code, message, details) {
  res.status(status).json({ error: { code, message, details } });
}

class FeishuApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
