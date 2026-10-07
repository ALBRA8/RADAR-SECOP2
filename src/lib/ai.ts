// MÓDULOS D y G — ANÁLISIS INTELIGENTE Y GENERACIÓN DE PROPUESTA (IA)
// REGLA CRÍTICA: el agente NUNCA inventa experiencia, contratos, certificaciones,
// capacidades, precios, firmas, documentos o declaraciones. Todo lo no confirmado
// queda marcado como PENDIENTE / REQUIERE_REVISIÓN.

import ZAI from 'z-ai-web-dev-sdk'

/** Cliente tipado del SDK (el constructor es privado, se infiere de create()). */
type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>
import type {
  AnalysisResult,
  CompanyConfigData,
  DocumentData,
  ExperienceData,
  ProductItemData,
  ProposalSection,
  ChecklistGroup,
  MarcoLogico,
  MarcoLogicoFila,
  RawSecopRecord,
  RequirementItem,
  RequirementStatus,
} from './types'
import { parseJsonArray } from './types'
import {
  canBackCompliance,
  clampConfidence,
  normalizeCategory,
  normalizeObligatoriness,
  normalizeTruthLevel,
} from './evidence'

/** Parsea el JSON serializado del Marco Lógico de forma tolerante (corrupto → null). */
export function safeParseMarcoLogico(raw: string | null | undefined): MarcoLogico | null {
  if (!raw) return null
  try {
    return normalizeMarcoLogico(JSON.parse(raw))
  } catch {
    return null
  }
}

const VALID_STATUS: RequirementStatus[] = ['CUMPLE', 'NO_CUMPLE', 'PENDIENTE', 'REQUIERE_REVISION']

async function getZai(): Promise<ZaiClient | null> {
  try {
    return await ZAI.create()
  } catch {
    return null
  }
}

export function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1].includes('{')) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const body = text.slice(start, end + 1)
  try {
    return JSON.parse(body)
  } catch {
    // Reparación tolerante: los modelos suelen emitir saltos de línea literales
    // dentro de los valores string (JSON inválido estricto). Estado in/out de string.
    try {
      return JSON.parse(repairControlChars(body))
    } catch {
      return null
    }
  }
}

/** Escapa caracteres de control (saltos, tabs) que estén DENTRO de strings JSON. */
function repairControlChars(s: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (ch === '\\') {
        out += ch + (s[i + 1] ?? '')
        i++
        continue
      }
      if (ch === '"') {
        inString = false
        out += ch
        continue
      }
      const code = ch.charCodeAt(0)
      if (code < 0x20) {
        out += code === 10 ? '\\n' : code === 13 ? '\\r' : code === 9 ? '\\t' : `\\u${code.toString(16).padStart(4, '0')}`
        continue
      }
      out += ch
    } else {
      if (ch === '"') inString = true
      out += ch
    }
  }
  return out
}

interface CompanyBundle {
  company: CompanyConfigData
  products: ProductItemData[]
  experiences: ExperienceData[]
  documents: DocumentData[]
}

function companyBlock(b: CompanyBundle): string {
  const prods = b.products.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ''}${p.keywords.length ? ` (palabras clave: ${p.keywords.join(', ')})` : ''}`).join('\n') || '(ninguno registrado)'
  const exps = b.experiences.map((e) => `- ${e.title}${e.entity ? ` — ${e.entity}` : ''}${e.year ? ` (${e.year})` : ''}${e.value ? ` — valor $${e.value}` : ''}`).join('\n') || '(ninguna registrada)'
  const docs = b.documents.map((d) => `- ${d.name} [${d.status}]${d.docType ? ` (${d.docType})` : ''}`).join('\n') || '(ninguno registrado)'
  return `EMPRESA: ${b.company.name} (NIT: ${b.company.nit || 'no registrado'})
Descripción: ${b.company.description || 'no registrada'}
Ubicación: ${b.company.city || ''} ${b.company.department || ''}
Capacidad operativa declarada: ${b.company.capacity || 'no declarada'}
Rango económico que puede atender: $${b.company.minBudget} – $${b.company.maxBudget} COP

PRODUCTOS/SERVICIOS REGISTRADOS (única evidencia válida):
${prods}

EXPERIENCIA COMPROBADA REGISTRADA (única evidencia válida):
${exps}

DOCUMENTOS DISPONIBLES EN EL EXPEDIENTE:
${docs}`
}

// ─── MÓDULO D: análisis de oportunidad ──────────────────────

export async function analyzeOpportunity(rec: RawSecopRecord, bundle: CompanyBundle): Promise<AnalysisResult> {
  const zai = await getZai()
  if (zai) {
    try {
      const system = `Eres un analista experto en contratación pública colombiana (SECOP II, Ley 80 de 1993 y Ley 2171 de 2021).
Analizas procesos de contratación para decidir si una empresa puede participar.

REGLAS ABSOLUTAS — NO NEGOCIABLES:
1. NUNCA inventes experiencia, contratos, certificaciones, capacidades, precios, documentos ni declaraciones de la empresa.
2. Para cada requisito usa SOLO la evidencia registrada de la empresa. Si no hay evidencia suficiente, el estado debe ser PENDIENTE o REQUIERE_REVISION, nunca CUMPLE.
3. Marca NO_CUMPLE solo cuando el requisito claramente contradice lo registrado (p. ej. valor fuera de rango, tipo de contrato no manejado).
4. No sugieras presentar ofertas si hay requisitos habilitantes críticos sin resolver.

