import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'
import { generateProposal } from '@/lib/ai'
import { parseJsonArray, type CompanyConfigData, type DocumentData, type ExperienceData, type ProductItemData } from '@/lib/types'

// MÓDULO G — Generación de borrador de propuesta (requiere oportunidad aprobada para preparación)
export async function POST(req: Request) {
  return safe(async () => {
    const body = await req.json()
    const opportunityId = body.opportunityId as string
    if (!opportunityId) return bad('Falta opportunityId')

    const opp = await db.opportunity.findUnique({
      where: { id: opportunityId },
      include: {
        process: true,
        company: { include: { products: true, experiences: true, documents: true } },
        requirements: true,
      },
    })
    if (!opp) throw new Error('Oportunidad no encontrada')
    if (opp.status !== 'APROBADA_PREPARACION') {
      throw new Error('Solo se puede generar propuesta para oportunidades aprobadas para preparación (Módulo H)')
    }

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

    const draft = await generateProposal(opp.process, bundle, requirements)

    const lastVersion = await db.proposal.findFirst({ where: { opportunityId }, orderBy: { version: 'desc' } })
    const version = (lastVersion?.version ?? 0) + 1

    const proposal = await db.proposal.create({
      data: {
        companyId: company.id,
        opportunityId,
        version,
        status: 'BORRADOR',
        sectionsJson: JSON.stringify(draft.sections),
        checklistsJson: JSON.stringify(draft.checklists),
        unconfirmedCount: draft.unconfirmedCount,
      },
    })

    await db.auditEvent.create({
      data: {
        action: 'GENERAR_PROPUESTA',
        entityType: 'Proposal',
        entityId: proposal.id,
        detail: `Versión ${version} generada con motor ${draft.engine}. ${draft.unconfirmedCount} dato(s) marcado(s) por confirmar.`,
      },
    })

    return { proposal: { ...proposal, sections: draft.sections, checklists: draft.checklists }, engine: draft.engine }
  })
}
