// Tipos y helpers del lado cliente

export interface ProcessData {
  id: string
  entity: string
  department?: string | null
  city?: string | null
  objectName: string
  description?: string | null
  phase?: string | null
  state?: string | null
  basePrice?: number | null
  modality?: string | null
  contractType?: string | null
  duration?: string | null
  durationUnit?: string | null
  unitName?: string | null
  categoryCode?: string | null
  publishDate?: string | null
  lastPubDate?: string | null
  receptionDate?: string | null
  url?: string | null
  source?: string
}

export interface DimensionData {
  key: string
  label: string
  result: 'OK' | 'PARCIAL' | 'NO' | 'ND'
  score: number
  weight: number
  reason: string
}

export interface RequirementData {
  id: string
  code: string
  description: string
  status: 'CUMPLE' | 'NO_CUMPLE' | 'PENDIENTE' | 'REQUIERE_REVISION'
  evidence?: string | null
  action?: string | null
  source?: string
}

export interface ProposalSectionData {
  key: string
  title: string
  content: string
  unconfirmed?: boolean
}

export interface ChecklistItemData {
  label: string
  required: boolean
  done?: boolean
}

export interface ChecklistGroupData {
  group: string
  items: ChecklistItemData[]
}

export interface ApprovalData {
  id: string
  decision: string
  approver: string
  notes?: string | null
  createdAt: string
}

export interface ProposalData {
  id: string
  version: number
  status: 'BORRADOR' | 'APROBADA'
  sections: ProposalSectionData[]
  checklists: ChecklistGroupData[]
  unconfirmedCount: number
  approvedBy?: string | null
  approvedAt?: string | null
  createdAt: string
  approvals?: ApprovalData[]
}

export interface OpportunityData {
  id: string
  status: 'NUEVA' | 'EN_ANALISIS' | 'COMPATIBLE' | 'APROBADA_PREPARACION' | 'DESCARTADA'
  score: number
  reasons: DimensionData[]
  missingDocs: string[]
  risks: string[]
  nextAction?: string | null
  analysisSummary?: string | null
  discardReason?: string | null
  rank?: number | null
  createdAt: string
  updatedAt: string
  process: ProcessData
  requirements?: RequirementData[]
  proposals?: ProposalData[]
}

export interface CompanyProfile {
  id: string
  name: string
  nit?: string | null
  description?: string | null
  city?: string | null
  department?: string | null
  minBudget: number
  maxBudget: number
  departmentsAllowed: string[]
  modalitiesAllowed: string[]
  contractTypesAllowed: string[]
  phasesAllowed: string[]
  requireKeywordHit: boolean
  capacity?: string | null
  approverName?: string | null
  products: { id: string; name: string; description?: string | null; category?: string | null; keywords: string[] }[]
  experiences: { id: string; title: string; entity?: string | null; year?: number | null; value?: number | null; description?: string | null }[]
  documents: { id: string; name: string; docType?: string | null; status: string; notes?: string | null }[]
}

export interface NotificationData {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  createdAt: string
  opportunityId?: string | null
  processId?: string | null
}

// ─── Formato ────────────────────────────────────────────────

const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

export function fmtCOP(n?: number | null): string {
  if (n == null) return 'No publicado'
  return copFormatter.format(n)
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return '—'
  }
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  return Math.ceil(diff / (24 * 3600 * 1000))
}

// ─── Etiquetas de estado ────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  NUEVA: 'Nueva',
  EN_ANALISIS: 'En análisis',
  COMPATIBLE: 'Compatible',
  APROBADA_PREPARACION: 'Aprobada p/ preparación',
  DESCARTADA: 'Descartada',
}

export const STATUS_COLORS: Record<string, string> = {
  NUEVA: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EN_ANALISIS: 'bg-amber-100 text-amber-800 border-amber-200',
  COMPATIBLE: 'bg-teal-100 text-teal-800 border-teal-200',
  APROBADA_PREPARACION: 'bg-lime-100 text-lime-800 border-lime-200',
  DESCARTADA: 'bg-rose-100 text-rose-700 border-rose-200',
}

export const REQ_COLORS: Record<string, string> = {
  CUMPLE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  NO_CUMPLE: 'bg-rose-100 text-rose-700 border-rose-200',
  PENDIENTE: 'bg-amber-100 text-amber-800 border-amber-200',
  REQUIERE_REVISION: 'bg-orange-100 text-orange-800 border-orange-200',
}

export const REQ_LABELS: Record<string, string> = {
  CUMPLE: 'Cumple',
  NO_CUMPLE: 'No cumple',
  PENDIENTE: 'Pendiente',
  REQUIERE_REVISION: 'Requiere revisión',
}

export const DIM_COLORS: Record<string, string> = {
  OK: 'text-emerald-600',
  PARCIAL: 'text-amber-600',
  NO: 'text-rose-600',
  ND: 'text-muted-foreground',
}

export const ALERT_TYPE_LABELS: Record<string, string> = {
  NUEVA_OPORTUNIDAD: 'Nueva oportunidad',
  ALTA_COMPATIBILIDAD: 'Alta compatibilidad',
  DOCUMENTO_FALTANTE: 'Documento faltante',
  REQUISITO_CRITICO: 'Requisito crítico',
  PROCESO_MODIFICADO: 'Proceso modificado',
  INFO_FALTANTE: 'Información faltante',
  SISTEMA: 'Sistema',
}

export function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-600'
  if (score >= 50) return 'bg-teal-500'
  if (score >= 30) return 'bg-amber-500'
  return 'bg-rose-500'
}
