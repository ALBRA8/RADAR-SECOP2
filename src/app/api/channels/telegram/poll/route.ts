import { safe } from '@/lib/api'
import { telegramPollOnce } from '@/lib/channels'

// MÓDULO CANALES — ciclo de polling de Telegram.
// GET: sondeo inmediato (lo usa el botón "Verificar ahora" del panel).
// POST: igual que GET pero acepta ?timeout=N para long-polling (lo usa el daemon).

async function poll(url: URL) {
  const timeout = Number(url.searchParams.get('timeout') || 0)
  return telegramPollOnce(Number.isFinite(timeout) ? Math.min(timeout, 50) : 0)
}

export async function GET(req: Request) {
  return safe(() => poll(new URL(req.url)))
}

export async function POST(req: Request) {
  return safe(() => poll(new URL(req.url)))
}
