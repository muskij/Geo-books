// Guards for /api/ai/chat: bounded input, bounded output, per-tier daily quota.
// Pure functions so they can be unit-tested without Firebase or OpenAI.

export const AI_CHAT_DAILY_BUDGET = { FREE: 30, STANDARD: 120, PREMIUM: 400 };
export const DEFAULT_AI_CHAT_BUDGET = 30;
export const MAX_CHAT_MESSAGES = 30;
export const MAX_CHAT_CHARS = 24000;   // total characters across all messages
export const MAX_CHAT_TOKENS = 2500;   // cap on completion size

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);

export function chatBudgetForTier(tier) {
  const t = String(tier || 'FREE').toUpperCase();
  if (AI_CHAT_DAILY_BUDGET[t] != null) return AI_CHAT_DAILY_BUDGET[t];
  // Paid-but-not-listed tiers (exam/university/tutor passes, *_ANNUAL) get the STANDARD budget.
  return t === 'FREE' ? DEFAULT_AI_CHAT_BUDGET : AI_CHAT_DAILY_BUDGET.STANDARD;
}

// Returns { ok, messages, error }. Drops nothing silently: invalid input is rejected.
export function sanitizeChatMessages(input) {
  if (!Array.isArray(input) || !input.length) return { ok: false, error: 'messages array is required' };
  if (input.length > MAX_CHAT_MESSAGES) return { ok: false, error: `Too many messages (max ${MAX_CHAT_MESSAGES})` };
  let total = 0;
  const out = [];
  for (const m of input) {
    if (!m || typeof m !== 'object' || !ALLOWED_ROLES.has(m.role) || typeof m.content !== 'string') {
      return { ok: false, error: 'Each message needs a valid role and string content' };
    }
    total += m.content.length;
    out.push({ role: m.role, content: m.content });
  }
  if (total > MAX_CHAT_CHARS) return { ok: false, error: 'Conversation is too long' };
  return { ok: true, messages: out };
}

export function clampChatParams({ temperature, maxTokens } = {}) {
  const t = Number(temperature);
  const mt = Number(maxTokens);
  return {
    temperature: Number.isFinite(t) ? Math.min(1.5, Math.max(0, t)) : 0.7,
    maxTokens: Number.isFinite(mt) && mt > 0 ? Math.min(MAX_CHAT_TOKENS, Math.floor(mt)) : 2000
  };
}
