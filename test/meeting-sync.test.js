import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  DEFAULT_OAUTH_SCOPE,
  buildOAuthCallbackDiagnostic,
  buildMeetingFromRecordingSync,
  buildFeishuOAuthAuthorizeUrl,
  buildMinutesPermissionAuthUrl,
  buildRecordingReadyEventFromRecordingPayload,
  buildSummaryFromMinutes,
  buildFeishuDocUrl,
  buildSessionCookie,
  decryptFeishuPayload,
  extractFeishuChallenge,
  extractMinuteToken,
  findMeetingIdFromListByNoPayload,
  findRecordKeyForRecordingEvent,
  findLatestMinutesSyncCandidate,
  getRecordMinuteUrl,
  getRecordSmartNoteUrl,
  hasRealSummaryInput,
  hasMinutesArtifactsContent,
  hasVerifiedMinutesSummary,
  isInternetReadableBasePermission,
  isUserTokenUsable,
  normalizeFeishuEventBody,
  normalizeFeishuEvent,
  normalizeFeishuUserInfoPayload,
  normalizeOAuthTokenPayload,
  parseCookieHeader,
  resolveFeishuErrorStatus,
  resolveMeetingOwner
} from '../src/meeting-sync.js';

test('extractMinuteToken parses Feishu minutes URLs', () => {
  assert.equal(
    extractMinuteToken('https://meetings.feishu.cn/minutes/obcn123ABC?from=event'),
    'obcn123ABC'
  );
  assert.equal(
    extractMinuteToken('https://meetings.feishu.cn/minutes/obcn123ABC/'),
    'obcn123ABC'
  );
  assert.equal(extractMinuteToken('https://example.com/not-minutes/abc'), '');
  assert.equal(extractMinuteToken(''), '');
});

test('extractFeishuChallenge supports top-level and event-level verification bodies', () => {
  assert.equal(extractFeishuChallenge({ challenge: 'top-level-code' }), 'top-level-code');
  assert.equal(
    extractFeishuChallenge({
      schema: '2.0',
      header: { event_type: 'url_verification' },
      event: { challenge: 'event-level-code' }
    }),
    'event-level-code'
  );
  assert.equal(extractFeishuChallenge({ event: {} }), '');
});

test('hasRealSummaryInput rejects empty manual sync input', () => {
  assert.equal(hasRealSummaryInput({}), false);
  assert.equal(hasRealSummaryInput({ minuteUrl: '   ', noteId: '' }), false);
  assert.equal(hasRealSummaryInput({ minuteToken: 'obcn123' }), true);
  assert.equal(hasRealSummaryInput({ minuteUrl: 'https://meetings.feishu.cn/minutes/obcn123' }), true);
  assert.equal(hasRealSummaryInput({ noteId: 'note_123' }), true);
});

test('buildFeishuOAuthAuthorizeUrl includes official client id, redirect uri, scope, and state', () => {
  const url = new URL(buildFeishuOAuthAuthorizeUrl({
    appId: 'cli_demo',
    redirectUri: 'https://example.com/api/feishu/oauth/callback',
    state: 'state_123'
  }));

  assert.equal(url.origin, 'https://accounts.feishu.cn');
  assert.equal(url.pathname, '/open-apis/authen/v1/authorize');
  assert.equal(url.searchParams.get('client_id'), 'cli_demo');
  assert.equal(url.searchParams.get('app_id'), null);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/api/feishu/oauth/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'state_123');
  assert.equal(url.searchParams.get('scope'), DEFAULT_OAUTH_SCOPE);
});

test('buildMinutesPermissionAuthUrl points to user permissions for Minutes scopes', () => {
  const url = new URL(buildMinutesPermissionAuthUrl('cli_demo'));

  assert.equal(url.origin, 'https://open.feishu.cn');
  assert.equal(url.pathname, '/app/cli_demo/auth');
  assert.equal(url.searchParams.get('q'), 'minutes:minutes.basic:read minutes:minutes.artifacts:read');
  assert.equal(url.searchParams.get('op_from'), 'openapi');
  assert.equal(url.searchParams.get('token_type'), 'user');
  assert.equal(buildMinutesPermissionAuthUrl(''), '');
});

