/** Networks Nexora can plan for, with their per-post character limits. */
export const PLATFORMS = {
  x:         { label: 'X',         limit: 280 },
  threads:   { label: 'Threads',   limit: 500 },
  linkedin:  { label: 'LinkedIn',  limit: 3000 },
  instagram: { label: 'Instagram', limit: 2200, needsMedia: true },
  facebook:  { label: 'Facebook',  limit: 5000 },
  tiktok:    { label: 'TikTok',    limit: 2200, needsVideo: true },
  pinterest: { label: 'Pinterest', limit: 500 },
  youtube:   { label: 'YouTube',   limit: 5000, needsVideo: true },
};

/**
 * Format guidance per network: aspect ratio as width/height and video length in seconds.
 * Approximations of each network's published limits. They drive warnings, not blocks.
 * Re-check them against the networks' current docs when a publishing adapter is built.
 */
const RULES = {
  x:         { minAspect: 1 / 2.39, maxAspect: 2.39, maxSeconds: 140, h264Only: true },
  threads:   { minAspect: 0.5, maxAspect: 1.91, maxSeconds: 300 },
  linkedin:  { minAspect: 1 / 2.4, maxAspect: 2.4, minSeconds: 3, maxSeconds: 600, h264Only: true },
  instagram: { minAspect: 0.5, maxAspect: 1.91, minSeconds: 3, maxSeconds: 900, imageMinAspect: 0.8 },
  facebook:  { minAspect: 0.5, maxAspect: 2.0, maxSeconds: 14_400 },
  tiktok:    { minAspect: 0.5, maxAspect: 0.6, minSeconds: 3, maxSeconds: 600, vertical: true },
  pinterest: { minAspect: 0.5, maxAspect: 1.0, minSeconds: 4, maxSeconds: 900, h264Only: true },
  youtube:   { minAspect: 0.5, maxAspect: 1.78, maxSeconds: 43_200 },
};

const fmtSecs = (s) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s}s`);

/** Describe the aspect ratio in words people recognise. */
export function aspectLabel(width, height) {
  if (!width || !height) return '';
  const r = width / height;
  const known = [[9 / 16, '9:16'], [4 / 5, '4:5'], [1, '1:1'], [16 / 9, '16:9'], [1.91, '1.91:1'], [2 / 3, '2:3']];
  const hit = known.find(([k]) => Math.abs(r - k) < 0.03);
  return hit ? hit[1] : `${r.toFixed(2)}:1`;
}

/**
 * How well a media item fits each network.
 * @returns {Record<string, {ok:boolean, note:string}>}
 */
export function readiness(media) {
  const out = {};
  const r = media.width && media.height ? media.width / media.height : null;
  const secs = (media.duration_ms || 0) / 1000;
  for (const [key, p] of Object.entries(PLATFORMS)) {
    const rule = RULES[key];
    const problems = [];
    if (media.kind === 'image') {
      if (p.needsVideo) problems.push('needs a video');
      const min = rule.imageMinAspect ?? rule.minAspect;
      if (r && (r < min - 0.01 || r > rule.maxAspect + 0.01)) problems.push(`${aspectLabel(media.width, media.height)} may be cropped`);
    } else {
      if (r && (r < rule.minAspect - 0.01 || r > rule.maxAspect + 0.01)) {
        problems.push(rule.vertical ? 'works best vertical (9:16)' : `${aspectLabel(media.width, media.height)} may be cropped`);
      }
      if (rule.maxSeconds && secs > rule.maxSeconds) problems.push(`longer than ${fmtSecs(rule.maxSeconds)}`);
      if (rule.minSeconds && secs < rule.minSeconds) problems.push(`shorter than ${rule.minSeconds}s`);
      if (rule.h264Only && /^(hvc1|hev1)$/.test(media.codec || '')) problems.push('HEVC may be rejected; H.264 is safest');
    }
    out[key] = { ok: problems.length === 0, note: problems.join(', ') };
  }
  return out;
}

/** Upload limits (PRD Feature 11). */
export const MEDIA_LIMITS = {
  video: { maxBytes: 500 * 1024 * 1024, maxSeconds: 600, mimes: ['video/mp4', 'video/quicktime'] },
  image: { maxBytes: 10 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
};
