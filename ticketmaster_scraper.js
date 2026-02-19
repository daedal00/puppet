const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const https = require("https");

puppeteer.use(StealthPlugin());

let config;
try {
  config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
} catch (e) {
  console.error("Error reading config.json");
  process.exit(1);
}

// Kill-Switch / Pre-flight Check
function checkIP() {
  return new Promise((resolve, reject) => {
    https
      .get("https://api64.ipify.org?format=json", (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json.ip);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

async function run() {
  // 1. Pre-flight IP Check
  console.log("Performing Pre-flight IP Check...");
  try {
    const currentIP = await checkIP();
    console.log(`Current External IP: ${currentIP}`);

    if (config.home_ip && currentIP === config.home_ip) {
      console.error(
        "CRITICAL: Current IP matches Home IP! Kill-switch activated.",
      );
      process.exit(1);
    }
    console.log("IP Check Passed. Proceeding...");
  } catch (e) {
    console.error("Failed to check IP:", e.message);
    // Fail safe? Or proceed if local binding is trusted?
    // User said: "If the returned IP matches my home Ethernet IP... process.exit(1)"
    // If check fails, we might warn but maybe proceed if we trust the binding?
    // Let's safe fail.
    process.exit(1);
  }

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-blink-features=AutomationControlled",
  ];

  // Network Binding
  if (config.local_ip) {
    // Chromium flag for binding to interface?
    // The user specifically asked for: --local-address=172.20.10.10
    // We will pass this EXACT argument as requested.
    args.push(`--local-address=${config.local_ip}`);
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: args,
    ignoreDefaultArgs: ["--enable-automation"],
    executablePath: "/usr/bin/chromium", // Updated for Arch
  });

  const page = await browser.newPage();

  // Stealth Setup
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );
  await page.setViewport({ width: 1920, height: 1080 });

  // Keep-Alive
  setInterval(async () => {
    try {
      // Ping google via page evaluation or separate request?
      // User said: "Add a setInterval that pings google.com via the mobile interface"
      // We can do a fetch inside the page context
      await page.evaluate(() => {
        fetch("https://www.google.com/generate_204", { mode: "no-cors" }).catch(
          () => {},
        );
      });
    } catch (e) {}
  }, 20000);

  // Network Interception
  page.on("response", async (response) => {
    const url = response.url();
    if (
      url.includes("/api/ismds/event/") ||
      (url.includes("facets") && url.includes("apikey="))
    ) {
      try {
        const buffer = await response.buffer();
        const json = JSON.parse(buffer.toString());

        // Print resale ticket prices
        if (json.facets) {
          console.log(JSON.stringify({ facets: json.facets }));

          // --- CSV Output Logic ---
          const outputFilename = "scraped_results.csv";

          // 1. Extract Event ID
          // URL ex: .../event/11006363A5897986
          const eventIdMatch = config.target_url.match(/event\/([A-Z0-9]+)/i);
          const eventId = eventIdMatch ? eventIdMatch[1] : "Unknown";

          // 2. Extract Event Name (From Page Title or Config)
          // We'll use the page title which we access below, or try to guess from URL
          const eventName = (await page.title()).replace(/,|"/g, ""); // Simple sanitize

          // 3. Extract Resale Stats
          // Facets structure is complex, let's try to find "resale" inventory type
          let resaleCount = 0;
          let minPrice = "N/A";

          // Attempt to find resale count in facets (inventoryType)
          // Structure assumption: facets.inventoryType is an array of objects
          if (Array.isArray(json.facets.inventoryType)) {
            const resaleType = json.facets.inventoryType.find(
              (t) => t.name === "resale" || t.name === "resale ticket",
            );
            if (resaleType) resaleCount = resaleType.count;
          }

          // Attempt to find min price
          // facets.prices might have min/max
          if (Array.isArray(json.facets.prices)) {
            const priceObj = json.facets.prices.find((p) => p.min);
            if (priceObj) minPrice = priceObj.min;
          }

          const timestamp = new Date().toISOString();
          const csvLine = `"${timestamp}","${eventId}","${eventName}","${config.target_url}","${resaleCount}","${minPrice}"\n`;

          // Check if header needs to be written
          if (!fs.existsSync(outputFilename)) {
            fs.writeFileSync(
              outputFilename,
              "Timestamp,EventID,EventName,TargetURL,ResaleCount,MinPrice\n",
            );
          }

          fs.appendFileSync(outputFilename, csvLine);
          console.log(`[SUCCESS] Appended result to ${outputFilename}`);
        }
      } catch (err) {
        console.error("Error parsing/writing CSV:", err);
      }
    }
  });

  try {
    const targetUrl = process.argv[2] || config.target_url;
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // MapsWithStealth logic?
    // User didn't explicitly ask for MapsWithStealth in the "Prompt", but "Stealth Setup" implied.
    // I will add basic interaction to keep it alive/human-like if needed, but user instruction was specific.
  } catch (err) {
    console.error("Navigation error:", err);
  }

  // Do not close browser automatically so keep-alive runs?
  // "Keep-Alive: Add a setInterval... to prevent... sleep" implies long running.
}

run();
