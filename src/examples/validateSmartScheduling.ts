/**
 * SMART Scheduling Links — Inferno Test Runner
 *
 * Drives the actual Inferno SMART Scheduling Links test suite via its REST API.
 * Can target either a local Inferno instance (via Docker) or the hosted
 * Inferno at inferno.healthit.gov.
 *
 * Usage:
 *   # Against local Inferno (docker compose -f docker-compose.inferno.yml up -d)
 *   npx tsx src/examples/validateSmartScheduling.ts http://host.docker.internal:4010/\$bulk-publish
 *
 *   # Against hosted Inferno (server must be publicly accessible)
 *   npx tsx src/examples/validateSmartScheduling.ts https://your-server.example.com/\$bulk-publish --inferno https://inferno.healthit.gov
 *
 * Environment variables:
 *   INFERNO_URL    — Inferno base URL (default: http://localhost:8080)
 *   BULK_PUBLISH_URL — $bulk-publish URL to test (default: arg[0] or http://host.docker.internal:4010/$bulk-publish)
 *   INFERNO_POLL_INTERVAL — Seconds between status polls (default: 2)
 *   INFERNO_TIMEOUT — Max seconds to wait for test completion (default: 120)
 */

// ─── Configuration ────────────────────────────────────────────

const args = process.argv.slice(2);
let bulkPublishUrl = process.env.BULK_PUBLISH_URL || 'http://host.docker.internal:4010/$bulk-publish';
let infernoUrl = process.env.INFERNO_URL || 'http://localhost:8080';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--inferno' && args[i + 1]) {
    infernoUrl = args[++i];
  } else if (!args[i].startsWith('--')) {
    bulkPublishUrl = args[i];
  }
}

const POLL_INTERVAL = parseInt(process.env.INFERNO_POLL_INTERVAL || '2', 10) * 1000;
const TIMEOUT = parseInt(process.env.INFERNO_TIMEOUT || '120', 10) * 1000;
const API = `${infernoUrl}/api`;

const SUITE_ID = 'smart_scheduling_links';

// ─── Types ────────────────────────────────────────────────────

interface TestResult {
  id: string;
  test_id?: string;
  test_group_id?: string;
  test_suite_id?: string;
  result: 'pass' | 'fail' | 'skip' | 'omit' | 'error' | 'cancel';
  result_message?: string;
  optional?: boolean;
  messages?: Array<{ type: string; message: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────

async function apiGet(path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────

async function run() {
  console.log(`\n🔬 Inferno SMART Scheduling Links Test Runner`);
  console.log(`   Inferno:       ${infernoUrl}`);
  console.log(`   $bulk-publish: ${bulkPublishUrl}\n`);

  // 1. Verify Inferno is reachable
  try {
    await apiGet('/test_suites');
    console.log('✓ Inferno is reachable');
  } catch (err) {
    console.error(`✗ Cannot reach Inferno at ${infernoUrl}`);
    console.error(`  ${err}`);
    console.error(`\n  To start Inferno locally:`);
    console.error(`    docker compose -f docker-compose.inferno.yml up -d`);
    console.error(`    # Wait ~30s for startup, then re-run this script`);
    process.exit(2);
  }

  // 2. Create test session
  console.log(`\nCreating test session for suite: ${SUITE_ID}`);
  const session = await apiPost('/test_sessions', { test_suite_id: SUITE_ID }) as { id: string };
  console.log(`  Session ID: ${session.id}`);

  // 3. Start test run with our $bulk-publish URL
  console.log(`\nStarting test run...`);
  const testRun = await apiPost('/test_runs', {
    test_session_id: session.id,
    test_suite_id: SUITE_ID,
    inputs: [
      { name: 'url', value: bulkPublishUrl },
      { name: 'max_lines_per_file', value: '100' },
    ],
  }) as { id: string; status: string };
  console.log(`  Test Run ID: ${testRun.id}`);

  // 4. Poll for completion
  const startTime = Date.now();
  let status = testRun.status;
  process.stdout.write('  Waiting');

  while (status === 'running' || status === 'queued' || status === 'waiting') {
    if (Date.now() - startTime > TIMEOUT) {
      console.error(`\n\n✗ Timed out after ${TIMEOUT / 1000}s`);
      process.exit(3);
    }
    await sleep(POLL_INTERVAL);
    process.stdout.write('.');
    const runStatus = await apiGet(`/test_runs/${testRun.id}`) as { status: string };
    status = runStatus.status;
  }
  console.log(` ${status}\n`);

  // 5. Get results
  const results = await apiGet(`/test_sessions/${session.id}/results`) as TestResult[];

  // Filter to individual test results (not group/suite summaries)
  const testResults = results.filter(r => r.test_id);

  // 6. Print results
  const icons: Record<string, string> = {
    pass: '✅', fail: '❌', skip: '⏭️ ', omit: '⬜', error: '💥', cancel: '🚫',
  };

  console.log('━'.repeat(80));
  console.log(' Inferno Test Results');
  console.log('━'.repeat(80));

  const counts: Record<string, number> = {};
  for (const r of testResults) {
    const icon = icons[r.result] || '❓';
    const opt = r.optional ? ' (optional)' : '';
    const testId = r.test_id || r.id;
    console.log(`  ${icon} ${testId}${opt}`);
    if (r.result_message) {
      const msg = r.result_message.length > 200
        ? r.result_message.slice(0, 200) + '...'
        : r.result_message;
      console.log(`     ${msg}`);
    }
    if (r.messages) {
      for (const m of r.messages.slice(0, 3)) {
        const mIcon = m.type === 'error' ? '  ⚠' : '  ℹ';
        const mMsg = m.message.length > 150 ? m.message.slice(0, 150) + '...' : m.message;
        console.log(`    ${mIcon} ${mMsg}`);
      }
    }
    counts[r.result] = (counts[r.result] || 0) + 1;
  }

  console.log('━'.repeat(80));
  const summary = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  console.log(`  ${testResults.length} tests: ${summary}`);

  const sessionUrl = `${infernoUrl}/test_sessions/${session.id}`;
  console.log(`\n  Full results: ${sessionUrl}`);
  console.log('━'.repeat(80));

  // Exit with failure if any required test failed
  const requiredFails = testResults.filter(r => r.result === 'fail' && !r.optional);
  process.exit(requiredFails.length > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
