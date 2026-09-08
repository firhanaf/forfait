# Manual test pass

Run before any demo recording or submission. Every case verifies against an independent
source — HashScan or the mirror node REST API — rather than trusting what the page says.

A successful transaction is not the same as a changed state. That distinction cost two days
during this build, so every write here is followed by a read.

**Preconditions**

- MetaMask on Hedera Testnet (chain ID 296, RPC `https://testnet.hashio.io/api`)
- Account `0.0.10085748` imported, funded with at least 20 ℏ — a full pass issues three
  securities, and issuance alone costs about 7.4 ℏ each
- `TOPIC_ID` in `FundView.tsx` set to the topic from `scripts/audit-trail.ts create`
- `npm run dev`

Cases 1–4 establish that the app survives a reload. Run them first; everything after
assumes a connected wallet.

---

## 1 — Cold start

The index is empty on a browser that has never issued anything, and the app must say so
rather than break.

| | |
|---|---|
| **Do** | DevTools → Application → Local Storage → delete `forfait.receivables.v1`. Hard-reload. |
| **Expect** | **Fund** shows *Nothing issued yet*. **Diagnostics** shows *Nothing indexed* and the security dropdown reads *Nothing indexed* with every SDK button disabled. |
| **Verify** | No red error banner, no console exception |

---

## 2 — Register an existing security

Recovers anything issued before the index existed, or from another machine.

| | |
|---|---|
| **Do** | Diagnostics → *Register an existing security*: `0.0.10415640`, `INV-2026-0047`, `2000.00`, USD, 60 days |
| **Expect** | A row appears immediately in *Indexed receivables* |
| **Verify** | Local Storage now holds `forfait.receivables.v1` with one entry whose fields match what was typed |

Use `0.0.10415640` and not any earlier security. Anything issued before the timestamp fix
carries a maturity in milliseconds and can never be redeemed — see FRICTION.md #4.

**Negative cases.** Each must be refused with a message, and nothing added:

- Security id `abc` → *Security id must look like 0.0.10404061*
- Face value `0` → *Face value must be a positive amount*
- Term `90` → *Term must be between 1 and 60 days*
- The same security id twice → silently ignored, still one row

---

## 3 — Reload with no wallet

The SDK's network configuration lives in memory, so after a reload nothing can be read from
the ledger until a wallet pairs again.

| | |
|---|---|
| **Do** | Click the account chip → **Disconnect**. Then reload. |
| **Expect** | Header shows **Connect wallet** and stays that way after the reload. Fund still lists the receivable with reference, face value, pay-today and return — all from the index. Status reads **Off-chain**, Release is disabled. |
| **Verify** | Console has no ethers *unsupported operation* error |

The pricing renders without a wallet because it is arithmetic over stored terms. Only
supply, holder and paused state need the chain.

Staying disconnected across the reload is the part worth checking. Disconnecting cannot
revoke anything — MetaMask still lists the site and `eth_accounts` still returns the
account — so the intent is remembered in `forfait.wallet.disconnected`. If the header
re-pairs by itself after this, that flag is not being read and the button is decorative.

**Then** clear the flag by clicking **Connect wallet**, and confirm it reconnects.

---

## 4 — Silent reconnect

| | |
|---|---|
| **Do** | Connect the wallet. Then reload the page — do not touch MetaMask. |
| **Expect** | The header shows *Reconnecting…* briefly, then the account id, with **no MetaMask popup**. Fund rows move from **Off-chain** to a live status on their own. |
| **Verify** | Click the account chip: factory `0.0.9213391`, resolver `0.0.9212226`, verdict green |

An empty factory or resolver means the configuration silently failed — FRICTION.md #1.
Reads keep working, so this must be checked deliberately, not inferred from the UI.

---

## 5 — Connection

| | |
|---|---|
| **Do** | From a disconnected state, click **Connect wallet** |
| **Expect** | Account ID appears in the header. Badge reads *Hedera testnet*, not *Config error*. |

**Negative case.** Switch MetaMask to Ethereum Mainnet and reconnect. Expect the error
*"paired without a Hedera account"*, not a silent failure.

---

## 6 — Reading chain state

