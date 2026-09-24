import * as React from 'react'
import { Eraser } from 'lucide-react'
import { Button } from '@/components/ui'

export interface SignaturePadHandle {
  isEmpty: () => boolean
  toDataURL: () => string
  clear: () => void
}

/**
 * Finger/mouse signature canvas. Draws at device-pixel resolution so strokes
 * stay crisp on phones, and exports a transparent PNG cropped to the ink.
 */
export const SignaturePad = React.forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void; disabled?: boolean }>(
  ({ onChange, disabled }, ref) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null)
    const drawing = React.useRef(false)
    const last = React.useRef<{ x: number; y: number } | null>(null)
    const strokes = React.useRef(0)
    const [empty, setEmpty] = React.useState(true)

    const setup = React.useCallback(() => {
      const c = canvasRef.current
      if (!c) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const rect = c.getBoundingClientRect()
      c.width = Math.round(rect.width * dpr)
      c.height = Math.round(rect.height * dpr)
      const ctx = c.getContext('2d')!
      ctx.scale(dpr, dpr)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 2.4
      ctx.strokeStyle = '#111827'
    }, [])

    React.useEffect(() => {
      setup()
    }, [setup])

    const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const markDirty = () => {
      if (empty) {
        setEmpty(false)
        onChange?.(false)
      }
    }

    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drawing.current = true
      last.current = point(e)
    }
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current || !last.current) return
      const p = point(e)
      const ctx = canvasRef.current!.getContext('2d')!
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      last.current = p
      strokes.current += 1
      if (strokes.current > 8) markDirty()
    }
    const up = () => {
      drawing.current = false
      last.current = null
    }

    const clear = () => {
      const c = canvasRef.current!
      c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
      strokes.current = 0
      setEmpty(true)
      onChange?.(true)
    }

    React.useImperativeHandle(ref, () => ({
      isEmpty: () => empty,
      clear,
      toDataURL: () => {
        // Crop to the drawn area so the signature sits nicely in the PDF.
        const c = canvasRef.current!
        const ctx = c.getContext('2d')!
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height)
        let minX = width, minY = height, maxX = 0, maxY = 0
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 0) {
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
            }
          }
        }
        if (maxX <= minX || maxY <= minY) return c.toDataURL('image/png')
        const pad = 12
        const w = Math.min(width, maxX - minX + pad * 2)
        const h = Math.min(height, maxY - minY + pad * 2)
        const out = document.createElement('canvas')
        out.width = w
        out.height = h
        out.getContext('2d')!.drawImage(c, Math.max(0, minX - pad), Math.max(0, minY - pad), w, h, 0, 0, w, h)
        return out.toDataURL('image/png')
      },
    }))

    return (
      <div className="space-y-2">
        <div className="relative rounded-lg border-2 border-dashed border-input bg-white">
          <canvas
            ref={canvasRef}
            aria-label="Area tanda tangan"
            className="block w-full h-44 touch-none cursor-crosshair rounded-lg"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
          />
          {empty && (
            <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-gray-400">
              Tanda tangan di sini
            </span>
          )}
          <span className="pointer-events-none absolute left-6 right-6 bottom-8 border-b border-gray-300" />
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={empty || disabled}>
            <Eraser className="h-3.5 w-3.5" /> Ulangi
          </Button>
        </div>
      </div>
    )
  },
)
SignaturePad.displayName = 'SignaturePad'