Devuelve EXCLUSIVAMENTE un JSON válido con esta estructura:
{
  "summary": "resumen del objeto, alcance y condiciones en 2-4 frases",
  "requirements": [
    { "code": "R1", "description": "requisito habilitante o técnico identificado", "status": "CUMPLE|NO_CUMPLE|PENDIENTE|REQUIERE_REVISION", "evidence": "qué evidencia registrada lo soporta (o 'ninguna registrada')", "action": "acción concreta para resolverlo", "categoria": "HABILITANTE|TECNICO|ECONOMICO|JURIDICO|ADMINISTRATIVO", "obligatoriedad": "OBLIGATORIO|OPCIONAL|DESEABLE|AMBIGUO|DESCONOCIDO", "fechaLimite": "fecha límite ISO que el pliego menciona o null", "confidence": 0.0, "truthLevel": "OBSERVED|INFERRED|ESTIMATED|UNKNOWN" }
  ],
  "missingDocs": ["documento faltante 1", "..."],
  "risks": ["riesgo 1", "..."],
  "nextAction": "siguiente acción recomendada en una frase"
}
REGLAS DE EVIDENCIA (regla de oro — NO NEGOCIABLES):
5. NUNCA puedes declarar truthLevel "VERIFIED": ese nivel está reservado a verificación humana o fuente primaria corroborada. Tu máximo es "OBSERVED", y SOLO si cites evidencia textual del pliego o de los datos publicados del proceso (p. ej. el precio base publicado). Si infieres o deduces, usa "INFERRED". Si no sabes, usa "UNKNOWN" — prefiero "NO SÉ" a "CREO QUE SÍ".
6. Un requisito NO puede quedar "CUMPLE" salvo que su evidence cite un dato real y registrado. Un CUMPLE sin evidencia verificable será degradado automáticamente a PENDIENTE.
7. confidence es tu certeza 0..1 sobre la clasificación del requisito (no sobre el cumplimiento).
Incluye entre 5 y 10 requisitos: habilitantes (jurídicos, financieros, experiencia), técnicos y documentales típicos del tipo de proceso.`

      const user = `PROCESO SECOP II:
ID: ${rec.id}
Entidad: ${rec.entity} (${rec.department || 'n/d'} / ${rec.city || 'n/d'})
Objeto: ${rec.objectName}
Descripción: ${rec.description || '(no publicada)'}
Presupuesto/precio base: ${rec.basePrice ? `$${rec.basePrice} COP` : 'no publicado'}
Modalidad: ${rec.modality || 'n/d'}
Tipo de contrato: ${rec.contractType || 'n/d'}
Fase: ${rec.phase || 'n/d'} | Estado: ${rec.state || 'n/d'}
Duración: ${rec.duration || 'n/d'} ${rec.durationUnit || ''}
Categoría UNSPSC: ${rec.categoryCode || 'n/d'}

${companyBlock(bundle)}