| | |
|---|---|
| **Do** | Open **Fund a receivable** |
| **Expect** | The row renders with the contract's own name and ISIN, plus supply and holder |
| **Verify** | Open `hashscan.io/testnet/contract/0.0.10415640`. Name, symbol and ISIN must match the page exactly. |

The name and ISIN come from the contract, not the index. If they differ from the reference
typed at issuance, the page is reading a different security.

---

## 7 — Audit trail

| | |
|---|---|
| **Do** | Same tab, scroll to **Audit trail** |
| **Expect** | Events listed in sequence order with status badges and document hashes |
| **Verify** | `https://testnet.mirrornode.hedera.com/api/v1/topics/<TOPIC_ID>/messages?order=asc` — sequence numbers and hashes match one for one |

Only `SUBMITTED` and `VERIFIED` are attested. Funding is read from the contract, not
written to the topic — the ledger already proves it.

---

## 8 — Tamper detection

The single most important case, and the one worth recording.

| | |
|---|---|
| **Do** | Filter to `INV-2026-0042` |
| **Expect** | Green verdict: *document hash is consistent* |
| **Do** | Filter to `INV-2026-0043` |
| **Expect** | Red verdict naming the number of differing hashes |

`INV-2026-0043` was deliberately altered between `VERIFIED` and `FUNDED`. If both trails
show green, the comparison is broken — check that `docHash` is read from the parsed
message rather than defaulting.

---

## 9 — Document hashing

| | |
|---|---|
| **Do** | **Raise a receivable** → drop `samples/INV-2026-0046.pdf` on the drop zone |
| **Expect** | Before the drop, **Tokenise** is disabled with *an invoice document is required*. After it, a `sha256:` digest appears and the button enables. |
| **Verify** | `npx tsx scripts/audit-trail.ts emit INV-2026-0046 SUBMITTED samples/INV-2026-0046.pdf` prints the **same hash, character for character** |

Two independent implementations — WebCrypto in the browser, `node:crypto` on the server —
over the same bytes. If they ever diverge, honest documents start reading as tampered.

---

## 10 — Pricing

| | |
|---|---|
| **Do** | Face value `2000.00`, term 60 days |
| **Expect** | Discount `$40.00`, paid today `$1,960.00`, return `12.41%` |
| **Verify** | `1 − 0.12 × 60/360 = 0.98`, so `2000 × 0.98 = 1960`. Return: `(40/1960) × (365/60) = 12.41%` |

The return exceeds the quoted 12% because the discount is earned on the smaller sum
advanced. If the page shows exactly 12%, the effective-return calculation is wrong.

**Boundary.** Set the due date 90 days out. Expect the 60-day validation message and both
buttons disabled.

**Currency.** Switch to `SGD`. Every amount on this tab must change symbol, and the Fund
tab must show `SGD` too — the index carries the currency because the contract stores it
hex-encoded and the app does not decode it yet.

---

## 11 — ISIN

| | |
|---|---|
| **Do** | Change the reference |
| **Expect** | ISIN updates, always 12 characters, always `XF` prefixed |
| **Verify** | Paste into any ISIN check-digit validator. The final digit must be accepted. |

---

## 12 — Issue, end to end

| | |
|---|---|
| **Do** | Fill the form with a new reference, click **Tokenise receivable** |
| **Expect** | Six MetaMask prompts — deploy, four role grants, the mint. The log names each. |
| **Expect** | A green panel with the new security id and **View in funding market →** |
| **Do** | Click it |
| **Expect** | The Fund tab lists the new receivable first, status **Open** |
| **Verify** | Diagnostics → select it → **Read state** → `totalSupply: "1"`, holders contains `0.0.10085748` |
| **Verify** | Mirror node: `/api/v1/contracts/{id}/results` — the newest `function_parameters` starts `0x18180262`, and no result carries an `error_message` |

**Timestamps.** In the same mirror-node output, confirm the stored maturity is a
ten-digit second-scale value. A thirteen-digit one is the milliseconds bug returning, and
every bond issued would be unredeemable — FRICTION.md #4.

