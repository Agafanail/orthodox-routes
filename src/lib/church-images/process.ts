import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

export const CHURCH_IMAGE_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const CHURCH_IMAGE_MAX_PIXELS = 24_000_000;
const MAX_DIMENSION = 10_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const VARIANT_EDGES = [480, 960, 1600] as const;
const INPUT_OPTIONS = { failOn: 'warning', limitInputPixels: CHURCH_IMAGE_MAX_PIXELS } as const;

type ImageRole = 'master' | '480' | '960' | '1600';
export type PreparedChurchImageFile = {
  role: ImageRole;
  objectKey: string;
  contentType: 'image/webp';
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  data: Buffer;
};
export type PreparedChurchImage = {
  imageId: string;
  files: PreparedChurchImageFile[];
};

/** The database receives only this manifest, never encoded bytes or the untouched upload. */
export function churchImageManifest(image: PreparedChurchImage) {
  return {
    imageId: image.imageId,
    files: image.files.map((file) => ({
      role: file.role, objectKey: file.objectKey, contentType: file.contentType,
      width: file.width, height: file.height, byteLength: file.byteLength, sha256: file.sha256,
    })),
  };
}

const UNAVAILABLE = 'Church photograph could not be prepared.';

function inputFormat(input: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return 'jpeg';
  if (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    // libvips may expose only the first frame of APNG. Reject animation explicitly.
    let offset = 8;
    while (offset + 12 <= input.length) {
      const size = input.readUInt32BE(offset);
      if (size > input.length - offset - 12) return null;
      const chunk = input.toString('ascii', offset + 4, offset + 8);
      if (chunk === 'acTL') return null;
      offset += size + 12;
      if (chunk === 'IEND') return 'png';
    }
    return null;
  }
  if (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF'
    && input.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function preparedFile(
  imageId: string, role: ImageRole, data: Buffer, width: number, height: number,
): PreparedChurchImageFile {
  if (data.length < 1 || data.length > MAX_OUTPUT_BYTES || width < 1 || height < 1) {
    throw new Error(UNAVAILABLE);
  }
  return {
    role, objectKey: `${imageId}/${role}.webp`, contentType: 'image/webp',
    width, height, byteLength: data.length,
    sha256: createHash('sha256').update(data).digest('hex'), data,
  };
}

/** Node-only, in-memory preparation. Never accepts a path/URL or persists the untouched upload. */
export async function prepareChurchImage(input: Buffer, existingImageId?: string): Promise<PreparedChurchImage> {
  try {
    if (!Buffer.isBuffer(input) || input.length < 1 || input.length > CHURCH_IMAGE_MAX_INPUT_BYTES) {
      throw new Error(UNAVAILABLE);
    }
    // Isolate processing from a caller mutating the upload while decoding is in progress.
    const upload = Buffer.from(input);
    const format = inputFormat(upload);
    if (!format) throw new Error(UNAVAILABLE);
    const metadata = await sharp(upload, INPUT_OPTIONS).metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height
      || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION
      || metadata.width * metadata.height > CHURCH_IMAGE_MAX_PIXELS
      || (metadata.pages ?? 1) !== 1) throw new Error(UNAVAILABLE);

    const imageId = existingImageId === undefined ? randomUUID() : existingImageId;
    if (typeof imageId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(imageId)) {
      throw new Error(UNAVAILABLE);
    }
    // Do not call keepMetadata/withMetadata: EXIF, GPS, XMP, ICC and comments must not survive.
    const master = await sharp(upload, INPUT_OPTIONS).autoOrient().toColourspace('srgb')
      .webp({ quality: 95, effort: 4 }).timeout({ seconds: 5 })
      .toBuffer({ resolveWithObject: true });
    const files = [preparedFile(imageId, 'master', master.data, master.info.width, master.info.height)];
    // Sequential processing bounds peak memory; variants read only the cleaned master.
    for (const edge of VARIANT_EDGES) {
      const variant = await sharp(master.data, INPUT_OPTIONS)
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 }).timeout({ seconds: 5 })
        .toBuffer({ resolveWithObject: true });
      files.push(preparedFile(imageId, `${edge}`, variant.data, variant.info.width, variant.info.height));
    }
    return { imageId, files };
  } catch {
    // Decoder errors may include untrusted metadata. Never expose them or the input bytes.
    throw new Error(UNAVAILABLE);
  }
}
