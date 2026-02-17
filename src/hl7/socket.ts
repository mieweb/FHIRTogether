/**
 * HL7 MLLP Socket Server
 * 
 * TCP/TLS socket server for receiving HL7v2 messages over MLLP protocol.
 * Supports both plain TCP and TLS-secured connections.
 */

import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import {
  MLLP_START_BLOCK,
  MLLP_END_BLOCK,
  MLLP_CARRIAGE_RETURN,
} from './types';
import {
  parseSIUMessage,
  parseRawMessage,
  buildACKMessage,
  createACKResponse,
  wrapMLLP,
  unwrapMLLP,
} from './parser';
import { siuToFhirResources } from './converter';
import { FhirStore } from '../types/fhir';

/**
 * Configuration for the MLLP server
 */
export interface MLLPServerConfig {
  port: number;
  host?: string;
  tls?: {
    enabled: boolean;
    key?: string;      // Path to private key file
    cert?: string;     // Path to certificate file
    ca?: string;       // Path to CA certificate file
    rejectUnauthorized?: boolean;
  };
  timeout?: number;    // Connection timeout in milliseconds
  allowedIPs?: string[];  // IP allowlist; if empty, all IPs are allowed
}

/**
 * Default configuration
 */
export const DEFAULT_MLLP_CONFIG: MLLPServerConfig = {
  port: 2575,
  host: '0.0.0.0',
  timeout: 30000, // 30 seconds
};

/**
 * MLLP Message received event data
 */
export interface MLLPMessageEvent {
  raw: string;
  parsed: ReturnType<typeof parseRawMessage>;
  socket: net.Socket;
  remoteAddress: string;
}

/**
 * MLLP Socket Server class
 */
export class MLLPServer extends EventEmitter {
  private server: net.Server | tls.Server | null = null;
  private config: MLLPServerConfig;
  private store: FhirStore | null = null;
  private connections: Set<net.Socket> = new Set();
  private isRunning = false;

