// MÓDULO MCP — Servidor Model Context Protocol del Agente SECOP Radar
// Permite que otros proyectos/agentes (Claude Desktop, n8n, scripts, otros MCP clients)
// consuman las capacidades del agente vía JSON-RPC 2.0 sobre Streamable HTTP (/api/mcp).
//
// REGLA CRÍTICA heredada del Módulo G: ninguna tool inventa datos de la empresa.
// Las acciones de escritura exigen el mismo flujo de aprobación humana que la UI.

import { db } from '@/lib/db'
import { analyzeOpportunity, generateProposal, refineProposal, safeParseMarcoLogico } from '@/lib/ai'
import { runSync } from '@/lib/sync'
import { analyzePliegoText } from '@/lib/media'
import { parseJsonArray, type ProposalSection, type CompanyConfigData, type DocumentData, type ExperienceData, type ProductItemData } from '@/lib/types'

export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const MCP_SERVER_INFO = {
  name: 'secop-radar-mcp',
  title: 'SECOP Radar — Agente de oportunidades SECOP II',
  version: '1.0.0',
}

// ─── JSON-RPC 2.0 ────────────────────────────────────────────

export interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const ERR = {
  PARSE: { code: -32700, message: 'Error de parseo JSON' },
  REQUEST: { code: -32600, message: 'Request JSON-RPC inválido' },
  METHOD: { code: -32601, message: 'Método no encontrado' },
  PARAMS: { code: -32602, message: 'Parámetros inválidos' },
  INTERNAL: { code: -32603, message: 'Error interno' },
}

function rpcResult(id: JsonRpcMessage['id'], result: Record<string, unknown>) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: JsonRpcMessage['id'], err: { code: number; message: string }, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { ...err, ...(data !== undefined ? { data } : {}) } }
}

// ─── Helpers de dominio (compartidos por las tools) ──────────

interface CompanyRow {
  id: string
  name: string
  nit: string | null
  description: string | null
  city: string | null
  department: string | null
  minBudget: number
  maxBudget: number
  departmentsAllowed: string
  modalitiesAllowed: string
  contractTypesAllowed: string
  phasesAllowed: string
  requireKeywordHit: boolean
  capacity: string | null
  approverName: string | null
  products: { id: string; name: string; description: string | null; category: string | null; keywords: string }[]
  experiences: { id: string; title: string; entity: string | null; year: number | null; value: number | null; description: string | null }[]
  documents: { id: string; name: string; docType: string | null; status: string; notes: string | null }[]
}

function buildBundle(company: CompanyRow) {
  return {
    company: {
      id: company.id,
      name: company.name,
      nit: company.nit,
      description: company.description,
      city: company.city,
      department: company.department,
      minBudget: company.minBudget,
      maxBudget: company.maxBudget,
      departmentsAllowed: parseJsonArray(company.departmentsAllowed),
      modalitiesAllowed: parseJsonArray(company.modalitiesAllowed),
      contractTypesAllowed: parseJsonArray(company.contractTypesAllowed),
      phasesAllowed: parseJsonArray(company.phasesAllowed),
      requireKeywordHit: company.requireKeywordHit,
      capacity: company.capacity,
      approverName: company.approverName,
    } as CompanyConfigData,
    products: company.products.map((p) => ({ id: p.id, name: p.name, description: p.description, category: p.category, keywords: parseJsonArray(p.keywords) })) as ProductItemData[],
    experiences: company.experiences.map((e) => ({ id: e.id, title: e.title, entity: e.entity, year: e.year, value: e.value, description: e.description })) as ExperienceData[],
    documents: company.documents.map((d) => ({ id: d.id, name: d.name, docType: d.docType, status: d.status, notes: d.notes })) as DocumentData[],
  }
}

function mapRequirements(reqs: { code: string; description: string; status: string; evidence: string | null; action: string | null; source: string }[]) {
  return reqs.map((r) => ({
    code: r.code,
    description: r.description,
    status: r.status as 'CUMPLE' | 'NO_CUMPLE' | 'PENDIENTE' | 'REQUIERE_REVISION',
    evidence: r.evidence ?? undefined,
    action: r.action ?? undefined,
    source: r.source as 'IA' | 'REGLA',
  }))
}