**Interruption.** Reject the third prompt. Expect an `ERROR` line in the log, no green
panel, and no new row on the Fund tab — a security deployed but never minted should not be
offered to funders.

---

## 13 — The funder arrives

There is no such thing as a default funder. The receivable goes to whoever has signed in,
and until somebody has, it goes nowhere.

| | |
|---|---|
| **Do** | Fund tab, with nobody signed in to Privy |
| **Expect** | **Release** is disabled. Its tooltip reads *No funder signed in — sign in below to receive this receivable*. |
| **Do** | *Pay the freelancer* → email → code → **Sign in** |
| **Expect** | A wallet address appears. *Hedera account* reads **created on first transfer** until the wallet has been paid. |
| **Do** | Send testnet HBAR to that address from another account, then click **refresh** |
| **Expect** | Balance updates, and *Hedera account* now shows an id such as `0.0.10418332` |
| **Expect** | **Release** is now enabled |

The first top-up costs about 0.6 ℏ more than later ones. Hedera creates the account on its
first incoming transfer and charges the sender for it, which is what onboarding a funder by
email actually costs.

**Switching tabs.** Send HBAR from another window and come back without clicking refresh.
The balance updates on its own — the card re-reads when the tab regains focus, because a
wallet is topped up somewhere else and this app would otherwise never notice.

---

## 14 — Release to that funder

| | |
|---|---|
| **Do** | **Release** on an open receivable |
| **Expect** | One MetaMask prompt. Status becomes **Funded**. |
| **Verify** | Diagnostics → Read state → holders is the funder's Hedera account, the same id shown on the payment card |

That last check is the point of the case. If holders shows any other account, a hardcoded
funder has survived somewhere and the security and the cash are landing on different
people.

**Not the holder.** Switch MetaMask to a different account and reload. Release must be
disabled, with the tooltip *Only the current holder can release this receivable*. Only the
holder can sign a transfer — which is why the button says Release rather than Fund.

---

## 15 — Pay the freelancer

| | |
|---|---|
| **Do** | On the payment card, click **Pay 100 ℏ** |
| **Expect** | A Privy confirmation, then *Transaction complete*, then a HashScan link on the card |
| **Verify** | Mirror node: `/api/v1/accounts/<funder address>` — the balance has dropped by slightly more than 100 ℏ |
| **Verify** | The transaction on HashScan shows the funder's account as sender and the freelancer's as recipient |

**Insufficient funds.** Sign in as a funder whose wallet holds less than 100 ℏ. The button
must be disabled with *Not enough HBAR — fund this wallet first*, rather than letting the
transaction fail on submission.

**The fee ignores the amount.** Compare this transaction's fee with a 1 ℏ transfer: both
are 0.02205 ℏ. The network charges for the transaction, not its value.

**Nothing binds the two legs.** Releasing and paying are separate transactions and either
can happen without the other. That is a real gap, recorded in Known gaps below — do not
narrate this pair as delivery-versus-payment.

---

## 16 — Pause and unpause

| | |
|---|---|
| **Do** | Diagnostics → Pause → Read state |
| **Expect** | `paused: true`. On the Fund tab the badge reads **Paused** and Release is disabled. |
| **Do** | Unpause → Read state |
| **Expect** | `paused: false`, Release enabled again |

Leaving the security paused blocks every later test, so always unpause afterwards.

---

## 17 — Redemption at maturity

Redemption cannot be observed on a sixty-day instrument, which is why it went untested for
days. The diagnostics page issues one that matures in minutes.

| | |
|---|---|
| **Do** | Diagnostics → **Create 8-minute bond**. Note `securityId` and `maturesAt`. |
| **Do** | Before maturity, select it and click **Redeem at maturity** |
| **Expect** | It **fails**. The bond is not yet mature, and the contract enforces that. |
| **Do** | Wait past `maturesAt`, then click it again |
| **Expect** | `{ ok: true, transactionId: … }` |
| **Verify** | **Read state** → `totalSupply: "0"`, `holders: []` |

Empty holders is the correct result, not a fault. Redemption burns the unit rather than
moving it: the receivable is settled, so nothing remains to hold.

