/* Generates the PWA icons from public/favicon.svg (run once; output is committed). */
import { mkdirSync, readFileSync } from 'node:fs'
import sharp from 'sharp'

const svg = readFileSync('public/favicon.svg')
mkdirSync('public/icons', { recursive: true })
const out = (size, file) => sharp(svg, { density: 512 }).resize(size, size).png().toFile(`public/icons/${file}`)
await out(192, 'icon-192.png')
await out(512, 'icon-512.png')
await out(180, 'apple-touch-icon.png')
await out(96, 'badge-96.png')
// Maskable: the glyph inside the 80% safe zone on a full-bleed brand background.
const inner = await sharp(svg, { density: 512 }).resize(360, 360).png().toBuffer()
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#4f46e5' } })
  .composite([{ input: inner, gravity: 'center' }]).png().toFile('public/icons/icon-maskable-512.png')
console.log('icons written')