test('DEFAULT_OAUTH_SCOPE includes minutes basic info and artifacts permissions', () => {
  const scopes = DEFAULT_OAUTH_SCOPE.split(/\s+/);

  assert.equal(scopes.includes('minutes:minutes.basic:read'), true);
  assert.equal(scopes.includes('minutes:minutes.artifacts:read'), true);
  assert.equal(scopes.includes('offline_access'), true);
});

test('buildOAuthCallbackDiagnostic records callback outcome without leaking OAuth secrets', () => {
  const diagnostic = buildOAuthCallbackDiagnostic({
    query: { code: 'auth_code_secret', state: 'state_secret' },
    status: 'FAILED',
    error: { code: 'FEISHU_AUTHEN_FAILED', message: 'permission denied' },
    now: Date.parse('2026-05-21T06:40:00.000Z')
  });

  assert.deepEqual(diagnostic, {
    at: '2026-05-21T06:40:00.000Z',
    status: 'FAILED',
    hasCode: true,
    hasState: true,
    errorCode: 'FEISHU_AUTHEN_FAILED',
    errorMessage: 'permission denied'
  });
  assert.equal(JSON.stringify(diagnostic).includes('auth_code_secret'), false);
  assert.equal(JSON.stringify(diagnostic).includes('state_secret'), false);
});

test('normalizeOAuthTokenPayload maps Feishu token payload and expiry', () => {
  const now = Date.parse('2026-05-20T00:00:00.000Z');
  const token = normalizeOAuthTokenPayload({
    data: {
      access_token: 'u-access',
      refresh_token: 'u-refresh',
      expires_in: 7200,
      refresh_expires_in: 2592000,
      open_id: 'ou_demo',
      scope: 'minutes:minutes.artifacts:read'
    }
  }, now);

  assert.equal(token.accessToken, 'u-access');
  assert.equal(token.refreshToken, 'u-refresh');
  assert.equal(token.openId, 'ou_demo');
  assert.equal(token.scope, 'minutes:minutes.artifacts:read');
  assert.equal(token.expiresAt, now + 7200 * 1000);
  assert.equal(token.refreshExpiresAt, now + 2592000 * 1000);
  assert.equal(isUserTokenUsable(token, now), true);
  assert.equal(isUserTokenUsable({ ...token, expiresAt: now + 60 * 1000 }, now), false);
});

test('normalizeFeishuUserInfoPayload extracts a display name for the logged-in user', () => {
  assert.deepEqual(normalizeFeishuUserInfoPayload({
    data: {
      open_id: 'ou_demo',
      union_id: 'on_demo',
      name: '张三',
      avatar_url: 'https://example.com/avatar.png'
    }
  }), {
    openId: 'ou_demo',
    unionId: 'on_demo',
    name: '张三',
    avatarUrl: 'https://example.com/avatar.png'
  });
});

test('session cookies can be parsed and emitted for per-browser OAuth state', () => {
  assert.deepEqual(parseCookieHeader('mc_session=sess_123; theme=dark'), {
    mc_session: 'sess_123',
    theme: 'dark'
  });
  assert.equal(
    buildSessionCookie('mc_session', 'sess_123', { secure: true, maxAgeSeconds: 60 }),
    'mc_session=sess_123; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60'
  );
});

test('resolveFeishuErrorStatus maps Feishu business errors away from HTTP 200', () => {
  assert.equal(resolveFeishuErrorStatus(200, 20026), 401);
  assert.equal(resolveFeishuErrorStatus(200, 99991679), 403);
  assert.equal(resolveFeishuErrorStatus(429, 0), 429);
  assert.equal(resolveFeishuErrorStatus(200, 12345), 502);
});

test('resolveMeetingOwner uses SSO open id and never falls back to fixed owner', () => {
  const now = Date.parse('2026-05-20T00:00:00.000Z');

  assert.deepEqual(
    resolveMeetingOwner({
      openId: 'ou_sso_user',
      refreshToken: 'refresh',
      expiresAt: now + 60 * 1000,
      refreshExpiresAt: now + 30 * 24 * 3600 * 1000
    }, { now }),
    { openId: 'ou_sso_user', name: '', source: 'SSO' }
  );

  assert.equal(
    resolveMeetingOwner({
      accessToken: 'u-access',
      expiresAt: now + 2 * 3600 * 1000,
      refreshExpiresAt: now + 30 * 24 * 3600 * 1000
    }, { now, fallbackOpenId: 'ou_fixed_owner' }),
    null
  );
});