function compactProcess(p: { id: string; entity: string; objectName: string; description: string | null; basePrice: number | null; modality: string | null; contractType: string | null; phase: string | null; state: string | null; duration: string | null; durationUnit: string | null; department: string | null; city: string | null; receptionDate: Date | null; url: string | null }) {
  return {
    id: p.id,
    entidad: p.entity,
    objeto: p.objectName,
    descripcion: p.description,
    valor_base_cop: p.basePrice,
    modalidad: p.modality,
    tipo_contrato: p.contractType,
    fase: p.phase,
    estado: p.state,
    duracion: p.duration ? `${p.duration} ${p.durationUnit || ''}`.trim() : null,
    ubicacion: [p.city, p.department].filter(Boolean).join(' / ') || null,
    fecha_limite_aprox: p.receptionDate,
    url: p.url,
  }
}

async function firstCompany() {
  return db.company.findFirst({
    orderBy: { createdAt: 'asc' },
    include: { products: true, experiences: true, documents: true },
  })
}

// ─── Registro de tools ───────────────────────────────────────

interface ToolDef {
  description: string
  inputSchema: Record<string, unknown>
  write?: boolean // herramienta que muta estado (exige flujo de aprobación vigente)
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export const MCP_TOOLS: Record<string, ToolDef> = {
  list_opportunities: {
    description:
      'Lista las oportunidades SECOP II detectadas para la empresa, con estado, compatibilidad (score), entidad, objeto, valor y fecha límite aproximada. Filtro opcional por estado.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['NUEVA', 'EN_ANALISIS', 'COMPATIBLE', 'APROBADA_PREPARACION', 'DESCARTADA'], description: 'Filtrar por estado de la oportunidad' },
        limit: { type: 'number', maximum: 50, default: 20, description: 'Máximo de resultados (1-50)' },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Math.max(num(args.limit) ?? 20, 1), 50)
      const status = str(args.status) || undefined
      const opps = await db.opportunity.findMany({
        where: status ? { status } : undefined,
        include: { process: true },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      })
      return {
        total: opps.length,
        oportunidades: opps.map((o) => ({
          opportunityId: o.id,
          proceso: compactProcess(o.process),
          estado_oportunidad: o.status,
          compatibilidad: o.score,
          resumen_analisis: o.analysisSummary,
          siguiente_accion: o.nextAction,
        })),
      }
    },
  },

  get_opportunity: {
    description:
      'Expediente completo de una oportunidad: datos del proceso SECOP, matriz de requisitos (estado/evidencia/acción), riesgos, documentos faltantes y la propuesta más reciente con sus secciones.',
    inputSchema: {
      type: 'object',
      properties: { opportunityId: { type: 'string', description: 'ID de la oportunidad (lo entrega list_opportunities)' } },
      required: ['opportunityId'],
    },
    handler: async (args) => {
      const id = str(args.opportunityId)
      if (!id) throw new Error('opportunityId es obligatorio')
      const opp = await db.opportunity.findUnique({
        where: { id },
        include: {
          process: true,
          requirements: { orderBy: { code: 'asc' } },
          proposals: { orderBy: { version: 'desc' }, take: 1 },
        },
      })
      if (!opp) throw new Error('Oportunidad no encontrada')
      const latest = opp.proposals[0]
      return {
        opportunityId: opp.id,
        estado: opp.status,
        compatibilidad: opp.score,
        proceso: compactProcess(opp.process),
        resumen_analisis: opp.analysisSummary,
        matriz_requisitos: opp.requirements.map((r) => ({ codigo: r.code, requisito: r.description, estado: r.status, evidencia: r.evidence, accion: r.action })),
        riesgos: parseJsonArray(opp.risksJson),
        documentos_faltantes: parseJsonArray(opp.missingDocsJson),
        siguiente_accion: opp.nextAction,
        propuesta_reciente: latest
          ? { proposalId: latest.id, version: latest.version, estado: latest.status, secciones: parseJsonArray(latest.sectionsJson), marcadores_por_confirmar: latest.unconfirmedCount }
          : null,
      }
    },
  },

  search_opportunities: {
    description:
      'Busca oportunidades SECOP II por texto libre (objeto/descripción) y rango de valor. Devuelve coincidencias con su compatibilidad para la empresa.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar en el objeto o descripción del proceso' },
        minValue: { type: 'number', description: 'Valor mínimo en COP' },
        maxValue: { type: 'number', description: 'Valor máximo en COP' },
        limit: { type: 'number', maximum: 50, default: 20 },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Math.max(num(args.limit) ?? 20, 1), 50)
      const query = str(args.query).trim()
      const minValue = num(args.minValue)
      const maxValue = num(args.maxValue)
      const opps = await db.opportunity.findMany({
        where: {
          AND: [
            { status: { not: 'DESCARTADA' } },
            ...(query ? [{ process: { OR: [{ objectName: { contains: query } }, { description: { contains: query } }, { entity: { contains: query } }] } }] : []),
            ...(minValue != null || maxValue != null
              ? [{ process: { basePrice: { ...(minValue != null ? { gte: minValue } : {}), ...(maxValue != null ? { lte: maxValue } : {}) } } }]
              : []),
          ],
        },
        include: { process: true },
        orderBy: { score: 'desc' },
        take: limit,
      })
      return { total: opps.length, resultados: opps.map((o) => ({ opportunityId: o.id, compatibilidad: o.score, estado: o.status, proceso: compactProcess(o.process) })) }
    },
  },

  analyze_opportunity: {
    description:
      'Ejecuta el análisis inteligente (Módulo D) sobre una oportunidad: la IA lee el proceso SECOP, extrae requisitos y construye la matriz REQUISITO|ESTADO|EVIDENCIA|ACCIÓN usando solo la evidencia registrada de la empresa.',
    inputSchema: {
      type: 'object',
      properties: { opportunityId: { type: 'string' } },
      required: ['opportunityId'],
    },
    write: true,
    handler: async (args) => {
      const id = str(args.opportunityId)
      if (!id) throw new Error('opportunityId es obligatorio')
      const opp = await db.opportunity.findUnique({ where: { id }, include: { process: true, company: { include: { products: true, experiences: true, documents: true } } } })
      if (!opp) throw new Error('Oportunidad no encontrada')
      if (opp.status === 'DESCARTADA') throw new Error('La oportunidad está descartada')

      await db.opportunity.update({ where: { id }, data: { status: 'EN_ANALISIS' } })
      const analysis = await analyzeOpportunity(opp.process, buildBundle(opp.company))

      await db.requirement.deleteMany({ where: { opportunityId: id } })
      await db.requirement.createMany({
        data: analysis.requirements.map((r) => ({
          opportunityId: id,
          code: r.code,
          description: r.description,
          status: r.status,
          evidence: r.evidence ?? null,
          action: r.action ?? null,
          source: r.source ?? 'IA',
        })),
      })

      const unmet = analysis.requirements.filter((r) => r.status === 'NO_CUMPLE')
      await db.opportunity.update({
        where: { id },
        data: {
          status: 'COMPATIBLE',
          analysisSummary: analysis.summary,
          nextAction: analysis.nextAction,
          risksJson: JSON.stringify([...analysis.risks]),
          missingDocsJson: JSON.stringify([...analysis.missingDocs]),
          score: unmet.length > 0 ? Math.max(5, opp.score - unmet.length * 8) : opp.score,
        },
      })

      await db.auditEvent.create({
        data: { action: 'ANALIZAR_OPORTUNIDAD', entityType: 'Opportunity', entityId: id, detail: `Análisis con motor ${analysis.engine} vía MCP: ${analysis.requirements.length} requisitos evaluados` },
      })

      return {
        engine: analysis.engine,
        resumen: analysis.summary,
        matriz_requisitos: analysis.requirements,
        documentos_faltantes: analysis.missingDocs,
        riesgos: analysis.risks,
        siguiente_accion: analysis.nextAction,
      }
    },
  },

  get_company_profile: {
    description: 'Perfil completo de la empresa: datos básicos, filtros configurados, productos/servicios, experiencia comprobada y documentos del expediente. Es la ÚNICA evidencia válida que el agente puede usar.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const company = await firstCompany()
      if (!company) throw new Error('No hay empresa configurada')
      return {
        companyId: company.id,
        nombre: company.name,
        nit: company.nit,
        descripcion: company.description,
        ubicacion: [company.city, company.department].filter(Boolean).join(' / ') || null,
        rango_economico_cop: { min: company.minBudget, max: company.maxBudget },
        cobertura_departamentos: parseJsonArray(company.departmentsAllowed),
        modalidades_interes: parseJsonArray(company.modalitiesAllowed),
        tipos_contrato_interes: parseJsonArray(company.contractTypesAllowed),
        capacidad_operativa: company.capacity,
        responsable_aprobacion: company.approverName,
        productos_servicios: company.products.map((p) => ({ nombre: p.name, descripcion: p.description, categoria: p.category, palabras_clave: parseJsonArray(p.keywords) })),
        experiencia: company.experiences.map((e) => ({ titulo: e.title, entidad: e.entity, anio: e.year, valor_cop: e.value, descripcion: e.description })),
        documentos: company.documents.map((d) => ({ nombre: d.name, tipo: d.docType, estado: d.status })),
      }
    },
  },

  generate_proposal: {
    description:
      'Genera una nueva versión del borrador de proyecto completo (Modo Agente Proyectista: 12 secciones — resumen ejecutivo, entendimiento, solución, metodología, cronograma, equipo, indicadores, riesgos, por qué nosotros, estructura económica, anexos y MARCO LÓGICO con matriz estructurada). Exige que la oportunidad esté aprobada para preparación (aprobación humana previa).',
    inputSchema: {
      type: 'object',
      properties: { opportunityId: { type: 'string' } },
      required: ['opportunityId'],
    },
    write: true,
    handler: async (args) => {
      const id = str(args.opportunityId)
      if (!id) throw new Error('opportunityId es obligatorio')
      const opp = await db.opportunity.findUnique({
        where: { id },
        include: { process: true, requirements: { orderBy: { code: 'asc' } }, company: { include: { products: true, experiences: true, documents: true } } },
      })
      if (!opp) throw new Error('Oportunidad no encontrada')
      if (opp.status !== 'APROBADA_PREPARACION') {
        throw new Error('Solo se puede generar propuesta para oportunidades aprobadas para preparación (Módulo H — aprobación humana)')
      }

      const bundle = buildBundle(opp.company)
      const draft = await generateProposal(opp.process, bundle, mapRequirements(opp.requirements))

      const last = await db.proposal.findFirst({ where: { opportunityId: id }, orderBy: { version: 'desc' } })
      const version = (last?.version ?? 0) + 1
      const proposal = await db.proposal.create({
        data: {
          companyId: opp.company.id,
          opportunityId: id,
          version,
          status: 'BORRADOR',
          sectionsJson: JSON.stringify(draft.sections),
          checklistsJson: JSON.stringify(draft.checklists),
          logicFrameworkJson: draft.marcoLogico ? JSON.stringify(draft.marcoLogico) : null,
          unconfirmedCount: draft.unconfirmedCount,
        },
      })

      await db.auditEvent.create({
        data: { action: 'GENERAR_PROPUESTA', entityType: 'Proposal', entityId: proposal.id, detail: `Versión ${version} generada vía MCP con motor ${draft.engine}. ${draft.unconfirmedCount} dato(s) marcado(s) por confirmar.${draft.marcoLogico ? ' Incluye marco lógico.' : ''}` },
      })

      return {
        proposalId: proposal.id,
        version,
        engine: draft.engine,
        marcadores_por_confirmar: draft.unconfirmedCount,
        secciones: draft.sections,
        marco_logico: draft.marcoLogico,
        checklist: draft.checklists,
        advertencia: 'Los precios NO los define el agente: la estructura económica es plantilla. La presentación en SECOP es manual y exige aprobación humana.',
      }
    },
  },

  refine_proposal: {
    description:
      'Refinamiento conversacional de la propuesta (Modo Agente Proyectista): aplica una instrucción en lenguaje natural ("haz el cronograma más agresivo", "enfatiza la experiencia ambiental") y regenera el proyecto completo como nueva versión trazable.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'ID de la propuesta (lo entrega get_opportunity o generate_proposal)' },
        instruction: { type: 'string', description: 'Instrucción de refinamiento en lenguaje natural (máx. 2000 caracteres)' },
      },
      required: ['proposalId', 'instruction'],
    },
    write: true,
    handler: async (args) => {
      const proposalId = str(args.proposalId)
      const instruction = str(args.instruction).trim()
      if (!proposalId) throw new Error('proposalId es obligatorio')
      if (!instruction) throw new Error('instruction es obligatoria')
      if (instruction.length > 2000) throw new Error('La instrucción supera 2000 caracteres')

      const proposal = await db.proposal.findUnique({
        where: { id: proposalId },
        include: {
          opportunity: {
            include: {
              process: true,
              requirements: { orderBy: { code: 'asc' } },
              company: { include: { products: true, experiences: true, documents: true } },
            },
          },
        },
      })
      if (!proposal) throw new Error('Propuesta no encontrada')
      if (proposal.status === 'APROBADA') throw new Error('La propuesta está aprobada: devuélvela desde la revisión (Módulo H) antes de refinar')

      const opp = proposal.opportunity
      const history = await db.proposalMessage.findMany({ where: { opportunityId: opp.id }, orderBy: { createdAt: 'desc' }, take: 10 })
      const currentML = safeParseMarcoLogico(proposal.logicFrameworkJson)
      const result = await refineProposal(opp.process, buildBundle(opp.company), mapRequirements(opp.requirements), parseJsonArray<ProposalSection>(proposal.sectionsJson), instruction, history.reverse().map((m) => ({ role: m.role, content: m.content })), currentML)
      if (!result) throw new Error('El motor IA no está disponible en este momento')

      // Si la IA omitió el marco lógico, conserva el vigente (no se pierde la matriz)
      const mlFinal = result.marcoLogico ?? currentML
      const version = proposal.version + 1
      const unconfirmedCount =
        result.sections.filter((s) => s.unconfirmed).length +
        result.sections.reduce((acc, s) => acc + (String(s.content).match(/\[POR CONFIRMAR/g) || []).length, 0)

      const newProposal = await db.proposal.create({
        data: {
          companyId: opp.company.id,
          opportunityId: opp.id,
          version,
          status: 'BORRADOR',
          sectionsJson: JSON.stringify(result.sections),
          checklistsJson: proposal.checklistsJson,
          logicFrameworkJson: mlFinal ? JSON.stringify(mlFinal) : null,
          unconfirmedCount,
        },
      })

      await db.proposalMessage.createMany({
        data: [
          { opportunityId: opp.id, role: 'USUARIO', content: instruction, versionBefore: proposal.version, versionAfter: version },
          { opportunityId: opp.id, role: 'AGENTE', content: result.changeSummary, versionBefore: proposal.version, versionAfter: version, sectionsAffected: JSON.stringify(result.sectionsAffected) },
        ],
      })

      await db.auditEvent.create({
        data: { action: 'REFINAR_PROPUESTA', entityType: 'Proposal', entityId: newProposal.id, detail: `Versión ${version} (desde v${proposal.version}) refinada vía MCP. Secciones: ${result.sectionsAffected.join(', ') || 'n/d'}.` },
      })

      return { proposalId: newProposal.id, version, resumen_cambio: result.changeSummary, secciones_afectadas: result.sectionsAffected, marcadores_por_confirmar: unconfirmedCount, secciones: result.sections, marco_logico: mlFinal }
    },
  },

  sync_secop: {
    description: 'Sincroniza procesos desde la fuente oficial SECOP II (datos.gov.co, dataset p6dx-8zbt): ingesta con dedup, detección de cambios, filtrado determinístico, compatibilidad, ranking y alertas.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', default: 45, description: 'Ventana de publicación en días' },
        limit: { type: 'number', maximum: 1000, default: 300, description: 'Máximo de procesos a consultar' },
      },
    },
    write: true,
    handler: async (args) => {
      const result = await runSync({
        days: num(args.days) ?? 45,
        limit: Math.min(num(args.limit) ?? 300, 1000),
      })
      return result
    },
  },

  get_dashboard_stats: {
    description: 'KPIs del panel: oportunidades por estado, propuestas, alertas no leídas y última sincronización registrada en auditoría.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const statuses = ['NUEVA', 'EN_ANALISIS', 'COMPATIBLE', 'APROBADA_PREPARACION', 'DESCARTADA'] as const
      const [porEstado, propuestasPorOpp, alertasNoLeidas, ultimaSync] = await Promise.all([
        Promise.all(statuses.map(async (s) => [s, await db.opportunity.count({ where: { status: s } })])),
        db.proposal.groupBy({ by: ['opportunityId'] }),
        db.notification.count({ where: { read: false } }),
        db.auditEvent.findFirst({ where: { action: 'SYNC_SECOP' }, orderBy: { createdAt: 'desc' } }),
      ])
      return {
        oportunidades_por_estado: Object.fromEntries(porEstado),
        propuestas_registradas: propuestasPorOpp.length, // oportunidades con propuestas (no versiones)
        alertas_no_leidas: alertasNoLeidas,
        ultima_sincronizacion: ultimaSync ? { fecha: ultimaSync.createdAt, detalle: ultimaSync.detail } : null,
      }
    },
  },

  get_marco_logico: {
    description:
      'Devuelve la Matriz de Marco Lógico del borrador más reciente de una oportunidad: árbol de problemas (problema central, causas, efectos), objetivo central y filas Fin/Propósito/Componentes/Actividades con indicadores verificables, medios de verificación y supuestos.',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'ID de la oportunidad (toma el borrador más reciente)' },
        proposalId: { type: 'string', description: 'ID de la propuesta (alternativo a opportunityId)' },
      },
    },
    handler: async (args) => {
      const proposalId = str(args.proposalId)
      let proposal = null as { id: string; version: number; logicFrameworkJson: string | null } | null
      if (proposalId) {
        proposal = await db.proposal.findUnique({ where: { id: proposalId }, select: { id: true, version: true, logicFrameworkJson: true } })
      } else {
        const oppId = str(args.opportunityId)
        if (!oppId) throw new Error('Entrega opportunityId o proposalId')
        proposal = await db.proposal.findFirst({ where: { opportunityId: oppId }, orderBy: { version: 'desc' }, select: { id: true, version: true, logicFrameworkJson: true } })
      }
      if (!proposal) throw new Error('Propuesta no encontrada')
      const ml = safeParseMarcoLogico(proposal.logicFrameworkJson)
      return {
        proposalId: proposal.id,
        version: proposal.version,
        marco_logico: ml,
        nota: ml
          ? 'El marco lógico es una propuesta estructural generada por IA: valida indicadores, medios y supuestos contra el pliego real antes de presentar.'
          : 'Esta propuesta aún no tiene marco lógico: pide una nueva versión o refina con la instrucción «construye el marco lógico completo con árbol de problemas».',
      }
    },
  },

  analyze_pliego_text: {
    description:
      'Analiza el TEXTO de un pliego de condiciones, términos de referencia, contrato u otro documento de contratación pública: extrae objeto, entidad, valores, plazos, requisitos habilitantes, garantías, criterios de evaluación, si exige marco lógico y alertas. (Extrae el texto del PDF antes de llamar esta tool.)',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Texto del documento (máx. 60.000 caracteres)' },
      },
      required: ['text'],
    },
    handler: async (args) => {
      const text = str(args.text).trim()
      if (!text) throw new Error('text es obligatorio')
      if (text.length > 60000) throw new Error('El texto supera 60.000 caracteres: divide el documento en partes')
      return analyzePliegoText(text)
    },
  },

  get_inbox: {
    description:
      'Mensajes recientes del agente por los canales de mensajería (Telegram, WhatsApp y panel web): conversaciones, transcripciones de notas de voz y análisis de pliegos/imágenes/video recibidos.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['TELEGRAM', 'WHATSAPP', 'WEB'], description: 'Filtrar por canal (opcional)' },
        limit: { type: 'number', maximum: 50, default: 20, description: 'Máximo de mensajes (1-50)' },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Math.max(num(args.limit) ?? 20, 1), 50)
      const channel = str(args.channel)
      const messages = await db.channelMessage.findMany({
        where: ['TELEGRAM', 'WHATSAPP', 'WEB'].includes(channel) ? { channel } : {},
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return {
        total: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          canal: m.channel,
          chat: m.chatName || m.chatId,
          direccion: m.direction,
          tipo: m.type,
          texto: m.text,
          transcripcion: m.transcript,
          analisis: m.analysis,
          estado: m.status,
          fecha: m.createdAt,
        })),
      }
    },
  },

  // ─── Observability / Doctor / Skills / Memory (PROMPT 05 §25) ─

  get_audit_events: {
    description:
      'Eventos de auditoría recientes del agente (acciones, entidad afectada, detalle, latencia y estado). Útil para reconstruir qué hizo el agente y cuándo.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', maximum: 100, default: 20, description: 'Máximo de eventos (1-100)' },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Math.max(num(args.limit) ?? 20, 1), 100)
      const events = await db.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
      return {
        total: events.length,
        eventos: events.map((e) => ({
          id: e.id,
          accion: e.action,
          entidad: e.entityType,
          entidadId: e.entityId,
          detalle: e.detail,
          executionId: e.executionId,
          correlationId: e.correlationId,
          agentId: e.agentId,
          latenciaMs: e.latencyMs,
          estado: e.status,
          fecha: e.createdAt,
        })),
      }
    },
  },

  get_executions: {
    description:
      'Ejecuciones recientes del agente (observability §25): operación, nivel de autonomía, latencia, estado (SUCCESS/PARTIAL/FAILED) y errores. Filtrable por operación.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Filtrar por operación, p. ej. GENERATE_PROPOSAL, DOCTOR_RUN (opcional)' },
        limit: { type: 'number', maximum: 100, default: 20, description: 'Máximo de ejecuciones (1-100)' },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Math.max(num(args.limit) ?? 20, 1), 100)
      const operation = str(args.operation) || undefined
      const executions = await db.execution.findMany({
        where: operation ? { operation } : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return {
        total: executions.length,
        ejecuciones: executions.map((e) => ({
          id: e.id,
          operacion: e.operation,
          correlationId: e.correlationId,
          skill: e.skillIdentity,
          autonomia: e.autonomyLevel,
          estado: e.status,
          latenciaMs: e.latencyMs,
          errores: e.errorsJson ? parseJsonArray<unknown>(e.errorsJson) : undefined,
          fecha: e.createdAt,
        })),
      }
    },
  },

  memory_search: {
    description:
      'Busca en la memoria del agente (MemoryDV §13-14): recuerdos episódicos, semánticos, factuales y procedurales con su nivel de verdad. Requiere el módulo de memoria (Agente 2-b).',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Texto a buscar en clave/contenido/resumen de la memoria' },
        type: { type: 'string', enum: ['EPISODIC', 'SEMANTIC', 'FACTUAL', 'PROCEDURAL'], description: 'Filtrar por tipo de memoria (opcional)' },
        limit: { type: 'number', maximum: 50, default: 10, description: 'Máximo de recuerdos (1-50)' },
      },
      required: ['q'],
    },
    handler: async (args) => {
      const q = str(args.q).trim()
      if (!q) throw new Error('Parámetro requerido: q (texto a buscar)')
      const limit = Math.min(Math.max(num(args.limit) ?? 10, 1), 50)
      const type = str(args.type)
      // Módulo MemoryDV (Agente 2-b): import dinámico — compila aunque aún no exista.
      try {
        const mod = (await import('@/lib/memory')) as Record<string, unknown>
        // API preferida: recall(q, { type, limit })
        const recall = typeof mod.recall === 'function' ? (mod.recall as (q: string, opts?: unknown) => Promise<unknown>) : undefined
        const fallback = ['searchMemory', 'memorySearch', 'search'].map((k) => mod[k]).find((f) => typeof f === 'function') as
          | ((...a: unknown[]) => Promise<unknown>)
          | undefined
        if (!recall && !fallback) throw new Error('sin función de búsqueda exportada')
        const results = recall ? await recall(q, { type: type || undefined, limit }) : await fallback!(q, type || undefined, limit)
        return { query: q, resultados: results }
      } catch (err) {
        throw new Error(`MemoryDV no disponible: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  },

  list_skills: {
    description:
      'Lista los skill contracts activos del agente (§15): identidad, versión, propósito, disparador, tasa de éxito y origen (SEED/LEARNED).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const skills = await db.skillContract.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { identity: 'asc' },
      })
      return {
        total: skills.length,
        skills: skills.map((s) => ({
          identity: s.identity,
          version: s.version,
          proposito: s.purpose,
          disparador: s.trigger,
          resultadoEsperado: s.expectedResult,
          successRate: s.successRate,
          runsCount: s.runsCount,
          confianza: s.confidence,
          origen: s.origin,
          ultimaValidacion: s.lastValidatedAt,
        })),
      }
    },
  },

  doctor_report: {
    description:
      'Diagnóstico de salud del agente (Doctor): conectividad SECOP, integridad de BD, canales, tools MCP, memoria, skills, evidencia sin provenance, requisitos sin fuente, deadlines vencidos y ejecuciones fallidas (24h).',
    inputSchema: {
      type: 'object',
      properties: {
        fix: { type: 'boolean', default: false, description: 'Aplica auto-fixes seguros (re-seed skills, consolidación de memoria) si es true' },
      },
    },
    handler: async (args) => {
      const { runDoctor } = await import('@/lib/doctor')
      const report = await runDoctor({ fix: args.fix === true })
      return {
        status: report.status,
        checkedAt: report.checkedAt,
        executionId: report.executionId,
        resumen: Object.fromEntries(report.checks.map((c) => [c.id, c.status])),
        checks: report.checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })),
        fixes: report.fixes,
      }
    },
  },
}

// ─── Dispatcher JSON-RPC ─────────────────────────────────────

export interface RpcOutcome {
  status: number
  body: JsonRpcMessage | JsonRpcMessage[] | null
  sessionId?: string
}

export async function handleRpcMessage(msg: JsonRpcMessage): Promise<RpcOutcome> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { status: 400, body: rpcError(msg?.id ?? null, ERR.REQUEST) }
  }

  const isNotification = msg.id === undefined || msg.id === null

  switch (msg.method) {
    case 'initialize': {
      const requested = typeof msg.params?.protocolVersion === 'string' ? (msg.params.protocolVersion as string) : MCP_PROTOCOL_VERSION
      const version = requested.startsWith('2025-') || requested.startsWith('2024-') ? requested : MCP_PROTOCOL_VERSION
      return {
        status: 200,
        sessionId: crypto.randomUUID(),
        body: rpcResult(msg.id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
          instructions:
            'Agente SECOP Radar: monitorea oportunidades de contratación pública colombiana (SECOP II), las analiza contra el perfil de la empresa, diseña proyectos-respuesta completos con Marco Lógico (árbol de problemas + matriz Fin/Propósito/Componentes/Actividades) y los refina conversacionalmente. También analiza pliegos/documentos y consulta la bandeja de canales de mensajería (Telegram/WhatsApp). Empieza con get_dashboard_stats o list_opportunities. Las tools de escritura respetan el flujo de aprobación humana.',
        }),
      }
    }

    case 'notifications/initialized':
      return { status: 202, body: null }

    case 'ping':
      return isNotification ? { status: 202, body: null } : { status: 200, body: rpcResult(msg.id, {}) }

    case 'tools/list':
      return {
        status: 200,
        body: rpcResult(msg.id, {
          tools: Object.entries(MCP_TOOLS).map(([name, t]) => ({
            name,
            title: name,
            description: t.description + (t.write ? ' [escribe datos / exige aprobación humana previa]' : ''),
            inputSchema: t.inputSchema,
          })),
        }),
      }
  }

  if (msg.method.startsWith('notifications/')) return { status: 202, body: null }

  if (msg.method === 'tools/call') {
    const name = str(msg.params?.name)
    const tool = MCP_TOOLS[name]
    if (!tool) {
      return { status: 200, body: rpcError(msg.id, ERR.METHOD, `Tool desconocida: ${name}. Usa tools/list para ver las disponibles.`) }
    }
    const args = (msg.params?.arguments as Record<string, unknown>) || {}
    try {
      const result = await tool.handler(args)
      return {
        status: 200,
        body: rpcResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        }),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error interno de la tool'
      return {
        status: 200,
        body: rpcResult(msg.id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }),
      }
    }
  }

  return { status: 200, body: rpcError(msg.id, ERR.METHOD, `Método no soportado: ${msg.method}`) }
}
