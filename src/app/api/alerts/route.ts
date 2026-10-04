import { db } from '@/lib/db'
import { safe } from '@/lib/api'

// Alertas (sección 8)
export async function GET() {
  return safe(async () => {
    const notifications = await db.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { opportunity: { include: { process: true } } },
    })
    const unread = notifications.filter((n) => !n.read).length
    return {
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt,
        opportunityId: n.opportunity?.id ?? null,
        processId: n.opportunity?.process?.id ?? null,
      })),
      unread,
    }
  })
}

export async function POST(req: Request) {
  return safe(async () => {
    const body = await req.json().catch(() => ({}))
    if (body.action === 'markAllRead') {
      await db.notification.updateMany({ where: { read: false }, data: { read: true } })
      return { updated: 'all' }
    }
    if (body.action === 'markRead' && body.id) {
      await db.notification.update({ where: { id: body.id }, data: { read: true } })
      return { updated: body.id }
    }
    throw new Error('Acción no soportada')
  })
}
