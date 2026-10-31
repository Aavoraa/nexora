// AI providers per workspace: Anthropic Claude, Google Gemini, Groq, OpenRouter.
// A workspace admin picks one and saves its API key (encrypted, never returned).
// Without a workspace provider, the platform key (ANTHROPIC_API_KEY) is used if set; otherwise AI is off.
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { one, pool, logActivity } from './db.js';
import { requireRole } from './auth.js';
import { aiLimit } from './ratelimit.js';
import { encrypt, decrypt } from './integrations.js';

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic Claude', badge: 'Paid', description: 'Best writing quality. Pay as you go.',
    keyUrl: 'https://console.anthropic.com/settings/keys', keyPrefix: 'sk-ant-', defaultModel: 'claude-opus-5-5',
  },
  gemini: {
    label: 'Google Gemini', badge: 'Free tier', description: 'Free daily limit on Google AI Studio keys.',
    keyUrl: 'https://aistudio.google.com/apikey', keyPrefix: 'AIza', defaultModel: 'gemini-2.5-flash',
  },
  groq: {
    label: 'Groq', badge: 'Free tier', description: 'Very fast open models on a free, rate-limited plan.',
    keyUrl: 'https://console.groq.com/keys', keyPrefix: 'gsk_', defaultModel: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    label: 'OpenRouter', badge: 'Free models', description: 'One key for many models. Pick one marked free.',
    keyUrl: 'https://openrouter.ai/keys', keyPrefix: 'sk-or-', defaultModel: 'openrouter/auto',
  },
};
const OPENAI_COMPATIBLE = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 60_000;

/** `code`: 'auth' (key rejected), 'model' (unknown model), 'rate' (rate limited), or undefined. */
export class AiError extends Error {
  constructor(message, status = 502, code = undefined) {
    super(message);
    this.status = status;
    this.expose = true;
    this.code = code;
  }
}

// ---------- which provider a workspace uses ----------

/** @returns {Promise<null | {provider, key, model, source: 'workspace'|'platform'}>} */
export async function resolveProvider(workspaceId) {
  const row = await one(`
    SELECT w.ai_provider, p.key_enc, p.model FROM workspaces w
    LEFT JOIN ai_providers p ON p.workspace_id = w.id AND p.provider = w.ai_provider
    WHERE w.id = $1`, [workspaceId]);
  if (row?.ai_provider && row.key_enc) {
    return { provider: row.ai_provider, key: decrypt(row.key_enc).api_key, model: row.model || PROVIDERS[row.ai_provider].defaultModel, source: 'workspace' };
  }
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return { provider: 'anthropic', key: null, model: process.env.CADENCE_MODEL || PROVIDERS.anthropic.defaultModel, source: 'platform' };
  }
  return null;
}

export const aiAvailable = async (workspaceId) => !!(await resolveProvider(workspaceId));

// ---------- calling a provider ----------

/** Pull the JSON object out of a model reply (tolerates code fences or extra prose). */
export function extractJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { /* fall through */ }
  }
  throw new AiError('The AI returned an unreadable response. Try again or choose another model.');
}

async function httpError(res, label) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.error?.status || body?.message || '';
  } catch { /* not JSON */ }
  detail = String(detail).replace(/\s+/g, ' ').slice(0, 160);
  // Gemini reports a bad key as 400 "API key not valid"; treat it like 401.
  const badKey = res.status === 401 || res.status === 403 || (res.status === 400 && /api[ _-]?key/i.test(detail));
  if (badKey) return new AiError(`${label} rejected the API key. Check it was copied in full.`, 400, 'auth');
  if (res.status === 404 || (res.status === 400 && /model/i.test(detail) && /(not found|not supported|does not exist|invalid)/i.test(detail))) {
    return new AiError(`${label} doesn't offer that model to this key.`, 400, 'model');
  }
  if (res.status === 429) return new AiError(`${label} rate limit reached. Wait a moment, or check your plan's limits.`, 429, 'rate');
  if (res.status === 400) return new AiError(`${label} refused the request${detail ? `: ${detail}` : '.'}`, 400);
  return new AiError(`${label} had a problem (${res.status}). Try again shortly.`, 502);
}

async function fetchJson(url, init, label) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new AiError(err.name === 'TimeoutError' ? `${label} took too long to answer.` : `Couldn't reach ${label}.`, 502);
  }
  if (!res.ok) throw await httpError(res, label);
  return res.json();
}

