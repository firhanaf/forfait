# Forfait 🧾

**Turn a 60-day invoice into cash today.**

Non-recourse financing of cross-border receivables, built on Hedera for
[ETHOnline 2026](https://ethglobal.com/events/ethonline2026).

> **Status:** built during ETHOnline 2026, first commit 5 September. This README tracks
> what actually works, not what is planned. See [Roadmap](#roadmap) for the rest.

---

## The problem

A freelancer in Indonesia invoices a client in Singapore and waits 30 to 60 days to be paid.
During that wait the receivable is worthless to them — no bank will underwrite a $2,000
invoice from a sole trader, because the diligence costs more than the loan.

The instrument that solves this already exists. **Forfaiting** is the non-recourse purchase
of cross-border receivables at a discount, and it has been standard practice in trade finance
for a century. It has simply never been economic at small ticket sizes.

## The approach

An unpaid invoice is, structurally, a **zero-coupon bond**:

| Invoice | Zero-coupon bond |
|---|---|
| Invoice amount | Face value |
| Payment due date | Maturity |
| Sold to a funder at a discount | Issued at a discount |
| Client pays in full at due date | Redemption at par |

So Forfait does not invent a token type. It issues the receivable as a bond through Hedera's
**Asset Tokenization Studio**, which already implements ERC-1400 with compliance controls,
corporate actions, and lifecycle management.

ATS has no dedicated zero-coupon type — a bond is issued with no coupon schedule set, which
is economically equivalent: the funder's return is the discount to face value, realised at
maturity.

## Architecture

```
Freelancer ──submits invoice──►  Forfait web
                                     │
                                     ├──► ATS (ERC-1400)   issue bond, roles, transfer, pause
                                     └──► Mirror Node      all reads

Platform  ──attests lifecycle──►  scripts/audit-trail.ts
                                     └──► HCS topic        SUBMITTED · VERIFIED

Funder ───────buys at discount──►  Forfait web
```

Two things are deliberately split apart.

**The document is hashed in the browser; only the platform writes the trail.** The
freelancer's machine computes the SHA-256 of the invoice and the file is never uploaded.
The topic's submit key belongs to the platform, so lifecycle attestations run server-side
through `scripts/audit-trail.ts`. If a freelancer could write `VERIFIED` for their own
invoice, the trail would prove nothing — that seam is the point, not an omission.

**Only off-chain facts are attested.** `SUBMITTED` and `VERIFIED` are claims about
documents and diligence, so they go to HCS. Funding is not: the transfer is already on the
ledger, and the app reads the holder from the contract rather than taking anyone's word
for it. Attesting to something the ledger already proves would be weaker, not stronger.

### What works today

| Capability | How it behaves |
|---|---|
| Issue a receivable as an ATS bond | deploy, four role grants, mint — six signatures |
| Pricing on an actual/360 discount basis | with tests, including the effective annual return |
| Transfer to a funder | one signature, read back from chain before the UI believes it |
| Pause and unpause | the compliance control a disputed receivable would use |
| Lifecycle audit trail on HCS | with the document hash, and tamper detection across a trail |
| Document hashing in the browser | pinned byte-for-byte against the platform's own hashing |

### Not built yet

| Missing | Why it is not here |
|---|---|
| **Delivery-versus-payment** | The receivable moves in one direction; the funder's cash does not move in the same transaction. Real DvP needs an ATS hold with the platform as notary. Until then the button says *Release*, not *Fund*. |
| **Settlement at maturity via Scheduled Transactions** | The 60-day cap in `domain.ts` is derived from Hedera's 62-day scheduling ceiling, so the constraint is already honoured — the settlement that would use it is not written. |
| **Privy embedded wallets** | The target user is a freelancer, not someone who wants to manage a seed phrase. Both wallets are MetaMask today. |
| **A platform verification UI** | `VERIFIED` is written by hand with the operator key. The workflow is designed; the interface is not. |
| **Separate accounts per role** | One account is currently issuer, holder and platform at once. Production separates them — see [docs/actors.md](docs/actors.md). |

### Why each piece

- **ATS / ERC-1400** — compliance controls come from audited code, not from me. Control
  lists, KYC gating, pause and transfer restrictions are already in the box. No custom
  Solidity was written for this project: the receivable is a diamond deployed through the
  canonical ATS factory `0.0.9213391` with resolver `0.0.9212226`, source upstream at
  [hashgraph/asset-tokenization-studio](https://github.com/hashgraph/asset-tokenization-studio).
- **Hedera Consensus Service** — one topic, one message per attested event, ordered by
  consensus. The invoice document never touches the ledger; only its SHA-256 hash is
  published, so a funder can verify the document they were shown is the one that was
  financed without the commercial terms becoming public.
- **Mirror Node REST API** — all reads. Free, and the only sane way to query history.

## Known limits

- **Invoice terms are capped at 60 days.** Hedera scheduled transactions expire after a
  maximum of 62 days, so anything longer cannot settle in a single schedule. Longer terms
  would need a re-scheduling mechanism — see [Roadmap](#roadmap).
- Testnet only.
- Invoice verification is not a credit assessment. Establishing that a receivable is real is
  a different problem from establishing that the debtor will pay.

## Measured costs

From my own testnet transactions, not from marketing material:

| Operation | HBAR | USD |
|---|---|---|
| Issue a receivable (ATS contract deployment) | 7.42171367 | **$0.586** |
| HBAR/token transfer | 0.00124353 | $0.0001 |
| HCS lifecycle message | 0.00211401 | $0.00017 |

Issuance dominates because it deploys an EVM contract. Everything after it — status updates,
transfers, settlement — costs a fraction of a cent.

On a $2,000 invoice, total ledger cost is about **0.03% of face value**, against 2–3% for a
conventional payment gateway. That ratio is why this works at ticket sizes banks ignore.

Hedera prices fees in USD, so the HBAR amount moves with the exchange rate while the dollar
cost holds. I measured the same transfer eight days apart at HBAR $0.0650 and $0.0804 — the
dollar cost matched to four significant figures both times.

## Roadmap

Beyond the hackathon. For gaps in what is here now, see
[Not built yet](#not-built-yet).

- Secondary market for issued receivables — ATS has no order book today
- Re-scheduling for invoice terms beyond 60 days
- Oracle-fed FX rates for multi-currency invoices
- Credit signals beyond document verification

## Getting started

```bash
git clone https://github.com/firhanaf/forfait
cd forfait
npm install
cp .env.example .env    # fill in Hedera testnet credentials
```

## AI usage

See [AI-USAGE.md](./AI-USAGE.md).

## License

See [LICENSE](./LICENSE).