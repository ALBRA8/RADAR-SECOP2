'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { StatusBadge, ScoreBadge, Spinner, EmptyState } from './shared'
import { fmtCOP, fmtDate, fmtDateTime, daysUntil, type OpportunityData, type NotificationData } from './client-types'
import { RefreshCw, Radar, CalendarClock, ClipboardList, Inbox, FileText, XCircle, CheckCircle2, Bell, Building2 } from 'lucide-react'

interface DashboardPayload {
  company: { id: string; name: string } | null
  stats: { nuevas: number; enAnalisis: number; compatibles: number; aprobadas: number; enPreparacion: number; descartadas: number; propuestas: number }
  topOpportunities: OpportunityData[]
  expiring: { id: string; processId: string; entity: string; objectName: string; receptionDate: string | null; score: number }[]
  alerts: NotificationData[]
  lastSync: { at: string; detail: string } | null
}

export function DashboardView({
  payload,
  loading,
  onOpenOpportunity,
  onSync,
  syncing,
  onGoTo,
}: {
  payload: DashboardPayload | null
  loading: boolean
  onOpenOpportunity: (id: string) => void
  onSync: () => void
  syncing: boolean
  onGoTo: (view: 'oportunidades' | 'empresa' | 'alertas') => void
}) {
  if (loading || !payload) return <Spinner label="Cargando panel…" />

  const s = payload.stats
  const kpis = [
    { label: 'Nuevas oportunidades', value: s.nuevas, icon: Inbox, color: 'text-emerald-600', view: 'oportunidades' as const },
    { label: 'En análisis', value: s.enAnalisis, icon: Radar, color: 'text-amber-600', view: 'oportunidades' as const },
    { label: 'Compatibles', value: s.compatibles, icon: CheckCircle2, color: 'text-teal-600', view: 'oportunidades' as const },
    { label: 'Aprobadas p/ preparación', value: s.aprobadas, icon: ClipboardList, color: 'text-lime-600', view: 'oportunidades' as const },
    { label: 'Propuestas en preparación', value: s.enPreparacion, icon: FileText, color: 'text-orange-600', view: 'oportunidades' as const },
    { label: 'Descartadas', value: s.descartadas, icon: XCircle, color: 'text-rose-600', view: 'oportunidades' as const },
  ]

  return (
    <div className="space-y-6">
      {/* Monitoreo */}
      <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50">
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-emerald-600 p-2.5 text-white shrink-0" aria-hidden>
              <Radar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold">Monitoreo de SECOP II</h3>
              <p className="text-sm text-muted-foreground">
                Fuente oficial: datos.gov.co — SECOP II Procesos de Contratación.
                {payload.lastSync && <> Última ingesta: {fmtDateTime(payload.lastSync.at)}.</>}
              </p>
            </div>
          </div>
          <Button onClick={onSync} disabled={syncing} className="bg-emerald-600 hover:bg-emerald-700 shrink-0 min-h-11">
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
            {syncing ? 'Consultando SECOP…' : 'Sincronizar ahora'}
          </Button>
        </CardContent>
      </Card>

      {!payload.company && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-amber-700 shrink-0" aria-hidden />
              <p className="text-sm text-amber-900">Aún no hay una empresa configurada. Registra el perfil para activar el monitoreo.</p>
            </div>
            <Button variant="outline" onClick={() => onGoTo('empresa')} className="border-amber-400 shrink-0 min-h-11">
              Configurar empresa
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <button
            key={k.label}
            onClick={() => onGoTo(k.view)}
            className="text-left rounded-lg border bg-card p-4 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-600"
            aria-label={`${k.label}: ${k.value}`}
          >
            <k.icon className={`w-4 h-4 ${k.color}`} aria-hidden />
            <p className="text-2xl font-bold mt-2 tabular-nums">{k.value}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-tight">{k.label}</p>
          </button>
        ))}
      </div>

      {/* Top 5 priorizadas */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Radar className="w-5 h-5 text-emerald-600" aria-hidden />
            Top 5 oportunidades prioritarias
          </CardTitle>
          <p className="text-sm text-muted-foreground">Ordenadas por compatibilidad con el perfil de tu empresa. Puntúa y explica cada caso.</p>
        </CardHeader>
        <CardContent>
          {payload.topOpportunities.length === 0 ? (
            <EmptyState
              title="Todavía no hay oportunidades priorizadas"
              hint="Usa «Sincronizar ahora» para consultar los procesos recientes de SECOP II. Si es tu primera vez, configura primero el perfil de la empresa."
            />
          ) : (
            <ol className="space-y-3">
              {payload.topOpportunities.map((o, idx) => (
                <li key={o.id}>
                  <button
                    onClick={() => onOpenOpportunity(o.id)}
                    className="w-full text-left rounded-lg border p-4 transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        {idx < 5 && <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>}
                        <ScoreBadge score={o.score} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{o.process.id}</span>
                          <StatusBadge status={o.status} />
                          {o.rank && (
                            <Badge variant="secondary" className="text-[11px]">
                              Prioridad {o.rank}
                            </Badge>
                          )}
                        </div>
                        <p className="font-medium mt-1 line-clamp-2">{o.process.objectName}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{o.process.entity}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{fmtCOP(o.process.basePrice)}</span>
                          <span>{o.process.department || 'Ubicación n/d'}</span>
                          <span>{o.process.modality || 'Modalidad n/d'}</span>
                          <span>Fase: {o.process.phase || 'n/d'}</span>
                        </div>
                        <Progress value={o.score} className="h-1.5 mt-3" aria-label={`Compatibilidad ${o.score}%`} />
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Próximas a vencer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-amber-600" aria-hidden />
              Próximas a vencer
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Según la fecha de recepción de respuestas publicada por la entidad (no todas las entidades la publican).
            </p>
          </CardHeader>
          <CardContent>
            {payload.expiring.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Sin fechas límite próximas publicadas.</p>
            ) : (
              <ul className="space-y-2.5">
                {payload.expiring.map((e) => {
                  const d = daysUntil(e.receptionDate)
                  return (
                    <li key={e.id}>
                      <button onClick={() => onOpenOpportunity(e.id)} className="w-full text-left rounded-md border px-3 py-2.5 hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{e.processId}</span>
                          <Badge variant="outline" className={`${d != null && d <= 5 ? 'border-rose-300 text-rose-700 bg-rose-50' : 'border-amber-300 text-amber-800 bg-amber-50'}`}>
                            {d != null ? `${d} día(s)` : fmtDate(e.receptionDate)}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium line-clamp-1 mt-1">{e.objectName}</p>
                        <p className="text-xs text-muted-foreground">{e.entity}</p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Alertas recientes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="w-5 h-5 text-orange-600" aria-hidden />
              Alertas recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {payload.alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Sin alertas por ahora.</p>
            ) : (
              <ul className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {payload.alerts.map((a) => (
                  <li key={a.id} className={`rounded-md border px-3 py-2.5 ${a.read ? 'opacity-60' : 'border-l-4 border-l-emerald-600'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{a.title}</p>
                      {!a.read && <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" aria-label="No leída" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{a.message}</p>
                    {a.opportunityId && (
                      <button onClick={() => onOpenOpportunity(a.opportunityId!)} className="text-xs font-medium text-emerald-700 hover:underline mt-1 focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded">
                        Ver oportunidad →
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => onGoTo('alertas')}>
              Ver todas las alertas →
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
