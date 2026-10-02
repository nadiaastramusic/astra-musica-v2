const crypto = require('crypto');

function parseImage(value) {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
  return match ? { type: match[1], body: match[2] } : null;
}

function imageVersion(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

// Store no second image cache in server memory. URLs resolve into existing state.
function mediaView(value, bucket, parts = []) {
  if (parseImage(value)) {
    const query = new URLSearchParams({ bucket, path: JSON.stringify(parts), v: imageVersion(value) });
    return '/api/media?' + query.toString();
  }
  if (Array.isArray(value)) return value.map((item, i) => mediaView(item, bucket, [...parts, String(i)]));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mediaView(item, bucket, [...parts, key])]));
  }
  return value;
}

function resolveMedia(sources, bucket, parts) {
  if (!Object.hasOwn(sources, bucket) || !Array.isArray(parts) || parts.length > 12) return null;
  let value = sources[bucket];
  for (const key of parts) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
        || value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return null;
    value = value[key];
  }
  return parseImage(value) ? value : null;
}

module.exports = { mediaView, resolveMedia, parseImage, imageVersion };
