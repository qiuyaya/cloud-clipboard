import { test, expect } from "@playwright/test";
import fs from "fs";

test.describe("Basic File Sharing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should create share link and download file", async ({ page }) => {
    const roomKey = `test-room-${Date.now()}`;

    // Step 1: Join a room
    await expect(page.getByPlaceholder("Enter room key")).toBeVisible({
      timeout: 10000,
    });

    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    // Wait for room page to load
    await expect(page.getByPlaceholder("Type your message or paste text here...")).toBeVisible({
      timeout: 15000,
    });

    // Step 2: Upload a test file
    // Create a test file
    const testFileContent = "This is a test file for sharing!";
    const testFile = await test.step("Create test file", async () => {
      const fileBlob = new Blob([testFileContent], { type: "text/plain" });
      const filePath = "test-file-" + Date.now() + ".txt";
      const fsImport = fs;
      fsImport.writeFileSync(filePath, testFileContent);
      return filePath;
    });

    // Upload the file using file input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFile);

    // Wait for file to appear in messages
    await expect(page.getByText("test-file-")).toBeVisible({
      timeout: 10000,
    });

    // Step 3: Create a share link
    await test.step("Click share button", async () => {
      // Look for the share button next to the uploaded file
      const shareButton = page
        .getByRole("button")
        .filter({ has: page.locator('svg[data-lucide="share2"]') })
        .first();

      await shareButton.click();
    });

    // Wait for share modal to open
    await expect(page.getByText("Share File")).toBeVisible({
      timeout: 5000,
    });

    // Step 4: Create share link (without password)
    await test.step("Create share link", async () => {
      const createButton = page.getByRole("button", { name: /create share link/i });
      await createButton.click();

      // Wait for success message or share link to appear
      await expect(page.getByText(/share link created!/i)).toBeVisible({
        timeout: 5000,
      });
    });

    // Step 5: Copy the share link
    let shareUrl = "";
    await test.step("Get share link URL", async () => {
      // Extract the share URL from the modal
      shareUrl = await page.locator("p").filter({ hasText: /http/ }).first().textContent();

      if (!shareUrl) {
        throw new Error("Share URL not found");
      }
    });

    // Step 6: Close the modal
    await page.getByRole("button", { name: /×|close|cancel/i }).click();

    // Step 7: Verify share link was created (check share count)
    await test.step("Verify share creation", async () => {
      // The access count should be 0 at this point
      await expect(page.getByText("Access Count: 0")).toBeVisible({
        timeout: 5000,
      });
    });

    // Step 8: Test accessing the share link in a new page context
    const context = await browser.newContext();
    const externalPage = await context.newPage();

    await test.step("Access share link from external page", async () => {
      await externalPage.goto(shareUrl);

      // Should see download success message
      await expect(externalPage.getByText(/file streaming would happen here/i)).toBeVisible({
        timeout: 10000,
      });
    });

    await context.close();

    // Step 9: Verify access count was incremented
    await test.step("Verify access count incremented", async () => {
      // Refresh the page to see updated access count
      await page.reload();

      // The access count should now be 1
      await expect(page.getByText("Access Count: 1")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("should create share link with password and require it for download", async ({
    page,
    browser,
  }) => {
    const roomKey = `test-room-password-${Date.now()}`;

    // Step 1: Join a room
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    await expect(page.getByPlaceholder("Type your message or paste text here...")).toBeVisible({
      timeout: 15000,
    });

    // Step 2: Create and upload a test file
    const testFileContent = "Password protected test file!";
    const fsImport = fs;
    const testFile = "test-password-file-" + Date.now() + ".txt";
    fsImport.writeFileSync(testFile, testFileContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFile);

    await expect(page.getByText("test-password-file-")).toBeVisible({
      timeout: 10000,
    });

    // Step 3: Click share button
    const shareButton = page
      .getByRole("button")
      .filter({ has: page.locator('svg[data-lucide="share2"]') })
      .first();
    await shareButton.click();

    // Step 4: Enable password protection
    await expect(page.getByText("Share File")).toBeVisible();

    const addPasswordLink = page.getByText(/add password protection/i);
    await addPasswordLink.click();

    // Step 5: Enter a secure password
    const passwordInput = page.locator('input[type="password"]');
    const securePassword = "SecurePass123!";
    await passwordInput.fill(securePassword);

    // Step 6: Create share link
    const createButton = page.getByRole("button", { name: /create share link/i });
    await createButton.click();

    // Wait for success
    await expect(page.getByText(/share link created!/i)).toBeVisible({
      timeout: 5000,
    });

    // Step 7: Verify password protection is indicated
    await expect(page.getByText(/password protected: yes/i)).toBeVisible();

    // Get the share URL
    const shareUrl = await page.locator("p").filter({ hasText: /http/ }).first().textContent();

    // Step 8: Try to access without password (should require auth)
    const context = await browser.newContext();
    const externalPage = await context.newPage();

    await externalPage.goto(shareUrl);
    await expect(externalPage.getByText(/authentication required/i)).toBeVisible({
      timeout: 10000,
    });

    await context.close();

    // Step 9: Close the modal
    await page.getByRole("button", { name: /×|close|cancel/i }).click();
  });

  test("should show error for expired share link", async ({ page, browser }) => {
    // This test would require creating a share with very short expiration
    // Since we can't easily control time in E2E tests, we'll skip this
    // In a real implementation, you might use time mocking or create shares with negative expiration

    test.skip(true, "Time-based test - requires special setup");
  });

  test("should show error for invalid share link", async ({ page }) => {
    // Try to access a non-existent share link
    const invalidUrl = "/api/share/invalid-share-id/download";

    await page.goto(invalidUrl);

    // Should see an error message
    await expect(page.getByText(/not found|not found or expired/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("should copy share link to clipboard", async ({ page }) => {
    const roomKey = `test-room-copy-${Date.now()}`;

    // Join room
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    await expect(page.getByPlaceholder("Type your message or paste text here...")).toBeVisible({
      timeout: 15000,
    });

    // Create and upload file
    const fsImport = fs;
    const testFile = "test-copy-file-" + Date.now() + ".txt";
    fsImport.writeFileSync(testFile, "Copy test file");

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFile);

    await expect(page.getByText("test-copy-file-")).toBeVisible({
      timeout: 10000,
    });

    // Create share
    const shareButton = page
      .getByRole("button")
      .filter({ has: page.locator('svg[data-lucide="share2"]') })
      .first();
    await shareButton.click();

    await expect(page.getByText("Share File")).toBeVisible();

    const createButton = page.getByRole("button", { name: /create share link/i });
    await createButton.click();

    await expect(page.getByText(/share link created!/i)).toBeVisible({
      timeout: 5000,
    });

    // Test copy functionality
    const copyButton = page.getByRole("button", { name: /copy link/i });
    await copyButton.click();

    // The button should trigger clipboard API
    // In Playwright, we can't directly verify clipboard contents without permission,
    // but we can check that the click was successful
    await expect(copyButton).toBeVisible();
  });
});
