import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findMinutesPermissionWarning,
  getOAuthDisplayState,
  getRecordStatusText,
  getSummaryDisplayState,
  getSummaryStepState,
  hasMinuteLink,
  isVerifiedRecordSummary
} from '../public/status-logic.js';

test('frontend status treats fallback-only minutes sync as waiting for AI artifacts', () => {
  const fallbackRecord = {
    status: 'SUMMARY_READY',
    bitableSyncStatus: 'SYNCED',
    summaryTitle: '飞书妙记已同步',
    highlights: ['飞书妙记已生成，系统已完成自动同步。'],
    actions: ['打开飞书妙记查看完整纪要和后续行动项。'],
    artifacts: [
      { type: '妙记', token: 'obcxxx' },
      { type: '同步提示', message: 'Missing scopes: minutes:minutes.basic:read' }
    ]
  };

  assert.equal(isVerifiedRecordSummary(fallbackRecord), false);
  assert.deepEqual(getSummaryStepState({ latestRecord: fallbackRecord }), {
    status: 'warn',
    text: '等待智能纪要'
  });
});

test('frontend status tolerates empty current record while events are loading', () => {
  assert.equal(isVerifiedRecordSummary(null), false);
  assert.deepEqual(getSummaryStepState({ latestRecord: null, recordingEvent: null }), {
    status: 'pending',
    text: '等待会议结束'
  });
});

test('frontend status marks summary complete only for verified minutes artifacts', () => {
  const verifiedRecord = {
    status: 'SUMMARY_READY',
    bitableSyncStatus: 'SYNCED',
    summaryTitle: '客户方案演示会议',
    highlights: ['客户确认下一步需要评估自研页面接入方式。'],
    actions: ['整理 Demo 验收材料'],
    artifacts: [
      { type: '智能纪要', noteId: 'note_demo' },
      { type: 'AI产物', kind: 'summary' },
      { type: '智能纪要文档', docToken: 'doc_summary' }
    ]
  };

  assert.equal(isVerifiedRecordSummary(verifiedRecord), true);
  assert.deepEqual(getSummaryStepState({ latestRecord: verifiedRecord }), {
    status: 'ok',
    text: '纪要已回写'
  });
});

test('frontend keeps records pending when the smart note document is missing', () => {
  const record = {
    status: 'SUMMARY_READY',
    bitableSyncStatus: 'SYNCED',
    summaryTitle: '客户方案演示会议',
    highlights: ['客户确认下一步需要评估自研页面接入方式。'],
    actions: ['整理 Demo 验收材料'],
    artifacts: [
      { type: '智能纪要', noteId: 'note_demo' },
      { type: 'AI产物', kind: 'summary' }
    ]
  };

  assert.equal(isVerifiedRecordSummary(record), false);
  assert.equal(getRecordStatusText(record), '等待智能纪要');
});

test('frontend exposes a minutes link even when smart notes are still pending', () => {
  assert.equal(hasMinuteLink({
    status: 'SUMMARY_READY',
    minuteToken: 'obcn_demo',
    artifacts: [{ type: '妙记', token: 'obcn_demo' }]
  }), true);
  assert.equal(hasMinuteLink({ artifacts: [] }), false);
});

test('frontend status surfaces minutes permission warning from synced record artifacts', () => {
  const records = [{
    updatedAt: '2026-05-21T01:00:00.000Z',
    summaryTitle: '飞书妙记已同步',
    artifacts: [{
      type: '同步提示',
      message: 'Missing scopes: minutes:minutes.basic:read'
    }]
  }];

  assert.deepEqual(findMinutesPermissionWarning({ records, events: [] }), {
    message: 'Missing scopes: minutes:minutes.basic:read'
  });
});

test('frontend status ignores stale minutes permission warnings after a newer successful sync', () => {
  const records = [
    {
      updatedAt: '2026-05-21T03:00:00.000Z',
      status: 'SUMMARY_READY',
      summaryTitle: '客户方案演示会议',
      minuteToken: 'new_token',
      artifacts: [{ type: 'AI产物', kind: 'summary' }]
    },
    {
      updatedAt: '2026-05-21T01:00:00.000Z',
      status: 'SUMMARY_READY',
      summaryTitle: '飞书妙记已同步',
      minuteToken: 'old_token',
      artifacts: [{
        type: '同步提示',
        message: 'Missing scopes: minutes:minutes.basic:read'
      }]
    }
  ];

  assert.equal(findMinutesPermissionWarning({ records, events: [] }), null);
});

test('frontend summary panel labels fallback-only summaries as pending artifacts', () => {
  const record = {
    status: 'SUMMARY_READY',
    bitableSyncStatus: 'SYNCED',
    summaryTitle: '飞书妙记已同步',
    artifacts: [{ type: '同步提示', message: 'Missing scopes: minutes:minutes.basic:read' }],
    highlights: ['飞书妙记已生成，系统已完成自动同步。'],
    actions: ['打开飞书妙记查看完整纪要和后续行动项。']
  };

  assert.deepEqual(getSummaryDisplayState(record), {
    verified: false,
    title: '已拿到妙记，等待智能纪要',
    description: '请确认会议里已经开启智能纪要；生成后点击重试同步或等待系统自动回写。'
  });
  assert.equal(getRecordStatusText(record), '等待智能纪要');
});

test('frontend oauth badge uses specific permission copy when minutes permissions are missing', () => {
  const state = getOAuthDisplayState({
    authenticated: true,
    openId: 'ou_test_user',
    name: '张三',
    updatedAt: '2026-05-20T21:43:29.569Z',
    permissionWarning: { message: 'Missing scopes: minutes:minutes.basic:read' }
  });

  assert.equal(state.statusText, '需补授权');
  assert.equal(state.statusClass, 'status-badge warn');
  assert.equal(state.buttonText, '补充妙记授权');
  assert.equal(state.metricText, '张三');
  assert.match(state.detailText, /补充读取妙记权限/);
});

test('frontend oauth badge does not show reauthorization after normal login', () => {
  const state = getOAuthDisplayState({
    authenticated: true,
    name: '张三',
    updatedAt: '2026-05-20T21:43:29.569Z',
    formatTime: () => '2026/05/20 21:43'
  });

  assert.equal(state.statusText, '已登录：张三');
  assert.equal(state.buttonText, '已登录');
  assert.doesNotMatch(state.detailText, /重新授权|授权/);
});
