import { ok } from '@/lib/api'
import { runDoctor } from '@/lib/doctor'

// MÓDULO DOCTOR — reporte de salud del agente.
// GET /api/doctor        → reporte completo (solo diagnóstico)
// GET /api/doctor?fix=1  → aplica los auto-fixes SEGUROS y determinísticos
//                          (re-seed de skills, consolidación/decay de memoria
//                          si los módulos existen); todo lo demás solo reporta.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const fix = url.searchParams.get('fix') === '1'
  const report = await runDoctor({ fix })
  return ok(report)
}