Analiza el proceso y produce el JSON.`

      const res = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
        temperature: 0.2,
      })

      const content: string = res?.choices?.[0]?.message?.content ?? ''
      const parsed = extractJson(content)
      if (parsed && Array.isArray(parsed.requirements) && parsed.requirements.length > 0) {
        const requirements: RequirementItem[] = (parsed.requirements as Record<string, unknown>[])
          .map((r, i) => {
            // Normalización de los nuevos campos (Task 2-a).
            const rawTruth = normalizeTruthLevel(r.truthLevel)
            // El motor IA NUNCA puede declarar VERIFIED: máximo OBSERVED.
            const truth = rawTruth === 'VERIFIED' ? 'OBSERVED' : rawTruth
            const due = typeof r.fechaLimite === 'string' && !Number.isNaN(Date.parse(r.fechaLimite)) ? new Date(r.fechaLimite).toISOString() : null
            return {
              code: String(r.code || `R${i + 1}`),
              description: String(r.description || '').slice(0, 500),
              status: VALID_STATUS.includes(r.status as RequirementStatus) ? (r.status as RequirementStatus) : 'PENDIENTE',
              evidence: r.evidence ? String(r.evidence).slice(0, 400) : undefined,
              action: r.action ? String(r.action).slice(0, 400) : undefined,
              source: 'IA' as const,
              category: normalizeCategory(r.categoria) ?? undefined,
              obligatoriness: normalizeObligatoriness(r.obligatoriedad),
              dueDate: due,
              truthLevel: truth,
              confidence: clampConfidence(r.confidence),
            }
          })
          .map(enforceGoldenRule)
        return {
          summary: String(parsed.summary || 'Análisis generado por IA.').slice(0, 1200),
          requirements,
          missingDocs: Array.isArray(parsed.missingDocs) ? parsed.missingDocs.map(String).slice(0, 15) : [],
          risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 10) : [],
          nextAction: String(parsed.nextAction || 'Revisar la matriz de requisitos con un responsable.').slice(0, 300),
          engine: 'IA',
        }
      }
    } catch (err) {
      console.error('[ai] analyzeOpportunity: motor IA falló, cae a reglas —', err instanceof Error ? err.message : err)
      // cae al motor de reglas
    }
  }

  return ruleBasedAnalysis(rec, bundle)
}

/**
 * REGLA DE ORO RADAR (Task 2-a): INFERRED+CUMPLE es INVÁLIDO como conclusión definitiva.
 * Si status==="CUMPLE" y no hay evidencia real (vacía, "ninguna", "no registrada") o el
 * truthLevel no es VERIFIED/OBSERVED → se degrada a PENDIENTE con truthLevel INFERRED.
 */
const EMPTY_EVIDENCE_RE = /(^\s*(ninguna|ningún|no registrad|no disponible|sin evidencia|vac[íi]a|n\/a|-)\s*$)|(ninguna registrada)|(no registrad)/i

export function enforceGoldenRule(r: RequirementItem): RequirementItem {
  if (r.status !== 'CUMPLE') return r
  const ev = (r.evidence || '').trim()
  const evidenceInvalida = !ev || EMPTY_EVIDENCE_RE.test(ev)
  if (evidenceInvalida || !canBackCompliance(r.truthLevel)) {
    return {
      ...r,
      status: 'PENDIENTE',
      truthLevel: 'INFERRED',
      action: `CUMPLE degradado a PENDIENTE: sin evidencia verificable (regla de oro RADAR)${r.action ? ` | ${r.action}` : ''}`.slice(0, 400),
    }
  }
  return r
}

/** Motor de respaldo basado en reglas — nunca inventa, marca todo como pendiente de validación. */
export function ruleBasedAnalysis(rec: RawSecopRecord, bundle: CompanyBundle): AnalysisResult {
  const c = bundle.company
  const requirements: RequirementItem[] = ([
    {
      code: 'R1',
      description: 'Valor del proceso dentro del rango económico que la empresa puede atender',
      status: rec.basePrice == null ? 'PENDIENTE' : rec.basePrice >= c.minBudget && rec.basePrice <= c.maxBudget ? 'CUMPLE' : 'NO_CUMPLE',
      evidence: rec.basePrice ? `Precio base publicado: $${rec.basePrice} COP` : 'Precio no publicado en SECOP',
      action: rec.basePrice == null ? 'Consultar el valor estimado en el pliego del proceso' : 'Confirmar capacidad de pago y flujo',
      source: 'REGLA',
      category: 'ECONOMICO',
      obligatoriness: 'OBLIGATORIO',
      // Dato real derivado de un campo de la API de SECOP → OBSERVED (regla 2-a).
      truthLevel: rec.basePrice == null ? 'UNKNOWN' : 'OBSERVED',
      confidence: rec.basePrice == null ? 0.3 : 0.95,
    },
    {
      code: 'R2',
      description: 'Experiencia previa relacionada con el objeto del proceso',
      status: bundle.experiences.length > 0 ? 'REQUIERE_REVISION' : 'PENDIENTE',
      evidence: bundle.experiences.length > 0 ? `${bundle.experiences.length} contrato(s) registrado(s) — verificar pertinencia` : 'Ninguna experiencia registrada',
      action: 'Comparar el objeto del proceso contra la experiencia registrada de la empresa',
      source: 'REGLA',
      category: 'HABILITANTE',
      obligatoriness: 'AMBIGUO',
      // La pertinencia de la experiencia es una inferencia, no un dato de la API.
      truthLevel: 'INFERRED',
      confidence: 0.5,
    },
    {
      code: 'R3',
      description: 'Documentos jurídicos habilitantes (RUT, RUP si aplica, certificación de existencia)',
      status: 'PENDIENTE',
      evidence: 'Depende de los documentos registrados en el expediente',
      action: 'Verificar vigencia de RUT/RUP y completar lo que falte',
      source: 'REGLA',
      category: 'JURIDICO',
      obligatoriness: 'OBLIGATORIO',
      truthLevel: 'UNKNOWN',
      confidence: 0.4,
    },
    {
      code: 'R4',
      description: 'Garantías exigidas (seriedad de la propuesta, cumplimiento, calidad)',
      status: 'REQUIERE_REVISION',
      evidence: 'No determinable desde los datos publicados',
      action: 'Revisar el pliego y confirmar con la compañía de garantías',
      source: 'REGLA',
      category: 'ADMINISTRATIVO',
      obligatoriness: 'DESCONOCIDO',
      truthLevel: 'UNKNOWN',
      confidence: 0.3,
    },
    {
      code: 'R5',
      description: 'Capacidad financiera requerida por la entidad',
      status: 'REQUIERE_REVISION',
      evidence: 'Información financiera de la empresa no registrada',
      action: 'Cargar estados financieros o índices si el pliego los exige',
      source: 'REGLA',
      category: 'ECONOMICO',
      obligatoriness: 'DESCONOCIDO',
      truthLevel: 'UNKNOWN',
      confidence: 0.3,
    },
    {
      code: 'R6',
      description: 'Plazo de ejecución compatible con la capacidad operativa',
      status: rec.duration ? 'REQUIERE_REVISION' : 'PENDIENTE',
      evidence: rec.duration ? `Duración publicada: ${rec.duration} ${rec.durationUnit || ''}` : 'Duración no publicada',
      action: 'Confirmar con operaciones que el plazo es cumplible',
      source: 'REGLA',
      category: 'TECNICO',
      obligatoriness: 'DESCONOCIDO',
      // Dato real derivado de un campo de la API de SECOP → OBSERVED (regla 2-a).
      truthLevel: rec.duration ? 'OBSERVED' : 'UNKNOWN',
      confidence: rec.duration ? 0.9 : 0.3,
    },
  ] as RequirementItem[]).map(enforceGoldenRule)
  const missingDocs = bundle.documents.filter((d) => d.status !== 'DISPONIBLE').map((d) => d.name)
  return {
    summary: `Análisis basado en reglas (motor IA no disponible): proceso ${rec.id} de ${rec.entity}, objeto "${rec.objectName.slice(0, 140)}". Los requisitos quedaron marcados para validación humana.`,
    requirements,
    missingDocs: missingDocs.length ? missingDocs : ['Determinar documentación exigida en el pliego'],
    risks: [
      'Análisis generado sin IA — validar el pliego directamente',
      rec.basePrice == null ? 'El valor del proceso no está publicado' : 'Valores pueden cambiar por adiciones',
    ],
    nextAction: 'Descargar y revisar el pliego del proceso antes de decidir la participación',
    engine: 'REGLAS',
  }
}

// ─── MÓDULO G: generación de propuesta — MODO AGENTE PROYECTISTA ─────

export interface ProposalDraft {
  sections: ProposalSection[]
  checklists: ChecklistGroup[]
  marcoLogico: MarcoLogico | null
  unconfirmedCount: number
  engine: 'IA' | 'REGLAS'
}

/** Normaliza y sanea el Marco Lógico que devuelve la IA (tolerante a faltantes). */
export function normalizeMarcoLogico(raw: unknown): MarcoLogico | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8) : []
  const filas: MarcoLogicoFila[] = (Array.isArray(m.filas) ? (m.filas as Record<string, unknown>[]) : [])
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      nivel: String(f.nivel ?? '').trim().slice(0, 80),
      resumen: String(f.resumen ?? '').trim().slice(0, 700),
      indicadores: String(f.indicadores ?? '').trim().slice(0, 700),
      mediosVerificacion: String(f.mediosVerificacion ?? '').trim().slice(0, 450),
      supuestos: String(f.supuestos ?? '').trim().slice(0, 450),
    }))
    .filter((f) => f.nivel && (f.resumen || f.indicadores))
    .slice(0, 12)
  if (filas.length === 0) return null
  return {
    problemaCentral: String(m.problemaCentral ?? '').trim().slice(0, 700),
    causas: strArr(m.causas),
    efectos: strArr(m.efectos),
    objetivoCentral: String(m.objetivoCentral ?? '').trim().slice(0, 700),
    filas,
  }
}

const DEEP_SECTION_SPEC = `1. "resumen_ejecutivo" — Resumen ejecutivo: 2-3 párrafos que presenten la comprensión de la necesidad, la solución propuesta y el diferencial de la empresa. Debe enganchar al evaluador en los primeros renglones.
2. "entendimiento" — Entendimiento del objeto y contexto: qué necesita realmente la entidad, el problema de fondo detrás del objeto, contexto territorial/institucional relevante y condiciones del proceso (duración, lugar, modalidad).
3. "solucion" — Solución propuesta: el enfoque de solución adaptado PUNTO POR PUNTO a la necesidad. Describe el alcance, los componentes de la solución y cómo cada componente responde a una parte del objeto. Explica el diferencial metodológico de la propuesta.
4. "metodologia" — Metodología y plan de trabajo: fases numeradas (Fase 1, Fase 2…) con actividades concretas, productos/entregables por fase y cómo se controla la calidad. Debe ser una metodología realista para el tipo de contrato y coherente con los servicios registrados de la empresa.
5. "cronograma" — Cronograma tentativo: distribución por fases contra la duración publicada (o [POR CONFIRMAR: plazo] si no está publicada). Usa una lista o tabla simple de fases con semanas/mes correspondiente.
6. "equipo" — Equipo y organización: roles necesarios y perfil de cada rol (responsable, apoyo técnico, logística), organización del trabajo y canales de coordinación con la entidad. NO inventes nombres ni hojas de vida: usa [POR CONFIRMAR: nombre del profesional] donde falte.
7. "indicadores" — Indicadores de éxito: 3-6 indicadores medibles alineados con el objeto (producto, oportunidad, calidad, satisfacción), con fórmula y meta referencial.
8. "gestion_riesgos" — Gestión de riesgos del proyecto: 3-5 riesgos propios de la ejecución (no de la participación), con mitigación concreta cada uno.
9. "por_que_nosotros" — Por qué esta empresa: argumenta SOLO con la experiencia, productos/servicios y documentos registrados de la empresa, conectándolos explícitamente con el objeto. Si la evidencia es poca, sé honesto y enfatiza capacidad y enfoque, sin exagerar.
10. "estructura_economica" — Estructura económica (plantilla): SIEMPRE "unconfirmed": true. Plantilla de tabla Concepto|Valor con [POR CONFIRMAR] en cada valor, más el presupuesto oficial de referencia y la advertencia de que el precio lo define la empresa.
11. "anexos" — Anexos y documentos de la oferta: lista de anexos exigibles según el tipo de proceso y la matriz de requisitos, indicando cuáles ya están en el expediente y cuáles faltan.`

// Especialista en Marco Lógico (llamada dedicada — metodología MEL/MML usada por entidades colombianas, DNP/MGA)
const MARCO_LOGICO_SYSTEM = `Eres un ESPECIALISTA EN MARCO LÓGICO: metodología estándar de formulación de proyectos públicos en Colombia (matriz de marco lógico MML, árbol de problemas y de objetivos, lineamientos MGA del DNP).
Tu tarea: construir el Marco Lógico de un proyecto-respuesta a un proceso de contratación pública SECOP II.

