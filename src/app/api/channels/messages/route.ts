import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'
import { sendTestMessage } from '@/lib/channels'
import { assertAllowed } from '@/lib/autonomy'

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
// AUTONOMÍA L3 — este es el punto de envío EXTERNO del agente (§20): se consulta
// la política (assertAllowed) y se deja rastro de auditoría. El bloqueo duro es
// opt-in (?enforce=1 o env RADAR_ENFORCE_AUTONOMY=1) para no romper el flujo
// actual de verificación de canales mientras todo opera ≤L2.
export async function POST(req: Request) {
  return safe(async () => {
    const url = new URL(req.url)
    const body = await req.json().catch(() => ({}))
    const channel = body.channel as 'TELEGRAM' | 'WHATSAPP'
    const chatId = String(body.chatId || '').trim()
    const text = String(body.text || '').trim() || '✅ Prueba de conexión del Agente SECOP Radar.'
    if (channel !== 'TELEGRAM' && channel !== 'WHATSAPP') return bad('Canal inválido')
    if (!chatId) return bad('Indica el chat ID de destino (para Telegram, p. ej. tu chat con el bot o un canal)')

    const autonomy = await assertAllowed('L3_EXECUTE_EXTERNAL')
    const enforce = url.searchParams.get('enforce') === '1' || process.env.RADAR_ENFORCE_AUTONOMY === '1'
    await db.auditEvent
      .create({
        data: {
          action: 'EXTERNAL_SEND_INTENT',
          entityType: 'ChannelMessage',
          entityId: chatId,
          detail: `Envío externo vía ${channel} a chat ${chatId}: política L3 ${autonomy.allowed ? 'PERMITIDO' : 'NO PERMITIDO'} — ${autonomy.reason}${enforce ? ' (enforcement duro activo)' : ' (solo registro)'}`,
          status: autonomy.allowed ? 'OK' : 'PARTIAL',
        },
      })
      .catch(() => undefined)
    if (!autonomy.allowed && enforce) {
      return bad(`Envío externo bloqueado por política de autonomía: ${autonomy.reason}`, 403)
    }

    await sendTestMessage(channel, chatId, text)
    return { ok: true, autonomy: { level: 'L3_EXECUTE_EXTERNAL', allowed: autonomy.allowed, enforced: enforce } }
  })
}

// Limpiar la bandeja
export async function DELETE() {
  return safe(async () => {
    await db.channelMessage.deleteMany({})
    return { ok: true }
  })
}
