# Who does what

Four parties. The interesting question for each is not what they can do, but **what stops
them doing the rest** — and whether that is enforced by the chain, by the platform, or by
nothing yet.

---

## Freelancer — the issuer

The person owed money. They hold the receivable until a funder buys it.

**Can**

- Submit an invoice with the underlying document, hashed in their own browser
- See exactly what a funder would pay before committing to anything
- Accept the discount, or walk away and wait to be paid in full
- Issue the receivable as a security they hold themselves
- Release it to a funder, and receive the proceeds

**Cannot**

| | Enforced by |
|---|---|
| Mark their own invoice `VERIFIED` | HCS `submitKey` — the topic belongs to the platform |
| Alter the document after submitting | The hash is published; any change breaks the trail |
| Sell the same receivable twice | Supply is capped at one unit; once transferred it is gone |
| Release it to nobody | The transfer target is the signed-in funder's account, not a constant |
| Take the receivable back after funding | Ownership is on-chain and they no longer hold it |

The last point is what makes this non-recourse. Once sold, the freelancer keeps the money
whether or not the client ever pays.

They need a wallet that can sign contract calls, because issuing an ERC-1400 security is a
contract call. That is the only reason MetaMask appears in this story at all.

---

## Funder — the buyer

Provides cash today against a claim payable later. Their return is the discount.

**Can**

- Sign in with an email address and receive a wallet they never had to create
- Browse receivables that have already been verified
- Read the full audit trail before committing — every state change, in order, timestamped
- Check that the document hash they were shown matches the one recorded at verification
- Pay the freelancer from that wallet
- Receive and hold the receivable in the same account that paid for it
- Redeem at par when the client pays

**Cannot**

| | Enforced by |
|---|---|
| See receivables before verification | Nothing yet — the listing does not filter on status |
| Alter the receivable's terms | ERC-1400: nominal value and maturity are fixed at issuance |
| Force early payment | Maturity is set at issuance and the client is not a party to the chain |
| Buy a paused receivable | The contract rejects transfers while paused |
| Receive the receivable without paying | **Nothing.** The two legs are separate transactions |

That last row is the honest one. Delivery and payment both happen, but nothing binds them:
a receivable can be released and never paid for, or paid for and never released. An ATS
hold with the platform as notary would bind them. It is designed and not built.

**What they are actually paid for:** the risk that the client never pays. Nothing on-chain
removes that. A tamper-evident trail removes document fraud and settlement risk — credit
risk stays, and 12% rather than 3% is what compensates it.

Note what the funder never needs: a browser extension, a seed phrase, or any prior
relationship with a blockchain. Buying a receivable is a financial decision, not a
technical one, and the wallet requirement is the point at which most people who would
happily fund a $2,000 invoice stop.

---

## Forfait — the platform

Does not own receivables. Sells verification and keeps the record.

**Can**

- Verify a submitted invoice: confirm the contract, that the work was delivered, and ideally
  that the client acknowledges the debt
- Write every attested state change to the audit trail
- Schedule settlement at issuance, so redemption happens without anyone being present
- Delete a schedule before it fires, if a receivable is disputed
- Pause a receivable that turns out to be disputed
- Force a transfer to unwind a fraudulent assignment — `isControllable: true` at issuance

**Should not**

| | Enforced by |
|---|---|
| Take custody of a receivable in normal operation | Nothing — this is a policy choice, and the controller power is real |
| Verify without evidence | Nothing — this is exactly what the platform is trusted for |

That controller power is deliberate and worth defending rather than hiding. In trade
finance an issuer is expected to be able to unwind a fraudulent assignment; in DeFi the
same capability reads as a backdoor. Both readings are fair. It is disclosed at issuance,
visible on-chain, and every use of it lands in the audit trail.

The platform also carries an obligation nobody votes on: keeping the payer account funded.
Scheduled settlement removes the operator from the loop, not the treasury. An unfunded
account on the maturity date means the schedule executes and the transaction inside it
fails.

---

## Client — the debtor

Owes the money. Usually never touches the chain at all.

**Can**

- Confirm the invoice is genuine, as part of verification
- Pay on the due date, through whatever rail they already use

**Cannot**

- Be compelled to pay by anything in this system

They are the source of every dollar in the transaction and the one party with no on-chain
presence. That is not an oversight — a Singapore company paying a supplier is not going to
install a wallet, and any design that requires it does not survive contact with reality.

---

## Built versus designed

Stated plainly so the demo does not claim more than the code does.

| Capability | Status |
|---|---|
| Issue a receivable as an ATS security | **Built** — six wallet prompts, end to end |
| Pricing on an actual/360 basis | **Built**, with tests |
| Document hashing in the freelancer's browser | **Built** — pinned against the platform's own hashing |
| Release to a funder | **Built** — to the signed-in funder's account, not a fixed one |
| Pause and unpause | **Built** |
| Audit trail with document hashing | **Built** — written by the platform, read by anyone |
| Tamper detection across a trail | **Built** |
| Funder onboarding by email | **Built** — a Privy wallet, created on sign-in |
| Funder payment to the freelancer | **Built** |
| Settlement at maturity | **Built** — scheduled at issuance, executed by the network |
| Verification workflow | Designed — the platform writes `VERIFIED` by hand today |
| Atomic delivery-versus-payment | Designed — ATS `Hold` and `Clearing` are the intended mechanism |
| A separate platform account | **Not yet** — one key still issues securities and owns the topic |

The last line is the honest one. The freelancer and the funder are now genuinely different
identities with different wallets and different account ids. The platform is not: the same
key that issues a security also owns the audit topic, which means the party being trusted
to attest is the same party being attested about. Production separates them, and the
reason it matters is the whole argument of this document — nobody should be able to write
`VERIFIED` for their own invoice.
