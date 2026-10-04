import { db } from '@/lib/db'
import { safe } from '@/lib/api'
import { parseJsonArray } from '@/lib/types'

// Listado de oportunidades con filtros opcionales
export async function GET(req: Request) {
  return safe(async () => {
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const q = url.searchParams.get('q')
    const top = url.searchParams.get('top')

    const where: Record<string, unknown> = {}
    if (status && status !== 'TODAS') where.status = status
    if (q) {
      where.process = { OR: [{ objectName: { contains: q } }, { description: { contains: q } }, { entity: { contains: q } }] }
    }

    const opportunities = await db.opportunity.findMany({
      where,
      include: { process: true },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: top === '1' ? 5 : undefined,
    })

    return {
      opportunities: opportunities.map((o) => ({
        ...o,
        reasons: parseJsonArray(o.reasonsJson),
        missingDocs: parseJsonArray(o.missingDocsJson),
        risks: parseJsonArray(o.risksJson),
      })),
      total: opportunities.length,
    }
  })
}
