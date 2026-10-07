// ─── UNIT TESTS: EVIDENCE CONTRACT (Task 2-a) — RADAR-SECOP2 ─────────────────
// Regla de oro: solo VERIFIED/OBSERVED pueden respaldar un CUMPLE definitivo.
// Funciones puras sin DB + createEvidenceRow contra la DB real con limpieza
// por source="UNIT_TEST_EVIDENCE" en afterAll (db/custom.db compartida: cuidado).

import { describe, it, expect, afterAll } from "bun:test";
import {
  canBackCompliance,
  normalizeTruthLevel,
  normalizeCategory,
  normalizeObligatoriness,
  clampConfidence,
  buildProvenance,
  createEvidenceRow,
  TRUTH_LEVELS,
} from "@/lib/evidence";
import { db } from "@/lib/db";

const CLEANUP_SOURCE = "UNIT_TEST_EVIDENCE";

afterAll(async () => {
  // Limpieza de las filas de prueba creadas por este archivo (prefijo reservado).
  await db.evidence.deleteMany({ where: { source: CLEANUP_SOURCE } });
});

describe("canBackCompliance (regla de oro)", () => {
  it("VERIFIED respalda CUMPLE", () => {
    expect(canBackCompliance("VERIFIED")).toBe(true);
  });

  it("OBSERVED respalda CUMPLE", () => {
    expect(canBackCompliance("OBSERVED")).toBe(true);
  });

  it("INFERRED NO respalda CUMPLE (regla de oro RADAR)", () => {
    expect(canBackCompliance("INFERRED")).toBe(false);
  });

  it("ESTIMATED NO respalda CUMPLE", () => {
    expect(canBackCompliance("ESTIMATED")).toBe(false);
  });

  it("UNKNOWN NO respalda CUMPLE", () => {
    expect(canBackCompliance("UNKNOWN")).toBe(false);
  });

  it("valores vacíos/nulos NUNCA respaldan (fail-closed, comparación estricta)", () => {
    expect(canBackCompliance(null)).toBe(false);
    expect(canBackCompliance(undefined)).toBe(false);
    expect(canBackCompliance("")).toBe(false);
    expect(canBackCompliance("verified")).toBe(false); // minúsculas: solo literales exactos VERIFIED/OBSERVED
    expect(canBackCompliance("Verified")).toBe(false);
    expect(canBackCompliance("VERIFIED ")).toBe(false); // con espacio: sin normalizar
  });
});

describe("normalizeTruthLevel", () => {
  it("acepta los 5 niveles válidos en mayúsculas", () => {
    for (const level of TRUTH_LEVELS) {
      expect(normalizeTruthLevel(level)).toBe(level);
    }
  });

  it("normaliza mayúsculas/minúsculas y espacios", () => {
    expect(normalizeTruthLevel("verified")).toBe("VERIFIED");
    expect(normalizeTruthLevel("  Observed  ")).toBe("OBSERVED");
  });

  it("fallback UNKNOWN para basura, números, null y undefined", () => {
    expect(normalizeTruthLevel("GARANTIZADO_SEGURO")).toBe("UNKNOWN");
    expect(normalizeTruthLevel(123)).toBe("UNKNOWN");
    expect(normalizeTruthLevel(null)).toBe("UNKNOWN");
    expect(normalizeTruthLevel(undefined)).toBe("UNKNOWN");
    expect(normalizeTruthLevel({})).toBe("UNKNOWN");
  });
});

describe("normalizeCategory / normalizeObligatoriness", () => {
  it("categorías válidas y fallback null", () => {
    expect(normalizeCategory("tecnico")).toBe("TECNICO");
    expect(normalizeCategory(" HABILITANTE ")).toBe("HABILITANTE");
    expect(normalizeCategory("categoría_inexistente")).toBeNull();
    expect(normalizeCategory(42)).toBeNull();
  });

  it("obligatoriedad válida y fallback DESCONOCIDO", () => {
    expect(normalizeObligatoriness("obligatorio")).toBe("OBLIGATORIO");
    expect(normalizeObligatoriness("DeSeAbLe")).toBe("DESEABLE");
    expect(normalizeObligatoriness("no sé")).toBe("DESCONOCIDO");
  });
});

describe("clampConfidence", () => {
  it("clampea a [0,1]", () => {
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence(-2)).toBe(0);
    expect(clampConfidence(0.75)).toBe(0.75);
  });

  it("acepta strings numéricos y usa fallback en no numéricos", () => {
    expect(clampConfidence("0.7")).toBeCloseTo(0.7);
    expect(clampConfidence("abc")).toBe(0.5);
    expect(clampConfidence(undefined, 0.9)).toBe(0.9);
    expect(clampConfidence(NaN, 0.3)).toBe(0.3);
  });
});

describe("buildProvenance (procedencia SIEMPRE presente)", () => {
  it("method/timestamp/extractor presentes y metadatos extra conservados", () => {
    const raw = buildProvenance({
      method: "SECOP_API_FIELD_DERIVATION",
      timestamp: "2026-01-01T00:00:00.000Z",
      extractor: "TEST",
      requirementCode: "R1",
    });
    const parsed = JSON.parse(raw);
    expect(parsed.method).toBe("SECOP_API_FIELD_DERIVATION");
    expect(parsed.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.extractor).toBe("TEST");
    expect(parsed.requirementCode).toBe("R1");
  });

  it("defaults seguros cuando faltan campos: method UNKNOWN, extractor RADAR-SECOP2, timestamp ISO", () => {
    const parsed = JSON.parse(buildProvenance({}));
    expect(parsed.method).toBe("UNKNOWN");
    expect(parsed.extractor).toBe("RADAR-SECOP2");
    expect(() => new Date(parsed.timestamp).toISOString()).not.toThrow();
  });
});

describe("createEvidenceRow (DB real, filas con prefijo de limpieza)", () => {
  it("inserta con defaults seguros: truthLevel UNKNOWN, UNVERIFIED, nunca hecho vacío, confidence clampeada", async () => {
    const row = await createEvidenceRow({
      source: CLEANUP_SOURCE,
      sourceType: "API",
      extractedFact: "   ",
      truthLevel: "valor-invalido",
      confidence: 7,
    });
    try {
      expect(row.agentId).toBe("RADAR-SECOP2");
      expect(row.source).toBe(CLEANUP_SOURCE);
      expect(row.extractedFact).toBe("(sin hecho extraído)");
      expect(row.confidence).toBe(1); // 7 clampeado a [0,1] → 1
      expect(row.truthLevel).toBe("UNKNOWN");
      expect(row.verificationStatus).toBe("UNVERIFIED");
    } finally {
      await db.evidence.delete({ where: { id: row.id } }).catch(() => undefined);
    }
  });

  it("reserva confidence clampeado (7 → 1) y respeta valores válidos explícitos", async () => {
    const row = await createEvidenceRow({
      source: CLEANUP_SOURCE,
      sourceType: "API",
      extractedFact: "unit-test: hecho observado en SECOP",
      truthLevel: "OBSERVED",
      confidence: 0.9,
      verificationStatus: "VERIFIED",
      sourceUrl: "https://www.datos.gov.co/resource/p6dx-8zbt.json",
      provenanceJson: buildProvenance({ method: "UNIT_TEST" }),
    });
    try {
      expect(row.confidence).toBeCloseTo(0.9);
      expect(row.truthLevel).toBe("OBSERVED");
      expect(row.verificationStatus).toBe("VERIFIED");
      expect(canBackCompliance(row.truthLevel)).toBe(true);
    } finally {
      await db.evidence.delete({ where: { id: row.id } }).catch(() => undefined);
    }
  });
});
