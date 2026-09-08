<img src="apps/web/public/logo-lockup.svg" alt="Forfait" width="300">

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
Freelancer ──submits invoice────►  Forfait web
                                       │
                                       ├──► ATS (ERC-1400)  issue bond, roles, transfer, pause
                                       └──► Mirror Node     all reads

Platform ──attests lifecycle────►  scripts/audit-trail.ts
                                       └──► HCS topic       SUBMITTED · VERIFIED

Platform ──schedules settlement─►  scripts/schedule-settlement.ts
                                       └──► Scheduled Tx    redeem at maturity,
                                                            executed by the network

Funder ────signs in with email──►  Privy embedded wallet
                                       └──► pays the freelancer
```

Four things are deliberately split apart.

**The document is hashed in the browser; only the platform writes the trail.** The
freelancer's machine computes the SHA-256 of the invoice and the file is never uploaded.
The topic's submit key belongs to the platform, so lifecycle attestations run server-side
through `scripts/audit-trail.ts`. If a freelancer could write `VERIFIED` for their own
invoice, the trail would prove nothing — that seam is the point, not an omission.

**Only off-chain facts are attested.** `SUBMITTED` and `VERIFIED` are claims about
documents and diligence, so they go to HCS. Funding is not: the transfer is already on the
ledger, and the app reads the holder from the contract rather than taking anyone's word
for it. Attesting to something the ledger already proves would be weaker, not stronger.

**Settlement is handed to the network, not to a process.** The redemption is signed once,
when the receivable is issued, and held by `setWaitForExpiry` until the maturity date.
There is no cron job, no keeper bot, and nothing that has to stay running for sixty days
and be trusted to still be running on the last one.

**The two sides need different wallets, so they get different wallets.** Issuing an
ERC-1400 security means signing contract calls, so the freelancer uses MetaMask. Paying
for one does not, so the funder signs in with an email address and Privy provisions a
wallet they never had to create. Forcing a seed phrase on someone who only wants to buy a
receivable is how this kind of product loses the people it is for.

### What works today

| Capability | How it behaves |
|---|---|
| Issue a receivable as an ATS bond | deploy, four role grants, mint — six signatures |
| Pricing on an actual/360 discount basis | with tests, including the effective annual return |
| Transfer to a funder | one signature, read back from chain before the UI believes it |
| Pause and unpause | the compliance control a disputed receivable would use |
| Lifecycle audit trail on HCS | with the document hash, and tamper detection across a trail |
| Document hashing in the browser | pinned byte-for-byte against the platform's own hashing |
| Settlement at maturity | a scheduled transaction signed at issuance; the network executes it |
| Funder payment from an email login | a Privy embedded wallet, created on sign-in, paying in HBAR |

Demonstrated on testnet: schedule `0.0.10416050` redeemed security `0.0.10416012` eighteen
milliseconds after its maturity, using the same gas as a manual redemption, with nobody
signing anything at execution time. Separately, `0.0.10418332` — a wallet that exists
because someone typed an email address — paid `0.0.10085748` directly.

### Not built yet

| Missing | Why it is not here |
|---|---|
| **Atomic delivery-versus-payment** | Both legs exist, but they are two transactions, not one. Either could complete without the other. Real DvP needs an ATS hold with the platform as notary, which is why the button says *Release* rather than *Fund*. |
| **A platform verification UI** | `VERIFIED` is written by hand with the operator key. The workflow is designed; the interface is not. |
| **A separate platform account** | The freelancer and the funder are now genuinely different identities with different wallets. The platform is not: one account still issues securities and owns the audit topic. See [docs/actors.md](docs/actors.md). |

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
- **Scheduled Transactions** — settlement without infrastructure. A
  `ContractExecuteTransaction` calling redemption is scheduled at issuance with
  `setWaitForExpiry`, so the network holds it until maturity and then executes it. An
  admin key is retained, because a disputed receivable must not settle on time and nothing
  else could stop it.
- **Privy** — the funder's side of the trade, without the wallet onboarding. An embedded
  wallet is provisioned on email sign-in and pays the freelancer directly on Hedera,
  configured through viem's `defineChain` against the same relay the rest of the app uses.
  The Hedera account behind that wallet does not exist until it receives its first
  transfer, which is why balances treat a mirror-node 404 as zero rather than an error.
- **Mirror Node REST API** — all reads. Free, and the only sane way to query history.

## Known limits

- **Invoice terms are capped at 60 days.** Settlement is a Hedera scheduled transaction,
  and those expire after a maximum of 62 days, so a longer term could not settle in a
  single schedule. Longer terms would need a re-scheduling mechanism — see
  [Roadmap](#roadmap).
- Testnet only. The funder's payment leg is denominated in HBAR because testnet has no
  stablecoin worth using; on mainnet it would be one, and the amount would be the real
  proceeds rather than a demonstration figure.
- Invoice verification is not a credit assessment. Establishing that a receivable is real is
  a different problem from establishing that the debtor will pay.
- Automatic settlement still depends on a funded payer account. If the platform's balance
  is insufficient when the schedule fires, the scheduled transaction fails while the
  schedule itself is recorded as having executed. The network removes the operator from
  the loop, not the treasury.

## Measured costs

From my own testnet transactions, not from marketing material.

| Operation | HBAR | USD |
|---|---|---|
| Issue a receivable (ATS contract deployment) | 7.42171367 | **$0.586** |
| Schedule settlement at maturity | 1.21100000 | $0.0998 |
| Execute the scheduled redemption | 0.19160000 | $0.0158 |
| Create a Hedera account by first transfer | 0.61610000 | $0.0508 |
| EVM transfer through the JSON-RPC relay | 0.02205000 | $0.0018 |
| Native HBAR/token transfer | 0.00124353 | $0.0001 |
| HCS lifecycle message | 0.00211401 | $0.00017 |

A full lifecycle — issuance, transfer, two attestations, scheduling, and settlement —
comes to roughly **$0.70**, or **0.035% of a $2,000 invoice**, against 2–3% for a
conventional payment gateway. That ratio is why this works at ticket sizes banks ignore.

Two of those rows are worth reading twice. Issuance dominates everything because it
deploys an EVM contract. And an EVM transfer through the relay costs about twenty times a
native one — the convenience of an Ethereum-shaped wallet is not free, it is just cheap.

Account creation is charged to whoever sends the first transfer, not to the account's
owner, so onboarding a funder by email costs the person funding them about five cents.
That figure is derived: the first transfer cost 0.6382 ℏ and a later identical one cost
0.02205 ℏ.

Hedera prices fees in USD, so the HBAR amount moves with the exchange rate while the dollar
cost holds. I measured the same transfer eight days apart at HBAR $0.0650 and $0.0804 — the
dollar cost matched to four significant figures both times. The rows above were measured on
8 September, at rates between $0.0804 and $0.0824.

The fee also ignores the amount. A 1 ℏ transfer and a 100 ℏ transfer both cost exactly
0.02205 ℏ, because the network charges for the transaction rather than its value. Ledger
cost is therefore flat while invoice size is not: on a $20,000 receivable the same
lifecycle is 0.0035% of face value rather than 0.035%.

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

The web app needs its own environment file at `apps/web/.env` with `VITE_PRIVY_APP_ID`.
Vite reads that one; the root `.env` is for the Node scripts.

## AI usage

See [AI-USAGE.md](./AI-USAGE.md).

## License

See [LICENSE](./LICENSE).
