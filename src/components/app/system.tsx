'use client'

// Vista "Sistema": Doctor, Skills, Memoria (MemoryDV), Ejecuciones y Salud.
// Consumo directo de las APIs de observabilidad — sin duplicar el dashboard.

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from './shared'
import { fmtDateTime } from './client-types'
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, Stethoscope,
  Brain, Search, Zap, HeartPulse, ChevronDown, Database, Globe, Cpu,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ─── Tipos locales (contratos de las APIs de observabilidad) ─────────

interface DoctorCheck {
  id: string
  status: string
  fixable: boolean
  detail: string
}
interface DoctorPayload {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  checkedAt: string
  checks: DoctorCheck[]
}
interface HealthPayload {
  ok: boolean
  agent: string
  uptime: number
  db: boolean
  secop: boolean
  version: string
}
interface SkillRow {
  identity: string
  version: string
  purpose?: string | null
  status: string
  confidence: number
  successRate: number
  runsCount: number
  validation: { valid: boolean; errors: string[] }
}
interface SkillsPayload {
  count: number
  allValid: boolean
  skills: SkillRow[]
}
interface MemoryEntry {
  id: string
  type: string
  key: string
  content: string
  truthLevel: string
  confidence: number
  accessCount: number
  tags: string[]
  createdAt: string
}
interface MemoryPayload {
  stats: {
    total: number
    byType: { type: string; count: number }[]
    avgConfidence: number
  }
  recent?: MemoryEntry[]
  entries?: MemoryEntry[]
  query?: string
  count?: number
}
interface ExecutionRow {
  id: string
  operation: string
  status: string
  autonomyLevel: string
  latencyMs: number | null
  createdAt: string
}
interface ExecutionsPayload {
  total: number
  limit: number
  executions: ExecutionRow[]
}

// ─── Etiquetas humanas ───────────────────────────────────────────────

const CHECK_LABELS: Record<string, string> = {
  secop_reachable: 'Conectividad SECOP II',
  db_integrity: 'Integridad de la base de datos',
  channels_configured: 'Canales de mensajería',
  mcp_tools: 'Herramientas MCP',
  memory_available: 'Memoria del agente (MemoryDV)',
  skills_valid: 'Skill contracts',
  evidence_sin_provenance: 'Procedencia de evidencias',
  requirements_sin_fuente: 'Fuente declarada de requisitos',
  deadlines_inconsistentes: 'Fechas límite inconsistentes',
}

const AUTONOMY_LABELS: Record<string, string> = {
  L0_OBSERVE: 'L0 · Observa',
  L1_SUGGEST: 'L1 · Sugiere',
  L2_EXECUTE_SAFE: 'L2 · Ejecuta seguro',
  L3_AUTONOMOUS: 'L3 · Autónomo',
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  EPISODIC: 'Episódica',
  SEMANTIC: 'Semántica',
  FACTUAL: 'Factual',
  PROCEDURAL: 'Procedimental',
}

const TRUTH_COLORS: Record<string, string> = {
  VERIFIED: 'bg-teal-100 text-teal-800 border-teal-200',
  OBSERVED: 'bg-teal-100 text-teal-800 border-teal-200',
  INFERRED: 'bg-amber-100 text-amber-800 border-amber-200',
  UNKNOWN: 'bg-muted text-muted-foreground border-border',
}

const TRUTH_LABELS: Record<string, string> = {
  VERIFIED: 'Verificada',
  OBSERVED: 'Observada',
  INFERRED: 'Inferida',
  UNKNOWN: 'Desconocida',
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n * 100)}%`
}

function fmtUptime(seconds: number | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min`
  return `${Math.floor(seconds)} s`
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  const s = Math.max(0, Math.floor(diff / 1000))
  if (s < 60) return 'hace un momento'
  const m = Math.floor(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} día${d === 1 ? '' : 's'}`
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Error ${res.status}`)
  return (await res.json()) as T
}

// ─── Icono por estado de check ───────────────────────────────────────

function CheckIcon({ status }: { status: string }) {
  if (status === 'OK') return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
  if (status === 'WARN') return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
  return <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden />
}

// ─── Card: Doctor ────────────────────────────────────────────────────

