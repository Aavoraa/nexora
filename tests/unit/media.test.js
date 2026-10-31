import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from '../../server/mediainfo.js';
import { readiness, aspectLabel } from '../../server/platforms.js';
import { makeVideo, makePng, makeJpeg, makeWebpLossless, reader } from '../fixtures.js';

const look = (buf) => inspect(reader(buf), buf.length);

test('reads MP4 dimensions, duration and codec', async () => {
  const info = await look(makeVideo({ width: 1920, height: 1080, seconds: 12 }));
  assert.deepEqual(info, { kind: 'video', mime: 'video/mp4', width: 1920, height: 1080, duration_ms: 12000, codec: 'avc1' });
});

test('portrait phone video stored with a rotation matrix is reported as portrait', async () => {
  const info = await look(makeVideo({ width: 1920, height: 1080, rotate90: true, codec: 'hvc1', brand: 'qt  ' }));
  assert.equal(info.mime, 'video/quicktime');
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.equal(info.codec, 'hvc1');
});

test('finds moov at the end of the file', async () => {
  const info = await look(makeVideo({ moovAtEnd: true, padBytes: 200_000, seconds: 30 }));
  assert.equal(info.duration_ms, 30000);
});

test('reads PNG, JPEG and WebP dimensions', async () => {
  assert.deepEqual(await look(makePng(1080, 1350)), { kind: 'image', mime: 'image/png', width: 1080, height: 1350 });
  assert.deepEqual(await look(makeJpeg(640, 480)), { kind: 'image', mime: 'image/jpeg', width: 640, height: 480 });
  assert.deepEqual(await look(makeWebpLossless(800, 600)), { kind: 'image', mime: 'image/webp', width: 800, height: 600 });
});

test('rejects files that are not supported media, whatever their name', async () => {
  assert.equal(await look(Buffer.from('%PDF-1.7 not a video')), null);
  assert.equal(await look(Buffer.from('GIF89a......')), null);
  assert.equal(await look(Buffer.alloc(0)), null);
});

test('aspect labels', () => {
  assert.equal(aspectLabel(1080, 1920), '9:16');
  assert.equal(aspectLabel(1080, 1350), '4:5');
  assert.equal(aspectLabel(1920, 1080), '16:9');
  assert.equal(aspectLabel(1000, 1000), '1:1');
});

test('readiness: vertical short video suits reels-style networks', () => {
  const r = readiness({ kind: 'video', width: 1080, height: 1920, duration_ms: 30_000, codec: 'avc1' });
  assert.equal(r.tiktok.ok, true);
  assert.equal(r.instagram.ok, true);
  assert.equal(r.x.ok, true);
});

test('readiness: long landscape HEVC video gets specific warnings', () => {
  const r = readiness({ kind: 'video', width: 1920, height: 1080, duration_ms: 300_000, codec: 'hvc1' });
  assert.equal(r.tiktok.ok, false);
  assert.match(r.tiktok.note, /vertical/);
  assert.match(r.x.note, /longer than 2 min/);
  assert.match(r.x.note, /HEVC/);
  assert.equal(r.youtube.ok, true);
});

test('readiness: images flag video-only networks and crop risk', () => {
  const r = readiness({ kind: 'image', width: 1920, height: 600 });
  assert.match(r.youtube.note, /needs a video/);
  assert.match(r.instagram.note, /cropped/);
});
