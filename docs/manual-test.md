# Manual test pass

Run before any demo recording or submission. Every case verifies against an independent
source — HashScan or the mirror node REST API — rather than trusting what the page says.

A successful transaction is not the same as a changed state. That distinction cost two days
during this build, so every write here is followed by a read.

**Preconditions**

- MetaMask on Hedera Testnet (chain ID 296, RPC `https://testnet.hashio.io/api`)
- Account `0.0.10085748` imported, funded with test HBAR
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
| **Do** | Diagnostics → *Register an existing security*: `0.0.10404061`, `INV-2026-0045`, the face value and term actually used, currency `USD` |
| **Expect** | A row appears immediately in *Indexed receivables* |
| **Verify** | Local Storage now holds `forfait.receivables.v1` with one entry whose fields match what was typed |

**Negative cases.** Each must be refused with a message, and nothing added:

- Security id `abc` → *Security id must look like 0.0.10404061*
- Face value `0` → *Face value must be a positive amount*
- Term `90` → *Term must be between 1 and 60 days*
- The same security id twice → silently ignored, still one row

---

## 3 — Reload with no wallet

The case that used to throw. The SDK's network configuration lives in memory, so after a
reload nothing can be read from the ledger until a wallet pairs again.

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
| **Verify** | Console shows a fresh `walletPaired` with non-empty `factoryId` and `resolverId` |

Empty `factoryId` after a reconnect means the configuration silently failed — FRICTION.md
#1. Reads keep working, so this must be checked in the console, not inferred from the UI.

---

## 5 — Connection

| | |
|---|---|
| **Do** | From a disconnected state, click **Connect wallet** |
| **Expect** | Account ID appears in the header, linked to HashScan. Badge reads *Hedera testnet*. |
| **Verify** | Console `walletPaired` carries `factoryId: 0.0.9213391`, `resolverId: 0.0.9212226` |

**Negative case.** Switch MetaMask to Ethereum Mainnet and reconnect. Expect the error
*"paired without a Hedera account"*, not a silent failure.

---

## 6 — Reading chain state

| | |
|---|---|
| **Do** | Open **Fund a receivable** |
| **Expect** | The row renders with the contract's own name and ISIN, plus supply and holder |
| **Verify** | Open `hashscan.io/testnet/contract/0.0.10404061`. Name, symbol and ISIN must match the page exactly. |

The name and ISIN come from the contract, not the index. If they differ from the reference
typed at issuance, the page is reading a different security.

---

## 7 — Audit trail

| | |
|---|---|
| **Do** | Same tab, scroll to **Audit trail** |
| **Expect** | Events listed in sequence order with status badges and document hashes |
| **Verify** | `https://testnet.mirrornode.hedera.com/api/v1/topics/<TOPIC_ID>/messages?order=asc` — sequence numbers and hashes match one for one |

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

## 9 — Pricing

| | |
|---|---|
| **Do** | **Raise a receivable**. Face value `2000.00`, term 60 days. |
| **Expect** | Discount `$40.00`, paid today `$1,960.00`, return `12.41%` |
| **Verify** | `1 − 0.12 × 60/360 = 0.98`, so `2000 × 0.98 = 1960`. Return: `(40/1960) × (365/60) = 12.41%` |

The return exceeds the quoted 12% because the discount is earned on the smaller sum
advanced. If the page shows exactly 12%, the effective-return calculation is wrong.

**Boundary.** Set the due date 90 days out. Expect the 60-day validation message and both
buttons disabled.

**Zero.** Set face value `0`. Expect *face value must be positive*.

**Currency.** Switch to `SGD`. Every amount on this tab must change symbol. Then issue one
and confirm the Fund tab shows `SGD` too — the index carries the currency because the
contract stores it hex-encoded and the app does not decode it yet.

---

## 10 — ISIN

