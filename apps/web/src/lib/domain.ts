// apps/web/src/lib/domain.ts
//
// The invoice model, and the mapping that lets Asset Tokenization Studio carry it.
//
// A discounted invoice is structurally a zero-coupon bond: a single payment of a known
// amount on a known date, sold today for less than that amount. ATS has no zero-coupon
// type, but a bond with no coupon schedule is the same instrument. So Forfait does not
// extend ATS — it uses the bond primitive for what it already is.

// ─────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────

export const STATUSES = ['SUBMITTED', 'VERIFIED', 'FUNDED', 'PAID', 'SETTLED'] as const;
export type Status = (typeof STATUSES)[number];

/** Transitions that are allowed. Anything else is a bug or an attack. */
const NEXT: Record<Status, Status[]> = {
  SUBMITTED: ['VERIFIED'],
  VERIFIED: ['FUNDED'],
  FUNDED: ['PAID'],
  PAID: ['SETTLED'],
  SETTLED: [],
};

export const canTransition = (from: Status, to: Status): boolean =>
  NEXT[from].includes(to);

export interface Invoice {
  /** The issuer's own reference, e.g. INV-2026-0042. Not unique across issuers. */
  reference: string;
  /** Freelancer raising the invoice. */
  issuerAccountId: string;
  /** Client who owes the money. Off-chain: never published. */
  debtorName: string;
  debtorCountry: string;
  /** Amount owed, in minor units. 200000 = USD 2,000.00 */
  faceValueMinor: number;
  currency: 'USD' | 'SGD' | 'EUR';
  issuedAt: Date;
  /** Maturity. The client pays on this date; the funder is repaid from it. */
  dueAt: Date;
  /** SHA-256 of the invoice document. The document itself never goes on-chain. */
  documentHash: string;
  status: Status;
  /** ATS security id, once tokenised. */
  securityId?: string;
}

// ─────────────────────────────────────────────────────────────
// Constraints
// ─────────────────────────────────────────────────────────────

/**
 * Hedera scheduled transactions expire after a maximum of 62 days, and maturity
 * settlement is scheduled at issuance. Sixty is the round number under that ceiling.
 * Longer terms would need a re-scheduling mechanism.
 */
export const MAX_TERM_DAYS = 60;

export const termDays = (invoice: Pick<Invoice, 'issuedAt' | 'dueAt'>): number =>
  Math.ceil((invoice.dueAt.getTime() - invoice.issuedAt.getTime()) / 86_400_000);

