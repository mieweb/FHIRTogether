import { test, expect } from '@playwright/test';

/**
 * Schedule Synchronization E2E Tests
 *
 * Loads the Provider View page, mocks the remote FHIR endpoint with a
 * WebChart-style Bundle (type=collection), clicks Synchronize, and asserts
 * the grid mapping.
 */

// A complete WebChart-style collection Bundle, mirroring the real payload
// structure (Practitioner + Location + Schedule entries). The omitted
// availableTime / coding details from the captured sample are filled in here.
const SAMPLE_BUNDLE = {
  resourceType: 'Bundle',
  type: 'collection',
  meta: { lastUpdated: '2026-06-11T13:59:44Z' },
  entry: [
    {
      resource: {
        resourceType: 'Practitioner',
        id: '16',
        name: [{ use: 'official', family: 'Butler', given: ['Internist', 'E.'] }],
      },
    },
    { resource: { resourceType: 'Location', id: 'OFFICE', name: 'Office' } },
    {
      resource: {
        resourceType: 'Schedule',
        id: '5',
        actor: [
          { reference: 'Practitioner/16', display: 'Butler, Internist E.' },
          { reference: 'Location/OFFICE' },
        ],
        serviceType: [
          { coding: [{ code: 'BERY', display: 'OSHA Beryllium' }], text: 'OSHA Beryllium' },
          { coding: [{ code: 'AUDIO', display: 'Audiogram' }], text: 'Audiogram' },
        ],
        planningHorizon: { start: '2026-01-30T13:00:00Z', end: '2026-08-30T21:00:00Z' },
        extension: [
          {
            url: 'https://zeus.med-web.com/webchart/wctmpierzchala/webchart.cgi/StructureDefinition/schedule-portal-time-slots',
            valueInteger: 15,
          },
          {
            url: 'http://hl7.org/fhir/StructureDefinition/availableTime',
            availableTime: [
              {
                daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
                availableStartTime: '08:00:00',
                availableEndTime: '17:00:00',
              },
            ],
          },
        ],
      },
    },
    {
      resource: {
        resourceType: 'Practitioner',
        id: '28',
        name: [{ use: 'official', family: 'Lab Testing', given: [''] }],
      },
    },
    {
      resource: {
        resourceType: 'Schedule',
        id: '6',
        actor: [
          { reference: 'Practitioner/28', display: 'Lab Testing' },
          { reference: 'Location/OFFICE' },
        ],
        serviceType: [
          { coding: [{ code: 'PHYS', display: 'Physical Exam' }], text: 'Physical Exam' },
        ],
        planningHorizon: { start: '2015-07-27T12:00:00Z', end: '2015-07-27T16:00:00Z' },
        comment: 'Fasting Appointments Only',
        extension: [
          {
            url: 'https://zeus.med-web.com/webchart/wctmpierzchala/webchart.cgi/StructureDefinition/schedule-portal-time-slots',
            valueInteger: 10,
          },
          {
            url: 'http://hl7.org/fhir/StructureDefinition/availableTime',
            availableTime: [
              {
                daysOfWeek: ['mon'],
                availableStartTime: '07:00:00',
                availableEndTime: '11:00:00',
              },
            ],
          },
        ],
      },
    },
    {
      resource: {
        resourceType: 'Practitioner',
        id: '66',
        name: [{ use: 'official', family: 'Vaccinator 1', given: [''] }],
      },
    },
    {
      resource: {
        resourceType: 'Schedule',
        id: '10',
        actor: [
          { reference: 'Practitioner/66', display: 'Vaccinator 1' },
          { reference: 'Location/OFFICE' },
        ],
        serviceType: [],
        planningHorizon: { start: '2021-02-22T13:00:00Z', end: '2021-02-22T22:00:00Z' },
        comment: 'COVID Vaccine-Injection 1 only',
        extension: [
          {
            url: 'https://zeus.med-web.com/webchart/wctmpierzchala/webchart.cgi/StructureDefinition/schedule-portal-time-slots',
            valueInteger: 10,
          },
          {
            url: 'http://hl7.org/fhir/StructureDefinition/availableTime',
            availableTime: [
              {
                daysOfWeek: ['sat', 'sun'],
                availableStartTime: '09:00:00',
                availableEndTime: '15:00:00',
              },
            ],
          },
        ],
      },
    },
  ],
};

const TARGET_URL =
  'https://zeus.med-web.com/webchart/wctmpierzchala/webchart.cgi/rest/schedules';

// Synchronization now runs server-side: the browser POSTs to /sync-schedules
// (the server fetches + parses + upserts), then the grid reloads from the
// persisted store via GET /Schedule. Both are mocked here.
const SYNC_GLOB = '**/sync-schedules';
const SCHEDULE_GLOB = '**/Schedule?*';

const SYNC_MARKER_URL = 'https://fhirtogether.org/fhir/StructureDefinition/synced-from';

/**
 * Build the searchset Bundle that GET /Schedule returns after synchronization:
 * the source Schedules with Location displays resolved and a sync-source marker
 * extension appended (mirroring what the server persists).
 */
