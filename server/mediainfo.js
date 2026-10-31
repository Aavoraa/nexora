/**
 * Identify an uploaded file from its own bytes and read its dimensions, duration and codec.
 * Pure parsing over a `read(start, length)` function, so it works on local files and on
 * ranged object-storage reads alike. No ffmpeg needed.
 */

const MAX_MOOV = 64 * 1024 * 1024;

/**
 * @param {(start:number, length:number) => Promise<Buffer>} read
 * @param {number} size  total file size in bytes
 * @returns {Promise<null | {kind:'video'|'image', mime:string, width:number, height:number,
 *   duration_ms?:number, codec?:string}>}  null when the file isn't a supported type
 */
export async function inspect(read, size) {
  const head = await read(0, Math.min(size, 64 * 1024));
  if (head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp') return inspectIsoBmff(read, size, head);
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return png(head);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return jpeg(read, size);
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return webp(head);
  return null;
}

// ---------- images ----------

function png(buf) {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { kind: 'image', mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

async function jpeg(read, size) {
  let pos = 2;
  for (let i = 0; i < 500 && pos + 9 < size; i++) {
    const seg = await read(pos, 9);
    if (seg[0] !== 0xff) return null;
    const marker = seg[1];
    if (marker === 0xff) { pos += 1; continue; } // fill byte
    if (SOF.has(marker)) {
      return { kind: 'image', mime: 'image/jpeg', height: seg.readUInt16BE(5), width: seg.readUInt16BE(7) };
    }
    pos += 2 + seg.readUInt16BE(2);
  }
  return null;
}

function webp(buf) {
  const chunk = buf.toString('latin1', 12, 16);
  let width;
  let height;
  if (chunk === 'VP8 ' && buf.length >= 30) {
    width = buf.readUInt16LE(26) & 0x3fff;
    height = buf.readUInt16LE(28) & 0x3fff;
  } else if (chunk === 'VP8L' && buf.length >= 25) {
    const b = buf.readUInt32LE(21);
    width = (b & 0x3fff) + 1;
    height = ((b >> 14) & 0x3fff) + 1;
  } else if (chunk === 'VP8X' && buf.length >= 30) {
    width = buf.readUIntLE(24, 3) + 1;
    height = buf.readUIntLE(27, 3) + 1;
  } else {
    return null;
  }
  return { kind: 'image', mime: 'image/webp', width, height };
}

// ---------- MP4 / MOV (ISO base media file format) ----------

/** Iterate boxes inside `buf` between start and end. */
function* boxes(buf, start = 0, end = buf.length) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    yield { type, start: pos + header, end: pos + size };
    pos += size;
  }
}

const child = (buf, box, type) => {
  for (const b of boxes(buf, box.start, box.end)) if (b.type === type) return b;
  return null;
};

async function inspectIsoBmff(read, size, head) {
  const brand = head.toString('latin1', 8, 12);
  // Walk top-level boxes using small header reads; `moov` is often at the end of phone videos.
  let pos = 0;
  let moov = null;
  for (let i = 0; i < 1000 && pos + 8 <= size; i++) {
    const h = await read(pos, 16);
    if (h.length < 8) break;
    let boxSize = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    if (boxSize === 1) boxSize = Number(h.readBigUInt64BE(8));
    else if (boxSize === 0) boxSize = size - pos;
    if (boxSize < 8) break;
    if (type === 'moov') {
      if (boxSize > MAX_MOOV) return null;
      moov = await read(pos, boxSize);
      break;
    }
    pos += boxSize;
  }
  if (!moov) return null;

  const root = [...boxes(moov)][0];
  const mvhd = child(moov, root, 'mvhd');
  if (!mvhd) return null;
  const v = moov[mvhd.start];
  const timescale = moov.readUInt32BE(mvhd.start + (v === 1 ? 20 : 12));
  const duration = v === 1 ? Number(moov.readBigUInt64BE(mvhd.start + 24)) : moov.readUInt32BE(mvhd.start + 16);

  for (const trak of boxes(moov, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    if (!hdlr || moov.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue;

    const tkhd = child(moov, trak, 'tkhd');
    const tv = moov[tkhd.start];
    const m = tkhd.start + (tv === 1 ? 52 : 40); // start of the 3x3 matrix
    const a = moov.readInt32BE(m);
    const b = moov.readInt32BE(m + 4);
    let width = Math.round(moov.readUInt32BE(m + 36) / 65536);
    let height = Math.round(moov.readUInt32BE(m + 40) / 65536);
    // Phones record landscape frames with a 90° rotation matrix for portrait video.
    if (a === 0 && Math.abs(b) === 0x10000) [width, height] = [height, width];

    const stsd = child(moov, child(moov, child(moov, mdia, 'minf') || mdia, 'stbl') || mdia, 'stsd');
    const codec = stsd ? moov.toString('latin1', stsd.start + 12, stsd.start + 16) : '';

    return {
      kind: 'video',
      mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4',
      width,
      height,
      duration_ms: timescale ? Math.round((duration / timescale) * 1000) : 0,
      codec: codec.trim(),
    };
  }
  return null;
}
