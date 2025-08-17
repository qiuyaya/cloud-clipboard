import { test, expect } from '@playwright/test';

test.describe('Basic Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');
  });

  test('should load the home page', async ({ page }) => {
    await expect(page).toHaveTitle(/Cloud Clipboard/);
    
    // Check if main elements are present with longer timeout
    await expect(page.getByText('Cloud Clipboard')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('Enter room key')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /join room/i })).toBeVisible({ timeout: 10000 });
  });

  test('should join a room successfully', async ({ page }) => {
    const roomKey = `test-room-${Date.now()}`;
    
    // Fill in room key and username
    await expect(page.getByPlaceholder('Enter room key')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('Test User');
    
    // Join room
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Should navigate to the room - check for message input
    await expect(page.getByPlaceholder('Type your message or paste text here...')).toBeVisible({ timeout: 15000 });
  });

  test('should handle theme switching', async ({ page }) => {
    // Look for theme toggle button
    const themeToggle = page.getByRole('button').filter({ hasText: /theme|dark|light/i }).first();
    
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      
      // Check if theme changed (look for dark mode class on html element)
      const htmlElement = page.locator('html');
      const hasThemeClass = await htmlElement.evaluate(el => {
        return el.classList.contains('dark') || el.classList.contains('light') || 
               el.getAttribute('data-theme') !== null;
      });
      expect(hasThemeClass).toBeTruthy();
    }
  });
});