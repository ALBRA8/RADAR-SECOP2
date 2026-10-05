import { safe, bad } from '@/lib/api'
import { handleWhatsAppPayload, getConfig } from '@/lib/channels'

// MÓDULO CANALES — webhook de WhatsApp Cloud API (Meta).
// GET: verificación del webhook (hub.mode / hub.verify_token / hub.challenge).
// POST: recepción de mensajes (texto, voz, audio, imágenes, video, documentos).

export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && challenge) {
    const config = await getConfig('WHATSAPP')
    if (config?.verifyToken && token === config.verifyToken) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }
  return Response.json({
    channel: 'WHATSAPP',
    webhookPath: '/api/channels/whatsapp/webhook',
    note: 'Configura esta URL en Meta App Dashboard → WhatsApp → Webhooks. Requiere una URL pública (https).',
  })
}

export async function POST(req: Request) {
  // Si WHATSAPP_APP_SECRET está definido, valida la firma X-Hub-Signature-256 de Meta
  // (HMAC-SHA256 del body crudo). Sin env, el endpoint queda para entornos privados/sandbox.
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (appSecret) {
    const raw = await req.text()
    const sig = req.headers.get('x-hub-signature-256') || ''
    const { createHmac } = await import('crypto')
    const expected = `sha256=${createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex')}`
    if (sig !== expected) return new Response('Firma inválida', { status: 401 })
    return safe(async () => {
      const payload = JSON.parse(raw)
      const result = await handleWhatsAppPayload(payload)
      return { ok: true, ...result }
    })
  }
  return safe(async () => {
    const payload = await req.json().catch(() => null)
    if (!payload) return bad('Payload inválido')
    const result = await handleWhatsAppPayload(payload)
    // Meta exige 200 aunque no haya nada que hacer
    return { ok: true, ...result }
  })
}
