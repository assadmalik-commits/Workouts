// A minimal PNG reader, because the only honest instrument left is the pixels
// the compositor actually put on screen. Everything else in this repo measures
// what the app decided; a screencast frame measures what the lifter saw.
// Handles what CDP emits: 8-bit, non-interlaced, RGB or RGBA.
import zlib from 'zlib';

export function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8, width = 0, height = 0, depth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9];
      if (depth !== 8) throw new Error('unsupported bit depth ' + depth);
      if (data[12] !== 0) throw new Error('interlaced png unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error('unsupported colour type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { width, height, channels, data: out };
}

// The shade of a band across the middle of the frame, away from any status bar
// or bottom chrome the host might draw in its own colour.
export function shadeOf(png, band = 0.5) {
  const y = Math.floor(png.height * band);
  const stride = png.width * png.channels;
  let sum = 0, n = 0;
  for (let x = 0; x < png.width; x += 4) {
    const i = y * stride + x * png.channels;
    sum += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
    n++;
  }
  const mean = sum / n;
  return { mean: Math.round(mean), shade: mean < 110 ? 'DARK' : mean > 200 ? 'LIGHT' : 'mid' };
}
