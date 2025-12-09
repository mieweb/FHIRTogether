#!/usr/bin/env npx tsx
/**
 * HL7 SIU Message Test Script
 * 
 * Generates sample SIU messages from a simulated legacy EHR and sends them
 * to FHIRTogether via both HTTPS and MLLP socket, verifying ACK responses.
 * 
 * Usage:
 *   npm run hl7-test                    # Run with default settings
 *   npm run hl7-test -- --count 20      # Generate 20 messages
 *   npm run hl7-test -- --https-only    # Test HTTPS only
 *   npm run hl7-test -- --socket-only   # Test socket only
 *   npm run hl7-test -- --verbose       # Show message details
 */

import {
  SIUMessageGenerator,
  DEFAULT_EHR_CONFIG,
  SAMPLE_PROVIDERS,
  SAMPLE_PATIENTS,
} from '../hl7/generator';
import {
  sendHL7OverHTTPS,
  sendHL7OverSocket,
  SendResult,
} from '../hl7/client';
import { SIUEventType } from '../hl7/types';

// Parse command line arguments
const args = process.argv.slice(2);
const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '10', 10);
const httpsOnly = args.includes('--https-only');
const socketOnly = args.includes('--socket-only');
const verbose = args.includes('--verbose');
const httpPort = parseInt(args.find(a => a.startsWith('--http-port='))?.split('=')[1] || '4010', 10);
const socketPort = parseInt(args.find(a => a.startsWith('--socket-port='))?.split('=')[1] || '2575', 10);
const host = args.find(a => a.startsWith('--host='))?.split('=')[1] || 'localhost';

// Configuration
const config = {
  https: {
    baseUrl: `http://${host}:${httpPort}`,
    timeout: 30000,
  },
  socket: {
    host,
    port: socketPort,
    timeout: 30000,
  },
};

// Stats
interface TestStats {
  total: number;
  httpsSuccess: number;
  httpsFailed: number;
  socketSuccess: number;
  socketFailed: number;
  byEventType: Record<SIUEventType, { total: number; success: number }>;
}

const stats: TestStats = {
  total: 0,
  httpsSuccess: 0,
  httpsFailed: 0,
  socketSuccess: 0,
  socketFailed: 0,
  byEventType: {
    S12: { total: 0, success: 0 },
    S13: { total: 0, success: 0 },
    S14: { total: 0, success: 0 },
    S15: { total: 0, success: 0 },
    S17: { total: 0, success: 0 },
    S26: { total: 0, success: 0 },
  },
};

function printResult(transport: string, result: SendResult, _eventType: string) {
  const status = result.success ? '✅' : '❌';
  const ackCode = result.ackCode || 'N/A';
  
  if (verbose) {
    console.log(`  ${transport}: ${status} ACK=${ackCode} - ${result.ackMessage || result.error || ''}`);
  } else {
    process.stdout.write(result.success ? '.' : 'F');
  }
}

