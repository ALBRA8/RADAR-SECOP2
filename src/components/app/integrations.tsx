'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from './shared'
import { Plug, KeyRound, Boxes, FlaskConical, Copy, CheckCircle2, XCircle, ShieldCheck, Wrench } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface McpTool {
  name: string
  description: string
  escribe_datos: boolean
  inputSchema: Record<string, unknown>
}

interface McpInfo {
  servidor: { name: string; title: string; version: string }
  protocolVersion: string
  endpoint: string
  autenticacion: { requerida: boolean; header?: string; formato?: string; nota?: string }
  tools: McpTool[]
  ejemplo_config_cliente: Record<string, unknown>
  ejemplo_llamada: { metodo: string; url: string; cuerpo: Record<string, unknown> }
}

export function IntegrationsView() {
  const { toast } = useToast()
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // Estado de la prueba en vivo
  const [testCall, setTestCall] = useState('{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "tools/call",\n  "params": { "name": "get_dashboard_stats", "arguments": {} }\n}')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testOk, setTestOk] = useState<boolean | null>(null)

  const loadInfo = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/mcp/info')
      setInfo(await res.json())
    } catch {
      setInfo(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInfo()
  }, [])

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `${label} copiado al portapapeles` })
    } catch {
      toast({ title: 'No se pudo copiar', variant: 'destructive' })
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestOk(null)
    try {
      const parsed = JSON.parse(testCall)
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify(parsed),
      })
      const text = await res.text()
      setTestResult(text.length > 4000 ? `${text.slice(0, 4000)}\n… (truncado)` : text)
      setTestOk(res.ok)
    } catch (e) {
      setTestResult(`Error: ${e instanceof Error ? e.message : 'JSON inválido o fallo de red'}`)
      setTestOk(false)
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <Spinner label="Consultando servidor MCP…" />
  if (!info) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          No se pudo cargar la información del servidor MCP. Verifica que la app esté corriendo.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Plug className="w-5 h-5 text-emerald-600" aria-hidden /> Integraciones — Servidor MCP
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          El agente expone sus capacidades vía <strong>Model Context Protocol (MCP)</strong>: otros proyectos, asistentes y automatizaciones pueden conectarle para consultar oportunidades, analizar procesos, generar proyectos y refinar propuestas.
        </p>
      </div>

      {/* Conexión */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-600" aria-hidden /> Datos de conexión
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between rounded-lg border p-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Endpoint (transporte Streamable HTTP · JSON-RPC 2.0)</p>
              <p className="font-mono text-sm break-all">{info.endpoint}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => copy(info.endpoint, 'Endpoint')} className="shrink-0 min-h-9">
              <Copy className="w-3.5 h-3.5 mr-1.5" aria-hidden /> Copiar
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className="border-emerald-300 text-emerald-800 bg-emerald-50">
              Protocolo MCP v{info.protocolVersion}
            </Badge>
            <Badge variant="outline">{info.servidor.name} v{info.servidor.version}</Badge>
            {info.autenticacion.requerida ? (
              <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50">
                Autenticación Bearer activa
              </Badge>
            ) : (
              <Badge variant="outline" className="border-muted text-muted-foreground">
                Sin autenticación (modo demo)
              </Badge>
            )}
          </div>
          {info.autenticacion.nota && <p className="text-xs text-muted-foreground">{info.autenticacion.nota}</p>}
        </CardContent>
      </Card>

      {/* Config de cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Boxes className="w-4 h-4 text-emerald-600" aria-hidden /> Configuración para otro proyecto o asistente
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Agrega este bloque a la configuración MCP de tu cliente (Claude Desktop, otro agente, n8n, script propio) y el agente SECOP Radar quedará disponible como servidor de herramientas.
          </p>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="rounded-lg border bg-muted/40 p-4 text-xs font-mono overflow-x-auto">{JSON.stringify(info.ejemplo_config_cliente, null, 2)}</pre>
            <Button
              size="sm"
              variant="outline"
              className="absolute top-2 right-2 min-h-8 bg-background"
              onClick={() => copy(JSON.stringify(info.ejemplo_config_cliente, null, 2), 'Configuración')}
            >
              <Copy className="w-3.5 h-3.5 mr-1" aria-hidden /> Copiar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="w-4 h-4 text-emerald-600" aria-hidden /> Herramientas expuestas ({info.tools.length})
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Cualquier cliente MCP puede invocarlas. Las herramientas de escritura respetan el flujo de aprobación humana y dejan rastro en auditoría.
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {info.tools.map((t) => (
            <div key={t.name} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{t.name}</span>
                {t.escribe_datos ? (
                  <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50 text-[10px]">escribe datos</Badge>
                ) : (
                  <Badge variant="outline" className="border-emerald-300 text-emerald-800 bg-emerald-50 text-[10px]">solo lectura</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Probar en vivo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-emerald-600" aria-hidden /> Probar el servidor en vivo
          </CardTitle>
          <p className="text-sm text-muted-foreground">Envía un mensaje JSON-RPC 2.0 al endpoint tal como lo haría otro proyecto.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={testCall} onChange={(e) => setTestCall(e.target.value)} rows={6} className="font-mono text-xs" aria-label="Mensaje JSON-RPC de prueba" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={runTest} disabled={testing} className="bg-emerald-600 hover:bg-emerald-700 min-h-9">
              {testing ? 'Enviando…' : 'Enviar JSON-RPC'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setTestCall('{\n  "jsonrpc": "2.0",\n  "id": 2,\n  "method": "tools/list",\n  "params": {}\n}')}
              className="min-h-9"
            >
              Usar tools/list
            </Button>
            <Button
              variant="outline"
              onClick={() => setTestCall('{\n  "jsonrpc": "2.0",\n  "id": 3,\n  "method": "tools/call",\n  "params": { "name": "list_opportunities", "arguments": { "limit": 5 } }\n}')}
              className="min-h-9"
            >
              Usar list_opportunities
            </Button>
          </div>
          {testResult !== null && (
            <div>
              <Separator className="my-2" />
              <p className="text-sm flex items-center gap-1.5 mb-1.5">
                {testOk ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden /> Respuesta del servidor MCP:
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-rose-600" aria-hidden /> La llamada falló:
                  </>
                )}
              </p>
              <pre className="rounded-lg border bg-muted/40 p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto">{testResult}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden />
        La presentación de ofertas en SECOP II sigue siendo manual y sujeta a aprobación humana, también vía MCP.
      </p>
    </div>
  )
}
