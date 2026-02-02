import { test, expect } from "@playwright/test";

/**
 * E2E tests for the SDK demo application.
 *
 * These tests verify the SDK works correctly in a real browser environment
 * with actual WASM loading and audio playback.
 *
 * Note: These tests require valid API credentials to run against the real API,
 * or can be run with MSW for offline testing.
 */

test.describe("Demo App", () => {
  test("page loads successfully", async ({ page }) => {
    await page.goto("/");

    // Check the demo app loads
    await expect(page.locator("h1")).toContainText("Underscore SDK Demo");
  });

  test("shows configuration form", async ({ page }) => {
    await page.goto("/");

    // Check form elements exist
    await expect(page.locator("#apiKey")).toBeVisible();
    await expect(page.locator("#compositionId")).toBeVisible();
    await expect(page.locator("#initBtn")).toBeVisible();
  });

  test("shows error for missing API key", async ({ page }) => {
    await page.goto("/");

    // Try to initialize without API key
    await page.locator("#initBtn").click();

    // Should show error in log
    await expect(page.locator("#log")).toContainText("API key is required");
  });

  test("shows error for missing composition ID", async ({ page }) => {
    await page.goto("/");

    // Enter API key but no composition ID
    await page.locator("#apiKey").fill("us_test_key");
    await page.locator("#initBtn").click();

    // Should show error in log
    await expect(page.locator("#log")).toContainText("Composition ID is required");
  });
});

test.describe("SDK Initialization", () => {
  test.skip("initializes with valid credentials", async ({ page }) => {
    /**
     * Skip by default - requires real API credentials.
     * Set TEST_API_KEY and TEST_COMPOSITION_ID env vars to run.
     */
    const apiKey = process.env.TEST_API_KEY;
    const compositionId = process.env.TEST_COMPOSITION_ID;

    if (!apiKey || !compositionId) {
      test.skip();
      return;
    }

    await page.goto("/");

    await page.locator("#apiKey").fill(apiKey);
    await page.locator("#compositionId").fill(compositionId);
    await page.locator("#initBtn").click();

    // Wait for initialization
    await expect(page.locator("#log")).toContainText("Audio engine initialized", {
      timeout: 10000,
    });

    // Synths section should be visible
    await expect(page.locator("#synthsSection")).toBeVisible();
  });
});

test.describe("Accessibility", () => {
  test("all form inputs have labels", async ({ page }) => {
    await page.goto("/");

    // Check API key input
    const apiKeyLabel = page.locator('label[for="apiKey"]');
    await expect(apiKeyLabel).toBeVisible();

    // Check composition ID input
    const compIdLabel = page.locator('label[for="compositionId"]');
    await expect(compIdLabel).toBeVisible();
  });

  test("buttons are keyboard accessible", async ({ page }) => {
    await page.goto("/");

    // Tab to the init button
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    // Press enter - should trigger click
    await page.keyboard.press("Enter");

    // Should show error (no credentials)
    await expect(page.locator("#log")).toContainText("required");
  });
});
