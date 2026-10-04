// MÓDULOS D y G — ANÁLISIS INTELIGENTE Y GENERACIÓN DE PROPUESTA (IA)
// REGLA CRÍTICA: el agente NUNCA inventa experiencia, contratos, certificaciones,
// capacidades, precios, firmas, documentos o declaraciones. Todo lo no confirmado
// queda marcado como PENDIENTE / REQUIERE_REVISIÓN.

import ZAI from 'z-ai-web-dev-sdk'
import type {
  AnalysisResult,
  CompanyConfigData,
  DocumentData,
  ExperienceData,
  ProductItemData,
  ProposalSection,
  ChecklistGroup,
  RawSecopRecord,
  RequirementItem,
  RequirementStatus,
} from './types'
import { parseJsonArray } from './types'

const VALID_STATUS: RequirementStatus[] = ['CUMPLE', 'NO_CUMPLE', 'PENDIENTE', 'REQUIERE_REVISION']

async function getZai(): Promise<InstanceType<typeof ZAI> | null> {
  try {
    return await ZAI.create()
  } catch {
    return null
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
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
    { "code": "R1", "description": "requisito habilitante o técnico identificado", "status": "CUMPLE|NO_CUMPLE|PENDIENTE|REQUIERE_REVISION", "evidence": "qué evidencia registrada lo soporta (o 'ninguna registrada')", "action": "acción concreta para resolverlo" }
  ],
  "missingDocs": ["documento faltante 1", "..."],
  "risks": ["riesgo 1", "..."],
  "nextAction": "siguiente acción recomendada en una frase"
}
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
          .map((r, i) => ({
            code: String(r.code || `R${i + 1}`),
            description: String(r.description || '').slice(0, 500),
            status: VALID_STATUS.includes(r.status as RequirementStatus) ? (r.status as RequirementStatus) : 'PENDIENTE',
            evidence: r.evidence ? String(r.evidence).slice(0, 400) : undefined,
            action: r.action ? String(r.action).slice(0, 400) : undefined,
            source: 'IA' as const,
          }))
        return {
          summary: String(parsed.summary || 'Análisis generado por IA.').slice(0, 1200),
          requirements,
          missingDocs: Array.isArray(parsed.missingDocs) ? parsed.missingDocs.map(String).slice(0, 15) : [],
          risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 10) : [],
          nextAction: String(parsed.nextAction || 'Revisar la matriz de requisitos con un responsable.').slice(0, 300),
          engine: 'IA',
        }
      }
    } catch {
      // cae al motor de reglas
    }
  }

  return ruleBasedAnalysis(rec, bundle)
}

