/**
 * System Routes
 *
 * REST endpoints for system registration, verification, and management.
 * Supports two onboarding paths:
 *   1. HL7 zero-friction (auto-registered via MSH-4/MSH-8 on first SIU)
 *   2. REST API registration with TLS challenge-response verification
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { FhirStore } from '../types/fhir';
import { generateApiKey, hashApiKey } from '../auth/apiKeyAuth';

export async function systemRoutes(fastify: FastifyInstance, store: FhirStore) {

  /**
   * POST /System/register — Public. Claim a URL + name, get a challenge token.
   */
  fastify.post<{
    Body: { name: string; url: string };
  }>('/System/register', {
    schema: {
      description: 'Register a new system. Returns a challenge token that must be served at the system URL.',
      tags: ['System'],
      body: {
        type: 'object',
        required: ['name', 'url'],
        properties: {
          name: { type: 'string', description: 'Organization name (e.g. "Ready Med")' },
          url: { type: 'string', format: 'uri', description: 'System URL (must be HTTPS in production)' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            systemId: { type: 'string' },
            challengeToken: { type: 'string' },
            challengeUrl: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
    },
  }, async (request, reply) => {
    const { name, url } = request.body;

    // Check URL uniqueness
    const existing = await store.getSystemByUrl(url);
    if (existing) {
      return reply.status(409).send({ error: 'URL already registered', systemId: existing.id });
    }

    const challengeToken = crypto.randomBytes(32).toString('hex');
    const defaultTtl = parseInt(process.env.SYSTEM_TTL_DAYS || '7', 10);

    const system = await store.createSystem({
      name,
      url,
      status: 'pending',
      ttlDays: defaultTtl,
      challengeToken,
    });

    const challengeUrl = `${url.replace(/\/$/, '')}/.well-known/fhirtogether-verify`;

    return reply.status(201).send({
      systemId: system.id,
      challengeToken,
      challengeUrl,
      instructions: `Serve the challenge token at ${challengeUrl} then call POST /System/${system.id}/verify`,
    });
  });

  /**
   * POST /System/:id/verify — Public. Complete TLS challenge-response.
   * Fetches the challenge URL over HTTPS (Node validates the TLS cert).
   * On success returns a one-time API key.
   */
  fastify.post<{
    Params: { id: string };
  }>('/System/:id/verify', {
    schema: {
      description: 'Verify system ownership via TLS challenge-response. Returns a one-time API key.',
      tags: ['System'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            systemId: { type: 'string' },
            apiKey: { type: 'string' },
            name: { type: 'string' },
            url: { type: 'string' },
            status: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
    },
  }, async (request, reply) => {
    const system = await store.getSystemById(request.params.id);
    if (!system) {
      return reply.status(404).send({ error: 'System not found' });
    }

    // Get the challenge token from the store
    const challengeToken = await store.getSystemChallengeToken(system.id);

    if (!challengeToken) {
      return reply.status(400).send({ error: 'No challenge pending for this system' });
    }

    if (!system.url) {
      return reply.status(400).send({ error: 'System has no URL to verify' });
    }

    // Fetch the challenge URL — Node.js will validate TLS by default
    const challengeUrl = `${system.url.replace(/\/$/, '')}/.well-known/fhirtogether-verify`;
    try {
      const response = await fetch(challengeUrl, {
        signal: AbortSignal.timeout(10000),
      });
      const body = (await response.text()).trim();

      if (body !== challengeToken) {
        return reply.status(403).send({
          error: 'Challenge token mismatch',
          expected: 'Token served at .well-known/fhirtogether-verify must match the challenge token',
        });
      }
    } catch (err) {
      return reply.status(502).send({
        error: `Failed to fetch challenge URL: ${err instanceof Error ? err.message : 'Unknown error'}`,
        challengeUrl,
      });
    }

    // Verification passed — generate API key
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    await store.updateSystem(system.id, {
      status: 'active',
      apiKeyHash,
      challengeToken: undefined,
    });

    return {
      systemId: system.id,
      apiKey, // Returned ONCE — never stored in plaintext
      name: system.name,
      url: system.url,
      status: 'active',
    };
  });

  /**
   * GET /System — Authenticated. Get own system details.
   */
  fastify.get('/System', {
    schema: {
      description: 'Get the authenticated system details, or list all systems (admin).',
      tags: ['System'],
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.isAdmin) {
      const systems = await store.getSystems();
      return { systems };
    }
    if (!request.system) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    return { system: request.system };
  });

  /**
   * PUT /System — Authenticated. Update own system details.
   */
  fastify.put<{
    Body: { name?: string };
  }>('/System', {
    schema: {
      description: 'Update the authenticated system name or other mutable fields.',
      tags: ['System'],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest<{ Body: { name?: string } }>, reply: FastifyReply) => {
    if (!request.system) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const updated = await store.updateSystem(request.system.id, {
      name: request.body.name,
    });

    return { system: updated };
  });

  /**
   * DELETE /System — Authenticated. Voluntary de-registration.
   */
  fastify.delete('/System', {
    schema: {
      description: 'De-register the authenticated system. Cascades to all locations, schedules, slots, and appointments.',
      tags: ['System'],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.system) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    await store.deleteSystem(request.system.id);
    return reply.status(204).send();
  });

  /**
   * POST /System/rekey — Authenticated. Rotate API key.
   */
  fastify.post('/System/rekey', {
    schema: {
      description: 'Generate a new API key for the authenticated system. The old key is immediately invalidated.',
      tags: ['System'],
      response: {
        200: {
          type: 'object',
          properties: { apiKey: { type: 'string' } },
          additionalProperties: true,
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.system) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    await store.updateSystem(request.system.id, { apiKeyHash });

    return { apiKey }; // Returned ONCE
  });

  /**
   * PUT /System/:id/status — Admin only. Change system status.
   */
  fastify.put<{
    Params: { id: string };
    Body: { status: string };
  }>('/System/:id/status', {
    schema: {
      description: 'Admin: set system verification status (unverified → active, or force-expire).',
      tags: ['System'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['unverified', 'active', 'expired'] },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>, reply: FastifyReply) => {
    if (!request.isAdmin) {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const system = await store.getSystemById(request.params.id);
    if (!system) {
      return reply.status(404).send({ error: 'System not found' });
    }

    const validStatuses = ['unverified', 'active', 'expired'];
    if (!validStatuses.includes(request.body.status)) {
      return reply.status(400).send({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const updated = await store.updateSystem(system.id, {
      status: request.body.status as any,
    });

    return { system: updated };
  });
}
