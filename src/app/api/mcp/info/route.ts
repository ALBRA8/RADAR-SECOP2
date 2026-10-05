import { NextResponse } from 'next/server'
import { MCP_TOOLS, MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from '@/lib/mcp'

// MÓDULO MCP — Descubrimiento legible para humanos/UI (no forma parte del wire protocol)
export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const authEnabled = Boolean(process.env.MCP_API_KEY)
  return NextResponse.json({
    servidor: MCP_SERVER_INFO,
    protocolo: 'MCP — Model Context Protocol (JSON-RPC 2.0, Streamable HTTP)',
    protocolVersion: MCP_PROTOCOL_VERSION,
    endpoint: `${origin}/api/mcp`,
    autenticacion: authEnabled
      ? { requerida: true, header: 'Authorization', formato: 'Bearer <MCP_API_KEY>' }
      : { requerida: false, nota: 'Modo demo sin credenciales — define MCP_API_KEY en el entorno para proteger el endpoint' },
    transporte: {
      metodo: 'POST',
      formato: 'JSON-RPC 2.0 (mensajes únicos o lotes)',
      metodos: ['initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call'],
      cabeceras_respuesta: ['Mcp-Session-Id (asignada en initialize)'],
    },
    tools: Object.entries(MCP_TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      escribe_datos: Boolean(t.write),
      inputSchema: t.inputSchema,
    })),
    ejemplo_config_cliente: {
      mcpServers: {
        'secop-radar': {
          url: `${origin}/api/mcp`,
          ...(authEnabled ? { headers: { Authorization: 'Bearer <MCP_API_KEY>' } } : {}),
        },
      },
    },
    ejemplo_llamada: {
      metodo: 'POST',
      url: `${origin}/api/mcp`,
      cuerpo: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_dashboard_stats', arguments: {} } },
    },
  })
}
