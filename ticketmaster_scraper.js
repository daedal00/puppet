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
      url.includes("/api/") // Catching all API calls for debug
    ) {
      try {
        // Try to fetch buffer; handle ProtocolError if resource is gone
        let buffer;
        try {
          buffer = await response.buffer();
        } catch (e) {
          if (
            e.message.includes("No data found for resource") ||
            e.message.includes("Protocol error")
          ) {
            // Ignore these common race conditions
            return;
          }
          throw e;
        }

        const json = JSON.parse(buffer.toString());

        // DEBUG: Log ALL JSON to see where prices are
        // Filter out huge useless things if needed, but best to capture all for a moment
        /*
        if (config.debug_dump || true) {
          // Force true for this debug step
          const logEntry = {
            url: url,
            data: json,
          };
          fs.appendFileSync(
            "debug_network.json",
            JSON.stringify(logEntry) + "\n",
          );
        }
        */

        // Parse both Facets (Summary) and Embedded Offers (Detail)

        const outputFilename = "scraped_results.csv";
        const timestamp = new Date().toISOString();

        // 1. Extract Event ID & Name
        const eventIdMatch = config.target_url.match(/event\/([A-Z0-9]+)/i);
        const eventId = eventIdMatch ? eventIdMatch[1] : "Unknown";
        let eventName = "Unknown";
        try {
          eventName = (await page.title()).replace(/,|"/g, "");
        } catch (e) {}

        let csvContent = "";

        // Helper
        const writeLine = (
          section,
          row,
          seats,
          qty,
          total,
          list,
          face,
          cur,
          fee,
          type,
          notes,
          offerId,
          listId,
        ) => {
          // Timestamp,EventID,EventName,Section,Row,Seats,Qty,TotalPrice,ListPrice,FaceValue,Currency,TotalFees,Type,SellerNotes,OfferID,ListingID
          // Escape quotes in notes/desc
          const safeNotes = (notes || "").replace(/"/g, '""');
          return `"${timestamp}","${eventId}","${eventName}","${section}","${row}","${seats}","${qty}","${total}","${list}","${face}","${cur}","${fee}","${type}","${safeNotes}","${offerId}","${listId}"\n`;
        };

        // A. Check for Detailed Offers (The Holy Grail)
        let detailedFound = false;
        if (
          json._embedded &&
          json._embedded.offer &&
          Array.isArray(json._embedded.offer)
        ) {
          console.log(
            `[INFO] Found ${json._embedded.offer.length} detailed offers!`,
          );
          json._embedded.offer.forEach((offer) => {
            const section = offer.section || "N/A";
            const row = offer.row || "N/A";
            const seatFrom = offer.seatFrom || "";
            const seatTo = offer.seatTo || "";
            const seats =
              seatFrom && seatTo ? `${seatFrom}-${seatTo}` : seatFrom || "N/A";

            // Quantity
            let qty = 1;
            if (
              offer.sellableQuantities &&
              Array.isArray(offer.sellableQuantities) &&
              offer.sellableQuantities.length > 0
            ) {
              qty = Math.max(...offer.sellableQuantities);
            } else if (seatFrom && seatTo) {
              const from = parseInt(seatFrom);
              const to = parseInt(seatTo);
              if (!isNaN(from) && !isNaN(to)) qty = to - from + 1;
            }

            // Pricing Details
            const total = offer.totalPrice || "N/A";
            const list = offer.listPrice || "N/A";
            const face = offer.faceValue || "N/A";
            const cur = offer.currency || "USD";

            // Calculate Fees
            let fee = 0;
            if (offer.charges && Array.isArray(offer.charges)) {
              fee = offer.charges.reduce((sum, c) => sum + (c.amount || 0), 0);
            } else if (total !== "N/A" && list !== "N/A") {
              fee = parseFloat(total) - parseFloat(list); // Approximation
            }
            fee = fee.toFixed(2);

            const type = offer.inventoryType || "primary";
            const notes = offer.sellerNotes || "";
            const offerId = offer.offerId || "N/A";
            const listId = offer.listingId || "N/A";

            csvContent += writeLine(
              section,
              row,
              seats,
              qty,
              total,
              list,
              face,
              cur,
              fee,
              type,
              notes,
              offerId,
              listId,
            );
          });
          detailedFound = true;
        }

        // B. Fallback to Facets - DISABLED to keep CSV clean
        // The user found these summary rows ('SummaryGroup', 'See Summary') useless and messy.
        // We only want rows with actual ticket data.
        if (!detailedFound && json.facets && Array.isArray(json.facets)) {
          // console.log(`[INFO] Ignored Facets summary (no detailed offers).`);
        }

        // Write to file
        if (csvContent) {
          if (!fs.existsSync(outputFilename)) {
            fs.writeFileSync(
              outputFilename,
              "Timestamp,EventID,EventName,Section,Row,Seats,Qty,TotalPrice,ListPrice,FaceValue,Currency,TotalFees,Type,SellerNotes,OfferID,ListingID\n",
            );
          }
          fs.appendFileSync(outputFilename, csvContent);
          console.log(`[SUCCESS] Appended results to ${outputFilename}`);
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
