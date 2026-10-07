# Task 2-a — Agente 2-a (Evidence Contract / Regla de Oro) — RADAR-SECOP2

Fecha: 2026-10-06 · Ownership respetado: solo evidence.ts (nuevo), types.ts (aditivo), ai.ts, analyze/route.ts, opportunities/[id]/route.ts.

## Qué implementó

1. **src/lib/evidence.ts (NUEVO)** — Contrato de evidencia: `TRUTH_LEVELS` (VERIFIED|OBSERVED|INFERRED|ESTIMATED|UNKNOWN), `canBackCompliance()` (solo VERIFIED/OBSERVED respaldan CUMPLE), `normalizeTruthLevel()` (fallback UNKNOWN), `normalizeCategory()`, `normalizeObligatoriness()`, `clampConfidence()`, `buildProvenance()` (JSON con method/timestamp/extractor siempre presentes) y `createEvidenceRow()` (inserta en Evidence con defaults seguros: agentId RADAR-SECOP2, confidence clamp 0..1, truthLevel normalizado, verificationStatus UNVERIFIED, extractedFact nunca vacío).

2. **src/lib/types.ts (aditivo)** — `RequirementItem` extendido con `category?`, `obligatoriness?`, `dueDate? (ISO string|null)`, `truthLevel?`, `confidence?`. Backward compatible.

3. **src/lib/ai.ts** — (a) Prompt de análisis ampliado: cada requisito pide categoria/obligatoriedad/fechaLimite/confidence/truthLevel + REGLAS DE EVIDENCIA 5-7 (IA NUNCA declara VERIFIED; máximo OBSERVED con cita textual; si infiere INFERRED; preferir NO SÉ). (b) Mapping post-IA: normalización de los 5 campos nuevos + downgrade VERIFIED→OBSERVED + `.map(enforceGoldenRule)`. (c) `enforceGoldenRule()` exportado: si status CUMPLE y (evidence vacía/menciona "ninguna|no registrad|vacía" O truthLevel no VERIFIED/OBSERVED) → fuerza PENDIENTE + truthLevel INFERRED + action "CUMPLE degradado a PENDIENTE: sin evidencia verificable (regla de oro RADAR)". (d) Motor REGLAS: R1/R6 derivados de campos de la API → truthLevel OBSERVED (R1 CUMPLE queda así legítimamente); R2 INFERRED; R3-R5 UNKNOWN; categorías/obligatoriedad/confidence asignadas; todo pasa por enforceGoldenRule. Exports existentes y fallback REGLAS intactos.

4. **analyze/route.ts** — Fila Execution (RUNNING→SUCCESS/FAILED, operation ANALYZE_OPPORTUNITY, inputsJson {opportunityId}, outputsJson {requirements, evidences}, evidenceIdsJson, providersJson, latencyMs). Requirements persisten los 5 campos nuevos. Tras guardar: 1 fila Evidence por requisito vía createEvidenceRow (source SECOP_API|IA_INFERENCIA, sourceType API|INFERRED, sourceUrl/timestamp del proceso para REGLA, provenanceJson con engine, relatedRequirementId, relatedOpportunityId). Respuesta previa intacta + aditivos `evidences` (count) y `executionId`.

5. **opportunities/[id]/route.ts** — Detalle incluye `requirement.evidences` (embebidas por requisito) y `opportunity.evidences` (hasta 200).

## Verificación (evidencia real, no asumida)

- `bunx tsc --noEmit` → **0 errores** (ahora ni siquiera los 4 de examples/skills; 0 en src/). `bun run lint` limpio.
- POST /api/opportunities/cmutn9r2n001yo7xsvuoijjb1/analyze `{"approver":"QA"}` (oportunidad APROBADA_PREPARACION) → **HTTP 200**: engine IA, evidences 8, executionId cmuxbs8wg001noema5b3oyx8u; 8 requisitos con category/obligatoriness/truthLevel/confidence; CUMPLE solo con truthLevel OBSERVED (R1, R4, R8); R2/R3 NO_CUMPLE/INFERRED.
- GET /api/opportunities/<id> → 200: opportunity.evidences=8, requirements 8/8 con evidences embebidas, provenanceJson con method/engine/extractor/requirementCode.
- GET /api/executions → fila ANALYZE_OPPORTUNITY status SUCCESS latencyMs 18174.
- Test inline de helpers: CUMPLE+"ninguna registrada"+INFERRED → PENDIENTE/INFERRED con mensaje de degradación; CUMPLE+evidencia real+OBSERVED → se mantiene.

## Incidente operativo (resuelto)

Primer POST analyze → 500: `db.execution` undefined. Causa raíz PREEXISTENTE (también tumbaba /api/executions del Task 2-c): el dev server arrancó 23:18 con el cliente Prisma VIEJO cacheado en globalThis; la regeneración del cliente fue 23:28. Reinicié el dev server (mismo comando del sistema, `bun run dev` en background, setsid) → todo operativo. No toqué archivos fuera de ownership.

## Pendientes

- La IA marcó truthLevel OBSERVED en R5 ("póliza vencida") cuya fuente real es el perfil de empresa, no el pliego: no viola la regla de oro (NO_CUMPLE), pero convendría exigir source-cited por nivel en el prompt (mejora futura).
- dueDate quedó null en esta corrida: el registro SECOP del proceso no publica fecha límite textual en los campos analizados (honesto, no inventado).
