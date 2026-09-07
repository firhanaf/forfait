# Who does what

Four parties. The interesting question for each is not what they can do, but **what stops
them doing the rest** — and whether that is enforced by the chain, by the platform, or by
nothing yet.

---

## Freelancer — the issuer

The person owed money. They hold the receivable until a funder buys it.

**Can**

- Submit an invoice with the underlying document
- See exactly what a funder would pay before committing to anything
- Accept the discount, or walk away and wait to be paid in full
- Issue the receivable as a security they hold themselves
- Receive the proceeds on funding

**Cannot**

| | Enforced by |
|---|---|
| Mark their own invoice `VERIFIED` | HCS `submitKey` — the topic belongs to the platform |
| Alter the document after submitting | The hash is published; any change breaks the trail |
| Sell the same receivable twice | Supply is capped at one unit; once transferred it is gone |
| Take the receivable back after funding | Ownership is on-chain and they no longer hold it |

The last point is what makes this non-recourse. Once sold, the freelancer keeps the money
whether or not the client ever pays.

---

## Funder — the buyer

Provides cash today against a claim payable later. Their return is the discount.

**Can**

- Browse receivables that have already been verified
- Read the full audit trail before committing — every state change, in order, timestamped
- Check that the document hash they were shown matches the one recorded at verification
- Buy at the quoted discount
- Redeem at par when the client pays

**Cannot**

| | Enforced by |
|---|---|
| See receivables before verification | Nothing yet — the listing does not filter on status |
| Alter the receivable's terms | ERC-1400: nominal value and maturity are fixed at issuance |
| Force early payment | Maturity is set at issuance and the client is not a party to the chain |
| Buy a paused receivable | The contract rejects transfers while paused |

**What they are actually paid for:** the risk that the client never pays. Nothing on-chain
removes that. A tamper-evident trail removes document fraud and settlement risk — credit
risk stays, and 12% rather than 3% is what compensates it.

---

## Forfait — the platform

Does not own receivables. Sells verification and keeps the record.

**Can**

- Verify a submitted invoice: confirm the contract, that the work was delivered, and ideally
  that the client acknowledges the debt
- Write every state transition to the audit trail
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
| Transfer to a funder | **Built** |
| Pause and unpause | **Built** |
| Audit trail with document hashing | **Built** — written by the platform, read by anyone |
| Tamper detection across a trail | **Built** |
| Redemption at maturity | Function present, not yet wired to the UI |
| Verification workflow | Designed — the platform writes `VERIFIED` by hand today |
| Delivery-versus-payment | Designed — ATS `Hold` and `Clearing` are the intended mechanism |
| Separate accounts per role | **Not yet** — one key currently acts as platform and freelancer |

The last line is the honest one. In this build a single MetaMask account issues the
security, holds it, and owns the audit trail topic. Production separates them: the
freelancer signs from their own wallet, and the platform's key lives on a server precisely
so that nobody can write `VERIFIED` for their own invoice.
