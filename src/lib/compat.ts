// MÓDULO E — MOTOR DE COMPATIBILIDAD
// No usa solamente palabras clave: combina objeto/valor/ubicación/experiencia/documentos/fechas/modalidad.
// El resultado es EXPLICABLE: devuelve razones por dimensión, no solo un porcentaje.

import type {
  CompatibilityDimension,
  CompatibilityEvaluation,
  CompanyConfigData,
  DimensionResult,
  DocumentData,
  ExperienceData,
  ProductItemData,
  RawSecopRecord,
} from './types'
import { normalizeText } from './types'

// Pesos configurables (por defecto según importancia relativa)
const DEFAULT_WEIGHTS = {
  objeto: 0.35,
  valor: 0.2,
  ubicacion: 0.15,
  modalidad: 0.1,
  tipoContrato: 0.1,
  vigencia: 0.05,
  preparacion: 0.05,
}

export interface CompatInput {
  company: CompanyConfigData
  products: ProductItemData[]
  experiences: ExperienceData[]
  documents: DocumentData[]
}

/** Extrae el vocabulario de la empresa (frases relevantes para hacer matching). */
function companyVocabulary(input: CompatInput): string[] {
  const vocab: string[] = []
  for (const p of input.products) {
    if (p.name) vocab.push(p.name)
    if (p.description) vocab.push(p.description)
    for (const k of p.keywords) vocab.push(k)
  }
  if (input.company.description) vocab.push(input.company.description)
  return vocab.filter((v) => v && v.trim().length >= 4)
}

