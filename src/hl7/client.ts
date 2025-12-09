/**
 * HL7 Client
 * 
 * Client for sending HL7v2 messages over HTTPS and TCP/TLS sockets.
 * Used for testing and integration with the FHIRTogether gateway.
 */

import * as net from 'net';
import * as tls from 'tls';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import {
  MLLP_START_BLOCK,
  MLLP_END_BLOCK,
  MLLP_CARRIAGE_RETURN,
  ACKMessage,
} from './types';
import {
  wrapMLLP,
  unwrapMLLP,
  parseACKMessage,
} from './parser';

/**
 * Configuration for HTTPS client
 */
export interface HTTPSClientConfig {
  baseUrl: string;
  timeout?: number;
  rejectUnauthorized?: boolean;
}

/**
 * Configuration for socket client
 */
export interface SocketClientConfig {
  host: string;
  port: number;
  tls?: {
    enabled: boolean;
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
  timeout?: number;
}

/**
 * Result of sending an HL7 message
 */
export interface SendResult {
  success: boolean;
  ackCode?: string;
  ackMessage?: string;
  raw?: string;
  parsed?: ACKMessage;
  error?: string;
}

/**
 * Send HL7 message over HTTPS
 */
export async function sendHL7OverHTTPS(
  message: string,
  config: HTTPSClientConfig
): Promise<SendResult> {
  return new Promise((resolve) => {
    try {
      const url = new URL('/hl7/siu', config.baseUrl);
      const isHttps = url.protocol === 'https:';
      
      const requestModule = isHttps ? https : http;
      
      const requestOptions: https.RequestOptions = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: config.timeout || 30000,
        rejectUnauthorized: config.rejectUnauthorized ?? true,
      };

      const req = requestModule.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            
            if (response.ack) {
              let ackMessage: ACKMessage | undefined;
              
              try {
                ackMessage = parseACKMessage(response.ack);
              } catch {
                // Ignore parse errors for ACK
              }
              
              resolve({
                success: response.status === 'success' || res.statusCode === 200,
                ackCode: ackMessage?.msa.acknowledgmentCode,
                ackMessage: ackMessage?.msa.textMessage,
                raw: response.ack,
                parsed: ackMessage,
              });
            } else {
              resolve({
                success: false,
                error: response.error || 'Unknown error',
                raw: data,
              });
            }
          } catch {
            resolve({
              success: false,
              error: `Invalid response: ${data}`,
              raw: data,
            });
          }
        });
      });

      req.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request timeout',
        });
      });

      // Send the message as JSON
      const body = JSON.stringify({ message });
      req.write(body);
      req.end();
      
    } catch (error) {
      resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}

/**
 * Send HL7 message over TCP/TLS socket with MLLP framing
 */
export async function sendHL7OverSocket(
  message: string,
  config: SocketClientConfig
): Promise<SendResult> {
  return new Promise((resolve) => {
    let socket: net.Socket | tls.TLSSocket;
    let responseBuffer = '';
    let resolved = false;

    const cleanup = () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    const resolveOnce = (result: SendResult) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(result);
      }
    };

    try {
      if (config.tls?.enabled) {
        const tlsOptions: tls.ConnectionOptions = {
          host: config.host,
          port: config.port,
          rejectUnauthorized: config.tls.rejectUnauthorized ?? true,
        };
        socket = tls.connect(tlsOptions);
      } else {
        socket = net.createConnection({
          host: config.host,
          port: config.port,
        });
      }

      if (config.timeout) {
        socket.setTimeout(config.timeout);
      }

      socket.on('connect', () => {
        // Send MLLP-wrapped message
        const mllpMessage = wrapMLLP(message);
        socket.write(mllpMessage);
      });

      socket.on('data', (data) => {
        responseBuffer += data.toString();
        
        // Look for complete MLLP message
        const startIdx = responseBuffer.indexOf(MLLP_START_BLOCK);
        const endIdx = responseBuffer.indexOf(MLLP_END_BLOCK + MLLP_CARRIAGE_RETURN);
        
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          const mllpResponse = responseBuffer.substring(startIdx, endIdx + 2);
          const rawAck = unwrapMLLP(mllpResponse);
          
          try {
            const ackMessage = parseACKMessage(rawAck);
            resolveOnce({
              success: ackMessage.msa.acknowledgmentCode === 'AA',
              ackCode: ackMessage.msa.acknowledgmentCode,
              ackMessage: ackMessage.msa.textMessage,
              raw: rawAck,
              parsed: ackMessage,
            });
          } catch (parseError) {
            resolveOnce({
              success: false,
              error: `Failed to parse ACK: ${parseError instanceof Error ? parseError.message : 'Unknown'}`,
              raw: rawAck,
            });
          }
        }
      });

      socket.on('timeout', () => {
        resolveOnce({
          success: false,
          error: 'Socket timeout',
        });
      });

      socket.on('error', (error) => {
        resolveOnce({
          success: false,
          error: error.message,
        });
      });

      socket.on('close', () => {
        if (!resolved) {
          resolveOnce({
            success: false,
            error: 'Connection closed without response',
          });
        }
      });

    } catch (error) {
      resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}

/**
 * HL7 Client class for managing connections and sending messages
 */
export class HL7Client {
  private httpsConfig?: HTTPSClientConfig;
  private socketConfig?: SocketClientConfig;

  constructor(options?: {
    https?: HTTPSClientConfig;
    socket?: SocketClientConfig;
  }) {
    this.httpsConfig = options?.https;
    this.socketConfig = options?.socket;
  }

  /**
   * Configure HTTPS endpoint
   */
  configureHTTPS(config: HTTPSClientConfig): void {
    this.httpsConfig = config;
  }

  /**
   * Configure socket endpoint
   */
  configureSocket(config: SocketClientConfig): void {
    this.socketConfig = config;
  }

  /**
   * Send message over HTTPS
   */
  async sendViaHTTPS(message: string): Promise<SendResult> {
    if (!this.httpsConfig) {
      return {
        success: false,
        error: 'HTTPS not configured',
      };
    }
    return sendHL7OverHTTPS(message, this.httpsConfig);
  }

  /**
   * Send message over socket
   */
  async sendViaSocket(message: string): Promise<SendResult> {
    if (!this.socketConfig) {
      return {
        success: false,
        error: 'Socket not configured',
      };
    }
    return sendHL7OverSocket(message, this.socketConfig);
  }

  /**
   * Send message over both transports and compare results
   */
  async sendViaBoth(message: string): Promise<{
    https?: SendResult;
    socket?: SendResult;
  }> {
    const results: { https?: SendResult; socket?: SendResult } = {};
    
    if (this.httpsConfig) {
      results.https = await this.sendViaHTTPS(message);
    }
    
    if (this.socketConfig) {
      results.socket = await this.sendViaSocket(message);
    }
    
    return results;
  }
}

/**
 * Create a default client configured for local development
 */
export function createDefaultClient(): HL7Client {
  return new HL7Client({
    https: {
      baseUrl: 'http://localhost:4010',
      timeout: 30000,
    },
    socket: {
      host: 'localhost',
      port: 2575,
      timeout: 30000,
    },
  });
}
