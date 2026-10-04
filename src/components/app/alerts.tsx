'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner, EmptyState } from './shared'
import { fmtDateTime, ALERT_TYPE_LABELS, type NotificationData } from './client-types'
import { Bell, CheckCheck } from 'lucide-react'

const TYPE_STYLES: Record<string, string> = {
  ALTA_COMPATIBILIDAD: 'border-l-emerald-600',
  NUEVA_OPORTUNIDAD: 'border-l-teal-500',
  DOCUMENTO_FALTANTE: 'border-l-amber-500',
  REQUISITO_CRITICO: 'border-l-rose-600',
  PROCESO_MODIFICADO: 'border-l-orange-500',
  INFO_FALTANTE: 'border-l-amber-400',
  SISTEMA: 'border-l-slate-400',
}

export function AlertsView({
  notifications,
  unread,
  loading,
  onOpenOpportunity,
  onMarkAllRead,
  onMarkRead,
}: {
  notifications: NotificationData[]
  unread: number
  loading: boolean
  onOpenOpportunity: (id: string) => void
  onMarkAllRead: () => void
  onMarkRead: (id: string) => void
}) {
  if (loading) return <Spinner label="Cargando alertas…" />

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="w-5 h-5 text-orange-600" aria-hidden />
            Alertas
            {unread > 0 && <Badge className="bg-emerald-600">{unread} sin leer</Badge>}
          </CardTitle>
          {unread > 0 && (
            <Button size="sm" variant="outline" onClick={onMarkAllRead} className="min-h-9">
              <CheckCheck className="w-4 h-4 mr-1.5" aria-hidden /> Marcar todas como leídas
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Se generan cuando aparece una oportunidad compatible, se aproxima una fecha límite, cambia un proceso, faltan documentos o hay requisitos críticos sin cubrir.
        </p>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <EmptyState title="No hay alertas" hint="Sincroniza con SECOP II desde el panel para empezar a generar alertas." />
        ) : (
          <ul className="space-y-2.5">
            {notifications.map((n) => (
              <li key={n.id} className={`rounded-md border border-l-4 px-3.5 py-3 ${TYPE_STYLES[n.type] || 'border-l-slate-300'} ${n.read ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-sm">{n.title}</p>
                  <Badge variant="secondary" className="text-[10px]">{ALERT_TYPE_LABELS[n.type] || n.type}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{fmtDateTime(n.createdAt)}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{n.message}</p>
                <div className="flex gap-3 mt-1.5">
                  {n.opportunityId && (
                    <button onClick={() => onOpenOpportunity(n.opportunityId!)} className="text-xs font-medium text-emerald-700 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded">
                      Ver oportunidad →
                    </button>
                  )}
                  {!n.read && (
                    <button onClick={() => onMarkRead(n.id)} className="text-xs text-muted-foreground hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded">
                      Marcar como leída
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
