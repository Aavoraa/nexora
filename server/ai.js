// Post drafts with the workspace's AI provider (see aiproviders.js).
import { PLATFORMS } from './platforms.js';
import { AiError, completeJson, resolveProvider, healModel } from './aiproviders.js';

export { AiError };

const SYSTEM = `You write social media posts for a brand's marketing team.
Write in the brand's voice when one is given. Match the conventions of the target platform:
its length limit, how hashtags and emojis are used there, and its typical tone.
Each draft must be ready to publish as-is: no placeholders, no surrounding quotes, no commentary.
Make the drafts meaningfully different from each other in angle or hook, not just wording.`;

const SCHEMA = {
  type: 'object',
  properties: {
    drafts: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['drafts'],
  additionalProperties: false,
};

const LENGTH_HINT = {
  short: 'Keep each draft short: one or two sentences.',
  medium: 'Keep each draft to a short paragraph.',
  long: 'Each draft can be a fuller post of several short paragraphs, still within the limit.',
};

/**
 * Generate post drafts for a brand.
 * @returns {Promise<string[]>}
 */
export async function generateDrafts({ brand, platform, brief, tone, count, length = 'medium', emoji = true, hashtags = false }) {
  const provider = await resolveProvider(brand.workspace_id);
  if (!provider) {
    throw new AiError('AI is off for this workspace. An admin can choose an AI provider in Setup.', 503);
  }
  const p = PLATFORMS[platform] || PLATFORMS.linkedin;

  const prompt = [
    `Brand: ${brand.name}`,
    brand.voice ? `Brand voice: ${brand.voice}` : null,
    `Platform: ${p.label} (max ${p.limit} characters per post)`,
    tone ? `Tone: ${tone}` : null,
    LENGTH_HINT[length] || LENGTH_HINT.medium,
    emoji ? 'Emoji: use at most one or two, only where natural.' : 'Emoji: do not use any emoji.',
    hashtags ? 'Hashtags: end with two or three relevant hashtags.' : 'Hashtags: do not use hashtags.',
    `Brief: ${brief}`,
    '',
    `Write ${count} distinct drafts.`,
  ].filter((l) => l !== null).join('\n');

  const request = { system: SYSTEM, prompt, schema: SCHEMA, maxTokens: 4096 };
  let out;
  try {
    out = await completeJson(provider, request);
  } catch (err) {
    // The saved model was retired or withdrawn: pick a working one, save it, retry once.
    if (err.code !== 'model' || provider.source !== 'workspace') throw err;
    out = await completeJson(await healModel(brand.workspace_id, provider), request);
  }
  if (!Array.isArray(out?.drafts)) throw new AiError('The AI returned an unreadable response. Try again or choose another model.');
  return out.drafts
    .map((d) => String(d).trim())
    .filter(Boolean)
    .slice(0, count);
}