function DoctorCard({ doctor, loading, onRun, running }: { doctor: DoctorPayload | null; loading: boolean; onRun: () => void; running: boolean }) {
  const statusStyle =
    doctor?.status === 'HEALTHY'
      ? 'bg-teal-100 text-teal-800 border-teal-200'
      : doctor?.status === 'UNHEALTHY'
        ? 'bg-rose-100 text-rose-700 border-rose-200'
        : 'bg-amber-100 text-amber-800 border-amber-200'
  const statusLabel = doctor?.status === 'HEALTHY' ? 'Saludable' : doctor?.status === 'DEGRADED' ? 'Degradado' : doctor?.status === 'UNHEALTHY' ? 'Crítico' : '—'

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-emerald-700" aria-hidden /> Doctor — diagnóstico del sistema
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`${statusStyle} border font-semibold`}>{statusLabel}</Badge>
            <Button size="sm" variant="outline" onClick={onRun} disabled={running} className="min-h-9">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${running ? 'animate-spin' : ''}`} aria-hidden />
              {running ? 'Diagnosticando…' : 'Ejecutar diagnóstico'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Verificado: {doctor ? fmtDateTime(doctor.checkedAt) : '—'}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner label="Consultando diagnóstico…" />
        ) : !doctor ? (
          <p className="py-4 text-sm text-muted-foreground">No se pudo cargar el diagnóstico.</p>
        ) : (
          <ul className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {doctor.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2.5 rounded-lg border p-3">
                <CheckIcon status={c.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{CHECK_LABELS[c.id] || c.id.replace(/_/g, ' ')}</p>
                    {c.fixable && <Badge variant="outline" className="text-[10px] px-1.5 py-0">reparable</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5 break-words">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Card: Salud (/api/health) ───────────────────────────────────────

function HealthCard({ health, loading }: { health: HealthPayload | null; loading: boolean }) {
  const rows = health
    ? [
        { icon: HeartPulse, label: 'Estado general', value: health.ok ? 'Operativo' : 'Con fallas', ok: health.ok },
        { icon: Database, label: 'Base de datos', value: health.db ? 'Conectada' : 'Sin conexión', ok: health.db },
        { icon: Globe, label: 'SECOP II (datos.gov.co)', value: health.secop ? 'Alcanzable' : 'No alcanzable (degradado)', ok: health.secop },
        { icon: Cpu, label: 'Uptime del agente', value: fmtUptime(health.uptime), ok: true },
        { icon: Zap, label: 'Versión', value: health.version || '—', ok: true },
      ]
    : []
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-emerald-700" aria-hidden /> Salud
        </CardTitle>
        <p className="text-xs text-muted-foreground">/api/health — latidos del agente</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner label="Consultando salud…" />
        ) : !health ? (
          <p className="py-4 text-sm text-muted-foreground">No se pudo cargar el estado de salud.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                  <r.icon className="w-4 h-4 shrink-0" aria-hidden />
                  <span className="truncate">{r.label}</span>
                </span>
                <span className={`text-sm font-medium text-right ${r.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{r.value}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Card: Skills ────────────────────────────────────────────────────

function SkillRowItem({ s }: { s: SkillRow }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,2fr)_70px_90px_70px_64px_28px] items-center gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded-lg"
        aria-expanded={open}
      >
        <span className="font-mono text-xs font-medium truncate" title={s.identity}>{s.identity}</span>
        <span className="hidden sm:block text-xs text-muted-foreground">v{s.version}</span>
        <span className="hidden sm:block">
          <Badge variant="outline" className="text-[10px] px-1.5 border-emerald-200 bg-emerald-50 text-emerald-800">{s.status}</Badge>
        </span>
        <span className="hidden sm:block text-xs text-muted-foreground">{fmtPct(s.successRate)}</span>
        <span className="hidden sm:block text-xs text-muted-foreground">{s.runsCount}</span>
        <span className="flex items-center justify-end gap-1">
          {s.validation.valid ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="Contrato válido" />
          ) : (
            <XCircle className="w-4 h-4 text-rose-600" aria-label="Contrato inválido" />
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
        <span className="col-span-full flex sm:hidden flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px] px-1.5 border-emerald-200 bg-emerald-50 text-emerald-800">{s.status}</Badge>
          <span>v{s.version}</span>
          <span>· éxito {fmtPct(s.successRate)}</span>
          <span>· {s.runsCount} ejec.</span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t bg-muted/30 text-sm space-y-1">
          <p className="text-muted-foreground leading-relaxed">{s.purpose || 'Sin propósito declarado en el contrato.'}</p>
          <p className="text-xs text-muted-foreground">Confianza del contrato: {fmtPct(s.confidence)}</p>
          {!s.validation.valid && s.validation.errors.length > 0 && (
            <ul className="text-xs text-rose-700 list-disc list-inside">
              {s.validation.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

function SkillsCard({ skills, loading }: { skills: SkillsPayload | null; loading: boolean }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-700" aria-hidden /> Skill contracts
          </CardTitle>
          {skills && (
            <Badge variant="outline" className={skills.allValid ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
              {skills.count} skills · {skills.allValid ? 'todos válidos' : 'con errores'}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Toca una fila para ver el propósito del contrato.</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner label="Consultando catálogo de skills…" />
        ) : !skills || skills.skills.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Sin skills registradas.</p>
        ) : (
          <ul className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            <li className="hidden sm:grid grid-cols-[minmax(0,2fr)_70px_90px_70px_64px_28px] gap-x-2 px-3 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Identidad</span><span>Versión</span><span>Estado</span><span>Éxito</span><span>Ejec.</span><span className="text-right">OK</span>
            </li>
            {skills.skills.map((s) => <SkillRowItem key={s.identity} s={s} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Card: Memoria (MemoryDV) ────────────────────────────────────────

function MemoryCard({ memory, loading, onSearch, searching, query, onQueryChange }: {
  memory: MemoryPayload | null
  loading: boolean
  onSearch: (q: string) => void
  searching: boolean
  query: string
  onQueryChange: (q: string) => void
}) {
  const entries: MemoryEntry[] = memory?.entries || memory?.recent || []
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="w-4 h-4 text-emerald-700" aria-hidden /> Memoria (MemoryDV)
        </CardTitle>
        {memory?.stats && (
          <p className="text-xs text-muted-foreground">
            {memory.stats.total} entrada(s) · confianza media {fmtPct(memory.stats.avgConfidence)}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {memory?.stats && (
          <div className="flex flex-wrap gap-1.5">
            {memory.stats.byType.map((t) => (
              <Badge key={t.type} variant="outline" className="text-[11px] border-border">
                {MEMORY_TYPE_LABELS[t.type] || t.type}: <strong className="ml-1">{t.count}</strong>
              </Badge>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); onSearch(query.trim()) }}
          className="flex gap-2"
          role="search"
        >
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar en memoria (ej.: INVIAS)…"
            aria-label="Buscar entradas de memoria"
            className="min-h-9 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={searching} className="min-h-9 shrink-0">
            <Search className={`w-3.5 h-3.5 mr-1 ${searching ? 'animate-pulse' : ''}`} aria-hidden />
            {searching ? '…' : 'Buscar'}
          </Button>
        </form>
        {loading ? (
          <Spinner label="Consultando memoria…" />
        ) : entries.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {query ? 'Sin resultados para esa búsqueda.' : 'Sin entradas de memoria.'}
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {entries.map((m) => (
              <li key={m.id} className="rounded-lg border p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs font-medium truncate max-w-[220px]" title={m.key}>{m.key}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5">{MEMORY_TYPE_LABELS[m.type] || m.type}</Badge>
                  <Badge variant="outline" className={`text-[10px] px-1.5 ${TRUTH_COLORS[m.truthLevel] || TRUTH_COLORS.UNKNOWN}`}>
                    {TRUTH_LABELS[m.truthLevel] || m.truthLevel}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.content}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Confianza {fmtPct(m.confidence)} · {m.accessCount} acceso(s)
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Card: Ejecuciones ───────────────────────────────────────────────

function ExecStatusChip({ status }: { status: string }) {
  const style =
    status === 'SUCCESS'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : status === 'PARTIAL'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-rose-200 bg-rose-50 text-rose-700'
  return <Badge variant="outline" className={`text-[10px] px-1.5 ${style}`}>{status}</Badge>
}

function ExecutionsCard({ execs, loading }: { execs: ExecutionsPayload | null; loading: boolean }) {
  return (
    <Card className="lg:col-span-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-700" aria-hidden /> Ejecuciones recientes
        </CardTitle>
        {execs && <p className="text-xs text-muted-foreground">{execs.total} registro(s) en total · últimas {execs.executions.length}</p>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner label="Consultando ejecuciones…" />
        ) : !execs || execs.executions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Sin ejecuciones registradas todavía.</p>
        ) : (
          <ul className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {execs.executions.map((e) => (
              <li key={e.id} className="rounded-lg border px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-xs font-medium" title={e.operation}>{e.operation}</span>
                <ExecStatusChip status={e.status} />
                <Badge variant="secondary" className="text-[10px] px-1.5">{AUTONOMY_LABELS[e.autonomyLevel] || e.autonomyLevel}</Badge>
                <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground whitespace-nowrap">
                  <span>{e.latencyMs != null ? `${e.latencyMs} ms` : '—'}</span>
                  <span title={fmtDateTime(e.createdAt)}>{fmtRelative(e.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Vista principal ─────────────────────────────────────────────────

export function SystemView() {
  const { toast } = useToast()
  const [doctor, setDoctor] = useState<DoctorPayload | null>(null)
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [skills, setSkills] = useState<SkillsPayload | null>(null)
  const [memory, setMemory] = useState<MemoryPayload | null>(null)
  const [execs, setExecs] = useState<ExecutionsPayload | null>(null)
  const [loadingDoctor, setLoadingDoctor] = useState(true)
  const [loadingHealth, setLoadingHealth] = useState(true)
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [loadingMemory, setLoadingMemory] = useState(true)
  const [loadingExecs, setLoadingExecs] = useState(true)
  const [runningDoctor, setRunningDoctor] = useState(false)
  const [searchingMemory, setSearchingMemory] = useState(false)
  const [memQuery, setMemQuery] = useState('')

  const loadDoctor = useCallback(async (announce = false) => {
    if (announce) setRunningDoctor(true)
    setLoadingDoctor(true)
    try {
      const data = await getJson<DoctorPayload>('/api/doctor')
      setDoctor(data)
      if (announce) {
        const n = data.checks.length
        const bad = data.checks.filter((c) => c.status !== 'OK').length
        toast({
          title: `Diagnóstico: ${data.status === 'HEALTHY' ? 'saludable' : data.status === 'DEGRADED' ? 'degradado' : 'crítico'}`,
          description: `${n} verificación(es) ejecutada(s)${bad > 0 ? ` · ${bad} con alerta` : ' · todo en orden'}.`,
        })
      }
    } catch {
      setDoctor(null)
      if (announce) toast({ title: 'No se pudo ejecutar el diagnóstico', variant: 'destructive' })
    } finally {
      setLoadingDoctor(false)
      setRunningDoctor(false)
    }
  }, [toast])

  const loadMemory = useCallback(async (q = '') => {
    if (q) setSearchingMemory(true)
    else setLoadingMemory(true)
    try {
      const data = await getJson<MemoryPayload>(q ? `/api/memory?q=${encodeURIComponent(q)}` : '/api/memory')
      setMemory(data)
    } catch {
      setMemory(null)
      toast({ title: 'No se pudo consultar la memoria del agente', variant: 'destructive' })
    } finally {
      setLoadingMemory(false)
      setSearchingMemory(false)
    }
  }, [toast])

  useEffect(() => {
    loadDoctor()
    getJson<HealthPayload>('/api/health').then(setHealth).catch(() => setHealth(null)).finally(() => setLoadingHealth(false))
    getJson<SkillsPayload>('/api/skills').then(setSkills).catch(() => setSkills(null)).finally(() => setLoadingSkills(false))
    loadMemory()
    getJson<ExecutionsPayload>('/api/executions?limit=15').then(setExecs).catch(() => setExecs(null)).finally(() => setLoadingExecs(false))
  }, [loadDoctor, loadMemory])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Sistema</h1>
        <p className="text-sm text-muted-foreground">
          Observabilidad del agente: diagnóstico, skill contracts, memoria y ejecuciones.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DoctorCard doctor={doctor} loading={loadingDoctor} onRun={() => loadDoctor(true)} running={runningDoctor} />
        <HealthCard health={health} loading={loadingHealth} />
        <SkillsCard skills={skills} loading={loadingSkills} />
        <MemoryCard
          memory={memory}
          loading={loadingMemory}
          searching={searchingMemory}
          query={memQuery}
          onQueryChange={setMemQuery}
          onSearch={(q) => loadMemory(q)}
        />
        <ExecutionsCard execs={execs} loading={loadingExecs} />
      </div>
    </div>
  )
}
