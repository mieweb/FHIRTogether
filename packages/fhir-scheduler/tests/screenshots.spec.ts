import { test, expect } from '@playwright/test';

/**
 * Screenshot generation for FHIR Scheduler Widget documentation
 * 
 * Captures screenshots at each step of the booking flow for use in:
 * - README.md documentation
 * - Embeddable_FHIR_Scheduler.md specification
 * 
 * Run with: npx playwright test tests/screenshots.spec.ts
 * Screenshots saved to: docs/screenshots/
 */

test.describe('Documentation Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    // Set a consistent viewport for documentation screenshots
    await page.setViewportSize({ width: 1024, height: 768 });
  });

  /**
   * Helper to navigate to booking form step
   * Uses different date and slot indices to avoid parallel test conflicts
   */
  async function navigateToBookingForm(
    page: import('@playwright/test').Page, 
    dateIndex = 0,
    slotIndex = 0
  ) {
    // Select provider
    await expect(page.getByRole('button', { name: /Select Dr\./ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select date at specified index
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option').nth(dateIndex).click();
    
    // Wait for time slots and select specified slot
    await expect(page.getByRole('option', { name: /AM|PM/ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: /AM|PM/ }).nth(slotIndex).click();
    
    // Wait for booking form to appear
    await expect(page.getByRole('heading', { name: 'Complete Your Booking' })).toBeVisible({ timeout: 10000 });
  }

  test('01-provider-list: Provider selection view', async ({ page }) => {
    await page.goto('http://localhost:5174/');
    
    // Wait for providers to load
    await expect(page.getByRole('heading', { name: 'Select a Provider' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Select Dr\./ }).first()).toBeVisible();
    
    // Small delay to ensure animations complete
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/01-provider-list.png',
      fullPage: false,
    });
  });

  test('02-date-selection: Available dates view', async ({ page }) => {
    await page.goto('http://localhost:5174/');
    
    // Wait for providers and select first one
    await expect(page.getByRole('button', { name: /Select Dr\./ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Wait for date selection to load
    await expect(page.getByRole('heading', { name: /Schedule with Dr\./ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: 'Available' })).toBeVisible();
    
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/02-date-selection.png',
      fullPage: false,
    });
  });

  test('03-calendar-view: Calendar tab view', async ({ page }) => {
    await page.goto('http://localhost:5174/');
    
    // Select provider
    await expect(page.getByRole('button', { name: /Select Dr\./ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Switch to Calendar tab
    await expect(page.getByRole('tab', { name: 'Calendar' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('tab', { name: 'Calendar' }).click();
    
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/03-calendar-view.png',
      fullPage: false,
    });
  });

  test('04-time-slots: Time slot selection', async ({ page }) => {
    await page.goto('http://localhost:5174/');
    
    // Select provider
    await expect(page.getByRole('button', { name: /Select Dr\./ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select first available date
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option').first().click();
    
    // Wait for time slots to appear
    await expect(page.getByRole('region', { name: 'Available times' })).toBeVisible({ timeout: 10000 });
    
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/04-time-slots.png',
      fullPage: false,
    });
  });

  test('05-booking-form: Booking form with hold timer', async ({ page }) => {
    await page.goto('http://localhost:5174/');
    
    // Use date 1, slot 0 to avoid conflicts with other booking tests
    await navigateToBookingForm(page, 1, 0);
    await expect(page.getByText(/Slot reserved for/)).toBeVisible();
    
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/05-booking-form.png',
      fullPage: false,
    });
  });

  test('06-booking-filled: Booking form with data entered', async ({ page }) => {
    await page.goto('http://localhost:5174/');
    
    // Use date 2, slot 0 to avoid conflicts
    await navigateToBookingForm(page, 2, 0);
    
    // Fill in the form using label locators
    await page.locator('#fs-name').fill('Jane Smith');
    await page.locator('#fs-email').fill('jane.smith@example.com');
    await page.locator('#fs-phone').fill('(555) 123-4567');
    await page.locator('#fs-reason').fill('Annual checkup');
    
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/06-booking-filled.png',
      fullPage: false,
    });
  });

  test('07-confirmation: Booking confirmation', async ({ page }) => {
    await page.goto('http://localhost:5174/');
    
    // Use date 3, slot 0 to avoid conflicts
    await navigateToBookingForm(page, 3, 0);
    
    // Fill in required fields
    await page.locator('#fs-name').fill('Test Patient');
    await page.locator('#fs-email').fill('test@example.com');
    await page.locator('#fs-phone').fill('(555) 000-0000');
    
    // Submit the booking
    await page.getByRole('button', { name: 'Confirm Booking' }).click();
    
    // Wait for confirmation heading specifically
    await expect(page.getByRole('heading', { name: 'Appointment Confirmed!' })).toBeVisible({ timeout: 15000 });
    
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/07-confirmation.png',
      fullPage: false,
    });
  });

  test('08-mobile-provider-list: Mobile view - provider list', async ({ page }) => {
    // Mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('http://localhost:5174/');
    
    await expect(page.getByRole('heading', { name: 'Select a Provider' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Select Dr\./ }).first()).toBeVisible();
    
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/08-mobile-provider-list.png',
      fullPage: false,
    });
  });

  test('09-mobile-booking: Mobile view - booking form', async ({ page }) => {
    // Mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('http://localhost:5174/');
    
    // Navigate to booking form (use date 4, slot 0 for isolation)
    await expect(page.getByRole('button', { name: /Select Dr\./ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option').nth(4).click();
    
    // Use first slot on this date
    await expect(page.getByRole('option', { name: /AM|PM/ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: /AM|PM/ }).first().click();
    
    await expect(page.getByRole('heading', { name: 'Complete Your Booking' })).toBeVisible({ timeout: 10000 });
    
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: 'docs/screenshots/09-mobile-booking.png',
      fullPage: true,
    });
  });
});
