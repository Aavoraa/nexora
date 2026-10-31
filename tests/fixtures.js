// Minimal, structurally valid media files built in memory for tests.

function box(type, ...payload) {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

const u32 = (...n) => { const b = Buffer.alloc(4 * n.length); n.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4)); return b; };
const i32 = (...n) => { const b = Buffer.alloc(4 * n.length); n.forEach((v, i) => b.writeInt32BE(v, i * 4)); return b; };

/**
 * An MP4/MOV with one video track. `rotate90` stores the frame landscape with a 90°
 * matrix, the way phones save portrait video.
 */
export function makeVideo({ width = 1920, height = 1080, seconds = 12, codec = 'avc1', rotate90 = false,
  brand = 'isom', moovAtEnd = false, padBytes = 0 } = {}) {
  const timescale = 1000;
  const mvhd = box('mvhd', u32(0, 0, 0, timescale, seconds * timescale), Buffer.alloc(80));
  const matrix = rotate90
    ? i32(0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000)
    : i32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
  const tkhd = box('tkhd', u32(0, 0, 0, 1, 0, seconds * timescale), Buffer.alloc(8), Buffer.alloc(8),
    matrix, u32(width * 65536, height * 65536));
  const hdlr = box('hdlr', u32(0, 0), Buffer.from('vide'), Buffer.alloc(12), Buffer.from('VideoHandler\0'));
  const stsd = box('stsd', u32(0, 1), box(codec, Buffer.alloc(78)));
  const trak = box('trak', tkhd, box('mdia', hdlr, box('minf', box('stbl', stsd))));
  const moov = box('moov', mvhd, trak);
  const ftyp = box('ftyp', Buffer.from(brand.padEnd(4)), u32(0), Buffer.from('isommp42'));
  const mdat = box('mdat', Buffer.alloc(1024 + padBytes));
  return moovAtEnd ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
}

export function makePng(width = 1080, height = 1350) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.concat([u32(13), Buffer.from('IHDR'), u32(width, height), Buffer.from([8, 6, 0, 0, 0]), u32(0)]);
  return Buffer.concat([sig, ihdr, Buffer.alloc(64)]);
}

export function makeJpeg(width = 1080, height = 1080) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(9)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, ...Array(9).fill(0)]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

export function makeWebpLossless(width = 800, height = 600) {
  const bits = Buffer.alloc(4);
  bits.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 0);
  const chunk = Buffer.concat([Buffer.from('VP8L'), u32(0), Buffer.from([0x2f]), bits, Buffer.alloc(16)]);
  return Buffer.concat([Buffer.from('RIFF'), u32(0), Buffer.from('WEBP'), chunk]);
}

/** read(start, len) over an in-memory buffer, for the inspector. */
export const reader = (buf) => async (start, len) => buf.subarray(start, start + len);
