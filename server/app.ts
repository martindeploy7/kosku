import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { sql as dsql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { type AppEnv, csrfGuard, sessionMiddleware } from './auth/context'
import { db } from './db/client'
import { env } from './env'
import { HttpError, mapDbError } from './lib/errors'
import { errMeta, log } from './lib/log'
import { adminRoutes } from './routes/admin'
import { approvalRoutes } from './routes/approvals'
import { authRoutes } from './routes/auth'
import { billingRoutes } from './routes/billing'
import { coreRoutes } from './routes/core'
import { docsRoutes, publicRoutes } from './routes/docs'
import { waRoutes } from './routes/whatsapp'

export function createApp() {
  const app = new Hono<AppEnv>()

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      // Lets the browser's built-in PDF viewer render /api/files inline.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  )

  /* ---------------- API ---------------- */
  app.use('/api/*', sessionMiddleware)
  app.use('/api/*', csrfGuard)
  app.use('/api/files', bodyLimit({
    maxSize: (env.UPLOAD_MAX_MB + 1) * 1024 * 1024,
    onError: () => { throw new HttpError(413, `Ukuran berkas maksimal ${env.UPLOAD_MAX_MB} MB.`, 'too_large') },
  }))
  app.use('/api/*', bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: () => { throw new HttpError(413, 'Permintaan terlalu besar.', 'too_large') },
  }))

  app.get('/api/health', async (c) => {
    try {
      await db.execute(dsql`select 1`)
      return c.json({ ok: true, db: 'ok', time: new Date().toISOString() })
    } catch {
      return c.json({ ok: false, db: 'down' }, 503)
    }
  })

  app.route('/api/auth', authRoutes)
  app.route('/api/public', publicRoutes)
  app.route('/api/whatsapp', waRoutes)
  app.route('/api/approvals', approvalRoutes)
  app.route('/api', coreRoutes)
  app.route('/api', billingRoutes)
  app.route('/api', docsRoutes)
  app.route('/api', adminRoutes)
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Endpoint tidak ditemukan.' } }, 404))

  /* ---------------- web app ---------------- */
  const staticRoot = path.resolve(env.STATIC_DIR)
  const indexFile = path.join(staticRoot, 'index.html')
  if (env.SERVE_STATIC && existsSync(indexFile)) {
    const indexHtml = readFileSync(indexFile, 'utf8')
    // Hashed bundles are immutable; the shell and service worker must always revalidate.
    app.use('/assets/*', async (c, next) => {
      await next()
      c.header('Cache-Control', 'public, max-age=31536000, immutable')
    })
    app.use('*', serveStatic({ root: path.relative(process.cwd(), staticRoot) || '.' }))
    app.get('*', (c) => {
      c.header('Cache-Control', 'no-cache')
      return c.html(indexHtml)
    })
  }

  app.onError((err, c) => {
    const mapped = err instanceof HttpError ? err : mapDbError(err)
    if (mapped) {
      return c.json({ error: { code: mapped.code, message: mapped.message, details: mapped.details } }, mapped.status)
    }
    log.error('Kesalahan tak terduga', { path: c.req.path, method: c.req.method, ...errMeta(err) })
    return c.json({ error: { code: 'internal', message: 'Terjadi kesalahan di server. Coba lagi; jika berulang, hubungi pengelola sistem.' } }, 500)
  })

  return app
}
