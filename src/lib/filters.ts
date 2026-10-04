// MÓDULO B — FILTRO DETERMINÍSTICO
// Reglas simples y verificables ANTES de usar IA. Parámetros configurables por empresa.

import type { CompanyConfigData, RawSecopRecord } from './types'

export interface FilterOutcome {
  passed: boolean
  reasons: string[] // motivos del descarte o notas del paso
}

const FINAL_STATES = ['adjudic', 'cerrad', 'terminad', 'liquidad', 'cancelad', 'revocado', 'descartado', 'suspendid']

function isProcessFinished(rec: RawSecopRecord): boolean {
  const hay = `${rec.state || ''} ${rec.phase || ''} ${rec.openState || ''}`.toLowerCase()
  return FINAL_STATES.some((s) => hay.includes(s))
}

/**
 * Aplica el filtro determinístico según la configuración de la empresa.
 * Nunca descarta silenciosamente: devuelve los motivos.
 */
export function applyDeterministicFilter(company: CompanyConfigData, rec: RawSecopRecord): FilterOutcome {
  const notes: string[] = []
  const discard: string[] = []

  // 1. Valor dentro del rango económico configurado
  if (rec.basePrice == null) {
    notes.push('Valor no publicado — requiere validación humana')
  } else if (rec.basePrice < company.minBudget) {
    discard.push(`Valor ($${fmt(rec.basePrice)}) por debajo del rango mínimo ($${fmt(company.minBudget)})`)
  } else if (rec.basePrice > company.maxBudget) {
    discard.push(`Valor ($${fmt(rec.basePrice)}) supera el rango máximo ($${fmt(company.maxBudget)})`)
  } else {
    notes.push(`Valor dentro del rango configurado`)
  }

  // 2. Proceso vigente (no terminado/adjudicado/cerrado)
  if (isProcessFinished(rec)) {
    discard.push(`Proceso no vigente (estado: ${rec.state || rec.phase || 'desconocido'})`)
  }

  // 3. Fase de interés configurada
  if (company.phasesAllowed.length > 0 && rec.phase) {
    const ok = company.phasesAllowed.some((p) => eq(p, rec.phase))
    if (!ok) discard.push(`Fase "${rec.phase}" fuera de las fases de interés`)
  }

  // 4. Modalidad permitida
  if (company.modalitiesAllowed.length > 0 && rec.modality) {
    const ok = company.modalitiesAllowed.some((m) => eq(m, rec.modality))
    if (!ok) discard.push(`Modalidad "${rec.modality}" no está entre las modalidades de interés`)
  }

  // 5. Tipo de contrato permitido
  if (company.contractTypesAllowed.length > 0 && rec.contractType) {
    const ok = company.contractTypesAllowed.some((t) => eq(t, rec.contractType))
    if (!ok) discard.push(`Tipo de contrato "${rec.contractType}" fuera del alcance configurado`)
  }

  // 6. Ubicación permitida (departamento)
  if (company.departmentsAllowed.length > 0 && rec.department) {
    const ok = company.departmentsAllowed.some((d) => eq(d, rec.department) || fuzzyDept(d, rec.department))
    if (!ok) discard.push(`Departamento "${rec.department}" fuera de la cobertura configurada`)
  }

  // 7. Exclusión por palabras clave (si la empresa exige coincidencia)
  //    La coincidencia semántica fina se hace en el motor de compatibilidad (Módulo E).
  if (company.requireKeywordHit) {
    const kwHits = keywordHits(company, rec)
    if (kwHits === 0) {
      discard.push('Sin coincidencia con palabras clave/categorías de la empresa')
    }
  }

  return { passed: discard.length === 0, reasons: [...discard, ...notes] }
}

// ─── helpers ─────────────────────────────────────────────────

function eq(a: string, b?: string | null): boolean {
  if (!b) return false
  const na = norm(a)
  const nb = norm(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

// Cobertura geográfica tolerante: "Bogotá" ↔ "Distrito Capital de Bogotá"
function fuzzyDept(configured: string, actual: string): boolean {
  const nA = norm(configured)
  const nB = norm(actual)
  if (nB.includes(nA) || nA.includes(nB)) return true
  const wordsA = nA.split(/\s+/).filter((w) => w.length > 3)
  return wordsA.length > 0 && wordsA.every((w) => nB.includes(w))
}

function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)
}

/** Cuenta coincidencias de palabras clave de la empresa en el texto del proceso. */
export function keywordHits(company: CompanyConfigData & { productsKeywords?: string[] }, rec: RawSecopRecord): number {
  const text = norm(`${rec.objectName} ${rec.description || ''} ${rec.categoryCode || ''}`)
  const kws = company.productsKeywords || []
  let hits = 0
  for (const kw of kws) {
    const n = norm(kw)
    if (n.length >= 4 && text.includes(n)) hits++
  }
  return hits
}
