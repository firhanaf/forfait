# Developer friction log — Hedera & ATS

Kept while building Forfait during ETHOnline 2026. Every entry is something that cost real
time and would cost the next developer the same. Written to be usable as upstream issues.

Entries 1–11 and 17 cover the ATS SDK, 12 the monorepo, 13–16 the native Hedera SDK. If you read
only one, read **#4** — it is the only failure here that reports nothing at all.

---

## ATS SDK

### 1. `InitializationRequest` silently produces empty configuration unless the plural array forms are supplied

**Impact:** blocking. Cost roughly two days.

This is the root cause behind almost everything else in this file.

The [integration guide](https://docs.tokenization-studio.hedera.com/ats/developer-guides/sdk-integration)
and the [SDK reference](https://docs.tokenization-studio.hedera.com/ats/api/sdk-reference) both
show initialisation like this:

```ts
await Network.init(new InitializationRequest({
  network: "testnet",
  mirrorNode: { baseUrl, apiKey: "", headerName: "" },
  rpcNode:    { baseUrl, apiKey: "", headerName: "" },
  configuration: { resolverAddress: "0.0.xxxx", factoryAddress: "0.0.yyyy" },
}));
```

That call **succeeds**. No error, no warning. But the configuration is never applied — the
`walletPaired` event later reports:

```json
{ "network": { "name": "testnet", "recognized": true, "factoryId": "", "resolverId": "" } }
```

Every subsequent failure descends from those two empty strings, and none of the error messages
mention configuration.

**What actually works** — taken from `apps/ats/web/src/services/SDKService.ts` in this
repository, which is the only place the correct shape appears:

```ts
await Network.init(new InitializationRequest({
  network, mirrorNode, rpcNode,
  events,                                                    // see #2
  configuration: { factoryAddress, resolverAddress },
  mirrorNodes:   { nodes: [{ mirrorNode,   environment: network }] },
  jsonRpcRelays: { nodes: [{ jsonRpcRelay: rpcNode, environment: network }] },
  factories:     { factories: [{ factory:  factoryAddress,  environment: network }] },
  resolvers:     { resolvers: [{ resolver: resolverAddress, environment: network }] },
}));
```

The plural forms are what the SDK reads. `configuration` appears to be a legacy field that is
accepted and ignored.

**Suggested fix:** reject an `InitializationRequest` that yields no factory or resolver, rather
than resolving successfully with empty values. Failing that, document the plural forms — they
are absent from both the integration guide and the SDK reference.

### 2. `events` handlers are required, and the connected account arrives through them

**Impact:** blocking, and undocumented.

`InitializationRequest` accepts `events?: Partial<WalletEvent>`. The SDK reference lists the
field but never explains it, and no example supplies it.

Without handlers, `Network.connect()` resolves to `{}` and the SDK has no account. Reads still
work. Every write fails with `GET /api/v1/accounts/0.0.0 → 404`.

The account is not returned by `connect()` — it arrives asynchronously through `walletPaired`:

```ts
const walletEvents = {
  walletFound: (e) => {},
  walletConnectionStatusChanged: (e) => {},
  walletDisconnect: (e) => {},
  walletPaired: (e) => {
    const accountId = e?.data?.account?.id?.value;   // "0.0.10085748"
  },
};
```

Supplying `account` in `ConnectRequest` — which the type permits — does **not** substitute for
this. It populates the account object while leaving the signer unset, so writes then fail
differently:

```
contract runner does not support sending transactions
(operation="sendTransaction", code=UNSUPPORTED_OPERATION, version=6.17.0)
```

**Suggested fix:** document that `events` is required for wallet connections, and that the
account is delivered via `walletPaired`.

### 3. MetaMask must already be connected to the page before `Network.init()`

**Impact:** blocking, and invisible.

The reference web app gates initialisation on MetaMask's connection state:

```ts
useEffect(() => {
  if (isMetamaskConnected) { init(walletEvents); }
}, [isMetamaskConnected]);
```

Calling `Network.init()` before `eth_requestAccounts` has resolved leaves the SDK without a
signer. Nothing reports this. Reads work; writes fail with the ethers `UNSUPPORTED_OPERATION`
error above, which says nothing about wallet connection order.

**Suggested fix:** document the ordering, or have `connect()` await wallet availability.

### 4. Bond dates are seconds, and passing milliseconds is accepted but breaks maturity forever

**Impact:** blocking, silent, and permanent. Cost a morning, and every bond issued before
it was found.

`startingDate` and `maturityDate` on `CreateBondRequest` are typed `string`. Nothing in
the type, the field name, or the documentation says which unit. JavaScript's
`Date.getTime()` returns milliseconds, so milliseconds is the natural guess.

Milliseconds are accepted. The value is stored verbatim, and the contract then compares
it against `block.timestamp`, which is in seconds.

```ts
// Accepted. Issuance succeeds, minting succeeds, HashScan shows a sensible date.
maturityDate: String(invoice.dueAt.getTime())                      // 1793923200000

// Correct.
maturityDate: String(Math.floor(invoice.dueAt.getTime() / 1000))   // 1793923200
```

A bond meant to mature on 6 November 2026 instead matures around the year 58,800. It can
never be redeemed, and nothing anywhere reports a problem.

**What it looks like.** Issuance, role grants and minting all succeed. The security reads
back correctly — name, ISIN, supply, holders. Redemption then fails with:

```
CALL_EXCEPTION  transaction execution reverted
gasUsed:       78547
error_message: 0xecb90424
```

A bare custom-error selector and no reason string. ATS ships no JSON ABIs, so the selector
cannot be resolved to a name from the package, and it is not in the public 4-byte database.

The ethers error compounds this: it reports `"data": ""` for the call, suggesting the SDK
sent no call data at all. It did — the mirror node shows the real calldata. Chasing that
first is a dead end.

**How it was found.** Two failures, on different securities with different maturity dates,
produced byte-identical gas usage: 78,547 both times. Identical gas means an identical
execution path, so the failure could not depend on the maturity date or on elapsed time.
That ruled out the obvious hypothesis before a day went into testing it.

The answer was in the contract result on the mirror node, which records every storage slot
the call read:

```
GET /api/v1/contracts/results/{transactionId}
```

```json
"state_changes": [
  { "contract_id": "0.0.10406673",
    "slot": "0x1aa172d1ea72cd83510f1cf656de1afda1343aac6b18ede59e254f0b6b4e3000",
    "value_read": "0x0000…000001a1ae27b400" }
]
```

`0x1a1ae27b400` is 1,793,923,200,000. Against a `block.timestamp` of about 1,788,834,062
that is three orders of magnitude out — and 1,793,923,200 *seconds* is exactly the
intended maturity date. The number was right; the unit was not.

**The technique generalises.** When a Hedera contract call reverts with nothing useful,
`state_changes` shows what the contract actually read. Those values are the values you
supplied, and recognising them in storage is usually faster than reasoning about what the
contract might be checking.

**Suggested fix.** A magnitude check when the request is constructed would cost one line
and remove the whole class of error: a plausible maturity is around 1.8 × 10⁹, and 1.8 ×
10¹² is not a date anyone means. Failing that, naming the field `maturityDateSeconds`, or
saying so in the type's doc comment, would be enough.

This is worth fixing above everything else in this log. Every other entry here announces
itself with an error. This one issues successfully, reads back correctly, and fails months
later — by which time every instrument issued in the meantime is already broken.

**Verified.** `0.0.10415407`, issued with seconds from the diagnostics page and left to
mature, redeemed successfully: supply 1 → 0, holders empty. `0.0.10415640`, issued through
the normal sixty-day path, was accepted with seconds. `0.0.10404061`, `0.0.10406673` and
`0.0.10415260`, all issued with milliseconds, are permanently unredeemable.

**Unresolved.** An earlier version of this entry claimed the opposite — that seconds are
rejected — on the strength of this error:

```
Invalid Timestamp Wed Jan 21 1970 23:49:41 GMT+0700, outside range
[Wed Jan 21 1970 23:49:41 GMT+0700, Thu Jan 22 1970 01:16:05 GMT+0700]
```

Those 1970 dates are second-scale values read as milliseconds, and the 86-minute width of
that range is a 60-day term read the same way — so some validation layer does treat the
input as milliseconds, which would make the SDK and the contract disagree with each other
about the unit. That error has not been reproduced since, and issuance with seconds now
succeeds through both the diagnostics and the normal path. Recorded here rather than
dropped, because if a validator does read these as milliseconds it is a second defect
sitting behind the first.

### 5. `regulationType` is typed optional but is required at runtime

**Impact:** blocking.

`CreateBondRequest.d.ts` declares `regulationType?: number`, so TypeScript accepts omitting it.
`CreateBondCommandHandler` then throws:

```
An error occurred while creating the bond: Regulation type is missing
```

Same for `regulationSubType`.

**Suggested fix:** make the fields required in the type, or default them.

### 6. Valid regulation type/subtype pairs are undocumented

**Impact:** blocking, requires reading source.

`RegulationType` and `RegulationSubType` are string enums (`NONE`, `REG_S`, `REG_D` /
`NONE`, `506_B`, `506_C`) but the request takes numbers. The mapping lives in
`CastRegulationType.fromNumber`, and the validity rule in `CheckRegulations.typeAndSubtype`:

| Type | Value | Allowed subtype |
|---|---|---|
| `NONE` | 0 | — |
| `REG_S` | 1 | `NONE` (0) only |
| `REG_D` | 2 | `506_B` (1) or `506_C` (2) |

Passing `REG_S` with subtype `506_B` gives:

```
Validation for class CreateBondRequest was not successful:
{ "name": "regulationSubType", "errors": [{ "message":
  "Regulation Sub Type 1 is not valid for regulation type 1", "errorCode": "10031" }] }
```

The error states the rejection without stating the rule.

**Suggested fix:** document the table, and export the enums for consumers.

### 7. Optional array fields must be passed explicitly or the SDK throws on `.length`

**Impact:** blocking, opaque error.

Omitting `externalPausesIds`, `externalControlListsIds`, `externalKycListsIds`,
`proceedRecipientsIds`, `proceedRecipientsData` produces:

```
An error occurred while creating the bond:
Cannot read properties of undefined (reading 'length')
```

No field name, and no stack frame pointing at user code.

**Suggested fix:** default to empty arrays.

### 8. `configId` and `configVersion` are required but absent from the integration guide

**Impact:** blocking.

The guide's `CreateEquityRequest` example omits both. `CreateBondRequest` requires them:

```
An error occurred while creating the bond: Config Id not found in request
```

The bond config ID is `0x…0002`. That value is only discoverable from
`apps/ats/web/.env.example` inside the monorepo — not from the SDK or its documentation.

### 9. The package barrel omits things its own public API requires

**Reported upstream:** [hashgraph/asset-tokenization-studio#1401](https://github.com/hashgraph/asset-tokenization-studio/issues/1401)

**Impact:** forces hardcoded constants, unusable methods, or unreachable features in
every integration.

`index.d.ts` re-exports `./port/in`, which in turn re-exports `./request`, `./response`
and the individual ports. Four things that public functionality depends on fall outside
that:

| Missing | Location | Needed for | Consequence |
|---|---|---|---|
| `SecurityRole` | `domain/context/security/` | every `grantRole`, `revokeRole`, `hasRole` | outside the exported `port/in` tree entirely; the 30+ role hashes must be copied out of `node_modules` by hand |
| `SetConfigurationRequest` | `port/in/request/management/` | `Network.setConfig()` | under an exported path but absent from `request/index.d.ts`; TypeScript reports it missing from 269 exports, and `package.json` `exports` blocks the deep path, so the method cannot be called as designed |
| `UnpauseRequest` | `port/in/request/security/operations/pause/` | `Security.unpause()` | same; `UnpauseRequest is not a constructor` at runtime |
| **`ControlList`** | `port/in/security/controlList/` | `addToControlList`, `removeFromControlList`, `isAccountInControlList` | the **port class itself** is unexported. `ControlListRequest` *is* exported, so a consumer can construct the request and then find nothing to pass it to |

The last one is the sharpest. `ControlListRequest` appears in the barrel's export list
alongside 250-odd others, which reads as a supported feature. The class that consumes it
is not exported from `port/in/index.ts`, not re-exported from the package index, and not
mixed into `Security` — so allow and deny lists, a compliance control the product page
advertises, cannot be reached from a published import at all.

`Security.unpause()` does accept a `PauseRequest`, which is exported, so that one has a
workaround. Control lists have none.

A related case worth separating: `EventParameter<'walletPaired'>` **is** exported, but does
not describe the payload. The reference implementation in `apps/ats/web` casts it to `any`
before reading it, so consumers must declare the shape themselves either way.

**Suggested fix.** The individual omissions are each a one-line export, but the pattern
matters more than the instances. Four separate features are unreachable for the same
reason, which suggests nothing checks the barrel against the API surface. A test that
imports the package the way a consumer does — from the published entry point, not by
deep path — and constructs one request and one port per feature would have caught all
four.


### 10. Exported types do not match the shapes actually returned

**Impact:** compiles cleanly, fails at runtime.

Two instances found while writing a typed client. Both compile, and both are wrong at
runtime, which is the worst combination: TypeScript actively steers you away from the
correct code.

**`Network.getFactoryAddress()` and `getResolverAddress()`** are declared `(): string` in
`Network.d.ts`. They return `Promise<string>`. Logging them without `await` prints
`[object Promise]`.

**`SecurityViewModel.diamondAddress` and `evmDiamondAddress`** are declared as strings.
`Security.getInfo()` returns objects:

```json
{ "diamondAddress": { "value": "0.0.10373584" },
  "evmDiamondAddress": { "value": "0x13c8ca9a1f58c5e953209477146891dcfcaa8741" } }
```

Reading `.value` is a type error; not reading it yields an object where a string was
expected. A consumer has to guard for both shapes to be safe.

**Suggested fix:** align the declarations with what the implementations return.

### 11. Errors consistently name the wrong cause

**Impact:** this is what turned a configuration mistake into a two-day investigation.

Every failure downstream of #1 reported something other than the missing configuration:

| Actual cause | Reported error |
|---|---|
| Configuration empty | `Factory not found in request` — blames the request, which never carries a factory |
| No account resolved | `GET /api/v1/accounts/0.0.0 → 404` |
| No signer attached | `contract runner does not support sending transactions` |
| Account lookup with empty input | `EVM address could not be retrieved for 0.0.10085748` — names a valid account, then reports `Value "" does not have the correct format (0.0.0)` |
| Role never granted | resolved only after the above; roles must be granted explicitly after creation, which no example shows |

`MirrorNodeAdapter.accountToEvmAddress` rejects with a bare empty string:

```js
else { return Promise.reject(""); }
```

which surfaces as a Hedera ID format error about `""`, several layers from its origin.

**Suggested fix:** reject with a described error, and surface configuration state in the
messages that depend on it.

### 17. The ESM build cannot be imported by Node

**Reported upstream:** [hashgraph/asset-tokenization-studio#1400](https://github.com/hashgraph/asset-tokenization-studio/issues/1400)

**Impact:** blocking for any use outside a bundler. Found while trying to enumerate the
package's exports from a one-line script.

```js
await import("@hashgraph/asset-tokenization-sdk");
```

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  .../build/esm/src/port/in/index
imported from .../build/esm/src/index.js
```

The file exists — as `index.js`. ESM requires fully specified specifiers, and the emitted
build imports `./port/in/index` with no extension. Node refuses it; a bundler does not,
because bundler resolution still probes for extensions.

So the package works in Vite, webpack and anything else that resolves like CommonJS, and
fails the moment it is loaded by the runtime its own directory name claims to target.

**Why this is worth more than it looks.** A tokenization SDK is not only a front-end
concern. Issuing securities from a backend, running a keeper, scheduling settlement,
writing an integration test in Node — all of it needs a plain `import`, and none of it is
possible today without putting a bundler in the path. In this project every server-side
script had to use the native Hedera SDK instead, and the parts that genuinely needed ATS
had to stay in the browser.

It also makes the package hard to inspect. Listing what a library exports is the first
thing anyone does when the documentation is thin, and here that fails before it starts —
which is how entries 9 and 10 in this log ended up being written by reading `.d.ts` files
by hand.

**Workaround.** Load it through something with bundler-style resolution — `tsx`,
`vite-node`, or a bundle step. There is no way to make plain `node` import it.

**Suggested fix.** Emit `.js` extensions in the ESM output. With TypeScript that means
`"module": "node16"` or `"nodenext"`, which makes the compiler enforce specifiers at
build time rather than leaving them to fail at import time. A single smoke test — `node
-e 'import("@hashgraph/asset-tokenization-sdk")'` in CI — would keep it fixed.

---

## ATS monorepo

### 12. `npm run ats:setup` fails on a fresh clone

**Impact:** blocking for anyone wanting the local web app.

Version 8.0.0, Node 22.15.0, Windows. Contracts compile, then `tsc -p tsconfig.build.json`
fails with 11 errors, all of this form:

```
scripts/domain/factory/deployBondToken.ts:76:23 - error TS2339:
Property 'DEFAULT_ADMIN_ROLE' does not exist on type '{}'.
```

Preceded by:

```
[WARN] 111 facets missing resolver keys: AccessControlFacet, AdjustBalancesFacet,
AllowanceFacet, AmortizationFacet, BalanceTrackerFacet, ...
```

The registry generator appears to emit an empty constants module, so `ATS_ROLES` is typed `{}`.
Adding `"exclude": ["scripts/**/*", "test/**/*"]` to `tsconfig.build.json` did not resolve it.

**Workaround:** skip the monorepo and install `@hashgraph/asset-tokenization-sdk` from npm. The
factory and resolver are already deployed on testnet, so a local contract build is unnecessary
for most integrations — but nothing in the documentation says so.

**Worth noting:** `apps/ats/web/src` is the only complete, working example of SDK
initialisation. Entries 1, 2 and 3 were all resolved by reading it. A build failure therefore
hides the most useful documentation in the project.

---

## Hedera native SDK

### 13. `INSUFFICIENT_TX_FEE` does not say what fee would have sufficed

Raising `setMaxTransactionFee` is the fix, but the error gives no target value. The receipt
carries the exchange rate, so the required amount is computable — it just is not surfaced.

### 14. Setting `kycKey` silently activates KYC enforcement

Creating a token with a `kycKey` means no account can receive it until explicitly granted.
Nothing warns at creation; the first transfer fails with `ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN`.
That setting a key also switches on enforcement is not evident from the API surface — unlike
`freezeKey` and `pauseKey`, which stay dormant until invoked.

### 15. `client.setOperator()` makes negative access-control tests pass silently

Every transaction is auto-signed by the operator. Adding a different signer does not replace
that signature, so a test written to prove "this account may not write" **succeeds** — because
the operator key was attached as well. Testing unauthorised access requires constructing a
separate `Client` with that identity as its operator.

This is the most dangerous item in this file: it makes broken access control look correct.

### 16. Chunked HCS message receipts return before all chunks land

`TopicMessageSubmitTransaction` with a message over 1024 bytes splits into chunks. The receipt
returns the first chunk's sequence number while later chunks are still in flight, so querying
`TopicInfoQuery` immediately gives an undercount — non-deterministically. The same 3000-byte
message reported 2 chunks on one run and 3 on the next.
