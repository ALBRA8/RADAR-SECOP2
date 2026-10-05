import { safe } from '@/lib/api'
import { handleTelegramUpdate, telegramPollOnce, getConfig } from '@/lib/channels'

// MÓDULO CANALES — webhook de Telegram (POST) e información (GET)
// En este sandbox no hay URL pública fija, por eso el modo por defecto es POLLING
// (ver /api/channels/telegram/poll). El webhook queda disponible si se configura
// setWebhook apuntando a una URL pública de la app.

export async function GET() {
  return safe(async () => {
    const config = await getConfig('TELEGRAM')
    return {
      channel: 'TELEGRAM',
      webhookPath: '/api/channels/telegram/webhook',
      pollingRecommended: true,
      configured: Boolean(config?.token),
      botUsername: config?.botUsername || null,
      lastCheckAt: config?.lastCheckAt || null,
    }
  })
}

export async function POST(req: Request) {
  return safe(async () => {
    const config = await getConfig('TELEGRAM')
    if (!config || !config.token) {
      return { ok: false, error: 'Bot de Telegram no configurado: guarda el token en la vista Canales.' }
    }
    // Si se definió TELEGRAM_WEBHOOK_SECRET (env), se exige el secret header que Telegram
    // envía en cada llamada de webhook (setWebhook secret_token). Sin env, el webhook no
    // debe exponerse públicamente: en este sandbox el modo recomendado es POLLING.
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (expectedSecret) {
      const got = req.headers.get('x-telegram-bot-api-secret-token')
      if (got !== expectedSecret) return { ok: false, error: 'Secret de webhook inválido' }
    }
    const update = await req.json().catch(() => null)
    if (!update) return { ok: false, error: 'Payload inválido' }
    const reply = await handleTelegramUpdate(update, { token: config.token })
    return { ok: true, reply }
  })
}

// Ciclo único de polling (lo usa el daemon y el botón "Verificar ahora")
export async function PUT(req: Request) {
  return safe(async () => {
    const url = new URL(req.url)
    const timeout = Number(url.searchParams.get('timeout') || 0)
    return telegramPollOnce(Number.isFinite(timeout) ? timeout : 0)
  })
}