REGLAS:
1. El árbol de problemas se deriva del objeto y contexto del proceso. NO inventes datos de la empresa ni cifras de la entidad.
2. Cada Componente de la matriz debe corresponder a una fase de la metodología del proyecto (te doy el plan de trabajo).
3. Indicadores VERIFICABLES: fórmula + meta referencial. Medios de verificación concretos. Supuestos realistas.
4. Español colombiano profesional.

Devuelve EXCLUSIVAMENTE JSON válido:
{
  "narrativa": "2-3 párrafos: árbol de problemas (problema central, causas, efectos), su espejo en árbol de objetivos y cómo la matriz alinea la propuesta con la lógica de intervención. Si el tipo de proceso suele exigir marco lógico en el pliego (obra, intervención social, educación, salud, cooperación, planes de desarrollo), dilo explícitamente.",
  "marcoLogico": {
    "problemaCentral": "...",
    "causas": ["causa 1", "causa 2", "causa 3"],
    "efectos": ["efecto 1", "efecto 2", "efecto 3"],
    "objetivoCentral": "...",
    "filas": [
      { "nivel": "Fin", "resumen": "...", "indicadores": "...", "mediosVerificacion": "...", "supuestos": "..." },
      { "nivel": "Propósito", "resumen": "...", "indicadores": "...", "mediosVerificacion": "...", "supuestos": "..." },
      { "nivel": "Componente 1: [nombre]", "resumen": "...", "indicadores": "...", "mediosVerificacion": "...", "supuestos": "..." },
      { "nivel": "Componente 2: [nombre]", "resumen": "...", "indicadores": "...", "mediosVerificacion": "...", "supuestos": "..." },
      { "nivel": "Actividades", "resumen": "actividades clave por componente", "indicadores": "insumos/presupuesto", "mediosVerificacion": "registros de ejecución", "supuestos": "..." }
    ]
  }
}`

export async function generateProposal(
  rec: RawSecopRecord,
  bundle: CompanyBundle,
  requirements: RequirementItem[],
): Promise<ProposalDraft> {
  const zai = await getZai()
  if (zai) {
    try {
      const system = `Eres un AGENTE PROYECTISTA experto en contratación pública colombiana (SECOP II, Ley 80 de 1993, Ley 2171 de 2021).
