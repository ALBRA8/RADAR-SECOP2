import { runSync } from '@/lib/sync'
import { safe } from '@/lib/api'

export async function POST(req: Request) {
  return safe(async () => {
    let body: { days?: number; limit?: number } = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }
    const result = await runSync({
      days: typeof body.days === 'number' ? body.days : 45,
      limit: typeof body.limit === 'number' ? body.limit : 300,
    })
    return result
  })
}
