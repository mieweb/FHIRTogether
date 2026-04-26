/**
 * SMART Scheduling Links — Inferno-Style Validation
 *
 * Automated script that mirrors the checks performed by the Inferno
 * SMART Scheduling Links test suite (v0.4.0):
 *   - Manifest URL form (1.01)
 *   - Manifest download (1.02)
 *   - Cache-Control header (optional)
 *   - Manifest structure (1.04)
 *   - State extensions (optional)
 *   - Location resource retrieval & validation
 *   - Schedule resource retrieval & validation
 *   - Slot resource retrieval & validation
 *
 * Usage:
 *   npx ts-node src/examples/validateSmartScheduling.ts [URL]
 *
 *   URL defaults to http://localhost:4010/$bulk-publish
 */

const MANIFEST_URL = process.argv[2] || 'http://localhost:4010/$bulk-publish';

// FHIR instant regex from the Inferno test kit
const INSTANT_REGEX =
  /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))/;

interface TestResult {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  message?: string;
}

const results: TestResult[] = [];

function pass(id: string, title: string, message?: string) {
  results.push({ id, title, status: 'pass', message });
}
function fail(id: string, title: string, message: string) {
  results.push({ id, title, status: 'fail', message });
}
function warn(id: string, title: string, message: string) {
  results.push({ id, title, status: 'warn', message });
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

async function run() {
  console.log(`\n🔍 SMART Scheduling Links Validation`);
  console.log(`   Target: ${MANIFEST_URL}\n`);

  // ── 1.01: URL form ─────────────────────────────────────────
  if (MANIFEST_URL.endsWith('$bulk-publish') && isValidUrl(MANIFEST_URL)) {
    pass('1.01', 'Manifest URL ends in $bulk-publish');
  } else {
    fail('1.01', 'Manifest URL ends in $bulk-publish',
      `URL "${MANIFEST_URL}" does not end with $bulk-publish or is not a valid URL`);
  }

  // ── 1.02: Download manifest ────────────────────────────────
  let manifest: Record<string, unknown> | null = null;
  let manifestRes: Response;
  try {
    manifestRes = await fetch(MANIFEST_URL, {
      headers: { 'Accept': 'application/json' },
    });

    if (manifestRes.status !== 200) {
      fail('1.02', 'Manifest can be downloaded', `HTTP ${manifestRes.status}`);
    } else {
      const body = await manifestRes.text();
      try {
        manifest = JSON.parse(body);
        pass('1.02', 'Manifest can be downloaded');
      } catch {
        fail('1.02', 'Manifest can be downloaded', 'Response is not valid JSON');
      }
    }
  } catch (err) {
    fail('1.02', 'Manifest can be downloaded', `Fetch failed: ${err}`);
    printResults();
    return;
  }

  if (!manifest) { printResults(); return; }

  // ── Cache-Control (optional) ───────────────────────────────
  const cacheControl = manifestRes!.headers.get('cache-control') || '';
  if (/max-age=\d+/.test(cacheControl)) {
    pass('opt', 'Cache-Control: max-age header present');
  } else {
    warn('opt', 'Cache-Control: max-age header present',
      'Missing Cache-Control: max-age header (SHOULD per spec)');
  }

  // ── 1.04: Manifest structure ───────────────────────────────
  const structureErrors: string[] = [];

  // transactionTime
  const tt = manifest.transactionTime;
  if (typeof tt !== 'string') {
    structureErrors.push('transactionTime must be a string');
  } else if (!INSTANT_REGEX.test(tt)) {
    structureErrors.push(`transactionTime "${tt}" is not in FHIR instant format`);
  }

  // request
  const req = manifest.request;
  if (typeof req !== 'string') {
    structureErrors.push('request must be a string');
  } else if (!isValidUrl(req as string)) {
    structureErrors.push(`request "${req}" is not a valid URL`);
  }

  // output
  const output = manifest.output;
  if (!Array.isArray(output)) {
    structureErrors.push('output must be an array');
  } else {
    const types = new Set<string>();
    for (const entry of output as Array<Record<string, unknown>>) {
      if (typeof entry.type !== 'string') structureErrors.push('output[].type must be a string');
      if (typeof entry.url !== 'string') structureErrors.push('output[].url must be a string');
      else if (!isValidUrl(entry.url as string)) structureErrors.push(`output URL "${entry.url}" is not valid`);
      if (entry.extension) {
        if (typeof entry.extension !== 'object' || Array.isArray(entry.extension)) {
          structureErrors.push('output[].extension must be a JSON object');
        } else {
          const ext = entry.extension as Record<string, unknown>;
          if (ext.state) {
            if (!Array.isArray(ext.state)) {
              structureErrors.push('extension.state must be an array');
            } else if (!(ext.state as unknown[]).every(s => typeof s === 'string')) {
              structureErrors.push('extension.state entries must all be strings');
            }
          }
        }
      }
      if (typeof entry.type === 'string') types.add(entry.type);
    }
    if (!types.has('Location')) structureErrors.push('No Location output entry');
    if (!types.has('Schedule')) structureErrors.push('No Schedule output entry');
    if (!types.has('Slot')) structureErrors.push('No Slot output entry');
  }

  if (structureErrors.length === 0) {
    pass('1.04', 'Manifest has correct structure');
  } else {
    fail('1.04', 'Manifest has correct structure', structureErrors.join('; '));
  }

  // ── State extensions (optional) ────────────────────────────
  if (Array.isArray(output)) {
    const relevant = (output as Array<Record<string, unknown>>)
      .filter(o => ['Location', 'Schedule', 'Slot'].includes(o.type as string));
    const withState = relevant.filter(o => {
      const ext = o.extension as Record<string, unknown> | undefined;
      return ext && Array.isArray(ext.state) && (ext.state as unknown[]).length > 0;
    });
    if (withState.length === relevant.length) {
      pass('opt', 'All outputs include state extension');
    } else {
      warn('opt', 'All outputs include state extension',
        `${withState.length}/${relevant.length} outputs include state extension (SHOULD per spec)`);
    }
  }

  // ── Resource retrieval ─────────────────────────────────────
  const outputArr = output as Array<Record<string, unknown>>;
  // Derive the base URL from the manifest URL to resolve NDJSON links
  const manifestBase = MANIFEST_URL.replace(/\/\$bulk-publish$/, '');
  for (const entry of outputArr) {
    const type = entry.type as string;
    let url = entry.url as string;
    if (!['Location', 'Schedule', 'Slot'].includes(type)) continue;

    // Normalize URL: if the manifest uses a different host (e.g. 0.0.0.0),
    // replace it with the host we used to reach the manifest.
    try {
      const entryUrl = new URL(url);
      const baseUrl = new URL(manifestBase);
      if (entryUrl.hostname !== baseUrl.hostname || entryUrl.port !== baseUrl.port) {
        entryUrl.hostname = baseUrl.hostname;
        entryUrl.port = baseUrl.port;
        entryUrl.protocol = baseUrl.protocol;
        url = entryUrl.toString();
      }
    } catch { /* keep original URL */ }

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/fhir+ndjson' },
      });

      if (res.status !== 200) {
        fail(`res.${type}`, `${type} NDJSON retrieval`, `HTTP ${res.status} from ${url}`);
        continue;
      }

      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('ndjson')) {
        warn(`res.${type}`, `${type} NDJSON content-type`, `Expected application/fhir+ndjson, got "${ct}"`);
      }

      const body = await res.text();
      const lines = body.split('\n').filter(Boolean);

      if (lines.length === 0) {
        warn(`res.${type}`, `${type} NDJSON retrieval`, 'File is empty');
        continue;
      }

      let valid = 0;
      const errors: string[] = [];
      for (const line of lines.slice(0, 100)) {
        try {
          const resource = JSON.parse(line);
          if (resource.resourceType !== type) {
            errors.push(`Expected resourceType "${type}", got "${resource.resourceType}"`);
          }
          if (!resource.id) errors.push(`Resource missing id`);

          // Type-specific checks
          if (type === 'Location') {
            if (!resource.name) errors.push('Location missing name');
            if (!resource.telecom || !Array.isArray(resource.telecom) || resource.telecom.length === 0) {
              errors.push('Location missing telecom');
            }
          }
          if (type === 'Schedule') {
            if (!resource.actor || !Array.isArray(resource.actor)) errors.push('Schedule missing actor');
          }
          if (type === 'Slot') {
            if (!resource.schedule?.reference) errors.push('Slot missing schedule.reference');
            if (!resource.status) errors.push('Slot missing status');
            if (!['free', 'busy'].includes(resource.status)) errors.push(`Slot status "${resource.status}" not free/busy`);
            if (!resource.start) errors.push('Slot missing start');
            if (!resource.end) errors.push('Slot missing end');
          }

          valid++;
        } catch {
          errors.push('Invalid JSON line');
        }
        if (errors.length > 3) break; // stop early on many errors
      }

      if (errors.length === 0) {
        pass(`res.${type}`, `${type} resources valid (${valid} checked)`);
      } else {
        fail(`res.${type}`, `${type} resource validation`, errors.slice(0, 5).join('; '));
      }
    } catch (err) {
      fail(`res.${type}`, `${type} NDJSON retrieval`, `Fetch failed: ${err}`);
    }
  }

  // ── Known gaps ─────────────────────────────────────────────
  console.log('\n📋 Known Inferno profile gaps (these are vaccine-specific requirements):');
  console.log('   • Location: Inferno expects VTrckS PIN identifier (vaccine-location profile)');
  console.log('   • Schedule: Inferno expects COVID-19 service type coding (vaccine-schedule profile)');
  console.log('   • These profiles are vaccine-specific; general scheduling data will not match.\n');

  printResults();
}

function printResults() {
  console.log('━'.repeat(72));
  console.log(' Test Results');
  console.log('━'.repeat(72));

  const icons = { pass: '✅', fail: '❌', skip: '⏭️', warn: '⚠️' };
  let passes = 0, fails = 0, warns = 0;

  for (const r of results) {
    const icon = icons[r.status];
    console.log(`  ${icon} [${r.id}] ${r.title}`);
    if (r.message) console.log(`     ${r.message}`);
    if (r.status === 'pass') passes++;
    else if (r.status === 'fail') fails++;
    else if (r.status === 'warn') warns++;
  }

  console.log('━'.repeat(72));
  console.log(`  ${passes} passed, ${fails} failed, ${warns} warnings`);
  console.log('━'.repeat(72));

  process.exit(fails > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
