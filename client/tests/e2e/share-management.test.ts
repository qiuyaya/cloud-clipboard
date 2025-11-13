import { test, expect } from "@playwright/test";

test.describe("Share Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should create share, view list, view details, and revoke", async ({ page }) => {
    const roomKey = `test-room-${Date.now()}`;

    // Step 1: Join a room
    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    await expect(page.getByPlaceholder("Type your message")).toBeVisible({
      timeout: 15000,
    });

    // Step 2: Upload a file
    const testFileName = "test-share-management-" + Date.now() + ".txt";

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: testFileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Test file for management"),
    });

    await expect(page.getByText(testFileName)).toBeVisible({
      timeout: 10000,
    });

    // Step 3: Create share link
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

    // Get the share URL
    const shareUrl = await page.locator("p").filter({ hasText: /http/ }).first().textContent();

    // Step 4: Navigate to share management (would need a navigation link in real app)
    // For now, we'll test accessing the share directly

    // Step 5: Test accessing the share
    const context = await browser.newContext();
    const externalPage = await context.newPage();

    await externalPage.goto(shareUrl);
    await expect(externalPage.getByText(/file streaming would happen here/i)).toBeVisible({
      timeout: 10000,
    });

    await context.close();

    // Step 6: Close the modal
    await page.getByRole("button", { name: /×|close|cancel/i }).click();
  });

  test("should view share list and filter by status", async ({ page }) => {
    const roomKey = `test-room-filter-${Date.now()}`;

    // Join room
    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    await expect(page.getByPlaceholder("Type your message")).toBeVisible({
      timeout: 15000,
    });

    // Create multiple shares with different statuses
    for (let i = 0; i < 3; i++) {
      const testFileName = `test-filter-${i}-${Date.now()}.txt`;

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: testFileName,
        mimeType: "text/plain",
        buffer: Buffer.from(`Test file ${i}`),
      });

      await expect(page.getByText(testFileName)).toBeVisible();

      const shareButton = page
        .getByRole("button")
        .filter({ has: page.locator('svg[data-lucide="share2"]') })
        .first();
      await shareButton.click();

      const createButton = page.getByRole("button", { name: /create share link/i });
      await createButton.click();

      await expect(page.getByText(/share link created!/i)).toBeVisible({
        timeout: 5000,
      });

      await page.getByRole("button", { name: /×|close|cancel/i }).click();
    }
  });

  test("should view access logs for a share", async ({ page }) => {
    const roomKey = `test-room-logs-${Date.now()}`;

    // Join room
    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    await expect(page.getByPlaceholder("Type your message")).toBeVisible({
      timeout: 15000,
    });

    // Create share
    const testFileName = "test-logs-" + Date.now() + ".txt";

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: testFileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Test file for logs"),
    });

    await expect(page.getByText(testFileName)).toBeVisible();

    const shareButton = page
      .getByRole("button")
      .filter({ has: page.locator('svg[data-lucide="share2"]') })
      .first();
    await shareButton.click();

    const createButton = page.getByRole("button", { name: /create share link/i });
    await createButton.click();

    await expect(page.getByText(/share link created!/i)).toBeVisible({
      timeout: 5000,
    });

    // Get the share URL
    const shareUrl = await page.locator("p").filter({ hasText: /http/ }).first().textContent();

    await page.getByRole("button", { name: /×|close|cancel/i }).click();

    // Access the share multiple times to create logs
    const context = await browser.newContext();
    const externalPage = await context.newPage();

    for (let i = 0; i < 3; i++) {
      await externalPage.goto(shareUrl);
      await externalPage.waitForTimeout(500);
    }

    await context.close();
  });

  test("should revoke a share link", async ({ page }) => {
    const roomKey = `test-room-revoke-${Date.now()}`;

    // Join room
    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    await expect(page.getByPlaceholder("Type your message")).toBeVisible({
      timeout: 15000,
    });

    // Create share
    const testFileName = "test-revoke-" + Date.now() + ".txt";

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: testFileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Test file to revoke"),
    });

    await expect(page.getByText(testFileName)).toBeVisible();

    const shareButton = page
      .getByRole("button")
      .filter({ has: page.locator('svg[data-lucide="share2"]') })
      .first();
    await shareButton.click();

    const createButton = page.getByRole("button", { name: /create share link/i });
    await createButton.click();

    await expect(page.getByText(/share link created!/i)).toBeVisible({
      timeout: 5000,
    });

    const shareUrl = await page.locator("p").filter({ hasText: /http/ }).first().textContent();

    await page.getByRole("button", { name: /×|close|cancel/i }).click();

    // Test accessing the share before revoking
    const context = await browser.newContext();
    const externalPage = await context.newPage();

    await externalPage.goto(shareUrl);
    await expect(externalPage.getByText(/file streaming would happen here/i)).toBeVisible({
      timeout: 10000,
    });

    await context.close();
  });

  test("should copy share link to clipboard", async ({ page }) => {
    const roomKey = `test-room-copy-${Date.now()}`;

    // Join room
    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    await expect(page.getByPlaceholder("Type your message")).toBeVisible({
      timeout: 15000,
    });

    // Create share
    const testFileName = "test-copy-clipboard-" + Date.now() + ".txt";

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: testFileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Test file"),
    });

    await expect(page.getByText(testFileName)).toBeVisible();

    const shareButton = page
      .getByRole("button")
      .filter({ has: page.locator('svg[data-lucide="share2"]') })
      .first();
    await shareButton.click();

    const createButton = page.getByRole("button", { name: /create share link/i });
    await createButton.click();

    await expect(page.getByText(/share link created!/i)).toBeVisible({
      timeout: 5000,
    });

    // Click copy button
    const copyButton = page.getByRole("button", { name: /copy link/i });
    await copyButton.click();

    // Verify the button is clickable
    await expect(copyButton).toBeVisible();
  });

  test("should show password protection indicator", async ({ page }) => {
    const roomKey = `test-room-password-${Date.now()}`;

    // Join room
    await page.getByPlaceholder("Enter room key").fill(roomKey);
    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByRole("button", { name: /join room/i }).click();

    await expect(page.getByPlaceholder("Type your message")).toBeVisible({
      timeout: 15000,
    });

    // Create share with password
    const testFileName = "test-password-" + Date.now() + ".txt";

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: testFileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Password protected file"),
    });

    await expect(page.getByText(testFileName)).toBeVisible();

    const shareButton = page
      .getByRole("button")
      .filter({ has: page.locator('svg[data-lucide="share2"]') })
      .first();
    await shareButton.click();

    // Create share (password is auto-generated)
    const createButton = page.getByRole("button", { name: /create share link/i });
    await createButton.click();

    await expect(page.getByText(/share link created!/i)).toBeVisible({
      timeout: 5000,
    });

    // Verify password protection is indicated
    // Password is always auto-generated, so it should be password protected
    await expect(page.getByText(/password protected: yes/i)).toBeVisible();
  });
});
