import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { UPLOADS_DIR } from '@/lib/channels'

// MÓDULO MULTIMODAL — sirve el medio original de un mensaje del inbox (solo lectura,
// archivos dentro de uploads/).

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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const msg = await db.channelMessage.findUnique({ where: { id }, select: { mediaPath: true, mimeType: true } })
    if (!msg?.mediaPath) return new Response('No encontrado', { status: 404 })

    const resolved = path.resolve(msg.mediaPath)
    const allowedRoot = path.resolve(UPLOADS_DIR)
    if (!resolved.startsWith(allowedRoot + path.sep)) return new Response('Ruta inválida', { status: 400 })
    if (!fs.existsSync(resolved)) return new Response('Archivo no disponible', { status: 404 })

    const buf = fs.readFileSync(resolved)
    const ext = path.extname(resolved).slice(1).toLowerCase()
    const mime = msg.mimeType || MIME_FALLBACK[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' },
    })
  } catch (err) {
    console.error('[media/file]', err)
    return new Response('Error sirviendo el archivo', { status: 500 })
  }
}
