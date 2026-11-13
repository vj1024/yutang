import {koiBodyPoint} from './koi-motion.js';

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function inkBounds(canvas) {
  const {width, height} = canvas;
  const pixels = canvas.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : {left, top, width:right - left + 1, height:bottom - top + 1};
}

// Put the chosen swimming direction along +x and remove only empty pixels.
export function alignFreeformDrawing(canvas, bounds, heading) {
  if (!bounds) return null;
  const {left, top, width, height} = bounds;
  const c = Math.abs(Math.cos(heading)), s = Math.abs(Math.sin(heading));
  const aligned = surface(Math.ceil(width * c + height * s) + 2, Math.ceil(width * s + height * c) + 2);
  const ctx = aligned.getContext('2d', {willReadFrequently:true});
  ctx.translate(aligned.width / 2, aligned.height / 2);
  ctx.rotate(-heading);
  ctx.drawImage(canvas, left, top, width, height, -width / 2, -height / 2, width, height);
  const crop = inkBounds(aligned);
  const art = surface(crop.width, crop.height);
  art.getContext('2d').drawImage(aligned, -crop.left, -crop.top);
  return art;
}

// A point on the leading edge is also the fish's feeding point. Use a real
// painted pixel even for a forked or crescent-shaped head.
export function freeformMouth(canvas) {
  const {width, height} = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const diagonal = Math.hypot(width, height);
  for (let x = width - 1; x >= 0; x--) {
    let nearest = -1;
    for (let y = 0; y < height; y++) {
      if (pixels[(y * width + x) * 4 + 3] >= 32 &&
          (nearest < 0 || Math.abs(y + .5 - height / 2) < Math.abs(nearest + .5 - height / 2))) nearest = y;
    }
    if (nearest >= 0) return {x:(x + .5 - width / 2) / diagonal, y:(nearest + .5 - height / 2) / diagonal};
  }
  return {x:width / (2 * diagonal), y:0};
}

export function prepareFreeformArt(image) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const art = surface(width, height), ctx = art.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const light = ctx.createLinearGradient(0, 0, 0, height);
  light.addColorStop(0, 'rgba(19,64,60,.18)');
  light.addColorStop(.42, 'rgba(255,250,214,.10)');
  light.addColorStop(1, 'rgba(16,57,56,.24)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);
  return art;
}

// Both axes use the same rest scale. Wide fins and tall drawings fit within
// the simulation's existing bank clearance without changing their proportions.
export function freeformSpinePoint(fish, u, widthFraction) {
  const p = koiBodyPoint(fish, u);
  return {
    x:(p.x - fish.length * .02) * widthFraction / .78,
    y:p.y * widthFraction / .78,
  };
}

const poses = new WeakMap();

export function drawFreeformFish(ctx, fish, art, shadow, quality) {
  let pose = poses.get(fish);
  if (!pose) {
    pose = {body:surface(1, 1), shade:surface(1, 1)};
    poses.set(fish, pose);
  }
  const {length, phase, bodyBend, swimAmplitude} = fish;
  if (pose.art !== art || pose.phase !== phase || pose.bend !== bodyBend ||
      pose.amplitude !== swimAmplitude || pose.length !== length || pose.quality !== quality) {
    const diagonal = Math.hypot(art.width, art.height);
    const widthFraction = art.width / diagonal, height = length * art.height / diagonal;
    const extent = length * 1.36;
    const pixels = Math.ceil(Math.min(640, extent * (quality === 'low' ? 1 : 2)));
    const buffer = pose.body, b = buffer.getContext('2d');
    if (buffer.width !== pixels) buffer.width = buffer.height = pixels;
    b.resetTransform();
    b.clearRect(0, 0, pixels, pixels);
    const scale = pixels / extent;
    b.setTransform(scale, 0, 0, scale, pixels / 2, pixels / 2);
    const strips = Math.min(art.width, quality === 'low' ? 16 : 36);
    const sourceStep = art.width / strips;
    let previous = freeformSpinePoint(fish, 0, widthFraction);
    // Neighboring affine strips meet along the same vertical edge. A tiny
    // source overlap covers subpixel raster seams before applying depth alpha.
    for (let i = 0; i < strips; i++) {
      const next = freeformSpinePoint(fish, (i + 1) / strips, widthFraction);
      const dx = (next.x - previous.x) / sourceStep;
      const dy = (next.y - previous.y) / sourceStep;
      const sx = i * sourceStep;
      const sw = sourceStep + Math.min(art.width - sx - sourceStep, .65 / (scale * dx));
      b.save();
      b.transform(dx, dy, 0, height / art.height, previous.x, previous.y - height / 2);
      b.drawImage(art, sx, 0, sw, art.height, 0, 0, sw, art.height);
      b.restore();
      previous = next;
    }
    // Downsample the actual bent silhouette for a softer underwater shadow.
    const shade = pose.shade, size = Math.max(8, Math.ceil(pixels / 5));
    if (shade.width !== size) shade.width = shade.height = size;
    const sh = shade.getContext('2d');
    sh.clearRect(0, 0, size, size);
    sh.drawImage(buffer, 0, 0, size, size);
    sh.globalCompositeOperation = 'source-in';
    sh.fillStyle = '#083c36';
    sh.fillRect(0, 0, size, size);
    sh.globalCompositeOperation = 'source-over';
    Object.assign(pose, {art, phase, bend:bodyBend, amplitude:swimAmplitude, length, quality, extent});
  }
  ctx.drawImage(shadow ? pose.shade : pose.body, -pose.extent / 2, -pose.extent / 2, pose.extent, pose.extent);
}