const anthropicClient = (key) => (key ? new Anthropic({ apiKey: key }) : new Anthropic());

/**
 * One request returning JSON text. `schema` is used where the provider supports
 * structured output; every provider is also told the exact JSON shape in the prompt.
 */
export async function completeJson({ provider, key, model }, { system, prompt, schema, maxTokens = 4096 }) {
  const label = PROVIDERS[provider].label;
  const shape = `\n\nReply with JSON only, exactly in this shape: ${JSON.stringify(exampleFor(schema))}`;

  if (provider === 'anthropic') {
    const isDefault = model === PROVIDERS.anthropic.defaultModel;
    let response;
    try {
      response = await anthropicClient(key).beta.messages.create({
        model,
        max_tokens: Math.max(maxTokens, 1024),
        system,
        ...(isDefault ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        output_config: { ...(isDefault ? { effort: 'low' } : {}), format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new AiError(`${label} rejected the API key. Check it was copied in full.`, 400, 'auth');
      if (err instanceof Anthropic.NotFoundError) throw new AiError(`${label} doesn't offer that model to this key.`, 400, 'model');
      if (err instanceof Anthropic.RateLimitError) throw new AiError(`${label} rate limit reached. Try again in a moment.`, 429, 'rate');
      if (err instanceof Anthropic.BadRequestError) throw new AiError(`${label} refused the request: ${String(err.message).slice(0, 160)}`, 400);
      if (err instanceof Anthropic.APIError) throw new AiError(`${label} request failed (${err.status ?? 'network'}).`);
      throw err;
    }
    if (response.stop_reason === 'refusal') throw new AiError('The AI declined this brief. Try rephrasing it.', 422);
    if (response.stop_reason === 'max_tokens') throw new AiError('The AI response was cut off. Ask for fewer drafts.');
    return extractJson(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  }

  if (provider === 'gemini') {
    const data = await fetchJson(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt + shape }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
      }),
    }, label);
    if (data.promptFeedback?.blockReason) throw new AiError('The AI declined this brief. Try rephrasing it.', 422);
    const cand = data.candidates?.[0];
    if (!cand) throw new AiError(`${label} returned no answer.`);
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') throw new AiError('The AI declined this brief. Try rephrasing it.', 422);
    if (cand.finishReason === 'MAX_TOKENS') throw new AiError('The AI response was cut off. Ask for fewer drafts.');
    return extractJson((cand.content?.parts || []).map((p) => p.text || '').join(''));
  }

  // Groq and OpenRouter: OpenAI-compatible chat completions.
  const data = await fetchJson(`${OPENAI_COMPATIBLE[provider]}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...(provider === 'openrouter' ? { 'X-Title': 'Nexora' } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt + shape }],
      // Groq supports JSON mode broadly; on OpenRouter support varies by model, so rely on the prompt.
      ...(provider === 'groq' ? { response_format: { type: 'json_object' } } : {}),
    }),
  }, label);
  const choice = data.choices?.[0];
  if (!choice) throw new AiError(`${label} returned no answer.`);
  if (choice.finish_reason === 'content_filter') throw new AiError('The AI declined this brief. Try rephrasing it.', 422);
  if (choice.finish_reason === 'length') throw new AiError('The AI response was cut off. Ask for fewer drafts.');
  return extractJson(choice.message?.content || '');
}

/** A tiny example object matching a JSON schema, used to describe the shape in prompts. */
function exampleFor(schema) {
  if (!schema) return {};
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, exampleFor(v)]));
  if (schema.type === 'array') return [exampleFor(schema.items), '…'];
  if (schema.type === 'boolean') return true;
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  return '…';
}

/** Model ids the key can use. Free OpenRouter models first and flagged. */
export async function listModels(provider, key) {
  const label = PROVIDERS[provider].label;
  if (provider === 'anthropic') {
    try {
      const out = [];
      for await (const m of anthropicClient(key).models.list({ limit: 100 })) out.push({ id: m.id, name: m.display_name || m.id });
      return out;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new AiError(`${label} rejected the API key. Check it was copied in full.`, 400, 'auth');
      throw new AiError(`Couldn't load ${label} models.`);
    }
  }
  if (provider === 'gemini') {
    const data = await fetchJson(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, label);
    return (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }));
  }
  const data = await fetchJson(`${OPENAI_COMPATIBLE[provider]}/models`, { headers: { authorization: `Bearer ${key}` } }, label);
  const models = (data.data || []).filter((m) => !/whisper|tts|guard|embed/i.test(m.id)).map((m) => {
    const free = provider === 'openrouter' && (m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0));
    return { id: m.id, name: m.name || m.id, free };
  });
  return models.sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id)).slice(0, 300);
}

