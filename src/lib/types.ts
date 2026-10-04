// Tipos compartidos del Agente SECOP II

export interface CompanyConfigData {
  id: string
  name: string
  nit?: string | null
  description?: string | null
  city?: string | null
  department?: string | null
  minBudget: number
  maxBudget: number
  departmentsAllowed: string[] // vacío = cobertura nacional
  modalitiesAllowed: string[]
  contractTypesAllowed: string[]
  phasesAllowed: string[]
  requireKeywordHit: boolean
  capacity?: string | null
  approverName?: string | null
}

export interface ProductItemData {
  id: string
  name: string
  description?: string | null
  category?: string | null
  keywords: string[]
}

export interface ExperienceData {
  id: string
  title: string
  entity?: string | null
  year?: number | null
  value?: number | null
  description?: string | null
}

export interface DocumentData {
  id: string
  name: string
  docType?: string | null
  status: 'DISPONIBLE' | 'PENDIENTE' | 'VENCIDO'
  notes?: string | null
}

// ─── Compatibilidad explicable (MÓDULO E) ───────────────────

export type DimensionResult = 'OK' | 'PARCIAL' | 'NO' | 'ND'

export interface CompatibilityDimension {
  key: string
  label: string
  result: DimensionResult
  score: number // 0..1
  weight: number // 0..1
  reason: string
}

export interface CompatibilityEvaluation {
  score: number // 0..100
  dimensions: CompatibilityDimension[]
  summary: string
}

// ─── Análisis inteligente (MÓDULO D) ────────────────────────

export type RequirementStatus = 'CUMPLE' | 'NO_CUMPLE' | 'PENDIENTE' | 'REQUIERE_REVISION'

export interface RequirementItem {
  code: string
  description: string
  status: RequirementStatus
  evidence?: string
  action?: string
  source?: 'IA' | 'REGLA'
}

export interface AnalysisResult {
  summary: string
  requirements: RequirementItem[]
  missingDocs: string[]
  risks: string[]
  nextAction: string
  engine: 'IA' | 'REGLAS'
}

// ─── Propuesta (MÓDULO G) ───────────────────────────────────

export interface ProposalSection {
  key: string
  title: string
  content: string
  unconfirmed?: boolean
}

export interface ChecklistGroup {
  group: string
  items: { label: string; required: boolean }[]
}

// ─── Proceso normalizado de SECOP ───────────────────────────

export interface RawSecopRecord {
  id: string
  entity: string
  nit?: string | null
  department?: string | null
  city?: string | null
  entityOrder?: string | null
  reference?: string | null
  portfolioId?: string | null
  objectName: string
  description?: string | null
  phase?: string | null
  state?: string | null
  openState?: string | null
  basePrice?: number | null
  modality?: string | null
  justification?: string | null
  contractType?: string | null
  subType?: string | null
  duration?: string | null
  durationUnit?: string | null
  unitCity?: string | null
  unitName?: string | null
  categoryCode?: string | null
  publishDate?: Date | null
  lastPubDate?: Date | null
  receptionDate?: Date | null
  openRespDate?: Date | null
  awarded?: string | null
  url?: string | null
}

// ─── Utilidades ─────────────────────────────────────────────

export function parseJsonArray<T = string>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : fallback
  } catch {
    return fallback
  }
}

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeText(text: string): string {
  return stripAccents((text || '').toLowerCase()).replace(/\s+/g, ' ').trim()
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

export const STOPWORDS = new Set([
  'para', 'con', 'las', 'los', 'del', 'por', 'que', 'sus', 'mas', 'sus',
  'como', 'este', 'esta', 'esto', 'sono', ' sido', 'entre', 'hacia',
  'desde', 'sobre', 'cual', 'cuales', 'donde', 'cuando', 'todos', 'todas',
  'otro', 'otros', 'otra', 'otras', 'sera', 'seran', 'sido', 'tener',
  'the', 'and', 'for', 'con', 'loc', 'com', 'ltd', 'sas', 'sa', 'cia',
])
