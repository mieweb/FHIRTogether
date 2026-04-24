import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import { SqliteStore, SCHEMA_VERSION } from './store/sqliteStore';
import { slotRoutes } from './routes/slotRoutes';
import { scheduleRoutes } from './routes/scheduleRoutes';
import { appointmentRoutes } from './routes/appointmentRoutes';
import { importRoutes } from './routes/importRoutes';
import { hl7Routes } from './routes/hl7Routes';
import { createMLLPServer, MLLPServer } from './hl7/socket';
import { registerBasicAuth } from './auth/basicAuth';

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
const AUTH_ENABLED = !!(process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD);
const HL7_MLLP_ALLOWED_IPS = process.env.HL7_MLLP_ALLOWED_IPS
  ? process.env.HL7_MLLP_ALLOWED_IPS.split(',').map(ip => ip.trim()).filter(Boolean)
  : [];
const HL7_MESSAGE_LOG_RETENTION_DAYS = parseInt(process.env.HL7_MESSAGE_LOG_RETENTION_DAYS || '7', 10);

/** Recursively find the newest mtime in a directory tree. */
function getNewestMtime(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, getNewestMtime(full));
    } else {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }
  return newest;
}

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

  // Register global Basic Auth (skips /health, /docs/*, /demo, /scheduler/*)
  const authActive = registerBasicAuth(fastify);
  if (!authActive) {
    fastify.log.warn('No AUTH_USERNAME/AUTH_PASSWORD set - all API endpoints are OPEN');
  }

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
          url: '/',
          description: 'Current server',
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

  // Serve customizable public assets (welcome page, etc.)
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/public/',
    decorateReply: true,
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
  const startupWarnings: string[] = [];

  if (STORE_BACKEND === 'sqlite') {
    store = new SqliteStore();
    const schemaStatus = await store.initialize();

    if (!schemaStatus.match) {
      startupWarnings.push(
        `⚠️  DB schema mismatch: database is v${schemaStatus.current}, code expects v${SCHEMA_VERSION}`,
        `   Auto-migrated to v${SCHEMA_VERSION} — verify data with: npm run generate-data`,
        `   Or reset the database:  rm data/fhirtogether.db && npm run generate-data`,
      );
    } else if (schemaStatus.migrated && schemaStatus.current === 0) {
      fastify.log.info('Fresh database — schema created at v' + SCHEMA_VERSION);
    }

    fastify.log.info('SQLite store initialized (schema v' + SCHEMA_VERSION + ')');
  } else {
    throw new Error(`Unsupported store backend: ${STORE_BACKEND}`);
  }

  // Check if the scheduler widget build is stale
  const schedulerDistPath = path.join(__dirname, '..', 'packages', 'fhir-scheduler', 'dist', 'standalone.js');
  const schedulerSrcDir = path.join(__dirname, '..', 'packages', 'fhir-scheduler', 'src');
  try {
    if (!fs.existsSync(schedulerDistPath)) {
      startupWarnings.push(
        '⚠️  Scheduler widget not built — /demo will not work',
        '   Run:  cd packages/fhir-scheduler && npm run build:standalone',
      );
    } else {
      const distMtime = fs.statSync(schedulerDistPath).mtimeMs;
      const newestSrc = getNewestMtime(schedulerSrcDir);
      if (newestSrc > distMtime) {
        startupWarnings.push(
          '⚠️  Scheduler widget build is stale (source files are newer than dist)',
          '   Run:  cd packages/fhir-scheduler && npm run build:standalone',
        );
      }
    }
  } catch {
    // Non-fatal — skip build check if paths don't exist
  }

  // Register routes
  await fastify.register(async (instance) => {
    await scheduleRoutes(instance, store);
    await slotRoutes(instance, store);
    await appointmentRoutes(instance, store);
    await importRoutes(instance, store);
  });

  // Register HL7 routes
  await fastify.register(async (instance) => {
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

  // Root endpoint — serve customizable welcome page (HTML) or JSON metadata
  fastify.get('/', async (request, reply) => {
    const accept = (request.headers.accept || '').toLowerCase();

    // Serve JSON for API clients that explicitly request it
    if (accept.includes('application/json') && !accept.includes('text/html')) {
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
          import: '/Import',
          importTemplate: '/Import/template',
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
    }

    // Serve the welcome page HTML from public/index.html
    return reply.sendFile('index.html', path.join(__dirname, '..', 'public'));
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

  return { fastify, store, startupWarnings };
}

async function start() {
  try {
    const { fastify, store, startupWarnings } = await buildServer();
    await fastify.listen({ port: PORT, host: HOST });

    // ── HL7 message log cleanup (runs once at startup + every 24 h) ──
    const runHL7LogCleanup = async () => {
      try {
        const deleted = await store.cleanupHL7MessageLog(HL7_MESSAGE_LOG_RETENTION_DAYS);
        if (deleted > 0) {
          fastify.log.info({ deleted, retentionDays: HL7_MESSAGE_LOG_RETENTION_DAYS }, 'HL7 message log cleanup complete');
        }
      } catch (err) {
        fastify.log.error({ err }, 'HL7 message log cleanup failed');
      }
    };
    await runHL7LogCleanup();
    const hl7LogCleanupInterval = setInterval(runHL7LogCleanup, 24 * 60 * 60 * 1000);
    hl7LogCleanupInterval.unref(); // don't keep the process alive just for this
    
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
        allowedIPs: HL7_MLLP_ALLOWED_IPS.length > 0 ? HL7_MLLP_ALLOWED_IPS : undefined,
      });
      
      mllpServer.on('listening', (info) => {
        console.log(`📨 HL7 MLLP Socket: ${info.tls ? 'tls' : 'tcp'}://${info.host}:${info.port}`);
      });
      
      mllpServer.on('error', (err) => {
        console.error('MLLP Server error:', err);
      });

      mllpServer.on('rejected', (info) => {
        fastify.log.warn(info, 'MLLP connection rejected');
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
    console.log(`🔐 API Auth: ${AUTH_ENABLED ? 'Basic Auth enabled' : '⚠️  OPEN (set AUTH_USERNAME & AUTH_PASSWORD)'}`);
    if (HL7_SOCKET_ENABLED) {
      console.log(`📨 HL7 Socket: ${HL7_TLS_ENABLED ? 'tls' : 'tcp'}://${HOST}:${HL7_SOCKET_PORT}`);
      console.log(`🔐 HL7 Socket IPs: ${HL7_MLLP_ALLOWED_IPS.length > 0 ? HL7_MLLP_ALLOWED_IPS.join(', ') : '⚠️  ALL (set HL7_MLLP_ALLOWED_IPS)'}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Print any startup warnings
    if (startupWarnings.length > 0) {
      console.log('┌──────────────────────────────────────────┐');
      console.log('│          STARTUP WARNINGS                │');
      console.log('├──────────────────────────────────────────┤');
      for (const w of startupWarnings) {
        console.log(`│ ${w}`);
      }
      console.log('└──────────────────────────────────────────┘\n');
    }
    
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
