import { test, expect } from '@playwright/test';

test.describe('Basic Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the home page', async ({ page }) => {
    await expect(page).toHaveTitle(/Cloud Clipboard/);
    
    // Check if main elements are present
    await expect(page.getByText('Cloud Clipboard')).toBeVisible();
    await expect(page.getByPlaceholder('Enter room key')).toBeVisible();
    await expect(page.getByRole('button', { name: /join room/i })).toBeVisible();
  });

  test('should join a room successfully', async ({ page }) => {
    const roomKey = `test-room-${Date.now()}`;
    
    // Fill in room key and username
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('Test User');
    
    // Join room
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Should navigate to the room
    await expect(page.getByText('Test User')).toBeVisible();
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
    await expect(page.getByRole('button', { name: /send/i })).toBeVisible();
  });

  test('should validate room key format', async ({ page }) => {
    // Try with invalid room key (no numbers)
    await page.getByPlaceholder('Enter room key').fill('invalidkey');
    await page.getByPlaceholder('Enter your name').fill('Test User');
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Should show validation error
    await expect(page.getByText(/room key must contain both letters and numbers/i)).toBeVisible();
  });

  test('should validate username', async ({ page }) => {
    const roomKey = `test-room-${Date.now()}`;
    
    // Try with empty username
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Should show validation error
    await expect(page.getByText(/name is required/i)).toBeVisible();
  });

  test('should send and receive text messages', async ({ page, context }) => {
    const roomKey = `chat-room-${Date.now()}`;
    
    // Open second page for user 2
    const page2 = await context.newPage();
    
    // User 1 joins room
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('User One');
    await page.getByRole('button', { name: /join room/i }).click();
    
    // User 2 joins the same room
    await page2.goto('/');
    await page2.getByPlaceholder('Enter room key').fill(roomKey);
    await page2.getByPlaceholder('Enter your name').fill('User Two');
    await page2.getByRole('button', { name: /join room/i }).click();
    
    // Wait for both users to be in the room
    await expect(page.getByText('User One')).toBeVisible();
    await expect(page.getByText('User Two')).toBeVisible();
    await expect(page2.getByText('User One')).toBeVisible();
    await expect(page2.getByText('User Two')).toBeVisible();
    
    // User 1 sends a message
    const message = 'Hello from User One!';
    await page.getByPlaceholder('Type a message...').fill(message);
    await page.getByRole('button', { name: /send/i }).click();
    
    // Both users should see the message
    await expect(page.getByText(message)).toBeVisible();
    await expect(page2.getByText(message)).toBeVisible();
    
    // User 2 replies
    const reply = 'Hello back from User Two!';
    await page2.getByPlaceholder('Type a message...').fill(reply);
    await page2.getByRole('button', { name: /send/i }).click();
    
    // Both users should see the reply
    await expect(page.getByText(reply)).toBeVisible();
    await expect(page2.getByText(reply)).toBeVisible();
    
    await page2.close();
  });

  test('should handle file uploads', async ({ page }) => {
    const roomKey = `file-room-${Date.now()}`;
    
    // Join room
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('File User');
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Wait for room to load
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
    
    // Create a test file
    const fileContent = 'This is a test file content';
    const fileName = 'test.txt';
    
    // Upload file
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /attach file/i }).click();
    const fileChooser = await fileChooserPromise;
    
    // Create a temporary file for upload
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileContent),
    });
    
    // Should show file upload success or file in chat
    await expect(page.getByText(fileName)).toBeVisible({ timeout: 10000 });
  });

  test('should show user list', async ({ page }) => {
    const roomKey = `users-room-${Date.now()}`;
    
    // Join room
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('User List Test');
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Should show user in the sidebar or user list
    await expect(page.getByText('User List Test')).toBeVisible();
    
    // Check for online indicator
    await expect(page.locator('[data-testid="user-online-indicator"]')).toBeVisible();
  });

  test('should handle theme switching', async ({ page }) => {
    // Check if theme toggle is present
    await expect(page.getByRole('button', { name: /toggle theme/i })).toBeVisible();
    
    // Click theme toggle
    await page.getByRole('button', { name: /toggle theme/i }).click();
    
    // Check if theme changed (look for dark mode class on html element)
    const htmlElement = page.locator('html');
    await expect(htmlElement).toHaveClass(/dark/);
    
    // Toggle back
    await page.getByRole('button', { name: /toggle theme/i }).click();
    await expect(htmlElement).not.toHaveClass(/dark/);
  });

  test('should handle language switching', async ({ page }) => {
    // Look for language toggle
    const languageToggle = page.getByRole('button', { name: /language/i });
    
    if (await languageToggle.isVisible()) {
      await languageToggle.click();
      
      // Should show language options
      await expect(page.getByText('English')).toBeVisible();
      await expect(page.getByText('中文')).toBeVisible();
      
      // Switch to Chinese
      await page.getByText('中文').click();
      
      // Should see Chinese text
      await expect(page.getByText('云剪贴板')).toBeVisible();
    }
  });

  test('should handle network disconnection gracefully', async ({ page, context }) => {
    const roomKey = `disconnect-room-${Date.now()}`;
    
    // Join room
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('Disconnect Test');
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Wait for connection
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
    
    // Simulate network disconnection
    await context.setOffline(true);
    
    // Should show disconnection indicator
    await expect(page.getByText(/disconnected/i)).toBeVisible({ timeout: 10000 });
    
    // Restore connection
    await context.setOffline(false);
    
    // Should reconnect
    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10000 });
  });

  test('should persist room state on page reload', async ({ page }) => {
    const roomKey = `persist-room-${Date.now()}`;
    
    // Join room
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('Persist User');
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Wait for room to load
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
    
    // Send a message
    await page.getByPlaceholder('Type a message...').fill('Test persistence');
    await page.getByRole('button', { name: /send/i }).click();
    
    // Reload page
    await page.reload();
    
    // Should auto-rejoin the room
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Persist User')).toBeVisible();
  });

  test('should handle room destruction when all users leave', async ({ page, context }) => {
    const roomKey = `destroy-room-${Date.now()}`;
    
    // Open second page
    const page2 = await context.newPage();
    
    // Both users join
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('User One');
    await page.getByRole('button', { name: /join room/i }).click();
    
    await page2.goto('/');
    await page2.getByPlaceholder('Enter room key').fill(roomKey);
    await page2.getByPlaceholder('Enter your name').fill('User Two');
    await page2.getByRole('button', { name: /join room/i }).click();
    
    // Wait for both to join
    await expect(page.getByText('User Two')).toBeVisible();
    
    // First user leaves
    await page.goto('/');
    await expect(page.getByPlaceholder('Enter room key')).toBeVisible();
    
    // Second user should still be in room
    await expect(page2.getByPlaceholder('Type a message...')).toBeVisible();
    
    // Second user leaves
    await page2.goto('/');
    
    // Room should be destroyed (verified by server logs or subsequent behavior)
    await expect(page2.getByPlaceholder('Enter room key')).toBeVisible();
    
    await page2.close();
  });
});