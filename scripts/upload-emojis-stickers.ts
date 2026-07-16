import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';
import { Server } from '../src/lib/models/Server';
import { ServerEmoji } from '../src/lib/models/ServerEmoji';
import { ServerSticker } from '../src/lib/models/ServerSticker';
import { storage } from '../src/lib/services/storage';
import { config } from '../src/lib/config';

const s3Client = new S3Client({
  endpoint: `https://${config.B2_ENDPOINT}`,
  region: config.B2_REGION,
  credentials: {
    accessKeyId: config.B2_KEY_ID,
    secretAccessKey: config.B2_APPLICATION_KEY,
  },
  forcePathStyle: true,
});

async function uploadStickerGif(data: Buffer, contentType: string, filename: string, serverId: string, userId: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() || 'gif';
  const secureFilename = `${nanoid(16)}.${ext}`;
  const key = `stickers/${serverId}/${userId}/${secureFilename}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: config.B2_BUCKET_NAME,
    Key: key,
    Body: data,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000',
  }));
  return `${config.CDN_URL}/${key}`;
}

const SERVER_ID = '970d8b59-ac45-48a6-adcf-21c24421f0ce';
const EMOJI_DIR = '/home/pikachubolk/Documents/servers-jsons/890474004094263357_emojis';
const STICKER_DIR = '/home/pikachubolk/Documents/servers-jsons/890474004094263357_stickers';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.apng': 'image/apng',
};

function getMime(filename: string): string {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return MIME_MAP[ext] || 'application/octet-stream';
}

function extractName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const match = base.match(/^(.+)_(\d{17,20})$/);
  const name = match ? match[1] : base;
  return name.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 32);
}

async function main() {
  console.log('Looking up server...');
  const server = await Server.findById(SERVER_ID);
  if (!server) {
    console.error('Server not found:', SERVER_ID);
    process.exit(1);
  }
  console.log(`Server: ${server.name} (owner: ${server.ownerId})`);
  const uploadedBy = server.ownerId;

  // ── Emojis ──
  console.log('\n--- Uploading Emojis ---');
  const emojiFiles = await readdir(EMOJI_DIR);
  let emojiCount = 0;
  for (const filename of emojiFiles) {
    const filePath = join(EMOJI_DIR, filename);
    const data = await readFile(filePath);
    const contentType = getMime(filename);
    const name = extractName(filename);
    const animated = contentType === 'image/gif';

    console.log(`  Uploading emoji: ${name} (${filename}, ${data.length} bytes)...`);

    try {
      const result = await storage.upload({
        category: 'emojis',
        contentType,
        data,
        size: data.length,
        filename,
        userId: uploadedBy,
      });

      await ServerEmoji.create({
        serverId: SERVER_ID,
        name,
        imageUrl: result.url,
        animated,
        available: true,
        managed: false,
        requireColons: true,
        roles: [],
        uploadedBy,
      });

      emojiCount++;
      console.log(`  ✓ Created emoji: ${name} -> ${result.url}`);
    } catch (err) {
      console.error(`  ✗ Failed for ${name}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Emojis done: ${emojiCount}/${emojiFiles.length}`);

  // ── Stickers ──
  console.log('\n--- Uploading Stickers ---');
  const stickerFiles = await readdir(STICKER_DIR);
  let stickerCount = 0;
  for (const filename of stickerFiles) {
    const filePath = join(STICKER_DIR, filename);
    const data = await readFile(filePath);
    const contentType = getMime(filename);
    const name = extractName(filename);

    console.log(`  Uploading sticker: ${name} (${filename}, ${data.length} bytes)...`);

    try {
      let url: string;
      if (contentType === 'image/gif') {
        url = await uploadStickerGif(data, contentType, filename, SERVER_ID, uploadedBy);
      } else {
        const result = await storage.upload({
          category: 'stickers',
          contentType,
          data,
          size: data.length,
          filename,
          serverId: SERVER_ID,
          userId: uploadedBy,
        });
        url = result.url;
      }

      await ServerSticker.create({
        serverId: SERVER_ID,
        name,
        imageUrl: url,
        tags: ['sticker'],
        available: true,
        uploadedBy,
      });

      stickerCount++;
      console.log(`  ✓ Created sticker: ${name} -> ${url}`);
    } catch (err) {
      console.error(`  ✗ Failed for ${name}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Stickers done: ${stickerCount}/${stickerFiles.length}`);

  console.log('\n=== All done ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
