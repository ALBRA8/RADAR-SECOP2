'use client'

// Sección "Evidencia" del detalle de oportunidad:
// 1) Evidencias agrupadas por requisito (Requirement.evidences[])
// 2) Historial de cambios del proceso (ProcessChange) como línea de tiempo.

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Spinner, EmptyState } from './shared'
import { fmtDateTime } from './client-types'
import {
  ChevronDown, History, ShieldCheck, SearchCheck,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ─── Tipos locales (contratos de la API de detalle) ──────────────────

interface EvidenceItem {
  id: string
  extractedFact: string
  truthLevel?: string | null
  confidence?: number | null
  source?: string | null
  provenanceJson?: string | null
  context?: string | null
  verificationStatus?: string | null
  createdAt?: string | null
}
interface RequirementWithEvidence {
  id: string
  code: string
  description: string
  status?: string
  evidences?: EvidenceItem[] | null
}
interface ProcessChangeItem {
  id: string
  field: string
  oldValue?: string | null
  newValue?: string | null
  impact?: string | null
  impactNote?: string | null
  source?: string | null
  detectedAt: string
}
interface ChangesPayload {
  opportunityId: string
  processId: string
  count: number
  changes: ProcessChangeItem[]
}

// ─── Etiquetas y colores ─────────────────────────────────────────────

const TRUTH_STYLE: Record<string, { label: string; cls: string }> = {
  VERIFIED: { label: 'Verificada', cls: 'bg-teal-100 text-teal-800 border-teal-200' },
  OBSERVED: { label: 'Observada', cls: 'bg-teal-100 text-teal-800 border-teal-200' },
  INFERRED: { label: 'Inferida', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  UNKNOWN: { label: 'Desconocida', cls: 'bg-muted text-muted-foreground border-border' },
}

const IMPACT_STYLE: Record<string, { label: string; cls: string }> = {
  ALTA: { label: 'Impacto alto', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  MEDIA: { label: 'Impacto medio', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  BAJA: { label: 'Impacto bajo', cls: 'bg-muted text-muted-foreground border-border' },
}

const FIELD_LABELS: Record<string, string> = {
  objectName: 'Objeto a contratar',
  description: 'Descripción',
  basePrice: 'Valor base estimado',
  state: 'Estado del procedimiento',
  openState: 'Estado de apertura',
  phase: 'Fase',
  receptionDate: 'Fecha de recepción de respuestas',
  publishDate: 'Fecha de publicación',
  awarded: 'Adjudicación',
  url: 'URL en SECOP',
  categoryCode: 'Código UNSPSC',
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function fmtConfidence(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n * 100)}%`
}

function truncate(v: string | null | undefined, max = 160): string {
  if (!v) return '—'
  return v.length > max ? `${v.slice(0, max)}…` : v
}

/** Parseo tolerante de provenanceJson: devuelve objeto o null si no es JSON válido. */
function parseProvenanceSafe(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ─── Fila de evidencia con procedencia colapsable ────────────────────

function EvidenceRow({ ev }: { ev: EvidenceItem }) {
  const [open, setOpen] = useState(false)
  const truth = TRUTH_STYLE[ev.truthLevel || 'UNKNOWN'] || TRUTH_STYLE.UNKNOWN
  const provenance = open ? parseProvenanceSafe(ev.provenanceJson) : null
  const rawInvalid = open && !!ev.provenanceJson && !provenance

  return (
    <li className="rounded-lg border p-3 bg-background">
      <div className="flex flex-wrap items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" aria-hidden />
        <p className="text-sm flex-1 min-w-[200px] leading-relaxed">{ev.extractedFact}</p>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <Badge variant="outline" className={`text-[10px] px-1.5 ${truth.cls}`}>{truth.label}</Badge>
          <Badge variant="secondary" className="text-[10px] px-1.5">confianza {fmtConfidence(ev.confidence)}</Badge>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <p className="text-[11px] text-muted-foreground">
          Fuente: <span className="font-mono">{ev.source || '—'}</span>
        </p>
        {(ev.provenanceJson) && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded px-1 min-h-8"
            aria-expanded={open}
          >
            Procedencia
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 rounded-md border bg-muted/30 p-2.5">
          {provenance ? (
            <pre className="text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">
              {JSON.stringify(provenance, null, 2)}
            </pre>
          ) : rawInvalid ? (
            <p className="text-[11px] text-muted-foreground">
              La procedencia no es un JSON estructurado. Contenido crudo:
              <span className="block font-mono mt-1 break-all">{truncate(ev.provenanceJson, 300)}</span>
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Sin datos de procedencia.</p>
          )}
        </div>
      )}
    </li>
  )
}

// ─── Evidencias agrupadas por requisito ──────────────────────────────

function EvidencesByRequirement({ requirements }: { requirements: RequirementWithEvidence[] }) {
  const groups = requirements.map((r) => ({ r, evs: r.evidences || [] }))
  const totalEvs = groups.reduce((acc, g) => acc + g.evs.length, 0)

  if (groups.length === 0) {
    return (
      <EmptyState
        title="Aún no hay requisitos analizados"
        hint="Ejecuta «Analizar con IA» para generar la matriz de requisitos y recolectar evidencia."
      />
    )
  }
  if (totalEvs === 0) {
    return (
      <EmptyState
        title="Sin evidencia registrada"
        hint="La matriz de requisitos existe, pero no hay evidencias asociadas. Vuelve a analizar la oportunidad para recolectarlas."
      />
    )
  }

  return (
    <div className="space-y-4">
      {groups.map(({ r, evs }) => (
        <div key={r.id}>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">{r.code}</span>
            <p className="text-sm font-medium flex-1 min-w-[200px]">{r.description}</p>
            {evs.length > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5">{evs.length} evidencia(s)</Badge>
            )}
          </div>
          {evs.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-lg border border-dashed px-3 py-2">
              Sin evidencias para este requisito.
            </p>
          ) : (
            <ul className="space-y-2">
              {evs.map((ev) => <EvidenceRow key={ev.id} ev={ev} />)}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Historial de cambios (ProcessChange) como línea de tiempo ───────

function ImpactChip({ impact }: { impact?: string | null }) {
  const imp = IMPACT_STYLE[impact || ''] || IMPACT_STYLE.BAJA
  return <Badge variant="outline" className={`text-[10px] px-1.5 whitespace-nowrap ${imp.cls}`}>{imp.label}</Badge>
}

function ChangesTimeline({ opportunityId }: { opportunityId: string }) {
  const { toast } = useToast()
  const [data, setData] = useState<ChangesPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/opportunities/${opportunityId}/changes`)
        if (!res.ok) throw new Error(`Error ${res.status}`)
        const d = (await res.json()) as ChangesPayload
        if (alive) setData(d)
      } catch {
        if (alive) {
          setData(null)
          toast({ title: 'No se pudo cargar el historial de cambios', variant: 'destructive' })
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => { alive = false }
  }, [opportunityId])

  if (loading) return <Spinner label="Consultando historial de cambios…" />

  if (!data || data.changes.length === 0) {
    return (
      <EmptyState
        title="Sin modificaciones registradas"
        hint="Cuando el agente detecte cambios del proceso en SECOP (valores, fechas, estado), aparecerán aquí con su impacto."
      />
    )
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        {data.count} cambio(s) detectado(s) en el proceso <span className="font-mono">{data.processId}</span>
      </p>
      <ol className="relative border-l ml-3 space-y-4">
        {data.changes.map((c) => (
          <li key={c.id} className="ml-4">
            <span
              className="absolute -left-[7px] mt-1.5 w-3.5 h-3.5 rounded-full border-2 border-background bg-teal-600"
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{fieldLabel(c.field)}</p>
              <ImpactChip impact={c.impact} />
              <span className="text-[11px] text-muted-foreground ml-auto" title={fmtDateTime(c.detectedAt)}>
                {fmtDateTime(c.detectedAt)}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground line-through decoration-rose-400/70 break-all max-w-full" title={c.oldValue || undefined}>
                {truncate(c.oldValue, 120)}
              </span>
              <span aria-hidden>→</span>
              <span className="font-medium break-all max-w-full" title={c.newValue || undefined}>
                {truncate(c.newValue, 120)}
              </span>
            </div>
            {c.impactNote && <p className="text-xs text-muted-foreground mt-1">{c.impactNote}</p>}
            {c.source && <p className="text-[11px] text-muted-foreground mt-0.5">Fuente: <span className="font-mono">{c.source}</span></p>}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─── Sección exportada (pestaña Evidencia del detalle) ───────────────

export function EvidenceSection({ opportunityId, requirements }: {
  opportunityId: string
  requirements: RequirementWithEvidence[]
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <SearchCheck className="w-4 h-4 text-emerald-700" aria-hidden /> Evidencia por requisito
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Hechos extraídos con su nivel de verdad y procedencia. El agente no inventa: cada afirmación remite a su fuente.
          </p>
        </CardHeader>
        <CardContent>
          <EvidencesByRequirement requirements={requirements} />
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-700" aria-hidden /> Historial de cambios del proceso
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Modificaciones detectadas en SECOP II (valor anterior → nuevo) con su impacto sobre la oportunidad.
          </p>
        </CardHeader>
        <CardContent>
          <ChangesTimeline opportunityId={opportunityId} />
        </CardContent>
      </Card>
    </div>
  )
}
