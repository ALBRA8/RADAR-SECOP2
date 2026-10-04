import { db } from '@/lib/db'
import { safe } from '@/lib/api'
import { analyzeOpportunity } from '@/lib/ai'
import { recomputeRanking } from '@/lib/sync'
import { parseJsonArray, type CompanyConfigData, type DocumentData, type ExperienceData, type ProductItemData } from '@/lib/types'

// MÓDULO D — Análisis inteligente de la oportunidad (IA con motor de reglas de respaldo)
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    const { id } = await params
    const opp = await db.opportunity.findUnique({ where: { id }, include: { process: true, company: { include: { products: true, experiences: true, documents: true } } } })
    if (!opp) throw new Error('Oportunidad no encontrada')
    if (opp.status === 'DESCARTADA') throw new Error('La oportunidad está descartada')

    await db.opportunity.update({ where: { id }, data: { status: 'EN_ANALISIS' } })

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

    const analysis = await analyzeOpportunity(opp.process, bundle)

    // Reemplaza la matriz de requisitos con el nuevo análisis
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
    const updated = await db.opportunity.update({
      where: { id },
      data: {
        status: 'COMPATIBLE',
        analysisSummary: analysis.summary,
        nextAction: analysis.nextAction,
        risksJson: JSON.stringify([...analysis.risks]),
        missingDocsJson: JSON.stringify([...analysis.missingDocs]),
        // Un requisito habilitante NO cumplido reduce la compatibilidad, pero no descarta
        // automáticamente: la decisión final es del humano (MÓDULO H).
        score: unmet.length > 0 ? Math.max(5, opp.score - unmet.length * 8) : opp.score,
      },
      include: { requirements: { orderBy: { code: 'asc' } } },
    })

    if (unmet.length > 0) {
      await db.notification.create({
        data: {
          type: 'REQUISITO_CRITICO',
          title: `Requisitos no cumplidos en ${opp.process.id}`,
          message: `${unmet.length} requisito(s) marcado(s) como NO_CUMPLE: ${unmet.map((r) => r.description).slice(0, 2).join(' | ')}.`,
          opportunityId: id,
        },
      })
    }

    await db.auditEvent.create({
      data: { action: 'ANALIZAR_OPORTUNIDAD', entityType: 'Opportunity', entityId: id, detail: `Análisis con motor ${analysis.engine}: ${analysis.requirements.length} requisitos evaluados` },
    })

    await recomputeRanking([company.id])

    return { opportunity: updated, analysisEngine: analysis.engine, analysis }
  })
}
