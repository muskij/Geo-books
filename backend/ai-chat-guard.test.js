import test from 'node:test';
import assert from 'node:assert/strict';
import { chatBudgetForTier, sanitizeChatMessages, clampChatParams, MAX_CHAT_MESSAGES, MAX_CHAT_TOKENS } from './ai-chat-guard.js';

test('budget by tier', () => {
  assert.equal(chatBudgetForTier('free'), 30);
  assert.equal(chatBudgetForTier(undefined), 30);
  assert.equal(chatBudgetForTier('PREMIUM'), 400);
  assert.equal(chatBudgetForTier('EXAM_PASS_SEASON'), 120);
});
test('rejects bad messages', () => {
  assert.equal(sanitizeChatMessages(null).ok, false);
  assert.equal(sanitizeChatMessages([]).ok, false);
  assert.equal(sanitizeChatMessages([{ role: 'tool', content: 'x' }]).ok, false);
  assert.equal(sanitizeChatMessages([{ role: 'user', content: 5 }]).ok, false);
  assert.equal(sanitizeChatMessages(Array(MAX_CHAT_MESSAGES + 1).fill({ role: 'user', content: 'a' })).ok, false);
  assert.equal(sanitizeChatMessages([{ role: 'user', content: 'a'.repeat(30000) }]).ok, false);
});
test('strips extra fields', () => {
  const r = sanitizeChatMessages([{ role: 'user', content: 'hi', name: 'x', tool_calls: [1] }]);
  assert.deepEqual(r.messages, [{ role: 'user', content: 'hi' }]);
});
test('clamps params', () => {
  assert.equal(clampChatParams({ maxTokens: 999999 }).maxTokens, MAX_CHAT_TOKENS);
  assert.equal(clampChatParams({}).maxTokens, 2000);
  assert.equal(clampChatParams({ temperature: 9 }).temperature, 1.5);
  assert.equal(clampChatParams({ temperature: 'abc' }).temperature, 0.7);
});
