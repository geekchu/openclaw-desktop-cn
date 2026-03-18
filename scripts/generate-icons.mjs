#!/usr/bin/env node
/**
 * Generate app icons from SVG source
 * Requires: sharp, png-to-ico
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, "../src-tauri/icons");
const svgPath = path.join(iconsDir, "favicon.svg");

// Read SVG content
const svgContent = fs.readFileSync(svgPath, "utf8");

// Icon sizes needed for Tauri
const sizes = [
  { name: "32x32.png", size: 32 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
  { name: "icon.png", size: 512 },
];

// ICO sizes (Windows)
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

async function generatePng(size, outputPath) {
  await sharp(Buffer.from(svgContent)).resize(size, size).png().toFile(outputPath);
  console.log(`Generated: ${outputPath} (${size}x${size})`);
}

async function generateIco(outputPath) {
  // Generate all sizes for ICO
  const pngBuffers = await Promise.all(
    icoSizes.map(async (size) => {
      return await sharp(Buffer.from(svgContent)).resize(size, size).png().toBuffer();
    }),
  );

  // Simple ICO file format
  // ICO header: 6 bytes
  // ICO directory entries: 16 bytes each
  // PNG data follows

  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;

  let offset = headerSize + dirSize;
  const entries = [];

  for (let i = 0; i < numImages; i++) {
    const size = icoSizes[i];
    const pngData = pngBuffers[i];
    entries.push({
      width: size >= 256 ? 0 : size,
      height: size >= 256 ? 0 : size,
      size: pngData.length,
      offset: offset,
      data: pngData,
    });
    offset += pngData.length;
  }

  // Build ICO file
  const totalSize = offset;
  const ico = Buffer.alloc(totalSize);

  // ICO header
  ico.writeUInt16LE(0, 0); // Reserved
  ico.writeUInt16LE(1, 2); // Type: 1 = ICO
  ico.writeUInt16LE(numImages, 4); // Number of images

  // Directory entries
  for (let i = 0; i < numImages; i++) {
    const entry = entries[i];
    const entryOffset = headerSize + i * dirEntrySize;
    ico.writeUInt8(entry.width, entryOffset); // Width
    ico.writeUInt8(entry.height, entryOffset + 1); // Height
    ico.writeUInt8(0, entryOffset + 2); // Color palette
    ico.writeUInt8(0, entryOffset + 3); // Reserved
    ico.writeUInt16LE(1, entryOffset + 4); // Color planes
    ico.writeUInt16LE(32, entryOffset + 6); // Bits per pixel
    ico.writeUInt32LE(entry.size, entryOffset + 8); // Size of image data
    ico.writeUInt32LE(entry.offset, entryOffset + 12); // Offset to image data
  }

  // Image data
  for (const entry of entries) {
    entry.data.copy(ico, entry.offset);
  }

  fs.writeFileSync(outputPath, ico);
  console.log(`Generated: ${outputPath} (${icoSizes.join(", ")}px)`);
}

async function main() {
  console.log("Generating icons from:", svgPath);
  console.log("Output directory:", iconsDir);
  console.log("");

  // Generate PNG files
  for (const { name, size } of sizes) {
    await generatePng(size, path.join(iconsDir, name));
  }

  // Generate ICO file
  await generateIco(path.join(iconsDir, "icon.ico"));

  console.log("");
  console.log("Done! Note: icon.icns (macOS) needs to be generated separately.");
  console.log("You can use: iconutil -c icns icon.iconset (on macOS)");
}

main().catch(console.error);
