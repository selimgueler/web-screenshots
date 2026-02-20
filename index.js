#!/usr/bin/env node

const { chromium } = require("playwright");
const { URL } = require("url");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

// ─── Configuration ───────────────────────────────────────────────
const args = process.argv.slice(2);
const loginFlag = args.includes("--login");
const urlArg = args.find((a) => !a.startsWith("--"));

const config = {
  // Target website (override via CLI: node index.js https://example.com)
  startUrl: urlArg || "https://example.com",

  // Login: run headed and pause for manual login
  // Usage: node index.js https://example.com --login
  requiresLogin: loginFlag,

  // Screenshot settings
  format: "jpeg", // jpeg | png
  quality: 85, // 1-100 (jpeg only)
  fullPage: true, // full scrollable page

  // Viewport
  viewportWidth: 1440,
  viewportHeight: 900,

  // Crawler settings
  maxPages: 50, // safety limit
  maxDepth: 3, // how deep to follow links
  timeout: 30000, // page load timeout (ms)
  waitAfterLoad: 1500, // extra wait for lazy content (ms)

  // Output
  outputDir: "./screenshots",

  // Ignore patterns (regex) — skip URLs matching these
  ignorePatterns: [
    /\.(pdf|zip|tar|gz|exe|dmg|mp4|mp3|mov|avi|jpg|jpeg|png|gif|svg|webp|ico)$/i,
    /\?(utm_|fbclid|gclid)/i,
    /#/,
    /mailto:/i,
    /tel:/i,
    /javascript:/i,
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, () => {
      rl.close();
      resolve();
    });
  });
}

