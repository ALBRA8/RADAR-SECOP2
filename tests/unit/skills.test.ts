// ─── UNIT TESTS: SKILL CONTRACTS (Task 2-c, PROMPT 05 §15) — RADAR-SECOP2 ────
// validateContract es una función PURA: se valida los 11 JSON reales de
// skills_registry/ y se prueban mutaciones inválidas sobre copias (sin DB).

import { describe, it, expect } from "bun:test";
import { loadRegistry, validateContract, SKILL_REGISTRY_DIR, type SkillContractSource } from "@/lib/skills";

const EXPECTED_COUNT = 11;

describe("loadRegistry sobre skills_registry/ real", () => {
  const { contracts, parseErrors } = loadRegistry();

  it("carga 11 contratos sin errores de parseo", () => {
    expect(parseErrors).toEqual([]);
    expect(contracts.length).toBe(EXPECTED_COUNT);
  });

  it("identidades únicas y con formato MAYÚSCULAS_CON_GUION_BAJO", () => {
    const identities = contracts.map((c) => c.identity);
    expect(new Set(identities).size).toBe(EXPECTED_COUNT);
    for (const id of identities) expect(id).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("incluye las skills núcleo del sistema RADAR", () => {
    const ids = new Set(contracts.map((c) => c.identity));
    for (const core of [
      "DISCOVER_TENDER",
      "ANALYZE_TENDER",
      "EXTRACT_REQUIREMENTS",
      "COLLECT_EVIDENCE",
      "VERIFY_REQUIREMENT",
      "EVALUATE_COMPATIBILITY",
      "BUILD_MARCO_LOGICO",
    ]) {
      expect(ids.has(core)).toBe(true);
    }
  });
});

describe("validateContract: los 11 contratos reales son VÁLIDOS", () => {
  const { contracts } = loadRegistry();

  for (const c of contracts) {
    it(`contrato válido: ${c.identity}`, () => {
      const v = validateContract(c);
      expect(v.valid).toBe(true);
      expect(v.errors).toEqual([]);
    });
  }
});

describe("validateContract: mutaciones inválidas sobre copias", () => {
  const base = (): SkillContractSource => {
    const { contracts } = loadRegistry();
    return JSON.parse(JSON.stringify(contracts[0])) as SkillContractSource;
  };

  it("sin purpose → inválido (mínimo 10 caracteres)", () => {
    const c = base();
    delete (c as Record<string, unknown>).purpose;
    const v = validateContract(c);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toContain("purpose");
  });

  it("semver inválida ('1.0' y 'v1.0.0') → inválido", () => {
    for (const bad of ["1.0", "v1.0.0", "1.0.0.0", "uno.dos.tres"]) {
      const c = base();
      c.version = bad;
      const v = validateContract(c);
      expect(v.valid).toBe(false);
      expect(v.errors.join(" ")).toContain("version");
    }
  });

  it("procedure vacío → inválido", () => {
    const c = base();
    c.procedure = [];
    const v = validateContract(c);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toContain("procedure");
  });

  it("evidence_policy como array → inválido (debe ser objeto)", () => {
    const c = base();
    (c as Record<string, unknown>).evidence_policy = ["no", "es", "objeto"];
    const v = validateContract(c);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toContain("evidence_policy");
  });

  it("identity en minúsculas → inválido", () => {
    const c = base();
    c.identity = "analyze_tender";
    const v = validateContract(c);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toContain("identity");
  });

  it("confidence fuera de [0,1] → inválido; null/undefined contrato → inválido", () => {
    const c = base();
    c.confidence = 1.5;
    expect(validateContract(c).valid).toBe(false);
    expect(validateContract(null).valid).toBe(false);
    expect(validateContract(undefined).valid).toBe(false);
  });

  it("regression_tests vacía → inválido", () => {
    const c = base();
    c.regression_tests = [];
    expect(validateContract(c).valid).toBe(false);
  });

  it("tools_required vacía → inválido", () => {
    const c = base();
    c.tools_required = [];
    expect(validateContract(c).valid).toBe(false);
  });
});

describe("registry coherente con la plataforma", () => {
  it("SKILL_REGISTRY_DIR apunta al directorio del proyecto", () => {
    expect(SKILL_REGISTRY_DIR.endsWith("skills_registry")).toBe(true);
  });
});
