import { test, expect } from '@playwright/test';

/**
 * HL7 Message Tester E2E Tests
 *
 * Tests the /hl7-tester page: layout, MSH config, sending messages,
 * response display, and deep links.
 *
 * Prerequisites:
 *   - FHIRTogether server running on port 4010 (auto-started via webServer config)
 */

test.describe('HL7 Message Tester', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hl7-tester');
  });

  // ── Page structure ──────────────────────────────────────

  test('loads page with correct title and header', async ({ page }) => {
    await expect(page).toHaveTitle('HL7 Message Tester — FHIRTogether');
    await expect(page.getByRole('heading', { name: 'HL7v2 Message Tester' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('SANDBOX');
  });

  test('displays navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Swagger UI' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  });

  test('renders all 6 example message cards', async ({ page }) => {
    const cards = [
      'SIU^S12 — New Appointment',
      'SIU^S12 — New Patient Visit',
      'SIU^S12 — Pediatrics Visit',
      'SIU^S14 — Modify Appointment',
      'SIU^S15 — Cancel Appointment',
      'SIU^S12 — Different Sending System',
    ];
    for (const title of cards) {
      await expect(page.getByText(title)).toBeVisible();
    }
  });

  test('each card has Send, Reset, and Copy buttons', async ({ page }) => {
    const sendButtons = page.getByRole('button', { name: 'Send to API' });
    await expect(sendButtons).toHaveCount(6);

    // Use exact match to avoid matching "Reset Defaults" and "Reset All to Defaults"
    const resetButtons = page.getByRole('button', { name: 'Reset', exact: true });
    await expect(resetButtons).toHaveCount(6);

    const copyButtons = page.getByRole('button', { name: 'Copy to clipboard' });
    await expect(copyButtons).toHaveCount(6);
  });

  // ── MSH Configuration ──────────────────────────────────

  test('shows MSH configuration panel with default values', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'MSH Configuration' })).toBeVisible();
    await expect(page.getByLabel('MSH-3: Sending Application')).toHaveValue('LEGACY_EHR');
    await expect(page.getByLabel('MSH-4: Sending Facility')).toHaveValue('MAIN_HOSPITAL');
    await expect(page.getByLabel('MSH-5: Receiving Application')).toHaveValue('FHIRTOGETHER');
    await expect(page.getByLabel('MSH-6: Receiving Facility')).toHaveValue('SCHEDULING_GATEWAY');
    await expect(page.getByLabel('MSH-12: HL7 Version')).toHaveValue('2.3');
  });

  test('shows provider & location config with defaults', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Provider & Location' })).toBeVisible();
    await expect(page.getByLabel('Provider')).toContainText('Dr. Douglas Adams');
    await expect(page.getByLabel('Location ID (AIL)')).toHaveValue('OFFICE');
    await expect(page.getByLabel('Location Name')).toHaveValue('Main Office');
  });

  test('Apply button updates MSH fields in messages', async ({ page }) => {
    // Change sending facility
    await page.getByLabel('MSH-4: Sending Facility').fill('TEST_FACILITY');
    await page.getByRole('button', { name: 'Apply MSH changes to all messages' }).click();

    // Verify the first message textarea value contains the new facility
    const textarea = page.getByLabel('HL7 message for SIU^S12 — New Appointment');
    const value = await textarea.inputValue();
    expect(value).toContain('TEST_FACILITY');
  });

  test('Reset Defaults restores original MSH values', async ({ page }) => {
    // Change a field
    await page.getByLabel('MSH-3: Sending Application').fill('CHANGED');
    await page.getByRole('button', { name: 'Apply MSH changes to all messages' }).click();

    // Reset
    await page.getByRole('button', { name: 'Reset MSH to defaults' }).click();

    await expect(page.getByLabel('MSH-3: Sending Application')).toHaveValue('LEGACY_EHR');
    const textarea = page.getByLabel('HL7 message for SIU^S12 — New Appointment');
    const value = await textarea.inputValue();
    expect(value).toContain('LEGACY_EHR');
  });

  // ── Sending messages ───────────────────────────────────

  test('sends SIU^S12 and receives AA ACK', async ({ page }) => {
    await page.locator('#btn-s12-new').click();

    // Wait for status to show OK
    await expect(page.locator('#status-s12-new')).toContainText('200 OK', { timeout: 10000 });

    // Response should be visible with ACK content
    const response = page.locator('#resp-pre-s12-new');
    await expect(response).toBeVisible();
    await expect(response).toContainText('MSA|AA|');
  });

  test('sends SIU^S14 modify and receives AA ACK', async ({ page }) => {
    // First create the appointment so the modify has something to update
    await page.locator('#btn-s12-new').click();
    await expect(page.locator('#status-s12-new')).toContainText('200 OK', { timeout: 10000 });

    // Now modify it
    await page.locator('#btn-s14-modify').click();
    await expect(page.locator('#status-s14-modify')).toContainText('200 OK', { timeout: 10000 });
    await expect(page.locator('#resp-pre-s14-modify')).toContainText('MSA|AA|');
  });

  test('sends SIU^S15 cancel and receives AA ACK', async ({ page }) => {
    // Create first
    await page.locator('#btn-s12-new').click();
    await expect(page.locator('#status-s12-new')).toContainText('200 OK', { timeout: 10000 });

    // Cancel
    await page.locator('#btn-s15-cancel').click();
    await expect(page.locator('#status-s15-cancel')).toContainText('200 OK', { timeout: 10000 });
    await expect(page.locator('#resp-pre-s15-cancel')).toContainText('MSA|AA|');
  });

  test('different sending system creates separate registration', async ({ page }) => {
    await page.locator('#btn-s12-different-system').click();
    await expect(page.locator('#status-s12-different-system')).toContainText('200 OK', { timeout: 10000 });
    await expect(page.locator('#resp-pre-s12-different-system')).toContainText('MSA|AA|');
  });

  // ── Deep links ─────────────────────────────────────────

  test('shows deep links after successful send', async ({ page }) => {
    await page.locator('#btn-s12-new').click();
    await expect(page.locator('#status-s12-new')).toContainText('200 OK', { timeout: 10000 });

    // Deep links bar should appear (may need time for async header read)
    const links = page.locator('#links-s12-new');
    await expect(links).toBeVisible({ timeout: 5000 });

    // Should contain scheduler link with provider name
    await expect(links.locator('a', { hasText: /Book with/ })).toBeVisible({ timeout: 5000 });

    // Should contain Schedule resource link
    await expect(links.locator('a', { hasText: /Schedule\// })).toBeVisible();

    // Should contain Free Slots link
    await expect(links.locator('a', { hasText: /Free Slots/ })).toBeVisible();

    // Should contain Provider View link
    await expect(links.locator('a', { hasText: /Provider View/ })).toBeVisible();
  });

  test('deep link points to correct schedule ID', async ({ page }) => {
    await page.locator('#btn-s12-new').click();
    await expect(page.locator('#status-s12-new')).toContainText('200 OK', { timeout: 10000 });

    const bookLink = page.locator('#links-s12-new a').first();
    const href = await bookLink.getAttribute('href');
    // Should contain /demo#calendar/ with a schedule ID
    expect(href).toMatch(/\/demo#calendar\/schedule-\d+/);
  });

  test('different system deep links to different schedule', async ({ page }) => {
    // Send the default system message
    await page.locator('#btn-s12-new').click();
    await expect(page.locator('#status-s12-new')).toContainText('200 OK', { timeout: 10000 });

    // Send the different system message
    await page.locator('#btn-s12-different-system').click();
    await expect(page.locator('#status-s12-different-system')).toContainText('200 OK', { timeout: 10000 });

    // Get both schedule links
    const link1 = await page.locator('#links-s12-new a').first().getAttribute('href');
    const link2 = await page.locator('#links-s12-different-system a').first().getAttribute('href');

    // They should point to different schedules
    expect(link1).not.toEqual(link2);
  });

  // ── Reset behavior ─────────────────────────────────────

  test('reset clears response and deep links', async ({ page }) => {
    // Send a message
    await page.locator('#btn-s12-new').click();
    await expect(page.locator('#status-s12-new')).toContainText('200 OK', { timeout: 10000 });
    await expect(page.locator('#links-s12-new')).toBeVisible();

    // Reset it
    await page.locator('#card-s12-new').getByRole('button', { name: 'Reset' }).click();

    // Response and links should be hidden
    await expect(page.locator('#resp-s12-new')).not.toBeVisible();
    await expect(page.locator('#links-s12-new')).not.toBeVisible();
    await expect(page.locator('#status-s12-new')).toHaveText('');
  });

  // ── Batch operations ───────────────────────────────────

  test('Send All Messages sends all 6 and shows responses', async ({ page }) => {
    await page.getByRole('button', { name: /Send all messages/i }).click();

    // Wait for last message to complete
    await expect(page.locator('#status-s12-different-system')).toContainText('200 OK', { timeout: 30000 });

    // All 6 should have OK status
    const ids = ['s12-new', 's12-newpatient', 's12-peds', 's14-modify', 's15-cancel', 's12-different-system'];
    for (const id of ids) {
      await expect(page.locator(`#status-${id}`)).toContainText('200 OK');
    }
  });

  test('Reset All clears all responses', async ({ page }) => {
    // Send all first
    await page.getByRole('button', { name: /Send all messages/i }).click();
    await expect(page.locator('#status-s12-different-system')).toContainText('200 OK', { timeout: 30000 });

    // Reset all
    await page.getByRole('button', { name: /Reset all/i }).click();

    // All statuses should be empty
    const ids = ['s12-new', 's12-newpatient', 's12-peds', 's14-modify', 's15-cancel', 's12-different-system'];
    for (const id of ids) {
      await expect(page.locator(`#status-${id}`)).toHaveText('');
    }
  });

  // ── Provider switching ─────────────────────────────────

  test('changing provider updates messages after Apply', async ({ page }) => {
    // Switch to a different provider
    await page.getByLabel('Provider').selectOption({ label: 'Dr. Ford Prefect — Cardiology' });
    await page.getByRole('button', { name: 'Apply MSH changes to all messages' }).click();

    // First message should now contain "Prefect^Ford"
    const textarea = page.getByLabel('HL7 message for SIU^S12 — New Appointment');
    const value = await textarea.inputValue();
    expect(value).toContain('Prefect^Ford');
  });
});
