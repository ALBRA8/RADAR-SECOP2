import { NextResponse } from 'next/server'
import { handleRpcMessage, type JsonRpcMessage, type RpcOutcome } from '@/lib/mcp'
import { rateLimit, timingSafeEqualStr, clientIp } from '@/lib/security'

// MÓDULO MCP — Transporte Streamable HTTP (JSON-RPC 2.0) en /api/mcp
// Endurecido:
// - Auth: si MCP_API_KEY está definida, exige "Authorization: Bearer <clave>" comparado en
//   tiempo constante; en producción sin MCP_API_KEY → 503 fail-closed; en dev sin clave
//   sigue abierto por compatibilidad (header X-MCP-Auth: disabled).
// - Rate limit por IP: 60 solicitudes/min.
// - Lotes JSON-RPC acotados: máximo 10 mensajes por solicitud (el excedente responde -32600).

const MAX_BATCH = 10
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000

function jsonRpcError(
  id: JsonRpcMessage['id'],
  code: number,
  message: string,
  status = 200,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status, headers })
}

function checkAuth(req: Request): { ok: boolean; open: boolean } {
  const key = process.env.MCP_API_KEY
  if (!key) {
    // Dev sin credenciales: abierto por compatibilidad (producción lo bloquea abajo).
    return { ok: process.env.NODE_ENV !== 'production', open: true }
  }
  const header = req.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return { ok: token.length > 0 && timingSafeEqualStr(token, key), open: false }
}

export async function POST(req: Request) {
  // 1) Auth (fail-closed en producción sin MCP_API_KEY)
  const auth = checkAuth(req)
  if (!auth.ok) {
    if (auth.open) {
      return jsonRpcError(
        null,
        -32001,
        'Servidor MCP cerrado: MCP_API_KEY no está definida y NODE_ENV es production (fail-closed).',
        503,
      )
    }
    return jsonRpcError(
      null,
      -32001,
      'No autorizado: falta o es inválido el header Authorization: Bearer <MCP_API_KEY>',
      401,
      { 'WWW-Authenticate': 'Bearer' },
    )
  }
  const extraHeaders: Record<string, string> = auth.open ? { 'X-MCP-Auth': 'disabled' } : {}

  // 2) Rate limit por IP (protege tools que tocan BD e IA)
  const rl = rateLimit(`mcp:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rl.allowed) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))
    return jsonRpcError(null, -32000, `Límite de ${RATE_LIMIT} solicitudes/min excedido para MCP.`, 429, {
      'Retry-After': String(retry),
      ...extraHeaders,
    })
  }

  // 3) Parseo JSON-RPC
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonRpcError(null, -32700, 'Error de parseo JSON', 400, extraHeaders)
  }

  // 4) Lote acotado: array ≤ 10 se procesa; el excedente responde -32600 por ítem.
  const isBatch = Array.isArray(raw)
  const items: unknown[] = isBatch ? (raw as unknown[]) : [raw]
  const processable = items.slice(0, MAX_BATCH) as JsonRpcMessage[]

  const outcomes: RpcOutcome[] = []
  for (const m of processable) {
    outcomes.push(await handleRpcMessage(m))
  }
  for (const extra of items.slice(MAX_BATCH)) {
    const id = (extra && typeof extra === 'object' && 'id' in (extra as JsonRpcMessage) ? (extra as JsonRpcMessage).id : null) ?? null
    outcomes.push({
      status: 200,
      sessionId: undefined,
      body: {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: `Lote demasiado grande: máximo ${MAX_BATCH} mensajes JSON-RPC por solicitud (ítem excedente no procesado)` },
      },
    })
  }

  const sessionId = outcomes.find((o) => o.sessionId)?.sessionId
  const headers: Record<string, string> = { ...extraHeaders }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
    headers['MCP-Protocol-Version'] = '2025-06-18'
  }

  const bodies = outcomes.map((o) => o.body).filter((b) => b !== null)
  if (bodies.length === 0) {
    return new NextResponse(null, { status: 202, headers })
  }
  const body = isBatch ? bodies : bodies[0]
  return NextResponse.json(body as object, { status: 200, headers })
}

// El servidor no ofrece stream SSE server→client: 405 es conforme a la spec Streamable HTTP.
export async function GET() {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'GET no soportado: este servidor responde por POST (JSON-RPC 2.0). Consulta /api/mcp/info para descubrimiento.' },
    },
    { status: 405, headers: { Allow: 'POST, DELETE' } },
  )
}

export async function DELETE() {
  // Servidor sin estado: no hay sesión que terminar.
  return new NextResponse(null, { status: 204 })
}
