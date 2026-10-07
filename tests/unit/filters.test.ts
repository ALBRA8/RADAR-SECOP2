// ─── UNIT TESTS: FILTRO DETERMINÍSTICO (Módulo B) — RADAR-SECOP2 ─────────────
// applyDeterministicFilter y keywordHits son funciones PURAS (sin DB):
// nunca descarta en silencio, siempre devuelve motivos explícitos.

import { describe, it, expect } from "bun:test";
import { applyDeterministicFilter, keywordHits, type FilterOutcome } from "@/lib/filters";
import type { CompanyConfigData, RawSecopRecord } from "@/lib/types";

const company = (over: Partial<CompanyConfigData> = {}): CompanyConfigData => ({
  id: "unit-test-company",
  name: "Empresa de Pruebas S.A.S.",
  description: "Servicios de aseo y suministros",
  minBudget: 5_000_000,
  maxBudget: 20_000_000,
  departmentsAllowed: [],
  modalitiesAllowed: [],
  contractTypesAllowed: [],
  phasesAllowed: [],
  requireKeywordHit: false,
  ...over,
});

const rec = (over: Partial<RawSecopRecord> = {}): RawSecopRecord => ({
  id: "CO1.REQ.UNIT.TEST",
  entity: "Entidad de Pruebas",
  objectName: "Suministro de insumos de aseo para instituciones educativas",
  description: "Adquisición de elementos de aseo y afeites",
  state: "En proceso",
  phase: "Presentación de oferta",
  basePrice: 12_000_000,
  department: "Distrito Capital de Bogotá",
  modality: "Contratación directa",
  contractType: "Prestación de servicios",
  ...over,
});

describe("regla 1: rango económico", () => {
  it("dentro del rango → pasa, con nota", () => {
    const out: FilterOutcome = applyDeterministicFilter(company(), rec());
    expect(out.passed).toBe(true);
    expect(out.reasons.join(" ")).toContain("Valor dentro del rango");
  });

  it("por debajo del mínimo → descartado con motivo explícito", () => {
    const out = applyDeterministicFilter(company(), rec({ basePrice: 1_000_000 }));
    expect(out.passed).toBe(false);
    expect(out.reasons.join(" ")).toContain("por debajo del rango mínimo");
  });

  it("por encima del máximo → descartado con motivo explícito", () => {
    const out = applyDeterministicFilter(company(), rec({ basePrice: 500_000_000 }));
    expect(out.passed).toBe(false);
    expect(out.reasons.join(" ")).toContain("supera el rango máximo");
  });

  it("valor no publicado → NO descarta (exige validación humana)", () => {
    const out = applyDeterministicFilter(company(), rec({ basePrice: null }));
    expect(out.passed).toBe(true);
    expect(out.reasons.join(" ")).toContain("validación humana");
  });
});

describe("regla 2: proceso vigente", () => {
  it("estado Adjudicado → descartado", () => {
    const out = applyDeterministicFilter(company(), rec({ state: "Adjudicado" }));
    expect(out.passed).toBe(false);
    expect(out.reasons.join(" ")).toContain("no vigente");
  });

  it("proceso activo → no descarta por vigencia", () => {
    expect(applyDeterministicFilter(company(), rec()).passed).toBe(true);
  });
});

describe("reglas 3-6: fase, modalidad, tipo y cobertura", () => {
  it("fase fuera de interés → descartado", () => {
    const out = applyDeterministicFilter(company({ phasesAllowed: ["Pliegos"] }), rec({ phase: "Presentación de oferta" }));
    expect(out.passed).toBe(false);
    expect(out.reasons.join(" ")).toContain("fases de interés");
  });

  it("modalidad no preferida → descartado", () => {
    const out = applyDeterministicFilter(company({ modalitiesAllowed: ["Licitación pública"] }), rec());
    expect(out.passed).toBe(false);
    expect(out.reasons.join(" ")).toContain("modalidades de interés");
  });

  it("tipo de contrato fuera del alcance → descartado", () => {
    const out = applyDeterministicFilter(company({ contractTypesAllowed: ["Obra"] }), rec());
    expect(out.passed).toBe(false);
    expect(out.reasons.join(" ")).toContain("alcance configurado");
  });

  it("departamento fuera de cobertura → descartado", () => {
    const out = applyDeterministicFilter(company({ departmentsAllowed: ["Antioquia"] }), rec());
    expect(out.passed).toBe(false);
    expect(out.reasons.join(" ")).toContain("fuera de la cobertura");
  });

  it("cobertura tolerante: 'Bogotá' acepta 'Distrito Capital de Bogotá'", () => {
    const out = applyDeterministicFilter(company({ departmentsAllowed: ["Bogotá"] }), rec());
    expect(out.passed).toBe(true);
  });
});

describe("regla 7: palabras clave exigidas", () => {
  it("requireKeywordHit sin coincidencia → descartado", () => {
    const out = applyDeterministicFilter(
      company({ requireKeywordHit: true, productsKeywords: ["laboratorios", "radiología"] }),
      rec(),
    );
    expect(out.passed).toBe(false);
    expect(out.reasons.join(" ")).toContain("palabras clave");
  });

  it("requireKeywordHit con coincidencia → pasa", () => {
    const out = applyDeterministicFilter(
      company({ requireKeywordHit: true, productsKeywords: ["aseo"] }),
      rec(),
    );
    expect(out.passed).toBe(true);
  });
});

describe("keywordHits (conteo puro)", () => {
  it("cuenta coincidencias norm-insensible en objeto/descripción/categoría", () => {
    const hits = keywordHits(company({ productsKeywords: ["Aseo", "AFEITES", "vacunas"] }), rec());
    expect(hits).toBe(2); // "aseo" y "afeites" coinciden; "vacunas" no
  });

  it("palabras cortas (<4) no cuentan", () => {
    const hits = keywordHits(company({ productsKeywords: ["aseo", "ab", "xyz"] }), rec());
    expect(hits).toBe(1);
  });
});