async function runTests() {
  console.log('\n🏥 HL7 SIU Message Integration Test');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`📋 Configuration:`);
  console.log(`   Messages to send: ${count}`);
  console.log(`   Legacy EHR: ${DEFAULT_EHR_CONFIG.sendingApplication}@${DEFAULT_EHR_CONFIG.sendingFacility}`);
  if (!socketOnly) {
    console.log(`   HTTPS endpoint: ${config.https.baseUrl}/hl7/siu`);
  }
  if (!httpsOnly) {
    console.log(`   Socket endpoint: ${config.socket.host}:${config.socket.port}`);
  }
  console.log(`   Providers: ${SAMPLE_PROVIDERS.length}`);
  console.log(`   Patients: ${SAMPLE_PATIENTS.length}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Create generator
  const generator = new SIUMessageGenerator(DEFAULT_EHR_CONFIG, SAMPLE_PROVIDERS, SAMPLE_PATIENTS);

  // Generate batch of messages
  console.log(`📨 Generating and sending ${count} SIU messages...\n`);
  
  if (!verbose) {
    process.stdout.write('Progress: ');
  }

  const batch = generator.generateBatch(count);
  
  for (let i = 0; i < batch.length; i++) {
    const { message, raw, eventType } = batch[i];
    stats.total++;
    stats.byEventType[eventType].total++;
    
    if (verbose) {
      console.log(`\n[${i + 1}/${count}] ${eventType} - Appt: ${message.sch.placerAppointmentId.idNumber}`);
      console.log(`  Patient: ${message.pid?.patientName.givenName} ${message.pid?.patientName.familyName}`);
      console.log(`  Provider: ${message.aip?.personnelResourceId?.givenName} ${message.aip?.personnelResourceId?.familyName}`);
    }
    
    // Send via HTTPS
    if (!socketOnly) {
      const httpsResult = await sendHL7OverHTTPS(raw, config.https);
      if (httpsResult.success) {
        stats.httpsSuccess++;
        stats.byEventType[eventType].success++;
      } else {
        stats.httpsFailed++;
      }
      printResult('HTTPS', httpsResult, eventType);
    }
    
    // Send via socket
    if (!httpsOnly) {
      const socketResult = await sendHL7OverSocket(raw, config.socket);
      if (socketResult.success) {
        stats.socketSuccess++;
        if (socketOnly) {
          stats.byEventType[eventType].success++;
        }
      } else {
        stats.socketFailed++;
      }
      printResult('Socket', socketResult, eventType);
    }
  }
  
  if (!verbose) {
    console.log('\n');
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('📊 Test Results Summary');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`Total messages: ${stats.total}`);
  
  if (!socketOnly) {
    const httpsTotal = stats.httpsSuccess + stats.httpsFailed;
    const httpsPercent = httpsTotal > 0 ? ((stats.httpsSuccess / httpsTotal) * 100).toFixed(1) : '0';
    console.log(`\n📡 HTTPS Results:`);
    console.log(`   Success: ${stats.httpsSuccess}/${httpsTotal} (${httpsPercent}%)`);
    console.log(`   Failed:  ${stats.httpsFailed}`);
  }
  
  if (!httpsOnly) {
    const socketTotal = stats.socketSuccess + stats.socketFailed;
    const socketPercent = socketTotal > 0 ? ((stats.socketSuccess / socketTotal) * 100).toFixed(1) : '0';
    console.log(`\n🔌 Socket Results:`);
    console.log(`   Success: ${stats.socketSuccess}/${socketTotal} (${socketPercent}%)`);
    console.log(`   Failed:  ${stats.socketFailed}`);
  }
  
  console.log(`\n📋 By Event Type:`);
  for (const [eventType, data] of Object.entries(stats.byEventType)) {
    if (data.total > 0) {
      const percent = ((data.success / data.total) * 100).toFixed(1);
      const emoji = eventType === 'S12' ? '➕' : 
                    eventType === 'S14' ? '✏️' :
                    eventType === 'S15' ? '🚫' :
                    eventType === 'S26' ? '👻' : '📝';
      console.log(`   ${emoji} SIU^${eventType}: ${data.success}/${data.total} (${percent}%)`);
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  // Exit code based on success
  const totalTests = (socketOnly ? 0 : stats.httpsSuccess + stats.httpsFailed) +
                     (httpsOnly ? 0 : stats.socketSuccess + stats.socketFailed);
  const totalSuccess = (socketOnly ? 0 : stats.httpsSuccess) +
                       (httpsOnly ? 0 : stats.socketSuccess);
  
  if (totalSuccess === totalTests && totalTests > 0) {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  } else if (totalTests === 0) {
    console.log('⚠️  No tests were run. Check endpoint availability.\n');
    process.exit(1);
  } else {
    console.log('❌ Some tests failed.\n');
    process.exit(1);
  }
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
HL7 SIU Message Test Script

Generates sample SIU scheduling messages from a simulated legacy EHR
and sends them to FHIRTogether via HTTPS and/or MLLP socket.

Usage:
  npm run hl7-test [options]

Options:
  --count=N        Number of messages to generate (default: 10)
  --host=HOST      Target host (default: localhost)
  --http-port=N    HTTP port (default: 4010)
  --socket-port=N  MLLP socket port (default: 2575)
  --https-only     Test HTTPS transport only
  --socket-only    Test socket transport only
  --verbose        Show detailed message information
  --help, -h       Show this help message

Examples:
  npm run hl7-test                          # Default: 10 messages, both transports
  npm run hl7-test -- --count=50            # Send 50 messages
  npm run hl7-test -- --https-only          # Test HTTPS only
  npm run hl7-test -- --verbose --count=5   # Detailed output for 5 messages

Message Types Generated:
  SIU^S12 - New appointment notification
  SIU^S14 - Appointment modification notification  
  SIU^S15 - Appointment cancellation notification
  `);
  process.exit(0);
}

// Run the tests
runTests().catch((error) => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