Tu misión: diseñar un PROYECTO COMPLETO e IRRESISTIBLE para responder a un proceso de contratación, adaptado a los requerimientos específicos de la oferta.

QUÉ HACE IRRESISTIBLE UNA PROPUESTA (aplícalo):
- Demuestra entendimiento profundo del problema de la entidad, no solo del texto del objeto.
- Responde punto por punto a la necesidad con una metodología concreta y realista.
- Habla el idioma del evaluador: enfoque metodológico, entregables verificables, equipo con roles claros, cronograma cumplible, riesgos gestionados e indicadores medibles.
- Argumenta el diferencial de la empresa con EVIDENCIA, sin inflarla.

REGLAS ABSOLUTAS — NO NEGOCIABLES:
1. NUNCA inventes experiencia, contratos, certificaciones, capacidades, precios, cifras económicas, firmas, documentos, nombres de personas ni declaraciones.
2. Usa ÚNICAMENTE la información registrada de la empresa que aparece abajo. La persuasión sale de la estructura y el argumento, no de datos inventados.
3. Cuando la propuesta necesite un dato que la empresa no tiene registrado, escribe literalmente [POR CONFIRMAR: qué dato falta] y marca la sección con "unconfirmed": true.
4. NO propongas valores económicos: la estructura económica queda como plantilla para que la empresa la diligencie.
5. Escribe en español colombiano profesional, con concreción (nada de relleno genérico). Cada párrafo debe aportar información.
6. Responde en formato compacto: máximo 130 palabras por sección. El detalle fino va en la sección de metodología e indicadores, no en disertaciones.

Devuelve EXCLUSIVAMENTE JSON válido con esta estructura:
{
  "sections": [
    { "key": "resumen_ejecutivo", "title": "1. Resumen ejecutivo", "content": "...", "unconfirmed": false },
    { "key": "entendimiento", "title": "2. Entendimiento del objeto y contexto", "content": "...", "unconfirmed": false },
    { "key": "solucion", "title": "3. Solución propuesta", "content": "...", "unconfirmed": false },
    { "key": "metodologia", "title": "4. Metodología y plan de trabajo", "content": "...", "unconfirmed": false },
    { "key": "cronograma", "title": "5. Cronograma tentativo", "content": "...", "unconfirmed": false },
    { "key": "equipo", "title": "6. Equipo y organización", "content": "...", "unconfirmed": false },
    { "key": "indicadores", "title": "7. Indicadores de éxito", "content": "...", "unconfirmed": false },
    { "key": "gestion_riesgos", "title": "8. Gestión de riesgos", "content": "...", "unconfirmed": false },
    { "key": "por_que_nosotros", "title": "9. Por qué esta empresa", "content": "...", "unconfirmed": false },
    { "key": "estructura_economica", "title": "10. Estructura económica (plantilla)", "content": "...", "unconfirmed": true },
    { "key": "anexos", "title": "11. Anexos y documentos de la oferta", "content": "...", "unconfirmed": false }
  ],
  "checklists": [
    { "group": "Documentos administrativos", "items": [ { "label": "...", "required": true } ] },
    { "group": "Antes de enviar", "items": [ { "label": "...", "required": true } ] }
  ]
}

(OJO: el Marco Lógico NO va en esta respuesta — se genera en una llamada especializada aparte.)

ESPECIFICACIÓN DE CADA SECCIÓN:
${DEEP_SECTION_SPEC}`

      const reqBlock = requirements.map((r) => `- [${r.status}] ${r.description} (evidencia: ${r.evidence || 'ninguna registrada'})`).join('\n')

      const user = `PROCESO SECOP II A CUBRIR:
ID: ${rec.id}
Entidad: ${rec.entity}
Objeto: ${rec.objectName}
Descripción publicada: ${rec.description || '(no publicada — deduce la necesidad desde el objeto)'}
Presupuesto de referencia: ${rec.basePrice ? `$${rec.basePrice} COP` : 'no publicado'} (NO usarlo como precio de la propuesta)
Duración publicada: ${rec.duration || 'n/d'} ${rec.durationUnit || ''}
Lugar: ${rec.city || 'n/d'} / ${rec.department || 'n/d'}
Modalidad: ${rec.modality || 'n/d'} | Tipo de contrato: ${rec.contractType || 'n/d'}

${companyBlock(bundle)}

MATRIZ DE REQUISITOS DEL ANÁLISIS (úsala para alinear la propuesta y armar los anexos):
${reqBlock}