// ---------- automatic model choice ----------

/** Models that can't write post text (images, speech, embeddings, moderation…). */
const NOT_TEXT = /image|imagen|veo|tts|audio|speech|transcri|whisper|live|embed|aqa|guard|moderat|robotics|computer-use|vision-preview|learnlm/i;

/**
 * Preference order per provider: the first pattern that matches wins; within a pattern,
 * newer version numbers come first. Fast, capable general text models are preferred.
 */
const PREFERENCE = {
  anthropic: [/^claude-opus-5-5$/, /^claude-sonnet-5-5$/, /^claude-(opus|sonnet)-/, /^claude-/],
  gemini: [/^gemini-[\d.]+-flash$/, /^gemini-flash-latest$/, /^gemini-[\d.]+-flash(-\d+)?$/, /^gemini-[\d.]+-pro$/,
    /^gemini-.*flash(?!.*(preview|exp))/, /^gemini-/, /^gemma-/],
  groq: [/^llama-3\.3-70b-versatile$/, /llama.*70b/i, /gpt-oss-120b/, /gpt-oss/, /llama/i, /./],
  openrouter: [/:free$/, /^openrouter\/auto$/, /./],
};
const newestFirst = (a, b) => b.localeCompare(a, undefined, { numeric: true });

/** Candidate model ids for a key, best first. */
export function rankModels(provider, models) {
  let pool = models.filter((m) => !NOT_TEXT.test(m.id));
  // Paid OpenRouter models are only used when there is no free one.
  if (provider === 'openrouter' && pool.some((m) => m.free)) pool = pool.filter((m) => m.free);
  const ids = pool.map((m) => m.id);
  const out = [];
  for (const re of PREFERENCE[provider]) {
    for (const id of ids.filter((x) => re.test(x) && !out.includes(x)).sort(newestFirst)) out.push(id);
  }
  return out;
}

/**
 * Find a model this key can actually use: list the key's models, then try the best
 * candidates until one answers. Stops early if the key itself is rejected or rate limited.
 * @returns {Promise<{model: string, ms: number, tried: string[]}>}
 */
export async function detectModel(provider, key, { maxTries = 4 } = {}) {
  const label = PROVIDERS[provider].label;
  const candidates = rankModels(provider, await listModels(provider, key)).slice(0, maxTries);
  if (!candidates.length) throw new AiError(`This ${label} key has no models that can write text.`, 400);
  const tried = [];
  for (const model of candidates) {
    tried.push(model);
    const started = Date.now();
    try {
      await pingModel(provider, key, model);
      return { model, ms: Date.now() - started, tried };
    } catch (err) {
      if (err.code === 'auth' || err.code === 'rate') throw err;
      // Unknown or unusable model: try the next candidate.
    }
  }
  throw new AiError(`None of this ${label} key's models answered (tried ${tried.join(', ')}). Check the key's plan or try again later.`, 400);
}

const PING_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
function pingModel(provider, key, model) {
  return completeJson({ provider, key, model }, {
    system: 'You are a connection test.', prompt: 'Confirm you can answer.', maxTokens: 200, schema: PING_SCHEMA,
  });
}

/**
 * After a saved model disappears (providers retire models), pick a new one for the
 * workspace and save it. Returns the refreshed provider, or null if it's not a workspace key.
 */
export async function healModel(workspaceId, active) {
  if (active.source !== 'workspace') return null;
  const { model } = await detectModel(active.provider, active.key);
  await pool.query('UPDATE ai_providers SET model = $3, updated_at = now() WHERE workspace_id = $1 AND provider = $2',
    [workspaceId, active.provider, model]);
  return { ...active, model };
}

// ---------- settings API (mounted at /api/ai) ----------

export const aiSettings = express.Router();
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const providerFrom = (v) => (PROVIDERS[v] ? v : (() => { throw new AiError('Choose Anthropic, Gemini, Groq or OpenRouter', 400); })());

