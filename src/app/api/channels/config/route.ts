import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'
import { upsertConfig, tgApi } from '@/lib/channels'

// MÓDULO CANALES — configuración de Telegram / WhatsApp

function maskToken(t: string): string {
  if (!t) return ''
  if (t.length <= 10) return '••••'
  return `${t.slice(0, 6)}••••••${t.slice(-4)}`
}

export async function GET() {
  return safe(async () => {
    const [telegram, whatsapp] = await Promise.all([db.channelConfig.findUnique({ where: { channel: 'TELEGRAM' } }), db.channelConfig.findUnique({ where: { channel: 'WHATSAPP' } })])
    const sanitize = (c: typeof telegram) =>
      c && { ...c, token: maskToken(c.token), hasToken: Boolean(c.token), verifyToken: c.verifyToken ? '••••' : null, hasVerifyToken: Boolean(c.verifyToken) }
    return { telegram: sanitize(telegram), whatsapp: sanitize(whatsapp) }
  })
}

export async function POST(req: Request) {
  return safe(async () => {
    const body = await req.json().catch(() => ({}))
    const channel = body.channel as 'TELEGRAM' | 'WHATSAPP'
    if (channel !== 'TELEGRAM' && channel !== 'WHATSAPP') return bad('Canal inválido (TELEGRAM o WHATSAPP)')

    const saved = await upsertConfig(channel, {
      token: typeof body.token === 'string' ? body.token.trim() : undefined,
      phoneNumberId: typeof body.phoneNumberId === 'string' ? body.phoneNumberId.trim() : undefined,
      verifyToken: typeof body.verifyToken === 'string' ? body.verifyToken.trim() : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    })

    // Telegram: validar el token de inmediato contra la API oficial
    let botInfo: { username?: string; valid: boolean; error?: string } = { valid: false }
    if (channel === 'TELEGRAM' && saved.token) {
      try {
        const me = (await tgApi(saved.token, 'getMe')) as { username?: string; first_name?: string }
        botInfo = { username: me.username, valid: true }
        await upsertConfig(channel, { botUsername: me.username })
      } catch (err) {
        botInfo = { valid: false, error: err instanceof Error ? err.message : 'token inválido' }
      }
    }

    const fresh = await db.channelConfig.findUnique({ where: { channel } })
    return {
      ok: true,
      config: fresh && { ...fresh, token: maskToken(fresh.token), hasToken: Boolean(fresh.token), verifyToken: fresh.verifyToken ? '••••' : null, hasVerifyToken: Boolean(fresh.verifyToken) },
      botInfo,
    }
  })
}