test('isInternetReadableBasePermission accepts only open and anyone-readable Base sharing', () => {
  assert.equal(isInternetReadableBasePermission({
    external_access_entity: 'open',
    link_share_entity: 'anyone_readable',
    security_entity: 'anyone_can_view'
  }), true);

  assert.equal(isInternetReadableBasePermission({
    status: 'PENDING_PERMISSION',
    reason: 'missing docs permission'
  }), false);
});

test('decryptFeishuPayload decrypts the official Encrypt Key sample', () => {
  assert.equal(
    decryptFeishuPayload('P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk=', 'test key'),
    'hello world'
  );
});

test('normalizeFeishuEventBody decrypts encrypted event JSON', () => {
  const plain = {
    schema: '2.0',
    header: { event_type: 'vc.meeting.recording_ready_v1' },
    event: {
      meeting: { meeting_no: '279256592' },
      url: 'https://meetings.feishu.cn/minutes/obcnq3b9jl72l83w4f149w9c'
    }
  };

  assert.deepEqual(
    normalizeFeishuEventBody({ encrypt: encryptFeishuPayload(JSON.stringify(plain), 'demo key') }, 'demo key'),
    plain
  );
});

test('buildMeetingFromRecordingSync updates the matched reserve record', () => {
  const meeting = buildMeetingFromRecordingSync({
    event: {
      meetingId: 'meeting_123',
      meetingNo: '123456789',
      minuteUrl: 'https://meetings.feishu.cn/minutes/minute_token_123',
      minuteToken: 'minute_token_123',
      duration: 1800
    },
    recordKey: 'reserve_123',
    existingRecord: {
      reserveId: 'reserve_123',
      topic: '客户方案演示会议',
      meetingNo: '123 456 789',
      meetingUrl: 'https://vc.feishu.cn/j/123456789',
      ownerId: 'ou_owner',
      createdAt: '2026-05-20T00:00:00.000Z'
    },
    existingMeeting: null,
    minute: { title: '客户方案演示会议纪要' },
    summary: {
      source: 'FEISHU_MINUTES',
      title: '客户方案演示会议纪要',
      duration: 1800,
      highlights: ['已同步真实妙记'],
      actions: [],
      artifacts: []
    },
    defaultOwnerId: 'ou_default'
  });

  assert.equal(meeting.reserveId, 'reserve_123');
  assert.equal(meeting.status, 'SUMMARY_READY');
  assert.equal(meeting.topic, '客户方案演示会议');
  assert.equal(meeting.meetingNo, '123456789');
  assert.equal(meeting.url, 'https://vc.feishu.cn/j/123456789');
  assert.equal(meeting.ownerId, 'ou_owner');
  assert.equal(meeting.minuteToken, 'minute_token_123');
});

test('normalizeFeishuEvent extracts recording_ready payload from v2 event body', () => {
  const normalized = normalizeFeishuEvent({
    header: { event_type: 'vc.meeting.recording_ready_v1' },
    event: {
      meeting: {
        id: 'meeting_123',
        meeting_no: '123 456 789'
      },
      url: 'https://meetings.feishu.cn/minutes/minute_token_123',
      duration: 1800
    }
  });

  assert.deepEqual(normalized, {
    type: 'vc.meeting.recording_ready_v1',
    meetingId: 'meeting_123',
    meetingNo: '123456789',
    minuteUrl: 'https://meetings.feishu.cn/minutes/minute_token_123',
    minuteToken: 'minute_token_123',
    duration: 1800
  });
});

test('normalizeFeishuEvent supports top-level event_type payloads', () => {
  const normalized = normalizeFeishuEvent({
    schema: '2.0',
    event_type: 'vc.meeting.recording_ready_v1',
    event: {
      meeting: {
        id: 'meeting_456',
        meeting_no: '279 256 592'
      },
      url: 'https://meetings.feishu.cn/minutes/obcnq3b9jl72l83w4f149w9c',
      duration: '30000'
    }
  });

  assert.equal(normalized.type, 'vc.meeting.recording_ready_v1');
  assert.equal(normalized.meetingId, 'meeting_456');
  assert.equal(normalized.meetingNo, '279256592');
  assert.equal(normalized.minuteToken, 'obcnq3b9jl72l83w4f149w9c');
  assert.equal(normalized.duration, 30000);
});