async function settingsFor(workspaceId) {
  const ws = await one('SELECT ai_provider FROM workspaces WHERE id = $1', [workspaceId]);
  const rows = (await pool.query(`SELECT p.provider, p.hint, p.model, p.updated_at, u.display_name AS updated_by
    FROM ai_providers p LEFT JOIN users u ON u.id = p.updated_by WHERE p.workspace_id = $1`, [workspaceId])).rows;
  const active = await resolveProvider(workspaceId);
  return {
    selected: ws.ai_provider,
    source: active?.source || null,
    active_provider: active?.provider || null,
    active_model: active?.model || null,
    platform_available: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    providers: Object.entries(PROVIDERS).map(([key, p]) => {
      const r = rows.find((x) => x.provider === key);
      return {
        key, label: p.label, badge: p.badge, description: p.description, key_url: p.keyUrl, key_prefix: p.keyPrefix,
        default_model: p.defaultModel, configured: !!r, hint: r?.hint || '', model: r?.model || '',
        updated_at: r?.updated_at || null, updated_by: r?.updated_by || null,
      };
    }),
  };
}

/** The key to use for a test/models call: the one typed in, else the saved one. */
async function keyFor(workspaceId, provider, typed) {
  if (typeof typed === 'string' && typed.trim()) return typed.trim();
  const row = await one('SELECT key_enc FROM ai_providers WHERE workspace_id = $1 AND provider = $2', [workspaceId, provider]);
  if (!row) throw new AiError('No API key provided.', 400);
  return decrypt(row.key_enc).api_key;
}

aiSettings.get('/settings', ah(async (req, res) => res.json(await settingsFor(req.user.workspace_id))));

/**
 * Save a provider key. The model is chosen automatically: the key's models are listed and
 * the best one that actually answers is stored. Nothing is saved if no model works.
 */
aiSettings.put('/settings', requireRole('admin'), aiLimit, ah(async (req, res) => {
  const provider = providerFrom(req.body.provider);
  const typedKey = typeof req.body.api_key === 'string' ? req.body.api_key.trim() : '';
  if (typedKey.length > 300) throw new AiError('That API key is too long.', 400);
  const key = await keyFor(req.user.workspace_id, provider, typedKey);
  const { model, ms } = await detectModel(provider, key);
  await pool.query(`
    INSERT INTO ai_providers (workspace_id, provider, key_enc, hint, model, updated_by, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6, now())
    ON CONFLICT (workspace_id, provider) DO UPDATE SET key_enc = EXCLUDED.key_enc, hint = EXCLUDED.hint,
      model = EXCLUDED.model, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [req.user.workspace_id, provider, encrypt({ api_key: key }), `…${key.slice(-4)}`, model, req.user.id]);
  if (req.body.select !== false) await pool.query('UPDATE workspaces SET ai_provider = $2 WHERE id = $1', [req.user.workspace_id, provider]);
  await logActivity(req.user.workspace_id, req.user.id, 'ai.provider_saved', `${PROVIDERS[provider].label} · ${model}`);
  res.json({ ...(await settingsFor(req.user.workspace_id)), detected: { model, ms } });
}));

aiSettings.delete('/settings/:provider', requireRole('admin'), ah(async (req, res) => {
  const provider = providerFrom(req.params.provider);
  await pool.query('DELETE FROM ai_providers WHERE workspace_id = $1 AND provider = $2', [req.user.workspace_id, provider]);
  await pool.query('UPDATE workspaces SET ai_provider = NULL WHERE id = $1 AND ai_provider = $2', [req.user.workspace_id, provider]);
  await logActivity(req.user.workspace_id, req.user.id, 'ai.provider_removed', PROVIDERS[provider].label);
  res.json(await settingsFor(req.user.workspace_id));
}));

/** Stop using a workspace provider (falls back to the platform key, or AI off). */
aiSettings.post('/settings/unselect', requireRole('admin'), ah(async (req, res) => {
  await pool.query('UPDATE workspaces SET ai_provider = NULL WHERE id = $1', [req.user.workspace_id]);
  await logActivity(req.user.workspace_id, req.user.id, 'ai.provider_unselected');
  res.json(await settingsFor(req.user.workspace_id));
}));

/** Check a key without saving it: finds the model it would use. */
aiSettings.post('/test', requireRole('admin'), aiLimit, ah(async (req, res) => {
  const provider = providerFrom(req.body.provider);
  const key = await keyFor(req.user.workspace_id, provider, req.body.api_key);
  const { model, ms, tried } = await detectModel(provider, key);
  res.json({ ok: true, model, ms, tried });
}));
