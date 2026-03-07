/**
 * Post-build script: inline all JS/CSS into HTML files under out/.
 * Reduces HTTP requests to 1 (the HTML itself) + images + favicon.
 *
 * Usage: node scripts/inline-assets.js
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.resolve(__dirname, "..", "out");

function inlineAssets(htmlPath) {
  let html = fs.readFileSync(htmlPath, "utf-8");

  // Inline <link rel="stylesheet" href="...">
  html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*\/?>/g, (match, href) => {
    const file = path.join(OUT_DIR, href);
    if (!fs.existsSync(file)) {
      return match;
    }
    const css = fs.readFileSync(file, "utf-8");
    return `<style>${css}</style>`;
  });

  // Strip all <script> tags EXCEPT JSON-LD (pure static site, no JS needed)
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) =>
    match.includes("application/ld+json") ? match : "",
  );

  // Inline favicon as data URI
  html = html.replace(/<link\s+rel="icon"\s+href="([^"]+)"[^>]*\/?>/g, (match, href) => {
    const file = path.join(OUT_DIR, href);
    if (!fs.existsSync(file)) {
      return match;
    }
    const svg = fs.readFileSync(file, "utf-8");
    const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    return `<link rel="icon" href="${dataUri}" type="image/svg+xml"/>`;
  });

  // Remove <link rel="preload" as="script" ...> — no longer needed
  html = html.replace(/<link\s+rel="preload"\s+as="script"[^>]*\/?>/g, "");

  fs.writeFileSync(htmlPath, html, "utf-8");
  const sizeKB = (Buffer.byteLength(html, "utf-8") / 1024).toFixed(1);
  console.log(`  ${path.relative(OUT_DIR, htmlPath)} → ${sizeKB} KB (inlined)`);
}

// Process all HTML files
const htmlFiles = fs
  .readdirSync(OUT_DIR, { recursive: true })
  .filter((f) => f.endsWith(".html"))
  .map((f) => path.join(OUT_DIR, f));

console.log(`Inlining JS/CSS into ${htmlFiles.length} HTML file(s)...`);
htmlFiles.forEach(inlineAssets);
console.log("Done.");
