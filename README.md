# Forfait 🧾

**Turn a 60-day invoice into cash today.**

Non-recourse financing of cross-border receivables, built on Hedera for
[ETHOnline 2026](https://ethglobal.com/events/ethonline2026).

> **Status:** in active development during ETHOnline 2026 (Sep 5–13). This README tracks
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

An unpaid invoice is, structurally, An invoice is issued as an ATS bond with no coupon schedule set, which is economically a
zero-coupon instrument: the funder's return is the discount to face value, realised at
maturity.:

| Invoice | Zero-coupon bond |
|---|---|
| Invoice amount | Face value |
| Payment due date | Maturity |
| Sold to a funder at a discount | Issued at a discount |
| Client pays in full at due date | Redemption at par |

So Forfait does not invent a token type. It issues the receivable as a bond through Hedera's
**Asset Tokenization Studio**, which already implements ERC-1400 with compliance controls,
corporate actions, and lifecycle management.

## Architecture

```
Freelancer ──submits invoice──►  Forfait API
                                     │
                                     ├──► ATS (ERC-1400)   issue bond, compliance, transfer
                                     ├──► HCS topic        lifecycle audit trail
                                     └──► Scheduled Tx     settlement at maturity

Funder ──────buys at discount───►  Forfait web ──reads──► Mirror Node REST API
```

**Why each piece**

- **ATS / ERC-1400** — compliance controls come from audited code, not from me. Control
  lists, KYC gating, pause, and transfer restrictions are already in the box.
- **Hedera Consensus Service** — one topic, one message per lifecycle event
  (`SUBMITTED → VERIFIED → FUNDED → PAID → SETTLED`), ordered and hash-chained by consensus.
  The invoice document never touches the ledger; only its SHA-256 hash is published, so a
  funder can verify the document they were shown is the one that was financed without the
  commercial terms becoming public.
- **Scheduled Transactions** (`setWaitForExpiry`) — the network executes settlement on the
  due date. No cron job, no keeper bot, nothing to keep running.
- **Privy** — email login and embedded wallets. The target user is a freelancer, not someone
  who wants to manage a seed phrase.
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

- Secondary market for issued receivables — ATS has no order book today
- Re-scheduling for invoice terms beyond 60 days
- Oracle-fed FX rates for multi-currency invoices
- Credit signals beyond document verification

## Getting started

```bash
git clone https://github.com/<user>/forfait
cd forfait
npm install
cp .env.example .env    # fill in Hedera testnet credentials
```

## AI usage

See [AI-USAGE.md](./AI-USAGE.md).

## License

MIT