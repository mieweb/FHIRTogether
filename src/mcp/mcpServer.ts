import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FhirStore } from '../types/fhir';
import { registerScheduleTools } from './tools/scheduleTools';
import { registerSlotTools } from './tools/slotTools';
import { registerAppointmentTools } from './tools/appointmentTools';

/**
 * MCP Server for FHIRTogether
 * Exposes FHIR scheduling operations as MCP tools for LLM agents
 */
export class FhirTogetherMcpServer {
  private mcpServer: McpServer;
  private store: FhirStore;
  private transports: Map<string, SSEServerTransport> = new Map();

  constructor(store: FhirStore) {
    this.store = store;
    this.mcpServer = new McpServer({
      name: 'fhirtogether',
      version: '1.0.0',
    });

    this.registerTools();
  }

  /**
   * Register all MCP tools with the server
   */
  private registerTools(): void {
    registerScheduleTools(this.mcpServer, this.store);
    registerSlotTools(this.mcpServer, this.store);
    registerAppointmentTools(this.mcpServer, this.store);
  }

  /**
   * Register SSE routes with Fastify for MCP communication
   */
  registerRoutes(fastify: FastifyInstance): void {
    // SSE endpoint for establishing MCP connection
    fastify.get('/mcp/sse', async (request: FastifyRequest, reply: FastifyReply) => {
      // Tell Fastify we're handling the response ourselves
      reply.hijack();

      // Create SSE transport for this session — it handles headers internally
      const transport = new SSEServerTransport('/mcp/messages', reply.raw);
      this.transports.set(transport.sessionId, transport);

      // Clean up on disconnect
      request.raw.on('close', () => {
        this.transports.delete(transport.sessionId);
      });

      // Connect the MCP server to this transport
      await this.mcpServer.connect(transport);
    });

    // Messages endpoint for receiving client messages
    fastify.post('/mcp/messages', async (request: FastifyRequest<{ Querystring: { sessionId?: string } }>, reply: FastifyReply) => {
      // Parse sessionId from URL for robustness
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId ? this.transports.get(sessionId) : undefined;

      if (!transport) {
        reply.status(400).send({ error: 'No active MCP session for this sessionId' });
        return;
      }

      // Tell Fastify we're handling the response ourselves
      reply.hijack();

      // Pass the already-parsed body from Fastify to handlePostMessage,
      // since Fastify's body parser has already consumed the raw request stream.
      await transport.handlePostMessage(request.raw, reply.raw, request.body as string);
    });

    // Health check endpoint
    fastify.get('/mcp/health', async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.send({
        status: 'ok',
        server: 'fhirtogether-mcp',
        version: '1.0.0',
        activeSessions: this.transports.size,
      });
    });
  }

  /**
   * Get the number of active sessions
   */
  getActiveSessionCount(): number {
    return this.transports.size;
  }
}

/**
 * Create and return an MCP server instance
 */
export function createMcpServer(store: FhirStore): FhirTogetherMcpServer {
  return new FhirTogetherMcpServer(store);
}
