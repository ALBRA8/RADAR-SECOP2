import { db } from '@/lib/db'
import { safe } from '@/lib/api'
import { parseJsonArray } from '@/lib/types'

// Detalle completo de la oportunidad (expediente)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    const { id } = await params
    const opportunity = await db.opportunity.findUnique({
      where: { id },
      include: {
        process: true,
        requirements: { orderBy: { code: 'asc' } },
        proposals: { orderBy: { version: 'desc' }, include: { approvals: { orderBy: { createdAt: 'desc' } } } },
        proposalMessages: { orderBy: { createdAt: 'asc' }, take: 100 },
      },
    })
    if (!opportunity) throw new Error('Oportunidad no encontrada')
    return {
      opportunity: {
        ...opportunity,
        reasons: parseJsonArray(opportunity.reasonsJson),
        missingDocs: parseJsonArray(opportunity.missingDocsJson),
        risks: parseJsonArray(opportunity.risksJson),
        messages: opportunity.proposalMessages,
      },
    }
  })
}