| | |
|---|---|
| **Do** | Change the reference |
| **Expect** | ISIN updates, always 12 characters, always `XF` prefixed |
| **Verify** | Paste into any ISIN check-digit validator. The final digit must be accepted. |

`XF` is unassigned to any national numbering agency, so these cannot collide with a real
security. That is deliberate and is stated in the UI.

---

## 11 — Issue, end to end

The whole point of the index: what is issued on one tab appears on another.

| | |
|---|---|
| **Do** | Fill the form with a new reference, click **Tokenise receivable** |
| **Expect** | Six MetaMask prompts — deploy, four role grants, the mint. The log names each. |
| **Expect** | A green panel with the new security id linked to HashScan, and **View in funding market →** |
| **Do** | Click it |
| **Expect** | The Fund tab now lists two receivables, the new one first, status **Open** |
| **Verify** | Diagnostics → select the new security → **Read state** → `totalSupply: "1"`, holders contains `0.0.10085748` |

**Interruption.** Reject the third prompt. Expect an `ERROR` line in the log, no green
panel, and no new row on the Fund tab — a security that was deployed but never minted
should not be offered to funders.

---

## 12 — Roles

Only needed on a security created outside `createReceivable`.

| | |
|---|---|
| **Do** | Diagnostics → Grant roles |
| **Expect** | Four wallet prompts, four `granted` lines |
| **Verify** | Each transaction appears under the account's history on HashScan |

Without `ISSUER`, issuing fails with *the account trying to perform the operation doesn't
have the needed role*. Creating a security grants `DEFAULT_ADMIN_ROLE` only.

---

## 13 — Release to a funder

| | |
|---|---|
| **Do** | Fund tab → **Release** on an open receivable |
| **Expect** | One MetaMask prompt. Status becomes **Funded**, the button disables, and a panel appears with the `audit-trail.ts emit … FUNDED` command. |
| **Verify** | Diagnostics → Read state → holders is now `0.0.10377457`, not the issuer |
| **Verify** | HashScan shows the transfer transaction |

**Not the holder.** Switch MetaMask to a different account and reload. Release must be
disabled, with the tooltip *Only the current holder can release this receivable*. Only the
holder can sign a transfer — which is why the button says Release rather than Fund, and why
real delivery-versus-payment needs a hold with a notary.

---

## 14 — Pause and unpause

| | |
|---|---|
| **Do** | Diagnostics → Pause → Read state |
| **Expect** | `paused: true`. On the Fund tab the badge reads **Paused** and Release is disabled. |
| **Do** | Unpause → Read state |
| **Expect** | `paused: false`, Release enabled again |

This is the compliance control a disputed receivable would use. Leaving the security paused
blocks every later test, so always unpause afterwards.

---

## 15 — Failure handling

| | |
|---|---|
| **Do** | Reject a MetaMask prompt |
| **Expect** | An error line in the log or under the row. No crash, no stuck spinner. |
| **Do** | Click any Diagnostics button before connecting |
| **Expect** | Buttons disabled, with a note to connect first |
| **Do** | Register a security id that does not exist, then open the Fund tab |
| **Expect** | Status **Unavailable** and the error under that row only. Other rows keep working. |

---

## Known gaps

Recorded so the demo does not claim more than the build does.

- **Release is one-sided.** It moves the receivable without taking the funder's cash in
  the same transaction. True DvP uses an ATS hold with the platform as notary — designed,
  not built. See `docs/actors.md`.
- **The index is per-browser.** Clearing site data hides receivables that still exist on
  the ledger; they can be re-registered under Diagnostics. Production indexes server-side
  from mirror-node events.
- **Face value and rate are not read from the contract.** They come from the terms entered
  at issuance. The contract's `nominalValue` is authoritative and should replace them.
- **HCS events are written by `scripts/audit-trail.ts`, not by the UI.** The platform owns
  that topic, so writing from the browser would mean putting the operator key there.
- **One account plays several roles.** `0.0.10085748` is issuer, holder and platform at
  once. Production separates them.
