import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'
import type { FileKind, FileOwnerType } from '@shared/types'
import { type Executor, db, schema } from '../db/client'
import { env } from '../env'
import { sha256 } from '../lib/crypto'
import { HttpError, notFound } from '../lib/errors'
import { storage } from './storage'

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['application/pdf', 'pdf'],
])

export interface StoredFile {
  id: string
  mime: string
  size: number
  originalName: string
  /** The bytes as stored (after re-encoding), so callers inside a transaction need not read them back. */
  buffer: Buffer
}

function keyFor(ownerType: string, ext: string) {
  const d = new Date()
  return `${ownerType}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`
}

function safeName(name: string) {
  return (name || 'berkas').replace(/[^\w.\- ()]/g, '_').slice(0, 120)
}

/**
 * Validate and store an upload. The type is sniffed from the bytes (never the
 * extension or the browser's claim). Photos are auto-rotated, downscaled and
 * re-encoded, which also strips EXIF — phone photos of a KTP often carry GPS.
 */
export async function ingestUpload(
  exec: Executor,
  input: {
    buffer: Buffer
    originalName: string
    ownerType: FileOwnerType
    ownerId: string
    kind: FileKind
    uploadedBy: string | null
  },
): Promise<StoredFile> {
  if (input.buffer.length > env.UPLOAD_MAX_MB * 1024 * 1024) {
    throw new HttpError(413, `Ukuran berkas maksimal ${env.UPLOAD_MAX_MB} MB.`, 'too_large')
  }
  const detected = await fileTypeFromBuffer(input.buffer)
  if (!detected || !ALLOWED.has(detected.mime)) {
    throw new HttpError(415, 'Format berkas tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.', 'unsupported_type')
  }

  let body = input.buffer
  let mime = detected.mime
  let ext = ALLOWED.get(detected.mime)!

  if (mime.startsWith('image/')) {
    const img = sharp(input.buffer, { failOn: 'error' }).rotate()
    if (input.kind === 'ttd') {
      // Signatures keep their transparency.
      body = await img.resize({ width: 1200, height: 600, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      mime = 'image/png'
      ext = 'png'
    } else {
      body = await img
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()
      mime = 'image/jpeg'
      ext = 'jpg'
    }
  }

  const baseName = safeName(input.originalName).replace(/\.[^.]+$/, '')
  return storeBuffer(exec, {
    buffer: body, mime, ext, originalName: `${baseName}.${ext}`,
    ownerType: input.ownerType, ownerId: input.ownerId, kind: input.kind, uploadedBy: input.uploadedBy,
  })
}

/** Store bytes the server produced itself (contract PDFs, signatures). */
export async function storeBuffer(
  exec: Executor,
  input: {
    buffer: Buffer
    mime: string
    ext: string
    originalName: string
    ownerType: FileOwnerType
    ownerId: string
    kind: FileKind
    uploadedBy: string | null
  },
): Promise<StoredFile> {
  const key = keyFor(input.ownerType, input.ext)
  await storage.put(key, input.buffer, input.mime)
  const [row] = await exec
    .insert(schema.files)
    .values({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind,
      storageKey: key,
      originalName: safeName(input.originalName),
      mime: input.mime,
      size: input.buffer.length,
      sha256: sha256(input.buffer),
      uploadedBy: input.uploadedBy,
    })
    .returning()
  return { id: row.id, mime: row.mime, size: row.size, originalName: row.originalName, buffer: input.buffer }
}

export async function loadFile(fileId: string, opts: { includeDeleted?: boolean } = {}) {
  const row = await db.query.files.findFirst({ where: eq(schema.files.id, fileId) })
  if (!row || (row.deletedAt && !opts.includeDeleted)) throw notFound('Berkas')
  const buffer = await storage.get(row.storageKey)
  return { row, buffer }
}