function persistedScheduleBundle() {
  const schedules = SAMPLE_BUNDLE.entry
    .map((e) => e.resource)
    .filter((r) => r.resourceType === 'Schedule')
    .map((s) => ({
      ...s,
      actor: s.actor.map((a) =>
        a.reference.startsWith('Location/') ? { ...a, display: 'Office' } : a
      ),
      extension: [...(s.extension || []), { url: SYNC_MARKER_URL, valueString: TARGET_URL }],
    }));
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: schedules.length,
    entry: schedules.map((resource) => ({ resource })),
  };
}

/** Assert the three sample schedules are mapped correctly into the grid. */
async function expectSampleGrid(page: import('@playwright/test').Page) {
  await expect(page.locator('#grid-count')).toHaveText('3 schedules');
  const rows = page.locator('#grid-body tr');
  await expect(rows).toHaveCount(3);

  // ── Row 1: Schedule/5 (Butler) ──
  const r1 = rows.nth(0);
  await expect(r1.locator('td').nth(0)).toHaveText('Butler, Internist E.');
  await expect(r1.locator('td').nth(1)).toHaveText('Office');
  await expect(r1.locator('td').nth(2)).toHaveText('01-30-2026 13:00:00');
  await expect(r1.locator('td').nth(3)).toHaveText('08-30-2026 21:00:00');
  await expect(r1.locator('td').nth(5)).toHaveText('08:00'); // start time
  await expect(r1.locator('td').nth(6)).toHaveText('17:00'); // end time
  await expect(r1.locator('td').nth(7)).toHaveText('15');    // slot minutes
  await expect(r1.locator('.dow-chip.dow-active')).toHaveCount(5);
  await expect(r1.locator('.type-tag')).toContainText(['OSHA Beryllium', 'Audiogram']);

  // ── Row 2: Schedule/6 (Lab Testing) — has comment ──
  const r2 = rows.nth(1);
  await expect(r2.locator('td').nth(0)).toHaveText('Lab Testing');
  await expect(r2.locator('td').nth(7)).toHaveText('10');
  await expect(r2.locator('td').nth(9)).toHaveText('Fasting Appointments Only');
  await expect(r2.locator('.dow-chip.dow-active')).toHaveCount(1);

  // ── Row 3: Schedule/10 (Vaccinator) — empty serviceType ──
  const r3 = rows.nth(2);
  await expect(r3.locator('td').nth(0)).toHaveText('Vaccinator 1');
  await expect(r3.locator('td').nth(9)).toHaveText('COVID Vaccine-Injection 1 only');
  await expect(r3.locator('.type-empty')).toBeVisible();
  await expect(r3.locator('.dow-chip.dow-active')).toHaveCount(2);
}

test.describe('Schedule Synchronization', () => {
  test.beforeEach(async ({ page }) => {
    // Default: no previously-synced schedules (empty searchset on page load).
    await page.route(SCHEDULE_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] }),
      })
    );
    await page.goto('/scheduler/provider-view.html');
    // The sync UI lives on its own dedicated tab.
    await page.getByRole('tab', { name: 'Synchronize' }).click();
  });

  test('loads page with sync panel and default endpoint', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Synchronize Schedules' })).toBeVisible();
    await expect(page.locator('#sync-url')).toHaveValue(TARGET_URL);
    await expect(page.locator('#grid-count')).toHaveText('0 schedules');
  });

  test('sync section is hidden until the Synchronize tab is selected', async ({ page }) => {
    await page.getByRole('tab', { name: 'Appointments' }).click();
    await expect(page.locator('#sync-section')).toBeHidden();
    await page.getByRole('tab', { name: 'Synchronize' }).click();
    await expect(page.locator('#sync-section')).toBeVisible();
  });

  test('synchronizes and maps the persisted schedules into the grid', async ({ page }) => {
    // Server-side sync succeeds and reports the imported count.
    await page.route(SYNC_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, imported: 3, source: TARGET_URL }),
      })
    );
    // After sync, the grid reloads from the persisted store.
    await page.unroute(SCHEDULE_GLOB);
    await page.route(SCHEDULE_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify(persistedScheduleBundle()),
      })
    );

    await page.getByRole('button', { name: /Synchronize/ }).click();

    await expect(page.getByText('Successfully synchronized 3 schedules.')).toBeVisible();
    await expectSampleGrid(page);
  });

  test('restores previously synchronized schedules on reload', async ({ page }) => {
    // Simulate reopening the page with schedules already persisted.
    await page.unroute(SCHEDULE_GLOB);
    await page.route(SCHEDULE_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/fhir+json',
        body: JSON.stringify(persistedScheduleBundle()),
      })
    );
    await page.reload();
    await page.getByRole('tab', { name: 'Synchronize' }).click();

    // Grid is populated without clicking Synchronize.
    await expectSampleGrid(page);
  });

  test('shows an error toast on server failure', async ({ page }) => {
    await page.route(SYNC_GLOB, (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Upstream fetch failed: getaddrinfo ENOTFOUND' }),
      })
    );
    await page.getByRole('button', { name: /Synchronize/ }).click();
    await expect(page.getByText(/Upstream fetch failed/)).toBeVisible();
    await expect(page.locator('#grid-count')).toHaveText('0 schedules');
  });

  test('rejects a non-collection bundle', async ({ page }) => {
    await page.route(SYNC_GLOB, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Expected Bundle.type "collection" but received "searchset".' }),
      })
    );
    await page.getByRole('button', { name: /Synchronize/ }).click();
    await expect(page.getByText(/Expected Bundle.type "collection"/)).toBeVisible();
  });
});
