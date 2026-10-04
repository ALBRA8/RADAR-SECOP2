'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge, ScoreBadge, Spinner, EmptyState } from './shared'
import { fmtCOP, fmtDate, STATUS_LABELS, type OpportunityData } from './client-types'
import { Search, MapPin, Calendar, Landmark, FilePlus2, Ban } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export function OpportunitiesView({
  opportunities,
  loading,
  onOpenOpportunity,
  onAnalyze,
  onDiscard,
  onApprovePrep,
  analyzingId,
}: {
  opportunities: OpportunityData[]
  loading: boolean
  onOpenOpportunity: (id: string) => void
  onAnalyze: (id: string) => void
  onDiscard: (id: string, reason: string) => void
  onApprovePrep: (id: string) => void
  analyzingId: string | null
}) {
  const { toast } = useToast()
  const [status, setStatus] = useState('TODAS')
  const [q, setQ] = useState('')

  const filtered = opportunities.filter((o) => {
    if (status !== 'TODAS' && o.status !== status) return false
    if (q) {
      const hay = `${o.process.objectName} ${o.process.description || ''} ${o.process.entity} ${o.process.id}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Flujo de oportunidades</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center mt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por objeto, entidad o ID del proceso…" className="pl-8" aria-label="Buscar oportunidades" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Filtrar por estado">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todos los estados</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Spinner label="Cargando oportunidades…" />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No hay oportunidades que coincidan"
              hint="Ajusta los filtros o ejecuta una sincronización desde el panel. Recuerda: solo pasan los procesos que superan el filtro determinístico y el umbral de compatibilidad."
            />
          ) : (
            <ul className="space-y-3">
              {filtered.map((o) => (
                <li key={o.id} className="rounded-lg border p-4 hover:shadow-sm transition-shadow">
                  <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex md:flex-col items-center md:items-stretch gap-2 shrink-0">
                      <ScoreBadge score={o.score} size="lg" />
                      {o.rank && (
                        <Badge variant="secondary" className="text-[11px]">Prio. {o.rank}</Badge>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => onOpenOpportunity(o.id)} className="font-mono text-xs text-emerald-700 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded" title="Abrir expediente">
                          {o.process.id}
                        </button>
                        <StatusBadge status={o.status} />
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <Landmark className="w-3 h-3" aria-hidden /> {o.process.entity}
                        </span>
                      </div>

                      <button onClick={() => onOpenOpportunity(o.id)} className="text-left focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded">
                        <h3 className="font-medium mt-1 line-clamp-2 hover:text-emerald-700">{o.process.objectName}</h3>
                      </button>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{fmtCOP(o.process.basePrice)}</span>
                        <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden />{o.process.city || '—'} / {o.process.department || '—'}</span>
                        <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" aria-hidden />Publicada {fmtDate(o.process.publishDate)}</span>
                        <span>{o.process.contractType || 'Tipo n/d'}</span>
                      </div>

                      {o.status === 'DESCARTADA' && o.discardReason && (
                        <p className="text-xs text-rose-700 mt-2 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                          Motivo del descarte: {o.discardReason}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2 mt-3">
                        <Button size="sm" variant="outline" onClick={() => onOpenOpportunity(o.id)} className="min-h-9">
                          Ver expediente
                        </Button>
                        {(o.status === 'NUEVA' || o.status === 'COMPATIBLE' || o.status === 'EN_ANALISIS') && (
                          <Button
                            size="sm"
                            onClick={() => onAnalyze(o.id)}
                            disabled={analyzingId === o.id}
                            className="bg-emerald-600 hover:bg-emerald-700 min-h-9"
                          >
                            <FilePlus2 className="w-4 h-4 mr-1.5" aria-hidden />
                            {analyzingId === o.id ? 'Analizando con IA…' : o.requirements && o.requirements.length > 0 ? 'Re-analizar con IA' : 'Analizar con IA'}
                          </Button>
                        )}
                        {(o.status === 'NUEVA' || o.status === 'COMPATIBLE' || o.status === 'EN_ANALISIS') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const reason = window.prompt('Motivo del descarte (obligatorio):')
                              if (reason && reason.trim()) onDiscard(o.id, reason.trim())
                              else if (reason !== null) toast({ title: 'El motivo es obligatorio para descartar', variant: 'destructive' })
                            }}
                            className="min-h-9"
                          >
                            <Ban className="w-4 h-4 mr-1.5" aria-hidden />
                            Descartar
                          </Button>
                        )}
                        {o.status === 'COMPATIBLE' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onApprovePrep(o.id)}
                            className="border-lime-500 text-lime-700 hover:bg-lime-50 min-h-9"
                          >
                            Aprobar para preparación
                          </Button>
                        )}
                        {o.status === 'APROBADA_PREPARACION' && (
                          <Button
                            size="sm"
                            onClick={() => onOpenOpportunity(o.id)}
                            className="bg-lime-600 hover:bg-lime-700 min-h-9"
                          >
                            <FilePlus2 className="w-4 h-4 mr-1.5" aria-hidden />
                            Preparar propuesta
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
