import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'
import { sendTestMessage } from '@/lib/channels'

// MÓDULO CANALES — bandeja de entrada unificada (TELEGRAM | WHATSAPP | WEB)

export async function GET(req: Request) {
  return safe(async () => {
    const url = new URL(req.url)
    const channel = url.searchParams.get('channel')
    const limit = Math.min(Number(url.searchParams.get('limit') || 60) || 60, 200)
    const messages = await db.channelMessage.findMany({
      where: channel && channel !== 'TODOS' ? { channel } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    const counts = await db.channelMessage.groupBy({ by: ['channel', 'direction'], _count: { _all: true } })
    return { messages, counts }
  })
}

// Enviar mensaje de prueba a un chat (verificación de configuración)
export async function POST(req: Request) {
  return safe(async () => {
    const body = await req.json().catch(() => ({}))
    const channel = body.channel as 'TELEGRAM' | 'WHATSAPP'
    const chatId = String(body.chatId || '').trim()
    const text = String(body.text || '').trim() || '✅ Prueba de conexión del Agente SECOP Radar.'
    if (channel !== 'TELEGRAM' && channel !== 'WHATSAPP') return bad('Canal inválido')
    if (!chatId) return bad('Indica el chat ID de destino (para Telegram, p. ej. tu chat con el bot o un canal)')
    await sendTestMessage(channel, chatId, text)
    return { ok: true }
  })
}

// Limpiar la bandeja
export async function DELETE() {
  return safe(async () => {
    await db.channelMessage.deleteMany({})
    return { ok: true }
  })
}
