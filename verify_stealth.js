const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1920,1080",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  console.log("Navigating to https://bot.sannysoft.com...");
  await page.goto("https://bot.sannysoft.com", { waitUntil: "networkidle0" });

  console.log("Taking screenshot...");
  await page.screenshot({ path: "sannysoft_result.png", fullPage: true });

  // Also parse some text to see result
  const failedTests = await page.evaluate(() => {
    const failed = [];
    document
      .querySelectorAll(".failed")
      .forEach((el) => failed.push(el.innerText));
    return failed;
  });

  if (failedTests.length > 0) {
    console.log("Failed tests detected:", failedTests);
  } else {
    console.log(
      "No obvious failures detected via CSS class '.failed' (Manual review of screenshot recommended).",
    );
  }

  await browser.close();
})();
