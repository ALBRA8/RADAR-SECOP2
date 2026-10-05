import { db } from '@/lib/db'
import { bad, safe } from '@/lib/api'
import { processInbound, type MsgType } from '@/lib/channels'
import { classifyMime } from '@/lib/media'

// MÓDULO MULTIMODAL — analizador desde la web (pliegos PDF, fotos de contratos, voz, video).
// Crea mensajes de canal 'WEB' (entran al inbox) y devuelve el análisis al navegador.

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB

export async function POST(req: Request) {
  return safe(async () => {
    const form = await req.formData()
    const file = form.get('file')
    const note = String(form.get('note') || '').trim()
    if (!(file instanceof File)) return bad('Adjunta un archivo (PDF, imagen, audio o video)')
    if (file.size === 0) return bad('El archivo está vacío')
    if (file.size > MAX_BYTES) return bad('El archivo supera el límite de 25 MB')

    const mime = file.type || 'application/octet-stream'
    const kind = classifyMime(mime)
    if (!kind) return bad(`Tipo de archivo no soportado: ${mime}. Soportamos PDF, imágenes, audio y video.`)

    // Validación de contenido (magic bytes) para los tipos clave: no basta con el MIME del cliente
    const head = Buffer.from(await file.slice(0, 8).arrayBuffer())
    if (mime === 'application/pdf' && head.subarray(0, 4).toString('latin1') !== '%PDF') {
      return bad('El archivo dice ser PDF pero no lo es (¿renombrado?). Envía el PDF original.')
    }
    if (mime.startsWith('image/') && !['image/svg+xml'].includes(mime)) {
      const isJpeg = head[0] === 0xff && head[1] === 0xd8
      const isPng = head[0] === 0x89 && head[1] === 0x50
      const isWebp = head.subarray(0, 4).toString('latin1') === 'RIFF'
      const isGif = head.subarray(0, 3).toString('latin1') === 'GIF'
      const isBmp = head[0] === 0x42 && head[1] === 0x4d
      if (!isJpeg && !isPng && !isWebp && !isGif && !isBmp) {
        return bad('La imagen no tiene un formato reconocible (JPEG/PNG/WebP/GIF/BMP).')
      }
    }

    const type: MsgType = kind === 'AUDIO' && note.toLowerCase().includes('voz') ? 'VOZ' : kind
    const buffer = Buffer.from(await file.arrayBuffer())

    const result = await processInbound({
      channel: 'WEB',
      chatId: 'web-panel',
      chatName: 'Panel web',
      type,
      text: note || null,
      mediaBuffer: buffer,
      mediaMime: mime,
      fileName: file.name || undefined,
    })

    return {
      ok: true,
      messageId: result.messageId,
      status: result.status,
      reply: result.reply,
      type,
      fileName: file.name,
      sizeBytes: file.size,
    }
  })
}
