import sharp from 'sharp';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { fail } from './shared.mjs';

export const LOGO_REQUEST_LIMIT = 3 * 1024 * 1024;
export async function normalizeLogo(value) {
  if (typeof value === 'string' && value.length > 4 * Math.ceil(2 * 1024 * 1024 / 3))
    fail(413, 'LOGO_TOO_LARGE', 'Choose an image up to 2 MiB.');
  if (typeof value !== 'string' || !value.length ||
      value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    fail(422, 'INVALID_LOGO', 'Choose a PNG or JPEG image up to 2 MiB.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) fail(422, 'INVALID_LOGO', 'Choose a valid image file.');
  if (bytes.length > 2 * 1024 * 1024) fail(413, 'LOGO_TOO_LARGE', 'Choose an image up to 2 MiB.');
  try {
    // libvips reads only the default APNG frame and does not expose its pages.
    // Inspect actual PNG chunks, rather than searching compressed pixel data.
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      for (let offset = 8; offset + 12 <= bytes.length;) {
        const size = bytes.readUInt32BE(offset);
        if (size > bytes.length - offset - 12) throw Error();
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        if (type === 'acTL') fail(422, 'INVALID_LOGO', 'Animated images are not supported. Choose a still PNG or JPEG image.');
        offset += size + 12;
        if (type === 'IEND') break;
      }
    }
    const image = sharp(bytes, { limitInputPixels: 16000000, failOn: 'warning', animated: true });
    const meta = await image.metadata();
    if (!['png', 'jpeg'].includes(meta.format) || (meta.pages ?? 1) !== 1 || meta.width * meta.height > 16000000) throw Error();
    const result = await image.rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (result.length >= 1024 * 1024) fail(413, 'LOGO_TOO_LARGE', 'This image is too complex. Choose a simpler logo image.');
    return result;
  } catch (error) {
    if (error.status) throw error;
    fail(422, 'INVALID_LOGO', 'Choose a valid, non-animated PNG or JPEG image with at most 16 megapixels.');
  }
}

export function createLogoStorage(config = process.env, client = new S3Client({})) {
  const key = (orgId, version) => `organizations/${orgId}/logos/${version}.png`;
  async function send(Command, input) {
    if (!config.ORGANIZATION_LOGO_BUCKET) fail(503, 'LOGO_UNAVAILABLE', 'Logo storage is temporarily unavailable. Please try again.');
    try { return await client.send(new Command({ Bucket: config.ORGANIZATION_LOGO_BUCKET, ...input })); }
    catch { fail(503, 'LOGO_UNAVAILABLE', 'Logo storage is temporarily unavailable. Please try again.'); }
  }
  return {
    async get(orgId, version) {
      const result = await send(GetObjectCommand, { Key: key(orgId, version) });
      try { return Buffer.from(await result.Body.transformToByteArray()); }
      catch { fail(503, 'LOGO_UNAVAILABLE', 'Logo storage is temporarily unavailable. Please try again.'); }
    },
    put: (orgId, version, bytes) => send(PutObjectCommand, { Key: key(orgId, version), Body: bytes, ContentType: 'image/png' }),
    remove: (orgId, version) => send(DeleteObjectCommand, { Key: key(orgId, version) }),
  };
}