/** Evalúa la compatibilidad de un proceso con el perfil de la empresa. Resultado explicable. */
export function evaluateCompatibility(input: CompatInput, rec: RawSecopRecord): CompatibilityEvaluation {
  const dims: CompatibilityDimension[] = []
  const c = input.company

  // ── 1. Relación objeto ↔ productos/servicios ────────────────
  {
    const processText = normalizeText(`${rec.objectName} ${rec.description || ''}`)
    const vocab = companyVocabulary(input)
    const matched: string[] = []
    for (const phrase of vocab) {
      const np = normalizeText(phrase)
      if (np.length >= 4 && processText.includes(np)) matched.push(phrase.trim())
    }
    // Coincidencia por tokens significativos compartidos (respaldo, no único criterio)
    const procTokens = new Set(processText.split(/\s+/).filter((t) => t.length >= 4))
    let tokenHits = 0
    const hitTokens = new Set<string>()
    for (const phrase of vocab) {
      for (const t of normalizeText(phrase).split(/\s+/)) {
        if (t.length >= 4 && procTokens.has(t) && !hitTokens.has(t)) {
          hitTokens.add(t)
          tokenHits++
        }
      }
    }
    const phraseScore = vocab.length ? Math.min(1, matched.length / Math.max(2, Math.min(vocab.length, 5))) : 0
    const tokenScore = vocab.length ? Math.min(1, tokenHits / 6) : 0
    const score = Math.max(phraseScore, tokenScore * 0.7)

    let result: DimensionResult = 'ND'
    let reason: string
    if (!vocab.length) {
      result = 'ND'
      reason = 'La empresa no tiene productos/servicios ni palabras clave registradas'
    } else if (matched.length > 0) {
      result = 'OK'
      reason = `El objeto coincide con: ${matched.slice(0, 4).join(', ')}`
    } else if (tokenScore > 0.15) {
      result = 'PARCIAL'
      reason = `Coincidencia parcial de términos (${tokenHits} términos en común)`
    } else {
      result = 'NO'
      reason = 'El objeto del proceso no guarda relación evidente con los productos/servicios registrados'
    }
    dims.push({ key: 'objeto', label: 'Relación objeto ↔ productos/servicios', result, score, weight: DEFAULT_WEIGHTS.objeto, reason })
  }

  // ── 2. Valor ────────────────────────────────────────────────
  {
    let result: DimensionResult = 'ND'
    let score = 0
    let reason: string
    if (rec.basePrice == null) {
      result = 'ND'
      score = 0.3
      reason = 'Precio base no publicado en SECOP — se requiere validación humana'
    } else if (rec.basePrice >= c.minBudget && rec.basePrice <= c.maxBudget) {
      result = 'OK'
      score = 1
      reason = `Valor dentro del rango configurado ($${fmt(c.minBudget)} – $${fmt(c.maxBudget)})`
    } else if (rec.basePrice < c.minBudget) {
      result = 'PARCIAL'
      score = 0.4
      reason = `Valor ($${fmt(rec.basePrice)}) por debajo del rango mínimo`
    } else {
      result = 'NO'
      score = 0
      reason = `Valor ($${fmt(rec.basePrice)}) supera el rango máximo configurado`
    }
    dims.push({ key: 'valor', label: 'Valor dentro de capacidad económica', result, score, weight: DEFAULT_WEIGHTS.valor, reason })
  }

  // ── 3. Ubicación ────────────────────────────────────────────
  {
    let result: DimensionResult
    let score: number
    let reason: string
    if (!c.departmentsAllowed.length) {
      result = 'OK'
      score = 1
      reason = 'Cobertura nacional configurada — cualquier ubicación es válida'
    } else if (rec.department && c.departmentsAllowed.some((d) => norm(d) === norm(rec.department!) || fuzzy(d, rec.department!))) {
      result = 'OK'
      score = 1
      reason = `Ubicación del proceso (${rec.department}) dentro de la cobertura`
    } else {
      result = 'NO'
      score = 0
      reason = `Ubicación (${rec.department || 'no indicada'}) fuera de la cobertura configurada`
    }
    dims.push({ key: 'ubicacion', label: 'Cobertura geográfica', result, score, weight: DEFAULT_WEIGHTS.ubicacion, reason })
  }

  // ── 4. Modalidad ────────────────────────────────────────────
  {
    let result: DimensionResult
    let score: number
    let reason: string
    if (!c.modalitiesAllowed.length) {
      result = 'OK'
      score = 0.8
      reason = 'Sin preferencia de modalidad configurada'
    } else if (rec.modality && c.modalitiesAllowed.some((m) => norm(m) === norm(rec.modality!))) {
      result = 'OK'
      score = 1
      reason = `Modalidad "${rec.modality}" es de interés para la empresa`
    } else {
      result = 'PARCIAL'
      score = 0.3
      reason = `Modalidad "${rec.modality || 'no indicada'}" no está entre las preferidas`
    }
    dims.push({ key: 'modalidad', label: 'Modalidad de contratación', result, score, weight: DEFAULT_WEIGHTS.modalidad, reason })
  }

  // ── 5. Tipo de contrato ─────────────────────────────────────
  {
    let result: DimensionResult
    let score: number
    let reason: string
    if (!c.contractTypesAllowed.length) {
      result = 'OK'
      score = 0.8
      reason = 'Sin preferencia de tipo de contrato configurada'
    } else if (rec.contractType && c.contractTypesAllowed.some((t) => norm(t) === norm(rec.contractType!))) {
      result = 'OK'
      score = 1
      reason = `Tipo "${rec.contractType}" es de interés`
    } else {
      result = 'PARCIAL'
      score = 0.2
      reason = `Tipo "${rec.contractType || 'no indicado'}" no configurado como interés`
    }
    dims.push({ key: 'tipoContrato', label: 'Tipo de contrato', result, score, weight: DEFAULT_WEIGHTS.tipoContrato, reason })
  }

  // ── 6. Vigencia / fase ──────────────────────────────────────
  {
    const ok = rec.phase && c.phasesAllowed.some((p) => norm(p) === norm(rec.phase!))
    const finished = ['adjudic', 'cerrad', 'cancelad', 'suspendid'].some((s) => norm(`${rec.state} ${rec.phase}`).includes(s))
    const result: DimensionResult = finished ? 'NO' : ok ? 'OK' : 'PARCIAL'
    dims.push({
      key: 'vigencia',
      label: 'Vigencia y fase del proceso',
      result,
      score: finished ? 0 : ok ? 1 : 0.5,
      weight: DEFAULT_WEIGHTS.vigencia,
      reason: finished
        ? 'El proceso parece finalizado o adjudicado'
        : ok
          ? `Fase "${rec.phase}" habilitada para presentar oferta`
          : `Fase "${rec.phase || 'no indicada'}" — verificar si aún acepta ofertas`,
    })
  }

  // ── 7. Preparación documental (Módulo C: solo comprobado) ───
  {
    const docs = input.documents
    const disponibles = docs.filter((d) => d.status === 'DISPONIBLE').length
    const pendientes = docs.filter((d) => d.status !== 'DISPONIBLE').length
    const total = docs.length
    let result: DimensionResult
    let score: number
    let reason: string
    if (total === 0) {
      result = 'ND'
      score = 0
      reason = 'No hay documentos corporativos registrados — cargarlos para mejorar la evaluación'
    } else if (pendientes === 0) {
      result = 'OK'
      score = 1
      reason = `${disponibles} documento(s) corporativo(s) disponible(s), ninguno pendiente`
    } else {
      result = 'PARCIAL'
      score = disponibles / total
      reason = `${disponibles} disponible(s) y ${pendientes} pendiente(s)/vencido(s) en el expediente`
    }
    dims.push({ key: 'preparacion', label: 'Preparación documental de la empresa', result, score, weight: DEFAULT_WEIGHTS.preparacion, reason })
  }

  const totalWeight = dims.reduce((acc, d) => acc + d.weight, 0) || 1
  const score = Math.round((dims.reduce((acc, d) => acc + d.score * d.weight, 0) / totalWeight) * 100)

  const strong = dims.filter((d) => d.result === 'OK' && d.weight >= 0.1).map((d) => d.label)
  const weak = dims.filter((d) => d.result === 'NO' || d.result === 'ND').map((d) => d.label)
  const summary =
    `Compatibilidad ${score}/100. Fortalezas: ${strong.slice(0, 3).join(', ') || 'ninguna clara'}. ` +
    `Puntos a vigilar: ${weak.slice(0, 3).join(', ') || 'ninguno crítico'}.`

  return { score, dimensions: dims, summary }
}

function fuzzy(configured: string, actual: string): boolean {
  const a = norm(configured)
  const b = norm(actual)
  if (b.includes(a) || a.includes(b)) return true
  const words = a.split(/\s+/).filter((w) => w.length > 3)
  return words.length > 0 && words.every((w) => b.includes(w))
}

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)
}