test('findRecordKeyForRecordingEvent matches by normalized meeting number', () => {
  const records = new Map([
    ['reserve_1', { reserveId: 'reserve_1', meetingNo: '123 456 789' }],
    ['reserve_2', { reserveId: 'reserve_2', meetingNo: '987654321' }]
  ]);

  assert.equal(
    findRecordKeyForRecordingEvent(records, { meetingNo: '123456789' }),
    'reserve_1'
  );
  assert.equal(
    findRecordKeyForRecordingEvent(records, { meetingNo: '000000000' }),
    ''
  );
});

test('findMeetingIdFromListByNoPayload finds matching meeting in nested list response', () => {
  assert.equal(
    findMeetingIdFromListByNoPayload({
      meeting_list: [
        { meeting_no: '111222333', id: 'meeting_other' },
        { meeting_no: '269 643 753', meeting_id: 'meeting_real' }
      ]
    }, '269643753'),
    'meeting_real'
  );

  assert.equal(
    findMeetingIdFromListByNoPayload({ has_more: false }, '269643753'),
    ''
  );
});

test('buildRecordingReadyEventFromRecordingPayload extracts real minute URL from recording payload', () => {
  assert.deepEqual(
    buildRecordingReadyEventFromRecordingPayload({
      recording: {
        url: 'https://meetings.feishu.cn/minutes/minute_from_polling',
        duration: 600
      }
    }, {
      meetingId: 'meeting_real',
      meetingNo: '269 643 753'
    }),
    {
      type: 'vc.meeting.recording_ready_v1',
      meetingId: 'meeting_real',
      meetingNo: '269643753',
      minuteUrl: 'https://meetings.feishu.cn/minutes/minute_from_polling',
      minuteToken: 'minute_from_polling',
      duration: 600
    }
  );

  assert.equal(
    buildRecordingReadyEventFromRecordingPayload({ recording: { url: 'https://example.com/no-minutes' } }, { meetingNo: '269643753' }),
    null
  );
});

test('buildSummaryFromMinutes maps minute info, AI artifacts, and note artifacts', () => {
  const summary = buildSummaryFromMinutes({
    minute: {
      title: '客户方案评审',
      url: 'https://meetings.feishu.cn/minutes/minute_token_123',
      note_id: 'note_123'
    },
    artifacts: {
      summary: '客户确认先演示真实会议闭环。',
      minute_chapters: [
        { title: '需求确认', summary: '确认自研页面发起会议并回写 Base。' }
      ],
      minute_todos: [
        { content: '补齐事件订阅权限', owners: [{ name: '张三' }] }
      ]
    },
    note: {
      artifacts: [
        { artifact_type: 1, doc_token: 'doc_summary' },
        { artifact_type: 2, doc_token: 'doc_transcript' }
      ]
    },
    minuteToken: 'minute_token_123',
    noteWarning: ''
  });

  assert.equal(summary.source, 'FEISHU_MINUTES');
  assert.equal(summary.title, '客户方案评审');
  assert.deepEqual(summary.highlights, [
    '客户确认先演示真实会议闭环。',
    '需求确认：确认自研页面发起会议并回写 Base。'
  ]);
  assert.deepEqual(summary.actions, ['补齐事件订阅权限 - 张三']);
  assert.deepEqual(summary.artifacts, [
    {
      type: '妙记',
      url: 'https://meetings.feishu.cn/minutes/minute_token_123',
      token: 'minute_token_123'
    },
    { type: '智能纪要', noteId: 'note_123' },
    { type: 'AI产物', kind: 'summary' },
    { type: 'AI产物', kind: 'chapters' },
    { type: 'AI产物', kind: 'todos' },
    { type: '纪要文档', docToken: 'doc_summary' },
    { type: '逐字稿文档', docToken: 'doc_transcript' }
  ]);
});

test('record links expose minutes and smart note links for the demo Base', () => {
  const record = {
    minuteToken: 'minute_token_123',
    artifacts: [
      { type: '妙记', url: 'https://meetings.feishu.cn/minutes/minute_token_123', token: 'minute_token_123' },
      { type: '纪要文档', docToken: 'doc_summary' }
    ]
  };

  assert.equal(getRecordMinuteUrl(record), 'https://meetings.feishu.cn/minutes/minute_token_123');
  assert.equal(
    getRecordSmartNoteUrl(record, { baseUrl: 'https://digitalsolution.feishu.cn/base/app_token' }),
    'https://digitalsolution.feishu.cn/docx/doc_summary'
  );
  assert.equal(buildFeishuDocUrl('doc_summary', 'https://digitalsolution.feishu.cn/base/app_token'), 'https://digitalsolution.feishu.cn/docx/doc_summary');
});

