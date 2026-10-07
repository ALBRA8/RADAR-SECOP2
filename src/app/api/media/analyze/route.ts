import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bad, safe } from '@/lib/api'
import { processInbound, type MsgType } from '@/lib/channels'
import { classifyMime } from '@/lib/media'
import { rateLimit, clientIp } from '@/lib/security'

// MÓDULO MULTIMODAL — analizador desde la web (pliegos PDF, fotos de contratos, voz, video).
// Crea mensajes de canal 'WEB' (entran al inbox) y devuelve el análisis al navegador.
// Endurecido: validación de magic bytes por familia (incluye audio/video), rate limit
// 30/min por IP y telemetría ProviderMetric (ASR_ZAI / VISION_ZAI / LLM_ZAI).

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000

// MIME activo jamás admitido (coherente con la denylist de media/[id]/file)
const MIME_DENYLIST = new Set(['text/html', 'image/svg+xml', 'application/xhtml+xml'])

function latin1(b: Buffer, from: number, to: number): string {
  return b.subarray(from, to).toString('latin1')
}

/** Audio real: ID3, frame MP3 (0xFF Ex), WAV (RIFF..WAVE), OGG, FLAC, M4A (ftyp@4). */
function looksLikeAudio(h: Buffer): boolean {
  if (h.length < 4) return false
  if (latin1(h, 0, 3) === 'ID3') return true // MP3 con cabecera ID3
  if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return true // frame sync MPEG audio
  if (latin1(h, 0, 4) === 'RIFF' && latin1(h, 8, 12) === 'WAVE') return true // WAV
  if (latin1(h, 0, 4) === 'OggS') return true // OGG/OGA
  if (latin1(h, 0, 4) === 'fLaC') return true // FLAC
  if (h.length >= 12 && latin1(h, 4, 8) === 'ftyp') return true // M4A / MP4 audio
  return false
}

/** Video real: MP4/MOV (ftyp en offset 4), WebM/Matroska (EBML 0x1A45DFA3). */
function looksLikeVideo(h: Buffer): boolean {
  if (h.length < 12) return false
  if (latin1(h, 4, 8) === 'ftyp') return true // MP4/MOV/M4V
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return true // EBML (WebM/MKV)
  return false
}

export async function POST(req: Request) {
  return safe(async () => {
    // 1) Rate limit barato ANTES de parsear el form (protege RAM y motor IA)
    const rl = rateLimit(`media-analyze:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)
    if (!rl.allowed) {
      const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))
      return NextResponse.json(
        { error: `Demasiadas solicitudes de análisis (máximo ${RATE_LIMIT}/min). Reintenta en ${retry}s.` },
        { status: 429, headers: { 'Retry-After': String(retry) } },
      )
    }

    const form = await req.formData()
    const file = form.get('file')
    const note = String(form.get('note') || '').trim()
    if (!(file instanceof File)) return bad('Adjunta un archivo (PDF, imagen, audio o video)')
    if (file.size === 0) return bad('El archivo está vacío')
    if (file.size > MAX_BYTES) return bad('El archivo supera el límite de 25 MB')

    const mime = (file.type || 'application/octet-stream').toLowerCase()
    if (MIME_DENYLIST.has(mime)) {
      return bad(`Tipo de archivo no admitido por seguridad: ${mime} (HTML/SVG pueden transportar scripts).`)
    }

    const kind = classifyMime(mime)
    if (!kind) return bad(`Tipo de archivo no soportado: ${mime}. Soportamos PDF, imágenes, audio y video.`)

    // 2) Validación de contenido por magic bytes — no basta con el MIME del cliente.
    //    Contenido vacío o magic desconocido → 400 (un .bin renombrado jamás pasa).
    const head = Buffer.from(await file.slice(0, 16).arrayBuffer())

    if (mime === 'application/pdf' && latin1(head, 0, 4) !== '%PDF') {
      return bad('El archivo dice ser PDF pero no lo es (¿renombrado?). Envía el PDF original.')
    }

    if (mime.startsWith('image/')) {
      const isJpeg = head[0] === 0xff && head[1] === 0xd8
      const isPng = head[0] === 0x89 && head[1] === 0x50
      const isWebp = latin1(head, 0, 4) === 'RIFF' && latin1(head, 8, 12) === 'WEBP'
      const isGif = latin1(head, 0, 3) === 'GIF'
      const isBmp = head[0] === 0x42 && head[1] === 0x4d
      if (!isJpeg && !isPng && !isWebp && !isGif && !isBmp) {
        return bad('La imagen no tiene un formato reconocible (JPEG/PNG/WebP/GIF/BMP).')
      }
    }

    if (mime.startsWith('audio/') && !looksLikeAudio(head)) {
      return bad('El audio no tiene un formato reconocible (MP3/WAV/OGG/FLAC/M4A). ¿Archivo renombrado o corrupto?')
    }

    if (mime.startsWith('video/') && !looksLikeVideo(head)) {
      return bad('El video no tiene un formato reconocible (MP4/WebM/MKV). ¿Archivo renombrado o corrupto?')
    }

    if (mime.startsWith('text/')) {
      // text/* no tiene magic; detectamos binarios disfrazados por bytes NUL.
      const sample = Buffer.from(await file.slice(0, 1024).arrayBuffer())
      if (sample.includes(0)) {
        return bad('El archivo dice ser texto pero contiene bytes binarios (¿renombrado?). Envíalo con su tipo real.')
      }
    }

    const type: MsgType = kind === 'AUDIO' && note.toLowerCase().includes('voz') ? 'VOZ' : kind
    const buffer = Buffer.from(await file.arrayBuffer())

    // 3) Telemetría: provider según tipo (ASR para voz/audio, visión para imagen/video, LLM para documentos)
    const provider = type === 'VOZ' || type === 'AUDIO' ? 'ASR_ZAI' : type === 'DOCUMENTO' ? 'LLM_ZAI' : 'VISION_ZAI'
    const t0 = Date.now()
    let result
    try {
      result = await processInbound({
        channel: 'WEB',
        chatId: 'web-panel',
        chatName: 'Panel web',
        type,
        text: note || null,
        mediaBuffer: buffer,
        mediaMime: mime,
        fileName: file.name || undefined,
      })
    } catch (err) {
      await db.providerMetric
        .create({
          data: { provider, operation: 'media_analyze', ok: false, latencyMs: Date.now() - t0, metaJson: JSON.stringify({ type, sizeBytes: file.size }) },
        })
        .catch(() => null)
      throw err
    }
    await db.providerMetric
      .create({
        data: {
          provider,
          operation: 'media_analyze',
          ok: result.status === 'RESPONDIDO',
          latencyMs: Date.now() - t0,
          metaJson: JSON.stringify({ type, sizeBytes: file.size, messageId: result.messageId }),
        },
      })
      .catch(() => null)

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