export function validate(invoice: Invoice): string[] {
  const errors: string[] = [];
  const days = termDays(invoice);

  if (days <= 0) errors.push('due date must be after the issue date');
  if (days > MAX_TERM_DAYS) {
    errors.push(`term is ${days} days; Forfait accepts ${MAX_TERM_DAYS} days or less`);
  }
  if (invoice.faceValueMinor <= 0) errors.push('face value must be positive');
  if (!/^sha256:[0-9a-f]{64}$/.test(invoice.documentHash)) {
    errors.push('document hash must be sha256:<64 hex chars>');
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────

/**
 * Trade finance discounts on an actual/360 basis — a 360-day year, actual days elapsed.
 * It is a banking convention rather than a mathematical one, and it is what a forfaiter
 * would quote, so Forfait uses it too.
 *
 *   proceeds = face × (1 − rate × days / 360)
 *
 * The funder's return is the difference between what they pay today and the face value
 * they receive at maturity. There is no coupon.
 */
export function discount(
  faceValueMinor: number,
  days: number,
  annualRate: number
): { proceedsMinor: number; discountMinor: number; effectiveAnnualReturn: number } {
  const factor = 1 - (annualRate * days) / 360;
  const proceedsMinor = Math.floor(faceValueMinor * factor);
  const discountMinor = faceValueMinor - proceedsMinor;

  // What the funder actually earns, annualised on the amount they put in.
  const effectiveAnnualReturn = (discountMinor / proceedsMinor) * (365 / days);

  return { proceedsMinor, discountMinor, effectiveAnnualReturn };
}

export const formatMinor = (minor: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);

// ─────────────────────────────────────────────────────────────
// ISIN
// ─────────────────────────────────────────────────────────────

/**
 * ATS requires an ISIN and validates its format. Real ISINs are allocated by a National
 * Numbering Agency; a receivable financed on a testnet has no such allocation.
 *
 * These are therefore synthetic. They use the `XF` prefix — not assigned to any NNA — so
 * they cannot collide with a real security, and they carry a correct check digit so that
 * downstream tooling treats them as well-formed. Production issuance would require real
 * allocation.
 */
export function syntheticIsin(reference: string): string {
  // 9 alphanumeric characters derived from the reference, padded deterministically.
  const body = reference
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-9)
    .padStart(9, '0');

  const base = `XF${body}`;
  return base + isinCheckDigit(base);
}

/** Luhn over the numeric expansion, per ISO 6166. A = 10, B = 11, … Z = 35. */
function isinCheckDigit(base: string): number {
  const digits = [...base]
    .map((c) => (/[0-9]/.test(c) ? c : (c.charCodeAt(0) - 55).toString()))
    .join('');

  let sum = 0;
  let double = true; // rightmost digit of the base is doubled
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

// ─────────────────────────────────────────────────────────────
// Mapping to ATS
// ─────────────────────────────────────────────────────────────

/** ISO 4217 code as the 3-byte hex ATS expects. 'USD' → '0x555344' */
const currencyHex = (code: string): string =>
  '0x' + [...code].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

/**
 * Regulation S governs securities offered outside the United States, and requires a
 * subtype of NONE. A receivable owed by an Asian client to an Indonesian freelancer sits
 * squarely there. Regulation D would be the wrong instrument and would drag in accredited
 * investor requirements.
 */
const REG_S = 1;
const SUBTYPE_NONE = 0;

/**
 * Builds the CreateBondRequest arguments for an invoice.
 *
 * Timestamps are milliseconds — the field is typed `string` and the unit is documented
 * nowhere; seconds are silently read as milliseconds and land in 1970. See FRICTION.md #4.
 *
 * `startingDate` is pushed a few minutes into the future. Using "now" fails intermittently
 * because time passes between constructing the request and validating it.
 */
export function toBondParams(invoice: Invoice, ownerAccountId: string) {
  const errors = validate(invoice);
  if (errors.length) throw new Error(errors.join('; '));

  const start = Date.now() + 5 * 60 * 1000;
  const maturity = invoice.dueAt.getTime();

  return {
    name: `Receivable ${invoice.reference}`,
    symbol: invoice.reference.replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase(),
    isin: syntheticIsin(invoice.reference),
    decimals: 0,

    // One invoice, one indivisible unit. Raising numberOfUnits would let several funders
    // finance a single receivable — a real feature, deliberately out of scope for now.
    numberOfUnits: '1',

    currency: currencyHex(invoice.currency),
    nominalValue: String(invoice.faceValueMinor),
    nominalValueDecimals: 2,

    startingDate: String(start),
    maturityDate: String(maturity),

    // Controllable so a disputed receivable can be recovered — standard in trade finance,
    // where the issuer is expected to be able to unwind a fraudulent assignment.
    isControllable: true,
    isWhiteList: false,
    erc20VotesActivated: false,
    arePartitionsProtected: false,
    isMultiPartition: false,
    clearingActive: false,
    internalKycActivated: false,

    regulationType: REG_S,
    regulationSubType: SUBTYPE_NONE,
    isCountryControlListWhiteList: false,
    countries: invoice.debtorCountry,
    info: `Forfait receivable ${invoice.reference}`,

    diamondOwnerAccount: ownerAccountId,

    // Optional in the type, required at runtime: omitting them throws on `.length`
    // with no field name. See FRICTION.md #7.
    externalPausesIds: [],
    externalControlListsIds: [],
    externalKycListsIds: [],
    proceedRecipientsIds: [],
    proceedRecipientsData: [],

    // Bond configuration, pinned. Leaving the version empty resolves to whatever is
    // latest at submit time, which would let a demo recorded today behave differently
    // when a judge runs it next week.
    configId: '0x0000000000000000000000000000000000000000000000000000000000000002',
    configVersion: 1,
  };
}