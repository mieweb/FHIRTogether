import { test, expect } from '@playwright/test';

/**
 * FHIR Scheduler Widget E2E Tests
 * 
 * Prerequisites:
 * - FHIRTogether server running on port 4010 (npm run dev from root)
 * - Test data generated (npm run generate-data from root)
 * - Vite dev server for scheduler (npm run dev from packages/fhir-scheduler)
 */

test.describe('FHIR Scheduler Widget', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the demo page
    await page.goto('http://localhost:5174/');
  });

  test('displays provider list on load', async ({ page }) => {
    // Should show the header
    await expect(page.getByRole('heading', { name: '🗓️ FHIR Scheduler Widget' })).toBeVisible();
    
    // Should show provider selection heading
    await expect(page.getByRole('heading', { name: 'Select a Provider' })).toBeVisible();
    
    // Should display at least one provider
    const providers = page.getByRole('button', { name: /Select Dr\./ });
    await expect(providers.first()).toBeVisible();
  });

  test('shows available dates when provider is selected', async ({ page }) => {
    // Click on first provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Should show date selection
    await expect(page.getByRole('heading', { name: /Schedule with Dr\./ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Select a Date' })).toBeVisible();
    
    // Should have Available and Calendar tabs
    await expect(page.getByRole('tab', { name: 'Available' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Calendar' })).toBeVisible();
    
    // Should show available date options
    const dateOptions = page.getByRole('option');
    await expect(dateOptions.first()).toBeVisible();
  });

  test('shows time slots when date is selected', async ({ page }) => {
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select first available date
    await page.getByRole('option').first().click();
    
    // Should show time slots
    await expect(page.getByRole('region', { name: 'Available times' })).toBeVisible();
    
    // Should have morning and/or afternoon sections
    const timeSlots = page.getByRole('listbox', { name: /times/ });
    await expect(timeSlots.first()).toBeVisible();
  });

  test('shows booking form with hold timer when slot is selected', async ({ page }) => {
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select first available date
    await page.getByRole('option').first().click();
    
    // Select first available time slot
    await page.getByRole('option', { name: /AM|PM/ }).first().click();
    
    // Should show booking form
    await expect(page.getByRole('heading', { name: 'Complete Your Booking' })).toBeVisible();
    
    // Should show hold timer
    await expect(page.getByText(/Slot reserved for/)).toBeVisible();
    
    // Should show appointment details
    await expect(page.getByText('Appointment Details')).toBeVisible();
    
    // Should have patient info form fields
    await expect(page.getByRole('textbox', { name: /Full Name/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Email/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Phone/ })).toBeVisible();
    
    // Should have confirm button
    await expect(page.getByRole('button', { name: 'Confirm Booking' })).toBeVisible();
  });

  test('can navigate back from calendar to provider list', async ({ page }) => {
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Should be on calendar view
    await expect(page.getByRole('heading', { name: /Schedule with Dr\./ })).toBeVisible();
    
    // Click back button
    await page.getByRole('button', { name: 'Back' }).click();
    
    // Should be back on provider list
    await expect(page.getByRole('heading', { name: 'Select a Provider' })).toBeVisible();
  });

  test('can navigate back from booking form to calendar', async ({ page }) => {
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select date
    await page.getByRole('option').first().click();
    
    // Select time slot
    await page.getByRole('option', { name: /AM|PM/ }).first().click();
    
    // Should be on booking form
    await expect(page.getByRole('heading', { name: 'Complete Your Booking' })).toBeVisible();
    
    // Click back button
    await page.getByRole('button', { name: 'Back' }).click();
    
    // Should be back on calendar view
    await expect(page.getByRole('heading', { name: 'Select a Date' })).toBeVisible();
  });

  test('can complete booking flow', async ({ page }) => {
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select date
    await page.getByRole('option').first().click();
    
    // Select time slot
    await page.getByRole('option', { name: /AM|PM/ }).first().click();
    
    // Fill in patient info
    await page.getByRole('textbox', { name: /Full Name/ }).fill('Test Patient');
    await page.getByRole('textbox', { name: /Email/ }).fill('test@example.com');
    await page.getByRole('textbox', { name: /Phone/ }).fill('555-1234');
    await page.getByRole('textbox', { name: /Reason/ }).fill('Annual checkup');
    
    // Submit booking
    await page.getByRole('button', { name: 'Confirm Booking' }).click();
    
    // Should show confirmation
    await expect(page.getByText(/Appointment Confirmed|Booking confirmed/i)).toBeVisible({ timeout: 10000 });
  });
});