Diseña el proyecto completo siguiendo la estructura JSON indicada.`

      const res = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
        temperature: 0.4,
      })

      const content: string = res?.choices?.[0]?.message?.content ?? ''
      const parsed = extractJson(content)
      if (parsed && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
        const sections: ProposalSection[] = (parsed.sections as Record<string, unknown>[]).map((s, i) => ({
          key: String(s.key || `seccion_${i + 1}`),
          title: String(s.title || `Sección ${i + 1}`),
          content: String(s.content || ''),
          unconfirmed: Boolean(s.unconfirmed) || String(s.content || '').includes('[POR CONFIRMAR'),
        }))
        const checklists: ChecklistGroup[] = Array.isArray(parsed.checklists)
          ? (parsed.checklists as Record<string, unknown>[]).map((g) => ({
              group: String(g.group || 'Checklist'),
              items: Array.isArray(g.items)
                ? (g.items as Record<string, unknown>[]).map((it) => ({
                    label: String(it.label || ''),
                    required: Boolean(it.required),
                  }))
                : [],
            }))
          : []

        // ── Llamada 2: MARCO LÓGICO especializado (evita truncamiento de una sola respuesta) ──
        let marcoLogico: MarcoLogico | null = null
        let mlNarrativa = ''
        try {
          const metodologia = sections.find((s) => s.key === 'metodologia')?.content || ''
          const mlRes = await zai.chat.completions.create({
            messages: [
              { role: 'system', content: MARCO_LOGICO_SYSTEM },
              {
                role: 'user',
                content: `PROCESO SECOP II:
ID: ${rec.id} | Entidad: ${rec.entity}
Objeto: ${rec.objectName}
Descripción publicada: ${rec.description || '(no publicada)'}
Duración: ${rec.duration || 'n/d'} ${rec.durationUnit || ''} | Lugar: ${rec.city || 'n/d'} / ${rec.department || 'n/d'}

${companyBlock(bundle)}

METODOLOGÍA DEL PROYECTO (los componentes de la matriz deben corresponder a estas fases):
${metodologia.slice(0, 2500)}

MATRIZ DE REQUISITOS:
${reqBlock}

Construye el Marco Lógico y devuelve el JSON indicado.`,
              },
            ],
            thinking: { type: 'disabled' },
            temperature: 0.3,
          })
          const mlParsed = extractJson(mlRes?.choices?.[0]?.message?.content ?? '')
          if (mlParsed) {
            marcoLogico = normalizeMarcoLogico(mlParsed.marcoLogico)
            mlNarrativa = String(mlParsed.narrativa || '').trim().slice(0, 3000)
          }
        } catch (err) {
          console.error('[ai] generateProposal: llamada de marco lógico falló —', err instanceof Error ? err.message : err)
        }
        if (!marcoLogico) {
          console.error('[ai] generateProposal: marco lógico IA no disponible — usa plantilla neutra')
          marcoLogico = templateProposal(rec, bundle, requirements).marcoLogico
        }

        const mlSection: ProposalSection = {
          key: 'marco_logico',
          title: `12. Marco lógico`,
          content: mlNarrativa || '⚠ La narrativa del marco lógico no pudo generarse con el motor IA. Usa la matriz estructurada de la tarjeta dedicada y valídala contra el pliego antes de presentar.',
          unconfirmed: !mlNarrativa,
        }
        const allSections = [...sections, mlSection]

        const unconfirmedCount =
          allSections.filter((s) => s.unconfirmed).length +
          allSections.reduce((acc, s) => acc + (String(s.content).match(/\[POR CONFIRMAR/g) || []).length, 0)
        return { sections: allSections, checklists, marcoLogico, unconfirmedCount, engine: 'IA' }
      }
      console.error('[ai] generateProposal: respuesta IA sin JSON válido/sections vacías — cae a plantilla. Longitud cruda:', content.length, 'inicio:', JSON.stringify(content.slice(0, 120)), 'fin:', JSON.stringify(content.slice(-120)))
    } catch (err) {
      console.error('[ai] generateProposal: motor IA falló, cae a plantilla —', err instanceof Error ? err.message : err)
      // cae a plantilla
    }
  } else {
    console.error('[ai] generateProposal: sin motor IA (ZAI.create falló) — cae a plantilla')
  }
  return templateProposal(rec, bundle, requirements)
}

// ─── MÓDULO G+: refinamiento conversacional de la propuesta ──────

export interface RefinementResult {
  sections: ProposalSection[]
  marcoLogico: MarcoLogico | null
  changeSummary: string
  sectionsAffected: string[]
  engine: 'IA'
}

/** Regenera la propuesta aplicando una instrucción del usuario, conservando la regla anti-invención. Devuelve null si no hay motor IA. */
export async function refineProposal(
  rec: RawSecopRecord,
  bundle: CompanyBundle,
  requirements: RequirementItem[],
  currentSections: ProposalSection[],
  instruction: string,
  history: { role: string; content: string }[],
  currentMarcoLogico?: MarcoLogico | null,
): Promise<RefinementResult | null> {
  const zai = await getZai()
  if (!zai) return null

  try {
    const system = `Eres el mismo AGENTE PROYECTISTA que redactó una propuesta para un proceso SECOP II. Ahora trabajas en el refinamiento conversacional con el usuario.

REGLAS ABSOLUTAS — NO NEGOCIABLES:
1. NUNCA inventes experiencia, contratos, certificaciones, capacidades, precios, cifras económicas, firmas, documentos, nombres de personas ni declaraciones.
2. Usa ÚNICAMENTE la información registrada de la empresa. Si la instrucción pide un dato que no está registrado, escribe [POR CONFIRMAR: qué dato falta].
3. Aplica la instrucción del usuario con precisión; el resto del proyecto debe quedar consistente con el cambio (si cambias la metodología, ajusta cronograma/indicadores/marco lógico si aplica).
4. NO degrades otras secciones: conserva su nivel de detalle y su evidencia.
5. Devuelve SIEMPRE el proyecto completo (las 12 secciones) Y el marco lógico actualizado; no solo lo tocado.

