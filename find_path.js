const fs = require("fs");

try {
  const content = fs.readFileSync("debug_excerpt.json", "utf8");
  const root = JSON.parse(content);
  const data = root.data;

  console.log("Top Level Keys:", Object.keys(data));

  function scan(obj, path) {
    if (!obj || typeof obj !== "object") return;

    if (obj.offerId && obj.section) {
      console.log("FOUND OFFER AT:", path);
      // Print one sample
      console.log(JSON.stringify(obj).substring(0, 200));
      return; // Don't recurse into the offer itself
    }

    Object.keys(obj).forEach((key) => {
      scan(obj[key], path ? `${path}.${key}` : key);
    });
  }

  scan(data, "");
} catch (e) {
  console.error("Error:", e.message);
}