/** Motor de respaldo basado en reglas — nunca inventa, marca todo como pendiente de validación. */
export function ruleBasedAnalysis(rec: RawSecopRecord, bundle: CompanyBundle): AnalysisResult {
  const c = bundle.company
  const requirements: RequirementItem[] = [
    {
      code: 'R1',
      description: 'Valor del proceso dentro del rango económico que la empresa puede atender',
      status: rec.basePrice == null ? 'PENDIENTE' : rec.basePrice >= c.minBudget && rec.basePrice <= c.maxBudget ? 'CUMPLE' : 'NO_CUMPLE',
      evidence: rec.basePrice ? `Precio base publicado: $${rec.basePrice} COP` : 'Precio no publicado en SECOP',
      action: rec.basePrice == null ? 'Consultar el valor estimado en el pliego del proceso' : 'Confirmar capacidad de pago y flujo',
      source: 'REGLA',
    },
    {
      code: 'R2',
      description: 'Experiencia previa relacionada con el objeto del proceso',
      status: bundle.experiences.length > 0 ? 'REQUIERE_REVISION' : 'PENDIENTE',
      evidence: bundle.experiences.length > 0 ? `${bundle.experiences.length} contrato(s) registrado(s) — verificar pertinencia` : 'Ninguna experiencia registrada',
      action: 'Comparar el objeto del proceso contra la experiencia registrada de la empresa',
      source: 'REGLA',
    },
    {
      code: 'R3',
      description: 'Documentos jurídicos habilitantes (RUT, RUP si aplica, certificación de existencia)',
      status: 'PENDIENTE',
      evidence: 'Depende de los documentos registrados en el expediente',
      action: 'Verificar vigencia de RUT/RUP y completar lo que falte',
      source: 'REGLA',
    },
    {
      code: 'R4',
      description: 'Garantías exigidas (seriedad de la propuesta, cumplimiento, calidad)',
      status: 'REQUIERE_REVISION',
      evidence: 'No determinable desde los datos publicados',
      action: 'Revisar el pliego y confirmar con la compañía de garantías',
      source: 'REGLA',
    },
    {
      code: 'R5',
      description: 'Capacidad financiera requerida por la entidad',
      status: 'REQUIERE_REVISION',
      evidence: 'Información financiera de la empresa no registrada',
      action: 'Cargar estados financieros o índices si el pliego los exige',
      source: 'REGLA',
    },
    {
      code: 'R6',
      description: 'Plazo de ejecución compatible con la capacidad operativa',
      status: rec.duration ? 'REQUIERE_REVISION' : 'PENDIENTE',
      evidence: rec.duration ? `Duración publicada: ${rec.duration} ${rec.durationUnit || ''}` : 'Duración no publicada',
      action: 'Confirmar con operaciones que el plazo es cumplible',
      source: 'REGLA',
    },
  ]
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

// ─── MÓDULO G: generación de propuesta ──────────────────────

export interface ProposalDraft {
  sections: ProposalSection[]
  checklists: ChecklistGroup[]
  unconfirmedCount: number
  engine: 'IA' | 'REGLAS'
}

export async function generateProposal(
  rec: RawSecopRecord,
  bundle: CompanyBundle,
  requirements: RequirementItem[],
): Promise<ProposalDraft> {
  const zai = await getZai()
  if (zai) {
    try {
      const system = `Eres un redactor experto de propuestas para procesos de contratación pública colombiana (SECOP II).

REGLAS ABSOLUTAS — NO NEGOCIABLES:
1. NUNCA inventes experiencia, contratos, certificaciones, capacidades, precios, cifras económicas, firmas, documentos ni declaraciones.
2. Usa ÚNICAMENTE la información registrada de la empresa que aparece abajo.
3. Cuando la propuesta necesite un dato que la empresa no tiene registrado, escribe literalmente [POR CONFIRMAR: qué dato falta] y marca la sección con "unconfirmed": true.
4. NO propongas valores económicos: la estructura económica queda como plantilla para que la empresa la diligencie.

Devuelve EXCLUSIVAMENTE JSON válido:
{
  "sections": [
    { "key": "presentacion", "title": "1. Presentación", "content": "...", "unconfirmed": false },
    { "key": "entendimiento", "title": "2. Entendimiento del objeto", "content": "...", "unconfirmed": false },
    { "key": "propuesta_tecnica", "title": "3. Propuesta técnica", "content": "...", "unconfirmed": false },
    { "key": "metodologia", "title": "4. Metodología y cronograma tentativo", "content": "...", "unconfirmed": false },
    { "key": "estructura_economica", "title": "5. Estructura económica (plantilla)", "content": "...", "unconfirmed": true },
    { "key": "anexos", "title": "6. Anexos requeridos", "content": "...", "unconfirmed": false }
  ],
  "checklists": [
    { "group": "Documentos administrativos", "items": [ { "label": "...", "required": true } ] },
    { "group": "Antes de enviar", "items": [ { "label": "...", "required": true } ] }
  ]
}`

      const reqBlock = requirements.map((r) => `- [${r.status}] ${r.description} (evidencia: ${r.evidence || 'ninguna registrada'})`).join('\n')

      const user = `PROCESO SECOP II A CUBRIR:
ID: ${rec.id}
Entidad: ${rec.entity}
Objeto: ${rec.objectName}
Descripción: ${rec.description || '(no publicada)'}
Presupuesto de referencia: ${rec.basePrice ? `$${rec.basePrice} COP` : 'no publicado'} (NO usarlo como precio de la propuesta)
Duración: ${rec.duration || 'n/d'} ${rec.durationUnit || ''}
Lugar: ${rec.city || 'n/d'} / ${rec.department || 'n/d'}

${companyBlock(bundle)}

MATRIZ DE REQUISITOS DEL ANÁLISIS:
${reqBlock}

Redacta el borrador de la propuesta técnica siguiendo la estructura JSON indicada.`

      const res = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
        temperature: 0.3,
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
        const unconfirmedCount =
          sections.filter((s) => s.unconfirmed).length +
          sections.reduce((acc, s) => acc + (String(s.content).match(/\[POR CONFIRMAR/g) || []).length, 0)
        return { sections, checklists, unconfirmedCount, engine: 'IA' }
      }
    } catch {
      // cae a plantilla
    }
  }
  return templateProposal(rec, bundle, requirements)
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

  const unconfirmedCount = sections.reduce((acc, s) => acc + (String(s.content).match(/\[POR CONFIRMAR/g) || []).length, 0)
  return { sections, checklists, unconfirmedCount, engine: 'REGLAS' }
}

export { parseJsonArray }
