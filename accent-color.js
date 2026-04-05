"use strict";

const sharp = require("sharp");

const HUE_BINS = 24;

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) {
    return { h: 0, s: 0, l };
  }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max - min);
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r, g, b) {
  return `#${[r, g, b]
    .map((x) => clampByte(x).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Picks a saturated “accent” from a raster image (PNG/JPEG/WebP buffer).
 * @param {Buffer} imageBuffer
 * @returns {Promise<{ hex: string; rgb: { r: number; g: number; b: number } } | null>}
 */
async function extractAccentColor(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    return null;
  }

  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .resize(48, 48, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const bucketScore = new Array(HUE_BINS).fill(0);
  const bucketR = new Array(HUE_BINS).fill(0);
  const bucketG = new Array(HUE_BINS).fill(0);
  const bucketB = new Array(HUE_BINS).fill(0);
  const bucketW = new Array(HUE_BINS).fill(0);

  let fallbackR = 0;
  let fallbackG = 0;
  let fallbackB = 0;
  let fallbackW = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const a = channels >= 4 ? data[i + 3] / 255 : 1;
      if (a < 0.12) {
        continue;
      }

      const { h: hue, s, l } = rgbToHsl(r, g, b);

      const satBoost = s * s;
      const lightGate = Math.sin(Math.PI * l);
      const wSoft = satBoost * lightGate;

      if (s >= 0.12 && l >= 0.05 && l <= 0.98) {
        fallbackR += data[i] * wSoft;
        fallbackG += data[i + 1] * wSoft;
        fallbackB += data[i + 2] * wSoft;
        fallbackW += wSoft;
      }

      if (s < 0.18 || l < 0.06 || l > 0.97) {
        continue;
      }

      const bin = Math.min(
        HUE_BINS - 1,
        Math.floor((hue / 360) * HUE_BINS)
      );
      bucketScore[bin] += wSoft;
      bucketR[bin] += data[i] * wSoft;
      bucketG[bin] += data[i + 1] * wSoft;
      bucketB[bin] += data[i + 2] * wSoft;
      bucketW[bin] += wSoft;
    }
  }

  let bestBin = -1;
  let bestScore = 0;
  for (let b = 0; b < HUE_BINS; b++) {
    if (bucketScore[b] > bestScore) {
      bestScore = bucketScore[b];
      bestBin = b;
    }
  }

  let rr;
  let gg;
  let bb;
  if (bestBin >= 0 && bestScore > 0 && bucketW[bestBin] > 0) {
    const w = bucketW[bestBin];
    rr = bucketR[bestBin] / w;
    gg = bucketG[bestBin] / w;
    bb = bucketB[bestBin] / w;
  } else if (fallbackW > 0) {
    rr = fallbackR / fallbackW;
    gg = fallbackG / fallbackW;
    bb = fallbackB / fallbackW;
  } else {
    return null;
  }

  const rOut = clampByte(rr);
  const gOut = clampByte(gg);
  const bOut = clampByte(bb);
  return {
    hex: toHex(rOut, gOut, bOut),
    rgb: { r: rOut, g: gOut, b: bOut },
  };
}

module.exports = { extractAccentColor };
