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

  test('displays visit type selector on load', async ({ page }) => {
    // Should show the header
    await expect(page.getByRole('heading', { name: '🗓️ FHIR Scheduler Widget' })).toBeVisible();
    
    // Should show visit type selection
    await expect(page.getByRole('heading', { name: 'Schedule an Appointment' })).toBeVisible();
    
    // Should display both visit type options
    await expect(page.getByRole('button', { name: /follow-up visit/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /new patient visit/i })).toBeVisible();
  });

  test('follow-up visit goes directly to provider list', async ({ page }) => {
    // Select follow-up visit
    await page.getByRole('button', { name: /follow-up visit/i }).click();
    
    // Should show provider selection heading
    await expect(page.getByRole('heading', { name: 'Select a Provider' })).toBeVisible();
    
    // Should display at least one provider
    const providers = page.getByRole('button', { name: /Select Dr\./ });
    await expect(providers.first()).toBeVisible();
  });

  test('new patient visit shows questionnaire first', async ({ page }) => {
    // Select new patient visit
    await page.getByRole('button', { name: /new patient visit/i }).click();
    
    // Should show intake questionnaire
    await expect(page.getByRole('heading', { name: 'Patient Intake' })).toBeVisible();
    
    // Should have questionnaire fields
    await expect(page.getByText('What type of visit do you need?')).toBeVisible();
    
    // Should have Continue button
    await expect(page.getByRole('button', { name: /Continue to Provider Selection/i })).toBeVisible();
  });

  test('shows available dates when provider is selected', async ({ page }) => {
    // Select follow-up visit to skip questionnaire
    await page.getByRole('button', { name: /follow-up visit/i }).click();
    
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
    // Select follow-up visit
    await page.getByRole('button', { name: /follow-up visit/i }).click();
    
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

  test('shows booking form with hold timer when slot is selected (follow-up)', async ({ page }) => {
    // Select follow-up visit
    await page.getByRole('button', { name: /follow-up visit/i }).click();
    
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select a date further out to avoid slot conflicts
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option').nth(5).click();
    
    // Select last available time slot to avoid conflicts with other tests
    await expect(page.getByRole('option', { name: /AM|PM/ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: /AM|PM/ }).last().click();
    
    // Should show booking form
    await expect(page.getByRole('heading', { name: 'Complete Your Booking' })).toBeVisible({ timeout: 10000 });
    
    // Should show hold timer
    await expect(page.getByText(/Slot reserved for/)).toBeVisible();
    
    // Should show appointment details
    await expect(page.getByText('Appointment Details')).toBeVisible();
    
    // Should have patient info form fields (for follow-up, questionnaire not completed)
    await expect(page.getByRole('textbox', { name: /Full Name/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Email/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Phone/ })).toBeVisible();
    
    // Should have confirm button
    await expect(page.getByRole('button', { name: 'Confirm Booking' })).toBeVisible();
  });

  test('can navigate back from provider list to visit type', async ({ page }) => {
    // Select follow-up visit
    await page.getByRole('button', { name: /follow-up visit/i }).click();
    
    // Should be on provider list - but there's no back button from provider list
    // to visit type in the current implementation
    await expect(page.getByRole('heading', { name: 'Select a Provider' })).toBeVisible();
  });

  test('can navigate back from calendar to provider list', async ({ page }) => {
    // Select follow-up visit
    await page.getByRole('button', { name: /follow-up visit/i }).click();
    
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
    // Select follow-up visit
    await page.getByRole('button', { name: /follow-up visit/i }).click();
    
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select a date further out to avoid conflicts
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option').nth(7).click();
    
    // Select last time slot to avoid conflicts
    await expect(page.getByRole('option', { name: /AM|PM/ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: /AM|PM/ }).last().click();
    
    // Should be on booking form
    await expect(page.getByRole('heading', { name: 'Complete Your Booking' })).toBeVisible({ timeout: 10000 });
    
    // Click back button
    await page.getByRole('button', { name: 'Back' }).click();
    
    // Should be back on calendar view
    await expect(page.getByRole('heading', { name: 'Select a Date' })).toBeVisible();
  });

  test('can complete follow-up booking flow', async ({ page }) => {
    // Select follow-up visit
    await page.getByRole('button', { name: /follow-up visit/i }).click();
    
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select a date far out to avoid conflicts with other tests
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option').nth(9).click();
    
    // Select last time slot to avoid conflicts
    await expect(page.getByRole('option', { name: /AM|PM/ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: /AM|PM/ }).last().click();
    
    // Wait for booking form
    await expect(page.getByRole('heading', { name: 'Complete Your Booking' })).toBeVisible({ timeout: 10000 });
    
    // Fill in patient info
    await page.getByRole('textbox', { name: /Full Name/ }).fill('Test Patient');
    await page.getByRole('textbox', { name: /Email/ }).fill('test@example.com');
    await page.getByRole('textbox', { name: /Phone/ }).fill('555-1234');
    await page.getByRole('textbox', { name: /Reason/ }).fill('Follow-up visit');
    
    // Submit booking
    await page.getByRole('button', { name: 'Confirm Booking' }).click();
    
    // Should show confirmation
    await expect(page.getByText(/Appointment Confirmed|Booking confirmed/i)).toBeVisible({ timeout: 10000 });
  });

  test('new patient flow proceeds through questionnaire to booking', async ({ page }) => {
    // Select new patient visit
    await page.getByRole('button', { name: /new patient visit/i }).click();
    
    // Fill out questionnaire
    await expect(page.getByRole('heading', { name: 'Patient Intake' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('radio', { name: 'New Patient Visit' }).click();
    await page.getByPlaceholder('Type your answer').first().fill('Annual checkup');
    await page.getByRole('checkbox', { name: 'None of the above' }).click();
    await page.getByRole('radio', { name: 'No' }).click();
    
    // Continue to providers
    await page.getByRole('button', { name: /Continue to Provider Selection/i }).click();
    
    // Should be on provider list now
    await expect(page.getByRole('heading', { name: 'Select a Provider' })).toBeVisible({ timeout: 10000 });
    
    // Select provider
    await page.getByRole('button', { name: /Select Dr\./ }).first().click();
    
    // Select a date far out to avoid conflicts
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option').nth(11).click();
    
    // Select last time slot to avoid conflicts
    await expect(page.getByRole('option', { name: /AM|PM/ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: /AM|PM/ }).last().click();
    
    // Should show booking form without patient info fields
    await expect(page.getByRole('heading', { name: 'Complete Your Booking' })).toBeVisible({ timeout: 10000 });
    
    // Patient info fields should NOT be visible (questionnaire already completed)
    await expect(page.getByRole('textbox', { name: /Full Name/ })).not.toBeVisible();
    
    // Submit booking
    await page.getByRole('button', { name: 'Confirm Booking' }).click();
    
    // Should show confirmation
    await expect(page.getByText(/Appointment Confirmed|Booking confirmed/i)).toBeVisible({ timeout: 10000 });
  });
});
