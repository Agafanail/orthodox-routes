import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CHURCH_IMAGE_MAX_INPUT_BYTES, churchImageManifest, prepareChurchImage } from './process';

function syntheticImage(width = 64, height = 32) {
  return sharp({ create: { width, height, channels: 4, background: '#824a31aa' } });
}

describe('church photograph preparation', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('decodes and re-encodes real %s bytes without metadata', async (format) => {
    const input = await syntheticImage().toFormat(format).toBuffer();
    const result = await prepareChurchImage(input);
    expect(result.imageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.files.map((file) => file.role)).toEqual(['master', '480', '960', '1600']);
    for (const file of result.files) {
      const metadata = await sharp(file.data).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(file.width);
      expect(metadata.height).toBe(file.height);
      expect(file.width).toBe(64);
      expect(file.height).toBe(32);
      expect(file.contentType).toBe('image/webp');
      expect(file.objectKey).toBe(`${result.imageId}/${file.role}.webp`);
      expect(file.byteLength).toBe(file.data.length);
      expect(file.sha256).toBe(createHash('sha256').update(file.data).digest('hex'));
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
    expect(Object.keys(result).sort()).toEqual(['files', 'imageId']);
    const manifest = churchImageManifest(result);
    expect(manifest.imageId).toBe(result.imageId);
    expect(manifest.files).toHaveLength(4);
    for (const file of manifest.files) {
      expect(Object.keys(file).sort()).toEqual([
        'role', 'objectKey', 'contentType', 'width', 'height', 'byteLength', 'sha256',
      ].sort());
    }
  });

  it('normalizes EXIF orientation and removes identifying EXIF/XMP from every output', async () => {
    const input = await syntheticImage().withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: 'Synthetic private photographer' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 4/1 0/1',
          GPSLongitudeRef: 'E', GPSLongitude: '7/1 40/1 0/1' } })
      .withXmp('<x:xmpmeta>Synthetic private location</x:xmpmeta>')
      .jpeg().toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    for (const file of (await prepareChurchImage(input)).files) {
      const metadata = await sharp(file.data).metadata();
      expect([file.width, file.height]).toEqual([32, 64]);
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(file.data.includes(Buffer.from('Synthetic private'))).toBe(false);
    }
  });

  it.each([[1800, 900], [900, 1800]])('preserves aspect ratio without crop for %s x %s', async (width, height) => {
    const result = await prepareChurchImage(await syntheticImage(width, height).png().toBuffer());
    expect(result.files.map((file) => [file.width, file.height])).toEqual(
      width > height ? [[1800, 900], [480, 240], [960, 480], [1600, 800]]
        : [[900, 1800], [240, 480], [480, 960], [800, 1600]],
    );
  });

  it('uses distinct opaque paths even for identical photos and discards appended input data', async () => {
    const input = Buffer.concat([await syntheticImage().jpeg().toBuffer(), Buffer.from('private trailer')]);
    const first = await prepareChurchImage(input);
    const second = await prepareChurchImage(input);
    expect(first.imageId).not.toBe(second.imageId);
    for (const file of first.files) expect(file.data.includes(Buffer.from('private trailer'))).toBe(false);
  });

  it('reuses only a validated staged identifier for an unchanged processing retry', async () => {
    const input = await syntheticImage().png().toBuffer();
    const first = await prepareChurchImage(input);
    const retried = await prepareChurchImage(input, first.imageId);
    expect(churchImageManifest(retried)).toEqual(churchImageManifest(first));
  });

  it.each(['../another-image', 'https://example.invalid/image.webp'])('refuses an unsafe retry identifier %s', async (id) => {
    await expect(prepareChurchImage(await syntheticImage().png().toBuffer(), id)).rejects.toThrow();
  });

  it.each([
    Buffer.alloc(0), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    Buffer.from('GIF89a'), Buffer.from('%PDF-1.7'),
    Buffer.from([0xff, 0xd8, 0xff, 0x00]), Buffer.from('RIFF0000WEBPbad'),
  ])('rejects unsupported or corrupt bytes with a safe error', async (input) => {
    await expect(prepareChurchImage(input)).rejects.toThrow(/^Church photograph could not be prepared\.$/);
  });

  it('rejects file paths and URLs rather than reading them', async () => {
    await expect(prepareChurchImage('https://example.invalid/private.jpg' as unknown as Buffer))
      .rejects.toThrow('Church photograph could not be prepared.');
  });

  it('rejects oversized bytes, excessive dimensions/pixels and truncated raster input', async () => {
    await expect(prepareChurchImage(Buffer.alloc(CHURCH_IMAGE_MAX_INPUT_BYTES + 1))).rejects.toThrow();
    const tooWide = await syntheticImage(10001, 1).png().toBuffer();
    await expect(prepareChurchImage(tooWide)).rejects.toThrow();
    const tooManyPixels = await syntheticImage(5000, 5000).png().toBuffer();
    await expect(prepareChurchImage(tooManyPixels)).rejects.toThrow();
    const valid = await syntheticImage().png().toBuffer();
    await expect(prepareChurchImage(valid.subarray(0, valid.length - 14))).rejects.toThrow();
  });

  it('rejects animated WebP instead of silently publishing its first frame', async () => {
    const frames = await Promise.all(['red', 'blue'].map((background) => sharp({
      create: { width: 32, height: 32, channels: 4, background },
    }).png().toBuffer()));
    const input = await sharp(frames, { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(input).metadata()).pages).toBe(2);
    await expect(prepareChurchImage(input)).rejects.toThrow();
  });

  it('rejects the APNG animation-control chunk before decoding', async () => {
    const png = await syntheticImage().png().toBuffer();
    const animationControl = Buffer.alloc(20);
    animationControl.writeUInt32BE(8, 0);
    animationControl.write('acTL', 4, 'ascii');
    const input = Buffer.concat([png.subarray(0, 33), animationControl, png.subarray(33)]);
    await expect(prepareChurchImage(input)).rejects.toThrow();
  });
});