The failing case is worth running deliberately. A revert here with `gasUsed: 78547` is the
maturity check doing its job; the same gas figure on a *matured* bond would mean the
timestamp bug has returned.

---

## 18 — Scheduled settlement

The one nobody signs.

| | |
|---|---|
| **Do** | Diagnostics → **Create 8-minute bond**. Note `securityId` and `maturityEpoch`. |
| **Do** | Immediately: `npx tsx scripts/schedule-settlement.ts create <securityId> 0xf73bf13d1d76ec352ddb44ea0427bafa7658c012 <maturityEpoch>` |
| **Expect** | A schedule id, an expiry two minutes after maturity, and call data beginning `0xd0db5fb2` |
| **Do** | `npx tsx scripts/schedule-settlement.ts info <scheduleId>` |
| **Expect** | `Wait expiry: true`, `Executed: not yet` |
| **Do** | Wait past the expiry. **Touch nothing.** |
| **Verify** | **Read state** → `totalSupply: "0"` |

**`info` now fails, and that is the expected outcome.** Consensus removes a schedule from
state once it executes, so `ScheduleInfoQuery` returns `INVALID_SCHEDULE_ID`. A query that
worked five minutes ago failing is evidence the schedule fired, not that it broke.

The history survives only on the mirror node:

```
GET /api/v1/schedules/<scheduleId>
```

```json
{ "executed_timestamp": "1788840336.018659726",
  "expiration_time":    "1788840336.000000000",
  "wait_for_expiry": true, "deleted": false }
```

**Then confirm the call itself succeeded**, because an executed schedule only means the
transaction was submitted:

```
GET /api/v1/contracts/<securityId>/results
```

The newest result must carry `error_message: null` and about 184,228 gas — the same figure
as a manual redemption. A result with 78,547 gas is a revert wearing a successful
schedule's clothes.

**Timing.** Issuance takes six prompts and roughly ninety seconds, and a schedule cannot be
created after its own expiry. An eight-minute term leaves comfortable margin; a five-minute
one does not.

---

## 19 — Failure handling

| | |
|---|---|
| **Do** | Reject a MetaMask prompt |
| **Expect** | An error line in the log or under the row. No crash, no stuck spinner. |
| **Do** | Click any Diagnostics button before connecting |
| **Expect** | Buttons disabled, with a note to connect first |
| **Do** | Register a security id that does not exist, then open the Fund tab |
| **Expect** | Status **Unavailable** and the error under that row only. Other rows keep working. |
| **Do** | Switch tabs and come back to Diagnostics |
| **Expect** | The log is still there. It survives unmounting; it is cleared only by reload. |

---

## Known gaps

Recorded so the demo does not claim more than the build does.

- **Nothing binds the two legs.** The receivable moves and the cash moves, but as separate
  transactions: either can complete without the other. True DvP uses an ATS hold with the
  platform as notary — designed, not built. See `docs/actors.md`.
- **The funder's payment is denominated in HBAR at a demonstration figure.** Testnet has
  no stablecoin worth using, and the real proceeds would be tens of thousands of HBAR. The
  card says so on screen rather than implying the amount is real.
- **Settlement still needs a funded payer.** If the platform's balance is short when the
  schedule fires, the transaction fails while the schedule records as executed. The
  network removes the operator from the loop, not the treasury.
- **The index is per-browser.** Clearing site data hides receivables that still exist on
  the ledger; they can be re-registered under Diagnostics. Production indexes server-side
  from mirror-node events.
- **Face value and rate are not read from the contract.** They come from the terms entered
  at issuance. The contract's `nominalValue` is authoritative and should replace them.
- **HCS events are written by `scripts/audit-trail.ts`, not by the UI.** The platform owns
  that topic, so writing from the browser would mean putting the operator key there.
- **The platform is still conflated with the issuer.** The freelancer and the funder are
  now genuinely separate identities with separate wallets, but one key still issues
  securities and owns the audit topic — so the party attesting is the party attested
  about. Production separates them.
- **Securities issued before the timestamp fix are unredeemable.** `0.0.10404061`,
  `0.0.10406673` and `0.0.10415260` carry millisecond maturities. They are left on the
  ledger as evidence for FRICTION.md #4 rather than hidden.