function normalizeUrl(href, baseUrl) {
  try {
    const url = new URL(href, baseUrl);
    // Remove trailing slash, hash, and common tracking params
    url.hash = "";
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    url.searchParams.delete("fbclid");
    url.searchParams.delete("gclid");
    let normalized = url.href;
    if (normalized.endsWith("/") && url.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

function isSameOrigin(href, origin) {
  try {
    const url = new URL(href);
    return url.origin === origin;
  } catch {
    return false;
  }
}

function shouldSkip(url) {
  return config.ignorePatterns.some((pattern) => pattern.test(url));
}

function urlToFilename(url) {
  const parsed = new URL(url);
  let name = parsed.pathname.replace(/^\//, "").replace(/\//g, "__");
  if (!name || name === "") name = "index";
  // Add search params to filename if present
  if (parsed.search) {
    name += parsed.search.replace(/[?&=]/g, "_");
  }
  // Sanitize
  name = name.replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 120);
  return `${name}.${config.format}`;
}

// ─── Main Crawler ────────────────────────────────────────────────
async function crawlAndScreenshot() {
  const startUrl = config.startUrl;
  const origin = new URL(startUrl).origin;

  console.log(`\n🌐 Site Screenshotter`);
  console.log(`   Target:     ${startUrl}`);
  console.log(`   Max pages:  ${config.maxPages}`);
  console.log(`   Max depth:  ${config.maxDepth}`);
  console.log(`   Format:     ${config.format.toUpperCase()} (quality: ${config.quality})`);
  console.log(`   Viewport:   ${config.viewportWidth}x${config.viewportHeight}`);
  console.log(`   Output:     ${path.resolve(config.outputDir)}`);
  if (config.requiresLogin) {
    console.log(`   Login:      ✅ Interactive (browser will open visibly)`);
  }
  console.log();

  // Ensure output directory
  fs.mkdirSync(config.outputDir, { recursive: true });

  // Launch browser (headed if login required, headless otherwise)
  const browser = await chromium.launch({
    headless: !config.requiresLogin,
    slowMo: config.requiresLogin ? 50 : 0,
  });
  const context = await browser.newContext({
    viewport: { width: config.viewportWidth, height: config.viewportHeight },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  // ─── Interactive Login ───────────────────────────────────────
  if (config.requiresLogin) {
    const page = await context.newPage();
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: config.timeout });

    console.log(`🔐 Browser opened at: ${startUrl}`);
    console.log(`   Please log in manually in the browser window.`);
    console.log(`   When you're logged in and on the main page, come back here.\n`);

    await prompt("   ➜ Press ENTER when you're logged in... ");

    // Capture the URL the user ended up on (might have redirected after login)
    const currentUrl = page.url();
    console.log(`\n   ✅ Logged in! Current page: ${currentUrl}`);
    console.log(`   Starting crawl...\n`);

    await page.close();
  }

  const visited = new Set();
  const queue = [{ url: normalizeUrl(startUrl, startUrl), depth: 0 }];
  const results = [];

  while (queue.length > 0 && visited.size < config.maxPages) {
    const { url, depth } = queue.shift();

    if (!url || visited.has(url) || shouldSkip(url)) continue;
    if (!isSameOrigin(url, origin)) continue;

    visited.add(url);
    const pageNum = visited.size;
    const filename = urlToFilename(url);
    const filepath = path.join(config.outputDir, filename);

    try {
      const page = await context.newPage();

      // Navigate
      console.log(`📸 [${pageNum}/${config.maxPages}] (depth ${depth}) ${url}`);
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: config.timeout,
      });

      // Wait a bit for lazy-loaded content
      await page.waitForTimeout(config.waitAfterLoad);

      // Close cookie banners / popups (common patterns)
      try {
        await page.evaluate(() => {
          const selectors = [
            '[class*="cookie"] button',
            '[class*="consent"] button',
            '[id*="cookie"] button',
            '[class*="popup"] [class*="close"]',
            'button[aria-label="Close"]',
            'button[aria-label="Accept"]',
            'button[aria-label="Accept all"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) el.click();
          }
        });
        await page.waitForTimeout(500);
      } catch {
        // Ignore — not every page has popups
      }

      // Take screenshot
      const screenshotOptions = {
        path: filepath,
        fullPage: config.fullPage,
        type: config.format,
      };
      if (config.format === "jpeg") {
        screenshotOptions.quality = config.quality;
      }
      await page.screenshot(screenshotOptions);

      console.log(`   ✅ Saved: ${filename}`);
      results.push({ url, file: filename, status: "ok" });

      // Extract links if within depth limit
      if (depth < config.maxDepth) {
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
        );

        for (const link of links) {
          const normalized = normalizeUrl(link, url);
          if (normalized && !visited.has(normalized) && isSameOrigin(normalized, origin)) {
            queue.push({ url: normalized, depth: depth + 1 });
          }
        }
      }

      await page.close();
    } catch (err) {
      console.log(`   ❌ Failed: ${err.message}`);
      results.push({ url, file: null, status: `error: ${err.message}` });
    }
  }

  await browser.close();

  // ─── Summary ─────────────────────────────────────────────────
  const succeeded = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status !== "ok").length;

  console.log(`\n────────────────────────────────────────`);
  console.log(`✅ Done! ${succeeded} screenshots saved, ${failed} failed`);
  console.log(`📁 Output: ${path.resolve(config.outputDir)}`);

  if (queue.length > 0) {
    console.log(`⚠️  ${queue.length} URLs remaining (hit maxPages limit of ${config.maxPages})`);
  }
  console.log();

  // Save manifest
  const manifest = {
    crawledAt: new Date().toISOString(),
    startUrl,
    config: {
      format: config.format,
      quality: config.quality,
      viewport: `${config.viewportWidth}x${config.viewportHeight}`,
      fullPage: config.fullPage,
    },
    pages: results,
  };
  fs.writeFileSync(
    path.join(config.outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`📋 Manifest saved: ${path.join(config.outputDir, "manifest.json")}\n`);
}

// ─── Run ─────────────────────────────────────────────────────────
crawlAndScreenshot().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
