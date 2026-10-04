'use client'

import { Badge } from '@/components/ui/badge'
import { STATUS_COLORS, STATUS_LABELS, REQ_COLORS, REQ_LABELS, DIM_COLORS } from './client-types'
import { CheckCircle2, XCircle, Clock, SearchCheck, MinusCircle, AlertTriangle } from 'lucide-react'
import type { DimensionData } from './client-types'

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`${STATUS_COLORS[status] || 'bg-muted'} border font-medium whitespace-nowrap`}>
      {STATUS_LABELS[status] || status}
    </Badge>
  )
}

export function ReqStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`${REQ_COLORS[status] || 'bg-muted'} border font-medium whitespace-nowrap`}>
      {REQ_LABELS[status] || status}
    </Badge>
  )
}

export function ScoreBadge({ score, size = 'sm' }: { score: number; size?: 'sm' | 'lg' }) {
  const color = score >= 70 ? 'bg-emerald-600' : score >= 50 ? 'bg-teal-500' : score >= 30 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div
      className={`${color} text-white rounded-lg font-bold flex flex-col items-center justify-center leading-none ${
        size === 'lg' ? 'w-16 h-16 text-xl' : 'w-11 h-11 text-sm'
      }`}
      title={`Compatibilidad: ${score}/100`}
    >
      {score}
      <span className={`${size === 'lg' ? 'text-[9px]' : 'text-[8px]'} font-normal opacity-90 mt-0.5`}>compat.</span>
    </div>
  )
}

export function DimIcon({ result }: { result: DimensionData['result'] }) {
  if (result === 'OK') return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden />
  if (result === 'PARCIAL') return <Clock className="w-4 h-4 text-amber-600 shrink-0" aria-hidden />
  if (result === 'NO') return <XCircle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden />
  return <MinusCircle className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
}

export function ReqIcon({ status }: { status: string }) {
  if (status === 'CUMPLE') return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden />
  if (status === 'NO_CUMPLE') return <XCircle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden />
  if (status === 'REQUIERE_REVISION') return <SearchCheck className="w-4 h-4 text-orange-600 shrink-0" aria-hidden />
  return <Clock className="w-4 h-4 text-amber-600 shrink-0" aria-hidden />
}

export function UnconfirmedWarn({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
      <span>
        Esta propuesta contiene <strong>{count} dato(s) marcado(s) [POR CONFIRMAR]</strong>. El agente nunca inventa información: complétala o valídala antes de aprobar.
      </span>
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 px-6 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {hint && <p className="text-sm text-muted-foreground max-w-md">{hint}</p>}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10" role="status" aria-live="polite">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden />
      <span className="text-sm text-muted-foreground">{label || 'Cargando…'}</span>
    </div>
  )
}
