import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'
import { refineProposal } from '@/lib/ai'
import { parseJsonArray, type CompanyConfigData, type DocumentData, type ExperienceData, type ProductItemData } from '@/lib/types'

// MÓDULO G+ — Refinamiento conversacional de la propuesta (Modo Agente Proyectista)
// Cada instrucción genera una nueva versión trazable + mensajes USUARIO/AGENTE persistentes.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const instruction = String(body.instruction || '').trim()
    if (!instruction) return bad('Falta la instrucción de refinamiento')
    if (instruction.length > 2000) return bad('La instrucción es demasiado larga (máx. 2000 caracteres)')

    const proposal = await db.proposal.findUnique({
      where: { id },
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
    if (proposal.status === 'APROBADA') {
      throw new Error('La propuesta ya está aprobada: si necesita cambios, devuélvela desde la revisión (Módulo H) y vuelve a refinar')
    }

    const opp = proposal.opportunity
    const company = opp.company

    const bundle = {
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

    const requirements = opp.requirements.map((r) => ({
      code: r.code,
      description: r.description,
      status: r.status as 'CUMPLE' | 'NO_CUMPLE' | 'PENDIENTE' | 'REQUIERE_REVISION',
      evidence: r.evidence ?? undefined,
      action: r.action ?? undefined,
      source: r.source as 'IA' | 'REGLA',
    }))

    const currentSections = parseJsonArray(proposal.sectionsJson)

    // Historial conversacional previo (últimos 10 mensajes para contexto)
    const history = await db.proposalMessage.findMany({
      where: { opportunityId: opp.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    const historyItems = history.reverse().map((m) => ({ role: m.role, content: m.content }))

    const result = await refineProposal(
      opp.process,
      bundle,
      requirements,
      currentSections,
      instruction,
      historyItems,
    )
    if (!result) {
      throw new Error('El motor IA no está disponible en este momento — intenta de nuevo en unos segundos')
    }

    // Nueva versión trazable
    const version = proposal.version + 1
    const unconfirmedCount =
      result.sections.filter((s) => s.unconfirmed).length +
      result.sections.reduce((acc, s) => acc + (String(s.content).match(/\[POR CONFIRMAR/g) || []).length, 0)

    const newProposal = await db.proposal.create({
      data: {
        companyId: company.id,
        opportunityId: opp.id,
        version,
        status: 'BORRADOR',
        sectionsJson: JSON.stringify(result.sections),
        checklistsJson: proposal.checklistsJson,
        unconfirmedCount,
      },
    })

    // Mensajes del chat (persistentes por oportunidad, atraviesan versiones)
    await db.proposalMessage.createMany({
      data: [
        { opportunityId: opp.id, role: 'USUARIO', content: instruction, versionBefore: proposal.version, versionAfter: version },
        {
          opportunityId: opp.id,
          role: 'AGENTE',
          content: result.changeSummary,
          versionBefore: proposal.version,
          versionAfter: version,
          sectionsAffected: JSON.stringify(result.sectionsAffected),
        },
      ],
    })

    await db.auditEvent.create({
      data: {
        action: 'REFINAR_PROPUESTA',
        entityType: 'Proposal',
        entityId: newProposal.id,
        detail: `Versión ${version} (desde v${proposal.version}) por instrucción conversacional. Secciones: ${result.sectionsAffected.join(', ') || 'n/d'}. ${unconfirmedCount} marcador(es) [POR CONFIRMAR].`,
      },
    })

    return {
      proposal: {
        ...newProposal,
        sections: result.sections,
        checklists: parseJsonArray(proposal.checklistsJson),
      },
      changeSummary: result.changeSummary,
      sectionsAffected: result.sectionsAffected,
      engine: result.engine,
    }
  })
}

// Historial del chat de refinamiento de una propuesta (por oportunidad)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    const { id } = await params
    const proposal = await db.proposal.findUnique({ where: { id }, select: { opportunityId: true } })
    if (!proposal) throw new Error('Propuesta no encontrada')
    const messages = await db.proposalMessage.findMany({
      where: { opportunityId: proposal.opportunityId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    return { messages }
  })
}
