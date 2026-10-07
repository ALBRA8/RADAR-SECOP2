// ─── UNIT TESTS: MOTOR DE COMPATIBILIDAD (Módulo E) — RADAR-SECOP2 ───────────
// evaluateCompatibility es PURA: 7 dimensiones con pesos correctos y resultado
// explicable (razones por dimensión, no solo porcentaje).

import { describe, it, expect } from "bun:test";
import { evaluateCompatibility, type CompatInput } from "@/lib/compat";
import type { CompanyConfigData, DocumentData, ExperienceData, ProductItemData, RawSecopRecord } from "@/lib/types";

const company = (over: Partial<CompanyConfigData> = {}): CompanyConfigData => ({
  id: "unit-test-company",
  name: "Empresa de Pruebas S.A.S.",
  minBudget: 5_000_000,
  maxBudget: 20_000_000,
  departmentsAllowed: [],
  modalitiesAllowed: [],
  contractTypesAllowed: [],
  phasesAllowed: ["Presentación de oferta"],
  requireKeywordHit: false,
  ...over,
});

const products = (over: Partial<ProductItemData>[] = []): ProductItemData[] => [
  { id: "p1", name: "Servicios de aseo y afeites", description: "aseo institucional", keywords: ["aseo", "afeites"], ...over[0] },
];

const experiences = (): ExperienceData[] => [{ id: "e1", title: "Contrato aseo 2023", entity: "Alcaldía", year: 2023 }];

const documents = (statuses: DocumentData["status"][] = ["DISPONIBLE"]): DocumentData[] =>
  statuses.map((s, i) => ({ id: `d${i}`, name: `Doc ${i}`, status: s }));

const rec = (over: Partial<RawSecopRecord> = {}): RawSecopRecord => ({
  id: "CO1.REQ.UNIT.COMPAT",
  entity: "Entidad de Pruebas",
  objectName: "Prestación de servicios de aseo institucional",
  description: "Servicios de aseo con experiencia acreditada",
  state: "En proceso",
  phase: "Presentación de oferta",
  basePrice: 12_000_000,
  department: "Distrito Capital de Bogotá",
  modality: "Contratación directa",
  contractType: "Prestación de servicios",
  ...over,
});

const input = (over: Partial<CompatInput> = {}): CompatInput => ({
  company: company(),
  products: products(),
  experiences: experiences(),
  documents: documents(),
  ...over,
});

