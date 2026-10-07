// EVIDENCE CONTRACT — Task 2-a (RADAR-SECOP2)
// Principio central: NUNCA INVENTAR. Toda afirmación importante debe poder responder:
// ¿de dónde salió?, ¿cuándo?, ¿qué documento lo respalda?, ¿fue observado o inferido?
// Regla de oro: solo VERIFIED/OBSERVED pueden respaldar un CUMPLE definitivo.
// INFERRED + CUMPLE es INVÁLIDO como conclusión definitiva.

import { db } from '@/lib/db'

/** Niveles de verdad admitidos por el contracto de evidencia. */
export const TRUTH_LEVELS = ['VERIFIED', 'OBSERVED', 'INFERRED', 'ESTIMATED', 'UNKNOWN'] as const

export type TruthLevel = (typeof TRUTH_LEVELS)[number]

/** Categorías de requisito (pliego SECOP II). */
export const REQUIREMENT_CATEGORIES = ['HABILITANTE', 'TECNICO', 'ECONOMICO', 'JURIDICO', 'ADMINISTRATIVO'] as const

/** Obligatoriedad declarada del requisito en el pliego. */
export const OBLIGATORINESS_LEVELS = ['OBLIGATORIO', 'OPCIONAL', 'DESEABLE', 'AMBIGUO', 'DESCONOCIDO'] as const

/**
 * ¿Puede este nivel de verdad respaldar un estado CUMPLE definitivo?
 * SOLO VERIFIED (corroborado por fuente primaria) u OBSERVED (dato real observado,
 * p. ej. campo de la API de SECOP o cita textual del pliego).
 */
export function canBackCompliance(truthLevel: string | null | undefined): boolean {
  return truthLevel === 'VERIFIED' || truthLevel === 'OBSERVED'
}

/** Normaliza cualquier valor a un TruthLevel válido; fallback UNKNOWN. */
export function normalizeTruthLevel(v: unknown): TruthLevel {
  const up = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return (TRUTH_LEVELS as readonly string[]).includes(up) ? (up as TruthLevel) : 'UNKNOWN'
}

/** Normaliza categoría de requisito; fallback null (desconocida). */
export function normalizeCategory(v: unknown): string | null {
  const up = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return (REQUIREMENT_CATEGORIES as readonly string[]).includes(up) ? up : null
}

/** Normaliza obligatoriedad; fallback DESCONOCIDO. */
export function normalizeObligatoriness(v: unknown): string {
  const up = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return (OBLIGATORINESS_LEVELS as readonly string[]).includes(up) ? up : 'DESCONOCIDO'
}

/** Clamp 0..1 con fallback 0.5. */
export function clampConfidence(v: unknown, fallback = 0.5): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/**
 * Construye el JSON de procedencia (provenanceJson): método, timestamp y extractor
 * son SIEMPRE presentes; el resto de metadatos se conservan tal cual.
 */
export function buildProvenance(meta: Record<string, unknown>): string {
  const { method, timestamp, extractor, ...rest } = meta
  return JSON.stringify({
    method: typeof method === 'string' && method ? method : 'UNKNOWN',
    timestamp: typeof timestamp === 'string' && timestamp ? timestamp : new Date().toISOString(),
    extractor: typeof extractor === 'string' && extractor ? extractor : 'RADAR-SECOP2',
    ...rest,
  })
}

export interface CreateEvidenceInput {
  source: string // SECOP_API | PLIEGO_PDF | IA_INFERENCIA | PERFIL_EMPRESA | ...
  sourceType: string // API | DOCUMENT | INFERRED | PROFILE | ...
  extractedFact: string
  sourceUrl?: string | null
  sourceDocId?: string | null
  sourceMessageId?: string | null
  timestamp?: Date | null
  context?: string | null
  confidence?: number
  truthLevel?: string
  verificationStatus?: string
  provenanceJson?: string | null
  relatedRequirementId?: string | null
  relatedOpportunityId?: string | null
  agentId?: string
}

/**
 * Inserta una fila Evidence con defaults seguros (nunca inventa):
 * - confidence clampeado 0..1 (default 0.5)
 * - truthLevel normalizado (default UNKNOWN)
 * - verificationStatus default UNVERIFIED
 * - agentId default RADAR-SECOP2
 */
export async function createEvidenceRow(partial: CreateEvidenceInput) {
  return db.evidence.create({
    data: {
      agentId: partial.agentId || 'RADAR-SECOP2',
      source: partial.source || 'MANUAL',
      sourceType: partial.sourceType || 'INFERRED',
      sourceUrl: partial.sourceUrl ?? null,
      sourceDocId: partial.sourceDocId ?? null,
      sourceMessageId: partial.sourceMessageId ?? null,
      timestamp: partial.timestamp ?? null,
      extractedFact: (partial.extractedFact || '').trim() || '(sin hecho extraído)',
      context: partial.context ?? null,
      confidence: clampConfidence(partial.confidence),
      truthLevel: normalizeTruthLevel(partial.truthLevel),
      verificationStatus: partial.verificationStatus || 'UNVERIFIED',
      provenanceJson: partial.provenanceJson ?? null,
      relatedRequirementId: partial.relatedRequirementId ?? null,
      relatedOpportunityId: partial.relatedOpportunityId ?? null,
    },
  })
}