test('buildSummaryFromMinutes maps documented Feishu artifacts fields', () => {
  const summary = buildSummaryFromMinutes({
    minute: {
      title: '客户真实会议',
      url: 'https://meetings.feishu.cn/minutes/obcnq3b9jl72l83w4f149w9c',
      note_id: '7616590025794260496'
    },
    artifacts: {
      summary: '妙记总结',
      minute_chapters: [
        {
          title: '项目进度回顾与风险评估',
          summary_content: '确认交付节点，并启动供应商风险评估。'
        }
      ],
      minute_todos: [
        {
          content: '提交资源保障方案',
          assignees: ['张三']
        }
      ]
    },
    note: null,
    minuteToken: 'obcnq3b9jl72l83w4f149w9c',
    noteWarning: ''
  });

  assert.deepEqual(summary.highlights, [
    '妙记总结',
    '项目进度回顾与风险评估：确认交付节点，并启动供应商风险评估。'
  ]);
  assert.deepEqual(summary.actions, ['提交资源保障方案 - 张三']);
});

test('hasMinutesArtifactsContent distinguishes reachable but empty artifacts payloads', () => {
  assert.equal(hasMinutesArtifactsContent({}), false);
  assert.equal(hasMinutesArtifactsContent({
    summary: [],
    minute_chapters: [],
    minute_todos: []
  }), false);
  assert.equal(hasMinutesArtifactsContent({
    summary: '客户确认推进 PoC。'
  }), true);
  assert.equal(hasMinutesArtifactsContent({
    minute_chapters: [{ title: '方案评审', summary_content: '确认演示闭环。' }]
  }), true);
  assert.equal(hasMinutesArtifactsContent({
    minute_todos: [{ content: '补齐验收材料' }]
  }), true);
});

test('hasVerifiedMinutesSummary rejects fallback-only summaries and sync warnings', () => {
  assert.equal(hasVerifiedMinutesSummary({
    status: 'SUMMARY_READY',
    summaryTitle: '飞书妙记已同步',
    highlights: ['飞书妙记已生成，系统已完成自动同步。'],
    artifacts: [
      { type: '妙记', token: 'obcn_demo' },
      { type: '同步提示', message: 'Minutes 基础信息读取失败：Missing scopes' }
    ],
    bitableSyncStatus: 'SYNCED'
  }), false);

  assert.equal(hasVerifiedMinutesSummary({
    status: 'SUMMARY_READY',
    summaryTitle: '客户方案演示纪要',
    highlights: ['客户确认下周进入 PoC。'],
    artifacts: [
      { type: '妙记', token: 'obcn_demo' },
      { type: 'AI产物', kind: 'summary' }
    ],
    bitableSyncStatus: 'SYNCED'
  }), true);
});

test('findLatestMinutesSyncCandidate ignores older fallback records with permission warnings', () => {
  const candidate = findLatestMinutesSyncCandidate([
    {
      meetingNo: 'old',
      status: 'SUMMARY_READY',
      bitableSyncStatus: 'SYNCED',
      minuteToken: 'old_token',
      updatedAt: '2026-05-21T06:32:18.456Z',
      artifacts: [{ type: '同步提示', message: 'Missing scopes: minutes:minutes.basic:read' }]
    },
    {
      meetingNo: 'new',
      status: 'SUMMARY_READY',
      bitableSyncStatus: 'SYNCED',
      minuteToken: 'new_token',
      updatedAt: '2026-05-21T07:22:55.323Z',
      artifacts: [{ type: '妙记', token: 'new_token' }]
    }
  ]);

  assert.equal(candidate.meetingNo, 'new');
});

function encryptFeishuPayload(plainText, encryptKey) {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const iv = Buffer.from('1234567890abcdef', 'utf8');
  const blockSize = 16;
  const padLength = blockSize - (Buffer.byteLength(plainText) % blockSize);
  const padded = Buffer.concat([
    Buffer.from(plainText, 'utf8'),
    Buffer.alloc(padLength, padLength)
  ]);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([iv, cipher.update(padded), cipher.final()]).toString('base64');
}