describe("estructura: 7 dimensiones con pesos correctos", () => {
  it("devuelve exactamente las 7 dimensiones", () => {
    const ev = evaluateCompatibility(input(), rec());
    expect(ev.dimensions.map((d) => d.key)).toEqual([
      "objeto",
      "valor",
      "ubicacion",
      "modalidad",
      "tipoContrato",
      "vigencia",
      "preparacion",
    ]);
  });

  it("los pesos por dimensión son los configurados y suman 1", () => {
    const ev = evaluateCompatibility(input(), rec());
    const weights: Record<string, number> = {};
    for (const d of ev.dimensions) weights[d.key] = d.weight;
    expect(weights.objeto).toBeCloseTo(0.35);
    expect(weights.valor).toBeCloseTo(0.2);
    expect(weights.ubicacion).toBeCloseTo(0.15);
    expect(weights.modalidad).toBeCloseTo(0.1);
    expect(weights.tipoContrato).toBeCloseTo(0.1);
    expect(weights.vigencia).toBeCloseTo(0.05);
    expect(weights.preparacion).toBeCloseTo(0.05);
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("cada dimensión lleva razón explicable y score 0..1; score total 0..100", () => {
    const ev = evaluateCompatibility(input(), rec());
    for (const d of ev.dimensions) {
      expect(d.reason.length).toBeGreaterThan(5);
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(1);
    }
    expect(ev.score).toBeGreaterThanOrEqual(0);
    expect(ev.score).toBeLessThanOrEqual(100);
    expect(ev.summary).toContain("Compatibilidad");
  });
});

describe("dimensión valor", () => {
  it("dentro del rango → OK score 1", () => {
    const ev = evaluateCompatibility(input(), rec({ basePrice: 15_000_000 }));
    const valor = ev.dimensions.find((d) => d.key === "valor")!;
    expect(valor.result).toBe("OK");
    expect(valor.score).toBe(1);
  });

  it("supera el máximo → NO score 0", () => {
    const ev = evaluateCompatibility(input(), rec({ basePrice: 900_000_000 }));
    const valor = ev.dimensions.find((d) => d.key === "valor")!;
    expect(valor.result).toBe("NO");
    expect(valor.score).toBe(0);
  });

  it("por debajo del mínimo → PARCIAL 0.4 (no descarta)", () => {
    const ev = evaluateCompatibility(input(), rec({ basePrice: 2_000_000 }));
    const valor = ev.dimensions.find((d) => d.key === "valor")!;
    expect(valor.result).toBe("PARCIAL");
    expect(valor.score).toBeCloseTo(0.4);
  });

  it("sin precio publicado → ND 0.3 con validación humana", () => {
    const ev = evaluateCompatibility(input(), rec({ basePrice: null }));
    const valor = ev.dimensions.find((d) => d.key === "valor")!;
    expect(valor.result).toBe("ND");
    expect(valor.reason).toContain("validación humana");
  });
});

describe("dimensión objeto", () => {
  it("objeto con match de vocabulario → OK", () => {
    const ev = evaluateCompatibility(input(), rec({ objectName: "Servicios de aseo y afeites para colegios" }));
    const objeto = ev.dimensions.find((d) => d.key === "objeto")!;
    expect(objeto.result).toBe("OK");
    expect(objeto.reason).toContain("coincide");
  });

  it("empresa sin productos → ND honesto", () => {
    const ev = evaluateCompatibility(input({ products: [] }), rec());
    const objeto = ev.dimensions.find((d) => d.key === "objeto")!;
    expect(objeto.result).toBe("ND");
  });
});

describe("dimensión ubicacion", () => {
  it("cobertura nacional (lista vacía) → OK", () => {
    const ev = evaluateCompatibility(input(), rec({ department: "Amazonas" }));
    expect(ev.dimensions.find((d) => d.key === "ubicacion")!.result).toBe("OK");
  });

  it("fuera de cobertura → NO score 0", () => {
    const ev = evaluateCompatibility(input({ company: company({ departmentsAllowed: ["Antioquia"] }) }), rec());
    const ubi = ev.dimensions.find((d) => d.key === "ubicacion")!;
    expect(ubi.result).toBe("NO");
    expect(ubi.score).toBe(0);
  });
});

describe("dimensión preparacion documental (solo comprobado, Módulo C)", () => {
  it("todo DISPONIBLE → OK score 1", () => {
    const ev = evaluateCompatibility(input(), rec());
    expect(ev.dimensions.find((d) => d.key === "preparacion")!.score).toBe(1);
  });

  it("sin documentos → ND score 0", () => {
    const ev = evaluateCompatibility(input({ documents: [] }), rec());
    const prep = ev.dimensions.find((d) => d.key === "preparacion")!;
    expect(prep.result).toBe("ND");
    expect(prep.score).toBe(0);
  });

  it("mezcla → PARCIAL con fracción disponible", () => {
    const ev = evaluateCompatibility(input({ documents: documents(["DISPONIBLE", "PENDIENTE", "VENCIDO"]) }), rec());
    const prep = ev.dimensions.find((d) => d.key === "preparacion")!;
    expect(prep.result).toBe("PARCIAL");
    expect(prep.score).toBeCloseTo(1 / 3);
  });
});

describe("dimensión vigencia", () => {
  it("proceso finalizado → NO score 0", () => {
    const ev = evaluateCompatibility(input(), rec({ state: "Adjudicado" }));
    const vig = ev.dimensions.find((d) => d.key === "vigencia")!;
    expect(vig.result).toBe("NO");
    expect(vig.score).toBe(0);
  });

  it("fase habilitada → OK score 1", () => {
    const ev = evaluateCompatibility(input(), rec());
    const vig = ev.dimensions.find((d) => d.key === "vigencia")!;
    expect(vig.result).toBe("OK");
    expect(vig.score).toBe(1);
  });
});

describe("score agregado", () => {
  it("caso bueno con match total → score > 0; caso imposible → bajo", () => {
    const bueno = evaluateCompatibility(input(), rec());
    expect(bueno.score).toBeGreaterThan(0);
    const malo = evaluateCompatibility(
      input({
        company: company({ departmentsAllowed: ["Antioquia"], phasesAllowed: ["Pliegos"] }),
        documents: documents(["VENCIDO", "PENDIENTE"]),
      }),
      rec({ basePrice: 900_000_000, state: "Adjudicado", objectName: "Construcción de puente vehicular" }),
    );
    expect(malo.score).toBeLessThan(bueno.score);
  });
});
