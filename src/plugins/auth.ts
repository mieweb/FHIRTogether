/**
 * Simple Bearer Token Authentication Plugin
 * This is a stub implementation for future SMART-on-FHIR integration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createOperationOutcome } from '../utils/fhir';

export interface AuthConfig {
  enabled: boolean;
  tokenSecret: string;
  publicPaths: string[];
}

export async function authPlugin(fastify: FastifyInstance, options: AuthConfig): Promise<void> {
  if (!options.enabled) {
    fastify.log.info('Authentication disabled');
    return;
  }

  fastify.log.info('Authentication enabled with bearer token validation');

  // Add authentication hook
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public paths
    const isPublicPath = options.publicPaths.some(path => 
      request.url.startsWith(path)
    );

    if (isPublicPath) {
      return;
    }

    const authorization = request.headers.authorization;
    
    if (!authorization) {
      const outcome = createOperationOutcome('error', 'login', 'Authorization header required');
      reply.code(401).send(outcome);
      return;
    }

    if (!authorization.startsWith('Bearer ')) {
      const outcome = createOperationOutcome('error', 'login', 'Bearer token required');
      reply.code(401).send(outcome);
      return;
    }

    const token = authorization.substring(7);
    
    // Simple token validation (stub)
    if (!token || token === 'invalid' || token === '') {
      const outcome = createOperationOutcome('error', 'login', 'Invalid or expired token');
      reply.code(401).send(outcome);
      return;
    }

    // For demo purposes, accept any non-empty token except 'invalid'
    // In a real implementation, this would verify JWT signatures, check expiration, etc.
    if (token.length < 3) {
      const outcome = createOperationOutcome('error', 'login', 'Token too short');
      reply.code(401).send(outcome);
      return;
    }

    // Attach user context to request (stub)
    (request as any).user = {
      id: 'user-' + token.substring(0, 8),
      scope: ['read', 'write'],
      aud: 'fhirtogether'
    };

    fastify.log.debug(`Authenticated user: ${(request as any).user.id}`);
  });

  // Add token introspection endpoint
  fastify.get('/auth/introspect', {
    schema: {
      headers: {
        type: 'object',
        required: ['authorization'],
        properties: {
          authorization: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            active: { type: 'boolean' },
            sub: { type: 'string' },
            aud: { type: 'string' },
            scope: { type: 'string' },
            exp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    
    if (!user) {
      reply.code(200).send({ active: false });
      return;
    }

    reply.code(200).send({
      active: true,
      sub: user.id,
      aud: user.aud,
      scope: user.scope.join(' '),
      exp: Math.floor(Date.now() / 1000) + 3600 // Expires in 1 hour
    });
  });

  // Add token generation endpoint (for testing only)
  fastify.post('/auth/token', {
    schema: {
      body: {
        type: 'object',
        required: ['client_id'],
        properties: {
          client_id: { type: 'string' },
          client_secret: { type: 'string' },
          grant_type: { type: 'string' },
          scope: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            access_token: { type: 'string' },
            token_type: { type: 'string' },
            expires_in: { type: 'number' },
            scope: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { client_id: string; client_secret?: string; grant_type?: string; scope?: string } }>, reply: FastifyReply) => {
    const { client_id, client_secret, grant_type = 'client_credentials', scope = 'read write' } = request.body;

    // Simple client validation (stub)
    if (!client_id || client_id === 'invalid') {
      const outcome = createOperationOutcome('error', 'invalid_client', 'Invalid client credentials');
      reply.code(400).send(outcome);
      return;
    }

    // Generate a simple token (in production, this would be a signed JWT)
    const token = `demo-token-${client_id}-${Date.now()}`;

    reply.code(200).send({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope
    });
  });
}