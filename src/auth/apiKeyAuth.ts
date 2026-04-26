/**
 * API Key Authentication
 *
 * Systems authenticate via `Authorization: Bearer <api-key>` header.
 * API keys are 64-character hex strings; stored as SHA-256 hashes.
 * Each valid request touches `last_activity_at` (implicit heartbeat).
 *
 * Falls back to Basic Auth when `AUTH_USERNAME`/`AUTH_PASSWORD` are set
 * (admin override for backward compatibility).
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { FhirStore, SynapseSystem } from '../types/fhir';
import { validateBasicAuth } from './basicAuth';

/** Paths that never require authentication. */
const PUBLIC_PATH_PREFIXES = [
  '/health',
  '/docs',
  '/demo',
  '/public/',
  '/scheduler/',
  '/Directory',
  '/System/register',
  '/hl7-tester',
  '/mcp/',
];

const PUBLIC_EXACT_PATHS = new Set(['/', '/health', '/favicon.ico']);

/** Paths that match /System/:id/verify */
const SYSTEM_VERIFY_RE = /^\/System\/[^/]+\/verify$/;

/**
 * Returns true when the given URL should be accessible without auth.
 */
function isPublicPath(url: string): boolean {
  const path = url.split('?')[0];
  if (PUBLIC_EXACT_PATHS.has(path)) return true;
  if (SYSTEM_VERIFY_RE.test(path)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** FHIR resource paths that allow unauthenticated GET (read-only). */
const PUBLIC_READ_PREFIXES = ['/Schedule', '/Slot', '/Appointment'];

/**
 * Returns true when the request is a public read-only FHIR query.
 * Patients must be able to browse providers, slots, and appointment status
 * without an API key.
 */
function isPublicRead(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const path = url.split('?')[0];
  return PUBLIC_READ_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Slot $hold and Appointment booking — public writes secured by hold tokens, not API keys. */
const PATIENT_WRITE_RE = /^\/Slot\/[^/]+\/\$hold(\/[^/]+)?$/;

/** Test cleanup endpoint — gated by ENABLE_TEST_ENDPOINTS, not by auth. */
const TEST_CLEANUP_RE = /^\/Slot\/\$holds$/;

function isPublicWrite(method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (PATIENT_WRITE_RE.test(path)) return true;
  if (method === 'DELETE' && TEST_CLEANUP_RE.test(path)) return true;
  if (method === 'POST' && path === '/Appointment') return true;
  return false;
}

/**
 * Generate a new API key (64-char hex string from 32 random bytes).
 */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash an API key for storage (SHA-256 hex digest).
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

// Augment Fastify request with system context
declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated system, if any. */
    system?: SynapseSystem;
    /** Whether the request was authenticated as admin (Basic Auth). */
    isAdmin?: boolean;
  }
}

/**
 * Register a global `onRequest` hook that enforces API key auth.
 * Falls back to Basic Auth if configured (admin access).
 * HL7 paths are skipped — they authenticate via MSH-8.
 */
export function registerApiKeyAuth(fastify: FastifyInstance, store: FhirStore): void {
  const adminUsername = process.env.AUTH_USERNAME;
  const adminPassword = process.env.AUTH_PASSWORD;
  const hasAdminAuth = !!(adminUsername && adminPassword);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url)) return;
    if (isPublicRead(request.method, request.url)) return;
    if (isPublicWrite(request.method, request.url)) return;

    // HL7 paths authenticate via MSH-8, not Bearer token
    const contentType = request.headers['content-type'] || '';
    const isHL7Path = request.url.startsWith('/hl7/');
    const isHL7Content = contentType.includes('hl7-v2') || (contentType.includes('text/plain') && isHL7Path);
    if (isHL7Path || isHL7Content) return;

    const authHeader = request.headers.authorization || '';

    // Try Bearer token first
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const hash = hashApiKey(token);
      const system = await store.getSystemByApiKeyHash(hash);

      if (system && system.status !== 'expired') {
        request.system = system;
        // Fire-and-forget activity update
        store.updateSystemActivity(system.id).catch(() => {});
        return;
      }
    }

    // Fall back to Basic Auth (admin access)
    if (hasAdminAuth && validateBasicAuth(authHeader, adminUsername!, adminPassword!)) {
      request.isAdmin = true;
      return;
    }

    // No valid auth
    reply.status(401).header('WWW-Authenticate', 'Bearer realm="FHIRTogether API"');
    reply.send({ error: 'Authentication required. Use Authorization: Bearer <api-key>' });
  });
}
