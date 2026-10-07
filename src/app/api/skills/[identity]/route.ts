// Skill Contracts — contrato individual
// GET /api/skills/[identity] → contrato completo con JSON parseados

import { safe, bad } from '@/lib/api'
import { getSkill } from '@/lib/skills'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ identity: string }> },
) {
  return safe(async () => {
    const { identity } = await params
    const skill = await getSkill(identity)
    if (!skill) {
      return bad(`Skill '${identity}' no encontrada en catálogo ni registry`, 404)
    }
    return skill
  })
}
