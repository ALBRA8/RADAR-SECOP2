import { NextResponse } from 'next/server'
import { handleRpcMessage, type JsonRpcMessage, type RpcOutcome } from '@/lib/mcp'

// MÓDULO MCP — Transporte Streamable HTTP (JSON-RPC 2.0) en /api/mcp
// Auth opcional: si MCP_API_KEY está definida, exige "Authorization: Bearer <clave>".

function authOk(req: Request): boolean {
  const key = process.env.MCP_API_KEY
  if (!key) return true // modo demo sin credenciales
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${key}`
}

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'No autorizado: falta o es inválido el header Authorization: Bearer <MCP_API_KEY>' } },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  )
}

export async function POST(req: Request) {
  if (!authOk(req)) return unauthorized()

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Error de parseo JSON' } }, { status: 400 })
  }

  const messages: JsonRpcMessage[] = Array.isArray(raw) ? (raw as JsonRpcMessage[]) : [raw as JsonRpcMessage]
  const outcomes: RpcOutcome[] = []
  for (const m of messages) {
    outcomes.push(await handleRpcMessage(m))
  }

  const sessionId = outcomes.find((o) => o.sessionId)?.sessionId
  const headers: Record<string, string> = {}
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
    headers['MCP-Protocol-Version'] = '2025-06-18'
  }

  const bodies = outcomes.map((o) => o.body).filter((b) => b !== null)
  if (bodies.length === 0) {
    return new NextResponse(null, { status: 202, headers })
  }
  const body = Array.isArray(raw) ? bodies : bodies[0]
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