Devuelve EXCLUSIVAMENTE JSON válido:
{
  "sections": [ { "key": "...", "title": "...", "content": "...", "unconfirmed": false } ],
  "marcoLogico": { "problemaCentral": "...", "causas": ["..."], "efectos": ["..."], "objetivoCentral": "...", "filas": [ { "nivel": "Fin", "resumen": "...", "indicadores": "...", "mediosVerificacion": "...", "supuestos": "..." } ] },
  "changeSummary": "resumen en 1-3 frases de qué cambió y por qué",
  "sectionsAffected": ["metodologia", "cronograma"]
}`

    const current = currentSections
      .map((s) => `### ${s.title} (key: ${s.key}${s.unconfirmed ? ' — contiene [POR CONFIRMAR]' : ''})\n${s.content}`)
      .join('\n\n')

    const currentML = currentMarcoLogico
      ? `MATRIZ DE MARCO LÓGICO VIGENTE:
Problema central: ${currentMarcoLogico.problemaCentral}
Objetivo central: ${currentMarcoLogico.objetivoCentral}
${currentMarcoLogico.filas.map((f) => `- ${f.nivel}: ${f.resumen} | Indicadores: ${f.indicadores} | Medios: ${f.mediosVerificacion} | Supuestos: ${f.supuestos}`).join('\n')}`
      : '(sin marco lógico previo — inclúyelo)'

    const historyBlock = history.length
      ? history.map((m) => `${m.role === 'USUARIO' ? 'Usuario' : 'Agente'}: ${m.content}`).join('\n')
      : '(sin conversación previa)'

    const reqBlock = requirements.map((r) => `- [${r.status}] ${r.description}`).join('\n')

    const user = `PROCESO SECOP II:
ID: ${rec.id} | Entidad: ${rec.entity}
Objeto: ${rec.objectName}
Duración: ${rec.duration || 'n/d'} ${rec.durationUnit || ''} | Lugar: ${rec.city || 'n/d'} / ${rec.department || 'n/d'}

${companyBlock(bundle)}

MATRIZ DE REQUISITOS:
${reqBlock}

CONVERSACIÓN PREVIA:
${historyBlock}

${currentML}

BORRADOR ACTUAL COMPLETO:
${current}

INSTRUCCIÓN NUEVA DEL USUARIO:
"""${instruction}"""

Aplica la instrucción y devuelve el JSON del proyecto completo actualizado.`

    const baseMessages: { role: 'system' | 'user'; content: string }[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]

    let res = await zai.chat.completions.create({
      messages: baseMessages,
      thinking: { type: 'disabled' },
      temperature: 0.35,
    })

    let content: string = res?.choices?.[0]?.message?.content ?? ''
    let parsed = extractJson(content)
    if ((!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) && content.length > 0) {
      // Probable truncamiento por longitud: reintento una vez en modo compacto
      console.error('[ai] refineProposal: respuesta inválida (', content.length, 'chars) — reintento compacto')
      res = await zai.chat.completions.create({
        messages: [
          ...baseMessages,
          {
            role: 'user',
            content:
              'IMPORTANTE: tu respuesta anterior se perdió o quedó incompleta. Responde de nuevo el JSON COMPLETO en versión COMPACTA: máximo 90 palabras por sección, sin repeticiones, conservando TODAS las secciones del borrador y el marco lógico.',
          },
        ],
        thinking: { type: 'disabled' },
        temperature: 0.3,
      })
      content = res?.choices?.[0]?.message?.content ?? ''
      parsed = extractJson(content)
    }
    if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      console.error('[ai] refineProposal: respuesta sin JSON válido tras reintento — descartada. Longitud cruda:', content.length, 'inicio:', JSON.stringify(content.slice(0, 160)), 'fin:', JSON.stringify(content.slice(-160)))
      return null
    }

    const sections: ProposalSection[] = (parsed.sections as Record<string, unknown>[]).map((s, i) => ({
      key: String(s.key || `seccion_${i + 1}`),
      title: String(s.title || `Sección ${i + 1}`),
      content: String(s.content || ''),
      unconfirmed: Boolean(s.unconfirmed) || String(s.content || '').includes('[POR CONFIRMAR'),
    }))

    return {
      sections,
      marcoLogico: normalizeMarcoLogico(parsed.marcoLogico),
      changeSummary: String(parsed.changeSummary || 'Propuesta actualizada según la instrucción.').slice(0, 800),
      sectionsAffected: Array.isArray(parsed.sectionsAffected) ? parsed.sectionsAffected.map(String).slice(0, 12) : [],
      engine: 'IA',
    }
  } catch (err) {
    console.error('[ai] refineProposal: falló el motor IA —', err instanceof Error ? err.message : err)
    return null
  }
}

