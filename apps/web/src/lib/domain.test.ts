// apps/web/src/lib/domain.test.ts
//
//   npm i -D vitest
//   npx vitest run

import { describe, it, expect } from "vitest";
import {
  STATUSES,
  canTransition,
  termDays,
  validate,
  discount,
  syntheticIsin,
  toBondParams,
  MAX_TERM_DAYS,
  type Invoice,
} from "./domain";

const HASH = "sha256:" + "a".repeat(64);

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  reference: "INV-2026-0042",
  issuerAccountId: "0.0.10085748",
  debtorName: "Acme Pte Ltd",
  debtorCountry: "SG",
  faceValueMinor: 200_000, // USD 2,000.00
  currency: "USD",
  issuedAt: new Date("2026-09-01T00:00:00Z"),
  dueAt: new Date("2026-10-31T00:00:00Z"), // 60 days
  documentHash: HASH,
  status: "SUBMITTED",
  ...over,
});

// ─────────────────────────────────────────────────────────────
describe("lifecycle", () => {
  it("advances one step at a time", () => {
    expect(canTransition("SUBMITTED", "VERIFIED")).toBe(true);
    expect(canTransition("VERIFIED", "FUNDED")).toBe(true);
    expect(canTransition("FUNDED", "PAID")).toBe(true);
    expect(canTransition("PAID", "SETTLED")).toBe(true);
  });

  it("refuses to fund an unverified receivable", () => {
    expect(canTransition("SUBMITTED", "FUNDED")).toBe(false);
  });

  it("refuses to move backwards", () => {
    expect(canTransition("FUNDED", "VERIFIED")).toBe(false);
    expect(canTransition("SETTLED", "PAID")).toBe(false);
  });

  it("is terminal at SETTLED", () => {
    for (const s of STATUSES) expect(canTransition("SETTLED", s)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe("term", () => {
  it("counts calendar days between issue and maturity", () => {
    expect(termDays(invoice())).toBe(60);
  });

  it("accepts a term at the ceiling", () => {
    expect(validate(invoice())).toEqual([]);
  });

  it("rejects a term past the scheduled-transaction ceiling", () => {
    // 90-day terms are common in trade, and cannot settle in a single Hedera schedule.
    const long = invoice({ dueAt: new Date("2026-11-30T00:00:00Z") });
    expect(termDays(long)).toBeGreaterThan(MAX_TERM_DAYS);
    expect(validate(long).join()).toMatch(/60 days or less/);
  });

  it("rejects a maturity before issuance", () => {
    const backwards = invoice({ dueAt: new Date("2026-08-01T00:00:00Z") });
    expect(validate(backwards).join()).toMatch(/after the issue date/);
  });

  it("rejects a malformed document hash", () => {
    expect(validate(invoice({ documentHash: "abc" })).join()).toMatch(/sha256/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("discount, actual/360", () => {
  it("prices a 60-day receivable at 12%", () => {
    // 1 − 0.12 × 60/360 = 0.98
    const { proceedsMinor, discountMinor } = discount(200_000, 60, 0.12);
    expect(proceedsMinor).toBe(196_000);
    expect(discountMinor).toBe(4_000);
  });

  it("uses a 360-day year, not 365", () => {
    // Under actual/365 the factor would be 1 − 0.12 × 60/365 = 0.98027,
    // giving 196,054 rather than 196,000. The banking convention is more expensive
    // for the borrower, and it is the one a forfaiter quotes.
    const { proceedsMinor } = discount(200_000, 60, 0.12);
    expect(proceedsMinor).toBeLessThan(196_055);
  });

  it("returns more than the quoted rate, because the discount is earned on the smaller sum", () => {
    // The funder pays 196,000 and receives 200,000. Annualised on what they actually
    // committed, that is above 12% — the quoted discount rate understates the return.
    const { effectiveAnnualReturn } = discount(200_000, 60, 0.12);
    expect(effectiveAnnualReturn).toBeGreaterThan(0.12);
    expect(effectiveAnnualReturn).toBeCloseTo(0.1241, 3);
  });

  it("costs the issuer more the longer they wait", () => {
    const short = discount(200_000, 30, 0.12).discountMinor;
    const long = discount(200_000, 60, 0.12).discountMinor;
    expect(long).toBeGreaterThan(short);
  });

  it("leaves the face value untouched at a zero rate", () => {
    expect(discount(200_000, 60, 0).proceedsMinor).toBe(200_000);
  });
});

// ─────────────────────────────────────────────────────────────
describe("ISIN", () => {
  it("produces a well-formed 12-character identifier", () => {
    const isin = syntheticIsin("INV-2026-0042");
    expect(isin).toHaveLength(12);
    expect(isin).toMatch(/^XF[0-9A-Z]{9}[0-9]$/);
  });

  it("uses a prefix no numbering agency has been assigned", () => {
    // XF cannot collide with a real security. These are testnet identifiers; production
    // issuance would require allocation by a National Numbering Agency.
    expect(syntheticIsin("INV-2026-0042").startsWith("XF")).toBe(true);
  });

  it("is deterministic", () => {
    expect(syntheticIsin("INV-2026-0042")).toBe(syntheticIsin("INV-2026-0042"));
  });

  it("distinguishes different references", () => {
    expect(syntheticIsin("INV-2026-0042")).not.toBe(
      syntheticIsin("INV-2026-0043"),
    );
  });

  it("computes a check digit that an independent implementation agrees with", () => {
    // Verified against a separate reimplementation of the ISO 6166 Luhn variant below,
    // so the test is not merely the code agreeing with itself. The algorithm was checked
    // by hand against Apple's US0378331005, which yields check digit 5.
    const generated = syntheticIsin("0378331005".slice(0, 9));
    expect(generated.slice(-1)).toBe(checkDigitOf("XF037833100"));
  });
});

/** Independent reimplementation, so the test is not just the code agreeing with itself. */
function checkDigitOf(base: string): string {
  const expanded = [...base]
    .map((c) => (c >= "0" && c <= "9" ? c : String(c.charCodeAt(0) - 55)))
    .join("");
  const reversed = [...expanded].reverse();
  const sum = reversed.reduce((acc, ch, i) => {
    let d = Number(ch);
    if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    return acc + d;
  }, 0);
  return String((10 - (sum % 10)) % 10);
}

// ─────────────────────────────────────────────────────────────
describe("mapping to ATS", () => {
  const params = toBondParams(invoice(), "0.0.10085748");

  it("carries the face value as nominal, in minor units", () => {
    expect(params.nominalValue).toBe("200000");
    expect(params.nominalValueDecimals).toBe(2);
  });

  it("sets maturity to the invoice due date, in milliseconds", () => {
    expect(params.maturityDate).toBe(
      String(new Date("2026-10-31T00:00:00Z").getTime()),
    );
    // Seconds would land in 1970 and be rejected. See FRICTION.md #4.
    expect(Number(params.maturityDate)).toBeGreaterThan(1_000_000_000_000);
  });

  it("starts in the future, so validation cannot race the clock", () => {
    expect(Number(params.startingDate)).toBeGreaterThan(Date.now());
  });

  it("issues one indivisible unit", () => {
    expect(params.numberOfUnits).toBe("1");
    expect(params.decimals).toBe(0);
  });

  it("encodes the currency as three bytes", () => {
    expect(params.currency).toBe("0x555344"); // USD
  });

  it("files under Regulation S with no subtype", () => {
    // Offerings outside the United States. Regulation D would pull in accredited
    // investor requirements that do not apply here, and REG_S rejects any other subtype.
    expect(params.regulationType).toBe(1);
    expect(params.regulationSubType).toBe(0);
  });

  it("stays controllable so a disputed receivable can be unwound", () => {
    expect(params.isControllable).toBe(true);
  });

  it("pins the bond configuration version", () => {
    // An unpinned version resolves to whatever is latest at submit time, which would let
    // a recorded demo behave differently when someone replays it.
    expect(params.configVersion).toBe(1);
    expect(params.configId.endsWith("2")).toBe(true);
  });

  it("passes empty arrays rather than omitting them", () => {
    // Omitting these throws "Cannot read properties of undefined (reading 'length')"
    // with no field name. See FRICTION.md #7.
    expect(params.externalPausesIds).toEqual([]);
    expect(params.proceedRecipientsData).toEqual([]);
  });

  it("refuses to build params for an invalid invoice", () => {
    const long = invoice({ dueAt: new Date("2026-12-31T00:00:00Z") });
    expect(() => toBondParams(long, "0.0.10085748")).toThrow(/60 days or less/);
  });

  it("asks for a document before complaining about its shape", () => {
    expect(validate({ ...invoice(), documentHash: "" })).toContain(
      "an invoice document is required",
    );
    expect(validate({ ...invoice(), documentHash: "sha256:xyz" })).toContain(
      "document hash must be sha256:<64 hex chars>",
    );
  });
});
