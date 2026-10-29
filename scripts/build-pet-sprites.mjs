// Asset maintenance only. Install sharp locally or set SHARP_MODULE_PATH to its module directory.
// node scripts/build-pet-sprites.mjs <pet-id> <imagegen-3x2-sheet.png>
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE_PATH || 'sharp');
const size = 384;
const catalog = {
  'cream-cat': {
    eyes: [[456, 505], [749, 423]], nose: [618, 493], mouth: [627, 556, 104, 78],
    frames: [
      [264, 199, 199, 202, 322, 166], [263, 199, 195, 207, 326, 171],
      [274, 199, 202, 204, 329, 167], [264, 200, 195, 218, 325, 181],
      [263, 200, 195, 217, 325, 181], [263, 200, 193, 219, 326, 181],
    ],
  },
  shiba: {
    eyes: [[415, 466], [737, 554]], nose: [549, 552], mouth: [560, 636, 115, 108],
    frames: [
      [224, 222, 173, 190, 302, 226], [209, 224, 157, 190, 291, 226],
      [204, 224, 154, 189, 285, 225], [225, 229, 173, 198, 302, 234],
      [214, 230, 161, 194, 296, 231], [208, 231, 155, 194, 289, 231],
    ],
  },
  'lop-rabbit': {
    eyes: [[433, 401], [727, 488]], nose: [547, 490], mouth: [550, 539, 97, 77],
    frames: [
      [250, 202, 198, 170, 330, 203], [242, 206, 186, 170, 318, 207],
      [238, 204, 183, 170, 316, 203], [250, 205, 198, 177, 330, 210],
      [247, 207, 192, 179, 324, 213], [238, 210, 184, 180, 316, 213],
    ],
  },
  'little-fox': {
    eyes: [[355, 529], [640, 595]], nose: [484, 624], mouth: [483, 664, 112, 69],
    frames: [
      [212, 246, 166, 211, 279, 238], [211, 247, 163, 216, 278, 243],
      [212, 246, 163, 208, 282, 235], [214, 248, 165, 219, 280, 247],
      [214, 250, 163, 220, 280, 248], [212, 250, 160, 221, 279, 249],
    ],
  },
};
const [id, source] = process.argv.slice(2), config = catalog[id];
if (id === '--preview') {
  const items=[];
  for (const [row,petId] of Object.keys(catalog).entries()) for (let col=0;col<5;col++) {
    const path=fileURLToPath(new URL(`../public/assets/pets/${petId}-expressions-v2.webp`,import.meta.url));
    const input=await sharp(path).extract({left:col*size,top:0,width:size,height:size}).resize(240).toBuffer();
    items.push({input,left:col*240,top:row*240});
  }
  await mkdir(new URL('../docs/assets/',import.meta.url),{recursive:true});
  await sharp({create:{width:1200,height:960,channels:4,background:'#edf2e7'}}).composite(items).webp({quality:90})
    .toFile(fileURLToPath(new URL('../docs/assets/pet-expressions-v2.webp',import.meta.url)));
  console.log('Saved docs/assets/pet-expressions-v2.webp');
  process.exit(0);
}
if (!config || !source) throw new Error('Usage: node scripts/build-pet-sprites.mjs <pet-id> <3x2-sheet.png>');
const basePath = fileURLToPath(new URL(`../public/assets/pets/${id}-v1.png`, import.meta.url));
const baseMeta = await sharp(basePath).metadata();
const { data: base } = await sharp(basePath).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { data: sheet, info } = await sharp(resolve(source)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.width % 3 || info.height % 2 || info.width / 3 !== info.height / 2) throw new Error('Expected equal square cells in a 3x2 sheet.');
const cell = info.width / 3, sourceScale = cell / 512, targetScale = size / baseMeta.width;
const targetEyes = config.eyes.map(point => point.map(n => n * targetScale));
const [noseX, noseY] = config.nose.map(n => n * targetScale);
const targetAngle = Math.atan2(targetEyes[1][1] - targetEyes[0][1], targetEyes[1][0] - targetEyes[0][0]);
const targetDistance = Math.hypot(targetEyes[1][0] - targetEyes[0][0], targetEyes[1][1] - targetEyes[0][1]);
function ellipse(x, y, cx, cy, rx, ry) {
  const radius = Math.hypot((x - cx) / rx, (y - cy) / ry);
  const t = Math.max(0, Math.min(1, (1 - radius) / .18));
  return t * t * (3 - 2 * t);
}
const frames = [base];
for (let frame = 0; frame < 6; frame++) {
  const [sx, sy, lx, ly, rx, ry] = config.frames[frame].map(n => n * sourceScale);
  const angle = targetAngle - Math.atan2(ry - ly, rx - lx);
  const scale = targetDistance / Math.hypot(rx - lx, ry - ly);
  const c = Math.cos(angle), s = Math.sin(angle), blink = frame >= 4;
  const result = blink ? Buffer.alloc(base.length) : Buffer.from(base);
  const col = frame % 3 * cell, row = Math.floor(frame / 3) * cell;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Feathered face patches keep the original body, outline, cheeks and accessories intact.
    const eyes = Math.max(...targetEyes.map(([ex, ey]) => ellipse(x, y, ex, ey - 2, 89 * targetScale, 105 * targetScale)));
    const [mx, my, mw, mh] = config.mouth.map(n => n * targetScale);
    const weight = Math.max(eyes, blink ? 0 : ellipse(x, y, mx, my, mw, mh));
    if (!weight) continue;
    const dx = (x - noseX) / scale, dy = (y - noseY) / scale;
    const u = sx + c * dx + s * dy, v = sy - s * dx + c * dy;
    if (u < 0 || v < 0 || u >= cell - 1 || v >= cell - 1) continue;
    const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy, p = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const at = (a, b) => sheet[((row + b) * info.width + col + a) * 4 + channel];
      const sample = at(ix, iy) * (1-fx)*(1-fy) + at(ix+1, iy)*fx*(1-fy) + at(ix, iy+1)*(1-fx)*fy + at(ix+1, iy+1)*fx*fy;
      result[p + channel] = blink ? sample : sample * weight + base[p + channel] * (1 - weight);
    }
    result[p + 3] = blink ? Math.round(255 * weight) : base[p + 3];
  }
  frames.push(result);
}
const output = new URL(`../public/assets/pets/${id}-expressions-v2.webp`, import.meta.url);
await sharp({ create: { width: size * frames.length, height: size, channels: 4, background: '#00000000' } })
  .composite(frames.map((input, index) => ({ input, raw: { width: size, height: size, channels: 4 }, left: index * size, top: 0 })))
  .webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(fileURLToPath(output));
console.log(`${id}: seven ${size}px frames → ${output.pathname}`);
