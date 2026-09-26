import os from 'node:os';
import path from 'node:path';

const secretKey = /authorization|cookie|password|passwd|secret|credential|private.?key|api.?key|(?:access|refresh|id|session|oauth).?token/i;
const patterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]'],
  [/\b((?:Authorization|Cookie|Set-Cookie|X-Api-Key)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]'],
  [/\b(?:eyJ[A-Za-z0-9_-]{8,}\.){2}[A-Za-z0-9_-]{8,}\b/g, '[REDACTED JWT]'],
  [/\b((?:access_token|refresh_token|id_token|client_secret|private_key|password|api_key)\s*[=:]\s*)[^\s&,;"']+/gi, '$1[REDACTED]'],
  [/(["']?(?:accessToken|refreshToken|idToken|clientSecret|privateKey|apiKey|password|secret)["']?\s*:\s*["'])[^"']+/gi, '$1[REDACTED]'],
  [/\bya29\.[A-Za-z0-9._-]+\b/g, '[REDACTED OAUTH TOKEN]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED API KEY]'],
  [/([?&](?:X-Goog-[^=&]+|token|access_token|signature|sig|key)=)[^&#\s]+/gi, '$1[REDACTED]'],
];

export function redactText(value, {home = os.homedir(), repoRoot = ''} = {}) {
  let result = String(value ?? '');
  for (const [pattern, replacement] of patterns) result = result.replace(pattern, replacement);
  for (const [folder, label] of [[repoRoot, '<repo>'], [home, '~']]) {
    if (!folder) continue;
    const normalized = path.resolve(folder).replaceAll('\\', '/');
    result = result.replaceAll(normalized, label).replaceAll(normalized.replaceAll('/', '\\'), label);
  }
  return result;
}

export function sanitize(value, options = {}, key = '') {
  if (secretKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value, options);
  if (Array.isArray(value)) return value.map(item => sanitize(item, options));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, sanitize(item, options, name)]),
  );
  return value;
}

export function safeError(error, options = {}) {
  return redactText(error instanceof Error ? error.message : String(error), options).slice(0, 600);
}
