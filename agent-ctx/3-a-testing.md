# Task 3-a — Agente TESTING (RADAR-SECOP2)

## Resumen
Verificación final del sistema: unit tests (bun:test), ampliación de e2e_test.py (fases E/F/G/J + fixes C0/D2), ejecución de las 4 suites + tsc, reporte en `download/verify_tests_final.txt`. **Cero toques en src/.**

## Resultados exactos
| Suite | Resultado |
|---|---|
| `bun test tests/unit` | **98 pass / 0 fail** (284 expect(), 6 archivos, 594ms) |
| `python3 scripts/e2e_test.py ALL` | **39/39 PASS** (A:4, B:3, C:6, D:4, E:4, F:6, G:3, J:9) |
| `bash scripts/test_security.sh` | **PASS=12 FAIL=0** |
| `python3 scripts/test_sync.py` | **16 PASS / 0 FAIL / 0 SKIP** |
| `bunx tsc --noEmit` | **0 errores** (exit 0) |
| Dev server tras corridas | `/api/health` ok:true, db:true, secop:true |

Total: **165 verificaciones, 165 OK / 0 FAIL.**

## Entregables (ownership)
1. `tests/unit/evidence.test.ts` — regla de oro (VERIFIED✓ OBSERVED✓ INFERRED✗ ESTIMATED✗ UNKNOWN✗, fail-closed), normalizeTruthLevel fallback UNKNOWN, createEvidenceRow con DB real y limpieza por `source="UNIT_TEST_EVIDENCE"` en afterAll.
2. `tests/unit/memory.test.ts` — FACTUAL sin evidenceIds → MemoryValidationError; aislamiento agentId+domain (escritura rechazada, getById→null, recall nunca cruza); recall con score>0; limpieza prefijo `unit-test-` en afterAll.
3. `tests/unit/skills.test.ts` — 11 contratos reales válidos; copias mutadas inválidas (purpose, semver, procedure vacío, evidence_policy array, identity minúscula, confidence 1.5).
4. `tests/unit/security.test.ts` — rateLimit N/N+1+ventana, timingSafeEqualStr, sanitizeForPrompt (bloquea inyección EN/ES, texto normal intacto), ssrfGuard (http/privadas/loopback/link-local→false; datos.gov.co→true).
5. `tests/unit/filters.test.ts` — presupuesto fuera de rango → descartado con motivo; keywords.
6. `tests/unit/compat.test.ts` — 7 dimensiones, pesos suman 1, OK/PARCIAL/NO/ND explicables.
7. `scripts/e2e_test.py` — FIX D2 (`>= 12` tools), FIX C0 (crea APROBADA_PREPARACION vía API y aprueba BORRADOR con QA-E2E; 422→force+notes auditado), FASE E (Evidence/Truth), F (MemoryDV), G (Skills/Doctor), J (Flujo RADAR Integral §27). CLI A|B|C|D|E|F|G|J|ALL|--ONLYx intacta.
8. `package.json` — `"test": "bun test tests/unit"` (única edición).
9. `download/verify_tests_final.txt` — reporte final detallado.

## Evidencia de fases nuevas (E2E ALL)
- **E**: evidences=8, todo requisito con truthLevel, CERO CUMPLE con INFERRED/ESTIMATED/UNKNOWN, provenanceJson=IA_PROMPT_ANALYSIS.
- **F**: stats seed≥4; FACTUAL sin evidencia→400; con evidencia→201; recall score>0; foráneo→400; DELETE 200.
- **G**: skills count=11 allValid=true; health ok+db; doctor DEGRADED (FAILs=[]).
- **J**: sync fetched=300 → dedup created=0 → media/analyze ok → evidences=8 → score=39 (7 dims) → approve http=200 snapshot {requirements, score, unconfirmedCount} → docx 12.440 bytes (>10KB) → MCP get_opportunity estado=APROBADA_PREPARACION.

## Notas para siguientes agentes
- Doctor DEGRADED en sandbox es esperado (ningún check FAIL).
- Las fases C0/J7 mutan datos reales con aprobaciones auditadas "QA-E2E" (por diseño).
- F1 exige seed de memoria ≥4: si se cambia el seed, ajustar el umbral del assert E2E, no el código.
