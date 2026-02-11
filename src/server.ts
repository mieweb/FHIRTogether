import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { config } from 'dotenv';
import path from 'path';
import { SqliteStore } from './store/sqliteStore';
import { slotRoutes } from './routes/slotRoutes';
import { scheduleRoutes } from './routes/scheduleRoutes';
import { appointmentRoutes } from './routes/appointmentRoutes';
import { hl7Routes } from './routes/hl7Routes';
import { createMLLPServer, MLLPServer } from './hl7/socket';

// Load environment variables
config();

const PORT = parseInt(process.env.PORT || '4010', 10);
const HOST = process.env.HOST || '0.0.0.0';
const STORE_BACKEND = process.env.STORE_BACKEND || 'sqlite';
const HL7_SOCKET_PORT = parseInt(process.env.HL7_SOCKET_PORT || '2575', 10);
const HL7_SOCKET_ENABLED = process.env.HL7_SOCKET_ENABLED !== 'false';
const HL7_TLS_ENABLED = process.env.HL7_TLS_ENABLED === 'true';
const HL7_TLS_KEY = process.env.HL7_TLS_KEY;
const HL7_TLS_CERT = process.env.HL7_TLS_CERT;
const HL7_TLS_CA = process.env.HL7_TLS_CA;

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
  });

  // Add content type parser for text/plain (for raw HL7 messages)
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Also handle x-application/hl7-v2+er7 (standard HL7 MIME type)
  fastify.addContentTypeParser('x-application/hl7-v2+er7', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Register Swagger
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'FHIRTogether Scheduling Synapse API',
        description: 'FHIR-compliant gateway and test server for schedule and appointment availability',
        version: '1.0.0',
        contact: {
          name: 'MieWeb',
          url: 'https://github.com/mieweb/FHIRTogether',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
      },
      servers: [
        {
          url: `http://localhost:${PORT}`,
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'Schedule', description: 'Provider schedule management' },
        { name: 'Slot', description: 'Time slot availability' },
        { name: 'Appointment', description: 'Appointment booking and management' },
        { name: 'HL7', description: 'HL7v2 message ingestion' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: false,
  });

  // Register static file serving for the scheduler demo
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'packages', 'fhir-scheduler'),
    prefix: '/scheduler/',
    decorateReply: false,
  });

  // Redirect /demo to the scheduler demo page
  fastify.get('/demo', async (_request, reply) => {
    return reply.redirect('/scheduler/index.html');
  });

  // Initialize store
  let store;
  if (STORE_BACKEND === 'sqlite') {
    store = new SqliteStore();
    await store.initialize();
    fastify.log.info('SQLite store initialized');
  } else {
    throw new Error(`Unsupported store backend: ${STORE_BACKEND}`);
  }

  // Register routes
  await fastify.register(async (instance) => {
    await scheduleRoutes(instance, store);
    await slotRoutes(instance, store);
    await appointmentRoutes(instance, store);
    await hl7Routes(instance, store);
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      store: STORE_BACKEND,
    };
  });

  // Root endpoint
  fastify.get('/', async () => {
    return {
      name: 'FHIRTogether Scheduling Synapse',
      version: '1.0.0',
      description: 'FHIR-compliant gateway and test server for schedule and appointment availability',
      documentation: '/docs',
      demo: '/demo',
      fhirVersion: 'R4',
      endpoints: {
        schedule: '/Schedule',
        slot: '/Slot',
        appointment: '/Appointment',
        hl7: '/hl7/siu',
        hl7Status: '/hl7/status',
        health: '/health',
        demo: '/demo',
      },
      hl7Socket: HL7_SOCKET_ENABLED ? {
        port: HL7_SOCKET_PORT,
        tls: HL7_TLS_ENABLED,
      } : null,
    };
  });

  // Graceful shutdown
  const closeGracefully = async (signal: string) => {
    fastify.log.info(`Received signal ${signal}, closing gracefully...`);
    await store.close();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', () => closeGracefully('SIGINT'));
  process.on('SIGTERM', () => closeGracefully('SIGTERM'));

  return { fastify, store };
}

async function start() {
  try {
    const { fastify, store } = await buildServer();
    await fastify.listen({ port: PORT, host: HOST });
    
    // Start MLLP socket server if enabled
    let mllpServer: MLLPServer | null = null;
    if (HL7_SOCKET_ENABLED) {
      mllpServer = createMLLPServer(store, {
        port: HL7_SOCKET_PORT,
        host: HOST,
        tls: HL7_TLS_ENABLED ? {
          enabled: true,
          key: HL7_TLS_KEY,
          cert: HL7_TLS_CERT,
          ca: HL7_TLS_CA,
        } : undefined,
      });
      
      mllpServer.on('listening', (info) => {
        console.log(`📨 HL7 MLLP Socket: ${info.tls ? 'tls' : 'tcp'}://${info.host}:${info.port}`);
      });
      
      mllpServer.on('error', (err) => {
        console.error('MLLP Server error:', err);
      });
      
      mllpServer.on('message', (event) => {
        fastify.log.info({ messageType: event.parsed.messageType, controlId: event.parsed.controlId }, 'HL7 message received via socket');
      });
      
      mllpServer.on('processed', (info) => {
        fastify.log.info(info, 'HL7 message processed');
      });
      
      await mllpServer.start();
    }
    
    console.log('\n🚀 FHIRTogether Scheduling Synapse');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 Server running at: http://${HOST}:${PORT}`);
    console.log(`📚 API Documentation: http://localhost:${PORT}/docs`);
    console.log(`🗓️ Scheduler Demo: http://localhost:${PORT}/demo`);
    console.log(`💾 Store Backend: ${STORE_BACKEND}`);
    console.log(`🧪 Test Endpoints: ${process.env.ENABLE_TEST_ENDPOINTS === 'true' ? 'Enabled' : 'Disabled'}`);
    if (HL7_SOCKET_ENABLED) {
      console.log(`📨 HL7 Socket: ${HL7_TLS_ENABLED ? 'tls' : 'tcp'}://${HOST}:${HL7_SOCKET_PORT}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Update graceful shutdown to include MLLP server
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    
    const closeAll = async (signal: string) => {
      fastify.log.info(`Received signal ${signal}, closing gracefully...`);
      if (mllpServer) {
        await mllpServer.stop();
      }
      await store.close();
      await fastify.close();
      process.exit(0);
    };
    
    process.on('SIGINT', () => closeAll('SIGINT'));
    process.on('SIGTERM', () => closeAll('SIGTERM'));
    
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

// Start server if run directly
if (require.main === module) {
  start();
}

export { buildServer, start };
