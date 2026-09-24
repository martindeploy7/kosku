import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { env } from '../env'

/* File bytes live outside the database (local volume or an S3-compatible
 * bucket such as Cloudflare R2); the `files` table only holds metadata. Keeps
 * the DB small and its backups fast. */

export interface Storage {
  put(key: string, body: Buffer, mime: string): Promise<void>
  get(key: string): Promise<Buffer>
}

class LocalStorage implements Storage {
  constructor(private root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key)
    // Keys are generated server-side, but never trust a path join blindly.
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Kunci penyimpanan tidak valid')
    return full
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, body, { flag: 'wx' })
  }

  async get(key: string) {
    return readFile(this.resolve(key))
  }
}

class S3Storage implements Storage {
  private client: S3Client
  constructor(private bucket: string) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    })
  }

  async put(key: string, body: Buffer, mime: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }))
  }

  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    return Buffer.from(await out.Body!.transformToByteArray())
  }
}

function build(): Storage {
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_ENDPOINT) {
      throw new Error('STORAGE_DRIVER=s3 membutuhkan S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY')
    }
    return new S3Storage(env.S3_BUCKET)
  }
  return new LocalStorage(path.resolve(env.DATA_DIR, 'files'))
}

export const storage = build()