  constructor(config: Partial<MLLPServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MLLP_CONFIG, ...config };
  }

  /**
   * Set the FHIR store for processing messages
   */
  setStore(store: FhirStore): void {
    this.store = store;
  }

  /**
   * Start the MLLP server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('MLLP server is already running');
    }

    return new Promise((resolve, reject) => {
      const connectionHandler = (socket: net.Socket) => {
        this.handleConnection(socket);
      };

      try {
        if (this.config.tls?.enabled) {
          // TLS server
          const tlsOptions: tls.TlsOptions = {
            rejectUnauthorized: this.config.tls.rejectUnauthorized ?? true,
          };

          if (this.config.tls.key) {
            tlsOptions.key = fs.readFileSync(this.config.tls.key);
          }
          if (this.config.tls.cert) {
            tlsOptions.cert = fs.readFileSync(this.config.tls.cert);
          }
          if (this.config.tls.ca) {
            tlsOptions.ca = fs.readFileSync(this.config.tls.ca);
          }

          this.server = tls.createServer(tlsOptions, connectionHandler);
        } else {
          // Plain TCP server
          this.server = net.createServer(connectionHandler);
        }

        this.server.on('error', (err) => {
          this.emit('error', err);
          if (!this.isRunning) {
            reject(err);
          }
        });

        this.server.listen(this.config.port, this.config.host, () => {
          this.isRunning = true;
          this.emit('listening', {
            port: this.config.port,
            host: this.config.host,
            tls: this.config.tls?.enabled || false,
          });
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the MLLP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      // Close all active connections
      this.connections.forEach((socket) => {
        socket.destroy();
      });
      this.connections.clear();

      this.server!.close(() => {
        this.isRunning = false;
        this.server = null;
        this.emit('closed');
        resolve();
      });
    });
  }

  /**
   * Handle incoming connection
   */
  private handleConnection(socket: net.Socket): void {
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    const remoteIP = socket.remoteAddress || '';

    // Enforce IP allowlist if configured
    if (this.config.allowedIPs && this.config.allowedIPs.length > 0) {
      // Normalize IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
      const normalizedIP = remoteIP.replace(/^::ffff:/, '');
      if (!this.config.allowedIPs.includes(normalizedIP)) {
        this.emit('rejected', { remoteAddress, reason: 'IP not in allowlist' });
        socket.destroy();
        return;
      }
    }

    this.connections.add(socket);
    
    this.emit('connection', { remoteAddress });

    let buffer = '';

    // Set timeout
    if (this.config.timeout) {
      socket.setTimeout(this.config.timeout);
    }

    socket.on('data', async (data) => {
      buffer += data.toString();
      
      // Look for complete MLLP message
      const startIdx = buffer.indexOf(MLLP_START_BLOCK);
      const endIdx = buffer.indexOf(MLLP_END_BLOCK + MLLP_CARRIAGE_RETURN);
      
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        // Extract complete message
        const mllpMessage = buffer.substring(startIdx, endIdx + 2);
        buffer = buffer.substring(endIdx + 2);
        
        // Process the message
        const response = await this.processMessage(mllpMessage, socket, remoteAddress);
        
        // Send response wrapped in MLLP
        socket.write(wrapMLLP(response));
      }
    });

    socket.on('timeout', () => {
      this.emit('timeout', { remoteAddress });
      socket.end();
    });

    socket.on('error', (err) => {
      this.emit('socketError', { remoteAddress, error: err });
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      this.emit('disconnection', { remoteAddress });
    });
  }

  /**
   * Process an incoming HL7 message
   */
  private async processMessage(
    mllpMessage: string,
    socket: net.Socket,
    remoteAddress: string
  ): Promise<string> {
    try {
      // Unwrap MLLP framing
      const rawMessage = unwrapMLLP(mllpMessage);
      
      // Parse the message
      const parsed = parseRawMessage(rawMessage);
      
      // Emit message event
      this.emit('message', {
        raw: rawMessage,
        parsed,
        socket,
        remoteAddress,
      } as MLLPMessageEvent);

      // Check if we have a store to process messages
      if (!this.store) {
        // No store - just acknowledge receipt
        const ack = createACKResponse(
          {
            segmentType: 'MSH',
            encodingCharacters: '^~\\&',
            sendingApplication: parsed.messageType || 'UNKNOWN',
            sendingFacility: 'UNKNOWN',
            receivingApplication: 'FHIRTOGETHER',
            receivingFacility: 'SCHEDULING_GATEWAY',
            dateTimeOfMessage: '',
            messageType: { 
              messageCode: parsed.messageType || 'UNK', 
              triggerEvent: parsed.triggerEvent || '' 
            },
            messageControlId: parsed.controlId || 'UNKNOWN',
            processingId: 'P',
            versionId: '2.3',
          },
          'AA',
          'Message received (no store configured)'
        );
        return buildACKMessage(ack);
      }

      // Process based on message type
      if (parsed.messageType === 'SIU') {
        return await this.processSIUMessage(rawMessage);
      }

      // Unsupported message type
      const ack = createACKResponse(
        {
          segmentType: 'MSH',
          encodingCharacters: '^~\\&',
          sendingApplication: 'UNKNOWN',
          sendingFacility: 'UNKNOWN',
          receivingApplication: 'FHIRTOGETHER',
          receivingFacility: 'SCHEDULING_GATEWAY',
          dateTimeOfMessage: '',
          messageType: { 
            messageCode: parsed.messageType || 'UNK', 
            triggerEvent: parsed.triggerEvent || '' 
          },
          messageControlId: parsed.controlId || 'UNKNOWN',
          processingId: 'P',
          versionId: '2.3',
        },
        'AE',
        `Unsupported message type: ${parsed.messageType}`,
        { code: '200', text: 'Unsupported message type', severity: 'E' }
      );
      return buildACKMessage(ack);

    } catch (error) {
      this.emit('processingError', { error, remoteAddress });
      
      const ack = createACKResponse(
        {
          segmentType: 'MSH',
          encodingCharacters: '^~\\&',
          sendingApplication: 'UNKNOWN',
          sendingFacility: 'UNKNOWN',
          receivingApplication: 'FHIRTOGETHER',
          receivingFacility: 'SCHEDULING_GATEWAY',
          dateTimeOfMessage: '',
          messageType: { messageCode: 'UNK', triggerEvent: '' },
          messageControlId: 'UNKNOWN',
          processingId: 'P',
          versionId: '2.3',
        },
        'AR',
        `Error processing message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { code: '100', text: 'Segment sequence error', severity: 'E' }
      );
      return buildACKMessage(ack);
    }
  }

  /**
   * Process SIU message and update store
   */
  private async processSIUMessage(rawMessage: string): Promise<string> {
    const siuMessage = parseSIUMessage(rawMessage);
    const fhirResult = siuToFhirResources(siuMessage);

    try {
      // Ensure schedule exists
      const practitionerId = fhirResult.schedule.id?.replace('schedule-', '');
      const existingSchedules = await this.store!.getSchedules({
        actor: `Practitioner/${practitionerId}`,
      });

      let scheduleId: string;
      if (existingSchedules.length === 0) {
        const createdSchedule = await this.store!.createSchedule(fhirResult.schedule);
        scheduleId = createdSchedule.id!;
      } else {
        scheduleId = existingSchedules[0].id!;
      }

      // Handle appointment based on action
      const placerApptId = siuMessage.sch.placerAppointmentId?.idNumber;

      if (fhirResult.action === 'create') {
        await this.store!.createAppointment(fhirResult.appointment);
        
        if (fhirResult.slot) {
          fhirResult.slot.schedule.reference = `Schedule/${scheduleId}`;
          await this.store!.createSlot(fhirResult.slot);
        }
      } else {
        // Try to find existing appointment
        let existingAppointment = null;
        if (placerApptId) {
          const appointments = await this.store!.getAppointments({});
          existingAppointment = appointments.find(apt =>
            apt.identifier?.some(id => id.value === placerApptId)
          );
        }

        if (existingAppointment) {
          await this.store!.updateAppointment(existingAppointment.id!, fhirResult.appointment);
        } else {
          await this.store!.createAppointment(fhirResult.appointment);
        }
      }

      // Success ACK
      const ack = createACKResponse(siuMessage.msh, 'AA', 'Message processed successfully');
      
      this.emit('processed', {
        messageType: siuMessage.msh.messageType,
        controlId: siuMessage.msh.messageControlId,
        action: fhirResult.action,
      });
      
      return buildACKMessage(ack);

    } catch (storeError) {
      const ack = createACKResponse(
        siuMessage.msh,
        'AE',
        `Error processing message: ${storeError instanceof Error ? storeError.message : 'Unknown error'}`,
        { code: '207', text: 'Application internal error', severity: 'E' }
      );
      return buildACKMessage(ack);
    }
  }

  /**
   * Get server status
   */
  getStatus(): {
    running: boolean;
    port: number;
    host: string;
    tls: boolean;
    connections: number;
  } {
    return {
      running: this.isRunning,
      port: this.config.port,
      host: this.config.host || '0.0.0.0',
      tls: this.config.tls?.enabled || false,
      connections: this.connections.size,
    };
  }
}

/**
 * Create and configure an MLLP server instance
 */
export function createMLLPServer(
  store: FhirStore,
  config: Partial<MLLPServerConfig> = {}
): MLLPServer {
  const server = new MLLPServer(config);
  server.setStore(store);
  return server;
}
