import { db } from '@/lib/db'
import { safe } from '@/lib/api'
import { parseJsonArray } from '@/lib/types'

// Panel principal (sección 7)
export async function GET() {
  return safe(async () => {
    const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } })

    const [nuevas, enAnalisis, compatibles, aprobadas, descartadas, lastSync, alertsRaw] = await Promise.all([
      db.opportunity.count({ where: { status: 'NUEVA' } }),
      db.opportunity.count({ where: { status: 'EN_ANALISIS' } }),
      db.opportunity.count({ where: { status: 'COMPATIBLE' } }),
      db.opportunity.count({ where: { status: 'APROBADA_PREPARACION' } }),
      db.opportunity.count({ where: { status: 'DESCARTADA' } }),
      db.auditEvent.findFirst({ where: { action: 'SYNC_SECOP' }, orderBy: { createdAt: 'desc' } }),
      db.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { opportunity: { include: { process: true } } } }),
    ])

    // Top 5 oportunidades prioritarias (MÓDULO F)
    const topOpportunities = await db.opportunity.findMany({
      where: { status: { in: ['NUEVA', 'EN_ANALISIS', 'COMPATIBLE'] } },
      include: { process: true },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    })

    // Próximas a vencer: usando fecha de recepción de respuestas cuando la entidad la publica
    const withDeadline = await db.opportunity.findMany({
      where: { status: { in: ['NUEVA', 'EN_ANALISIS', 'COMPATIBLE'] }, process: { receptionDate: { not: null } } },
      include: { process: true },
      orderBy: { process: { receptionDate: 'asc' } },
      take: 5,
    })
    const now = Date.now()
    const expiring = withDeadline.filter((o) => {
      const d = o.process.receptionDate ? new Date(o.process.receptionDate).getTime() : 0
      return d > now && d - now < 15 * 24 * 3600 * 1000
    })

    // Conteo por OPORTUNIDADES con propuestas (no por versiones del borrador)
    const [versionesPorOpp, borradorPorOpp] = await Promise.all([
      db.proposal.groupBy({ by: ['opportunityId'] }),
      db.proposal.groupBy({ by: ['opportunityId'], where: { status: 'BORRADOR' } }),
    ])

    const lastSyncData = lastSync
      ? {
          at: lastSync.createdAt,
          detail: lastSync.detail,
          source: parseJsonArray<{ k: string }>('[]'),
        }
      : null

    return {
      company: company ? { id: company.id, name: company.name } : null,
      stats: {
        nuevas,
        enAnalisis,
        compatibles,
        aprobadas,
        enPreparacion: borradorPorOpp.length,
        descartadas,
        propuestas: versionesPorOpp.length,
      },
      topOpportunities: topOpportunities.map((o) => ({
        ...o,
        reasons: parseJsonArray(o.reasonsJson),
      })),
      expiring: expiring.map((o) => ({ id: o.id, processId: o.process.id, entity: o.process.entity, objectName: o.process.objectName, receptionDate: o.process.receptionDate, score: o.score })),
      alerts: alertsRaw.map((a) => ({ ...a, opportunity: a.opportunity ? { id: a.opportunity.id, processId: a.opportunity.process.id } : null })),
      lastSync: lastSyncData,
    }
  })
}
