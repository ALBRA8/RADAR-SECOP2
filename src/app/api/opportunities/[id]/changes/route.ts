import { db } from '@/lib/db'
import { safe } from '@/lib/api'

// Task 2-f — Historial de modificaciones de una oportunidad:
// ProcessChange del proceso subyacente (incluye cambios detectados antes de
// que existiera la oportunidad), más recientes primero.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    const { id } = await params
    const limitParam = Number(new URL(req.url).searchParams.get('limit') ?? 50)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 200) : 50

    const opportunity = await db.opportunity.findUnique({
      where: { id },
      select: { id: true, processId: true },
    })
    if (!opportunity) throw new Error('Oportunidad no encontrada')

    const changes = await db.processChange.findMany({
      where: { OR: [{ opportunityId: id }, { processId: opportunity.processId }] },
      orderBy: { detectedAt: 'desc' },
      take: limit,
    })

    return { opportunityId: id, processId: opportunity.processId, count: changes.length, changes }
  })
}
