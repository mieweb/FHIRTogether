/**
 * Main Fastify Server Application
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import env from '@fastify/env';

// Route imports
import { scheduleRoutes } from './routes/schedule';
import { slotRoutes } from './routes/slot';
import { appointmentRoutes } from './routes/appointment';
import { specialRoutes } from './routes/special';

const envSchema = {
  type: 'object',
  required: [],
  properties: {
    NODE_ENV: {
      type: 'string',
      default: 'development'
    },
    PORT: {
      type: 'string',
      default: '3000'
    },
    STORE_BACKEND: {
      type: 'string',
      default: 'simulator'
    },
    ENABLE_TEST_MODE: {
      type: 'string',
      default: 'true'
    },
    ENABLE_AUTH: {
      type: 'string',
      default: 'false'
    }
  }
};

async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
    }
  });

  // Register environment plugin
  await fastify.register(env, {
    schema: envSchema,
    dotenv: true
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });

  // Register Swagger documentation
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'FHIRTogether Scheduling Synapse',
        description: 'FHIR-compliant gateway and test server for schedule and appointment availability',
        version: '1.0.0',
        contact: {
          name: 'mieweb',
          url: 'https://github.com/mieweb/FHIRTogether'
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT'
        }
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server'
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      },
      tags: [
        {
          name: 'Schedule',
          description: 'FHIR Schedule resource operations'
        },
        {
          name: 'Slot',
          description: 'FHIR Slot resource operations'
        },
        {
          name: 'Appointment',
          description: 'FHIR Appointment resource operations'
        },
        {
          name: 'HL7v2',
          description: 'HL7v2 message ingestion'
        },
        {
          name: 'Test Mode',
          description: 'Test and simulation operations'
        },
        {
          name: 'System',
          description: 'System operations and metadata'
        }
      ]
    }
  });

  // Register Swagger UI
  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    },
    staticCSP: true,
    transformSpecificationClone: true
  });

  // Authentication plugin (simple bearer token stub)
  if (process.env.ENABLE_AUTH === 'true') {
    fastify.addHook('preHandler', async (request, reply) => {
      // Skip auth for health, metadata, and docs endpoints
      const publicPaths = ['/health', '/metadata', '/docs'];
      if (publicPaths.some(path => request.url.startsWith(path))) {
        return;
      }

      const authorization = request.headers.authorization;
      if (!authorization || !authorization.startsWith('Bearer ')) {
        reply.code(401).send({
          resourceType: 'OperationOutcome',
          issue: [{
            severity: 'error',
            code: 'login',
            details: {
              text: 'Authorization required'
            }
          }]
        });
        return;
      }

      // Simple token validation (stub)
      const token = authorization.substring(7);
      if (!token || token === 'invalid') {
        reply.code(401).send({
          resourceType: 'OperationOutcome',
          issue: [{
            severity: 'error',
            code: 'login',
            details: {
              text: 'Invalid token'
            }
          }]
        });
        return;
      }
    });
  }

  // Register routes
  await fastify.register(scheduleRoutes);
  await fastify.register(slotRoutes);
  await fastify.register(appointmentRoutes);
  await fastify.register(specialRoutes);

  // Root endpoint
  fastify.get('/', async (request, reply) => {
    return {
      message: 'FHIRTogether Scheduling Synapse',
      version: '1.0.0',
      fhirVersion: 'R4',
      documentation: '/docs',
      metadata: '/metadata',
      health: '/health'
    };
  });

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    
    const outcome = {
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'processing',
        details: {
          text: error.message
        }
      }]
    };

    reply.code(500).send(outcome);
  });

  // Not found handler
  fastify.setNotFoundHandler((request, reply) => {
    const outcome = {
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'not-found',
        details: {
          text: `Resource not found: ${request.url}`
        }
      }]
    };

    reply.code(404).send(outcome);
  });

  return fastify;
}

export default buildApp;