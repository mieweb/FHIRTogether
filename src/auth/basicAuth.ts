/**
 * HTTP Basic Auth
 *
 * Provides timing-safe validation of Basic Auth credentials and a
 * Fastify `onRequest` hook that can be registered globally or per-scope.
 *
 * Public paths (health check, docs, demo assets) are exempted so they
 * remain accessible without credentials.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';

/** Paths that never require authentication. */
const PUBLIC_PATH_PREFIXES = ['/health', '/docs', '/demo', '/scheduler/'];
const PUBLIC_EXACT_PATHS = new Set(['/', '/health']);

/**
 * Returns true when the given URL should be accessible without auth.
 */
function isPublicPath(url: string): boolean {
  // Strip query string for comparison
  const path = url.split('?')[0];

  if (PUBLIC_EXACT_PATHS.has(path)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Validate an HTTP Basic Auth header against the expected credentials.
 * Uses `crypto.timingSafeEqual` to prevent timing attacks.
 */
export function validateBasicAuth(
  authHeader: string | undefined,
  expectedUsername: string,
  expectedPassword: string,
): boolean {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  const base64 = authHeader.slice(6);
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) {
    return false;
  }

  const username = decoded.slice(0, colonIndex);
  const password = decoded.slice(colonIndex + 1);

  const expectedUserBuf = Buffer.from(expectedUsername, 'utf-8');
  const expectedPassBuf = Buffer.from(expectedPassword, 'utf-8');
  const actualUserBuf = Buffer.from(username, 'utf-8');
  const actualPassBuf = Buffer.from(password, 'utf-8');

  const usernameMatch =
    expectedUserBuf.length === actualUserBuf.length &&
    timingSafeEqual(expectedUserBuf, actualUserBuf);
  const passwordMatch =
    expectedPassBuf.length === actualPassBuf.length &&
    timingSafeEqual(expectedPassBuf, actualPassBuf);

  return usernameMatch && passwordMatch;
}

/**
 * Register a global `onRequest` hook that enforces HTTP Basic Auth.
 *
 * Call this once on the root Fastify instance — it will protect every
 * route except the public paths listed above.
 *
 * If `AUTH_USERNAME` and `AUTH_PASSWORD` are not both set the hook is
 * **not** installed and the function returns `false` so callers can log
 * a warning.
 */
export function registerBasicAuth(fastify: FastifyInstance): boolean {
  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;

  if (!username || !password) {
    return false; // auth not configured
  }

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url)) return;

    if (!validateBasicAuth(request.headers.authorization, username, password)) {
      const contentType = request.headers['content-type'] || '';
      const isHL7 =
        contentType.includes('text/plain') ||
        contentType.includes('hl7-v2');

      reply
        .status(401)
        .header('WWW-Authenticate', 'Basic realm="FHIRTogether API"');

      if (isHL7) {
        reply
          .header('Content-Type', 'text/plain')
          .send('Authentication required');
      } else {
        reply.send({ error: 'Authentication required' });
      }
    }
  });

  return true;
}
