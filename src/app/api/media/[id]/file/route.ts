import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { UPLOADS_DIR } from '@/lib/channels'
import { sanitizeFilename } from '@/lib/security'

// MÓDULO MULTIMODAL — sirve el medio original de un mensaje del inbox (solo lectura,
// archivos dentro de uploads/). NUNCA se sirve inline: siempre descarga (attachment)
// con nosniff + CSP sandbox; HTML/SVG jamás se sirven (denylist → 415).

const MIME_FALLBACK: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
}

// Denylist de mime no servibles: vector clásico de XSS almacenado (SVG/HTML con JS embebido).
const MIME_DENYLIST = new Set(['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/xhtml'])
const EXT_DENYLIST = new Set(['svg', 'html', 'htm', 'xhtml', 'xht'])

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const msg = await db.channelMessage.findUnique({ where: { id }, select: { mediaPath: true, mimeType: true } })
    if (!msg?.mediaPath) return new Response('No encontrado', { status: 404 })

    const resolved = path.resolve(msg.mediaPath)
    const allowedRoot = path.resolve(UPLOADS_DIR)
    if (!resolved.startsWith(allowedRoot + path.sep)) return new Response('Ruta inválida', { status: 400 })
    if (!fs.existsSync(resolved)) return new Response('Archivo no disponible', { status: 404 })

    const ext = path.extname(resolved).slice(1).toLowerCase()
    const mime = (msg.mimeType || MIME_FALLBACK[ext] || 'application/octet-stream').toLowerCase().split(';')[0].trim()

    // Rechazo duro de contenido activo: no se sirve ni inline ni como descarga.
    if (MIME_DENYLIST.has(mime) || EXT_DENYLIST.has(ext)) {
      return new Response('Tipo de contenido no servible (HTML/SVG bloqueado por riesgo de XSS)', {
        status: 415,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
      })
    }

    const buf = fs.readFileSync(resolved)
    const fileName = sanitizeFilename(path.basename(resolved))
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': mime,
        // Descarga forzada: el navegador nunca renderiza el medio en el origen del panel.
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[media/file]', err)
    return new Response('Error sirviendo el archivo', { status: 500 })
  }
}