/** Plantilla de respaldo — estructura completa sin inventar datos. */
export function templateProposal(rec: RawSecopRecord, bundle: CompanyBundle, requirements: RequirementItem[]): ProposalDraft {
  const c = bundle.company
  const prods = bundle.products.map((p) => `- ${p.name}`).join('\n') || '[POR CONFIRMAR: registrar productos/servicios de la empresa]'
  const exps = bundle.experiences.map((e) => `- ${e.title}${e.entity ? ` — ${e.entity}` : ''}${e.year ? ` (${e.year})` : ''}`).join('\n') || '[POR CONFIRMAR: registrar experiencia relevante]'
  const unconfirmed = !bundle.experiences.length || !bundle.products.length

  const sections: ProposalSection[] = [
    {
      key: 'presentacion',
      title: '1. Presentación',
      content: `${c.name}${c.nit ? `, identificada con NIT ${c.nit}` : ''}${c.department ? `, con presencia en ${c.city || ''} ${c.department}` : ''}, presenta su propuesta para el proceso ${rec.id} convocado por ${rec.entity}, cuyo objeto es: ${rec.objectName}.`,
      unconfirmed: false,
    },
    {
      key: 'entendimiento',
      title: '2. Entendimiento del objeto',
      content: `El proceso exige: ${rec.description || rec.objectName}. ${rec.duration ? `La duración publicada es de ${rec.duration} ${rec.durationUnit || 'días'}.` : '[POR CONFIRMAR: plazo de ejecución en el pliego]'} El lugar de ejecución corresponde a ${rec.city || '[POR CONFIRMAR]'} / ${rec.department || '[POR CONFIRMAR]'}.`,
      unconfirmed: false,
    },
    {
      key: 'propuesta_tecnica',
      title: '3. Propuesta técnica',
      content: `La empresa cuenta con los siguientes productos/servicios registrados pertinentes:\n${prods}\n\nExperiencia registrada relevante:\n${exps}\n\n[POR CONFIRMAR: detalle metodológico y asignación de equipo de trabajo]`,
      unconfirmed,
    },
    {
      key: 'estructura_economica',
      title: '4. Estructura económica (plantilla)',
      content: `⚠ PLANTILLA PARA DILIGENCIAR — el agente no define precios:\n\n| Concepto | Valor |\n|---|---|\n| Valor directo | [POR CONFIRMAR] |\n| Administración | [POR CONFIRMAR] |\n| Imprevistos | [POR CONFIRMAR] |\n| IVA | [POR CONFIRMAR] |\n| TOTAL | [POR CONFIRMAR] |\n\nPresupuesto oficial de referencia: ${rec.basePrice ? `$${rec.basePrice.toLocaleString('es-CO')} COP` : 'no publicado'}.`,
      unconfirmed: true,
    },
    {
      key: 'anexos',
      title: '5. Anexos requeridos',
      content: requirements
        .filter((r) => r.status !== 'CUMPLE')
        .map((r) => `- [${r.status}] ${r.description} → ${r.action || 'definir acción'}`)
        .join('\n') || 'Sin anexos pendientes según la matriz de requisitos.',
      unconfirmed: false,
    },
    {
      key: 'marco_logico',
      title: '6. Marco lógico (plantilla)',
      content: `⚠ PLANTILLA GENERADA SIN MOTOR IA — el árbol de problemas y la matriz deben validarse con el pliego.

Problema central identificado en el objeto: ${rec.objectName}
Árbol de problemas: [POR CONFIRMAR: causas y efectos con la comunidad/entidad]
Árbol de objetivos: [POR CONFIRMAR: objetivos espejo de las causas]

Matriz de marco lógico: completa la fila de cada nivel (Fin, Propósito, Componentes, Actividades) con indicadores verificables, medios de verificación y supuestos, coherentes con el plan de trabajo.`,
      unconfirmed: true,
    },
  ]

  const checklists: ChecklistGroup[] = [
    {
      group: 'Documentos administrativos',
      items: [
        { label: 'Propuesta técnica firmada', required: true },
        { label: 'Estructura económica diligenciada y firmada', required: true },
        { label: 'RUT vigente', required: true },
        { label: 'Certificación de existencia y representación legal', required: true },
        { label: 'Garantía de seriedad de la propuesta (si el pliego la exige)', required: false },
      ],
    },
    {
      group: 'Antes de enviar',
      items: [
        { label: 'Verificar fecha límite de presentación en el proceso SECOP', required: true },
        { label: 'Confirmar requisitos habilitantes de la matriz', required: true },
        { label: 'Revisar que no queden marcadores [POR CONFIRMAR]', required: true },
        { label: 'Aprobación explícita del responsable registrado', required: true },
      ],
    },
  ]

  const marcoLogico: MarcoLogico = {
    problemaCentral: rec.objectName.slice(0, 600),
    causas: ['[POR CONFIRMAR: causas del problema]'],
    efectos: ['[POR CONFIRMAR: efectos del problema]'],
    objetivoCentral: `Atender el objeto del proceso ${rec.id}: ${rec.objectName.slice(0, 400)}`,
    filas: [
      { nivel: 'Fin', resumen: '[POR CONFIRMAR: contribución de largo plazo]', indicadores: '[POR CONFIRMAR]', mediosVerificacion: '[POR CONFIRMAR]', supuestos: '[POR CONFIRMAR]' },
      { nivel: 'Propósito', resumen: '[POR CONFIRMAR: efecto directo esperado]', indicadores: '[POR CONFIRMAR]', mediosVerificacion: '[POR CONFIRMAR]', supuestos: '[POR CONFIRMAR]' },
      { nivel: 'Componente 1', resumen: '[POR CONFIRMAR: primer producto/entregable]', indicadores: '[POR CONFIRMAR]', mediosVerificacion: '[POR CONFIRMAR]', supuestos: '[POR CONFIRMAR]' },
      { nivel: 'Actividades', resumen: '[POR CONFIRMAR: actividades por componente]', indicadores: '[POR CONFIRMAR]', mediosVerificacion: '[POR CONFIRMAR]', supuestos: '[POR CONFIRMAR]' },
    ],
  }

  const unconfirmedCount = sections.reduce((acc, s) => acc + (String(s.content).match(/\[POR CONFIRMAR/g) || []).length, 0)
  return { sections, checklists, marcoLogico, unconfirmedCount, engine: 'REGLAS' }
}

export { parseJsonArray }
