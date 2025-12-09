import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from 'dotenv';
import { SqliteStore } from './store/sqliteStore';
import { slotRoutes } from './routes/slotRoutes';
import { scheduleRoutes } from './routes/scheduleRoutes';
import { appointmentRoutes } from './routes/appointmentRoutes';

// Load environment variables
config();

const PORT = parseInt(process.env.PORT || '4010', 10);
const HOST = process.env.HOST || '0.0.0.0';
const STORE_BACKEND = process.env.STORE_BACKEND || 'sqlite';

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
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
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
      fhirVersion: 'R4',
      endpoints: {
        schedule: '/Schedule',
        slot: '/Slot',
        appointment: '/Appointment',
        health: '/health',
      },
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

  return fastify;
}

async function start() {
  try {
    const fastify = await buildServer();
    await fastify.listen({ port: PORT, host: HOST });
    
    console.log('\n🚀 FHIRTogether Scheduling Synapse');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 Server running at: http://${HOST}:${PORT}`);
    console.log(`📚 API Documentation: http://localhost:${PORT}/docs`);
    console.log(`💾 Store Backend: ${STORE_BACKEND}`);
    console.log(`🧪 Test Endpoints: ${process.env.ENABLE_TEST_ENDPOINTS === 'true' ? 'Enabled' : 'Disabled'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
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
