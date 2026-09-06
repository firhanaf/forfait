# Developer friction log — Hedera & ATS

Kept while building Forfait during ETHOnline 2026. Every entry is something that cost real
time and would cost the next developer the same. Written to be usable as upstream issues.

Entries 1–11 cover the ATS SDK, 12 the monorepo, 13–16 the native Hedera SDK.

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

### 4. Timestamps are milliseconds, but nothing says so

**Impact:** blocking, misleading error.

`startingDate` and `maturityDate` are typed `string`. Passing Unix **seconds** yields:

```
Invalid Timestamp Wed Jan 21 1970 23:49:41 GMT+0700 (Indochina Time), outside range
[Wed Jan 21 1970 23:49:41 GMT+0700, Thu Jan 22 1970 01:16:05 GMT+0700]
```

The value is being read as milliseconds. The error shows 1970 dates but never says "expected
milliseconds".

**Suggested fix:** document the unit, and detect second-scale values to emit a targeted hint.

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

### 9. Classes required by public methods are missing from the package barrel

**Impact:** forces hardcoded constants or unusable methods in every integration.

`index.d.ts` re-exports `./port/in`, which in turn re-exports `./request`, `./response`
and the individual ports. Three things public methods depend on fall outside that:

| Class | Location | Needed for | Consequence |
|---|---|---|---|
| `SecurityRole` | `domain/context/security/` | every `grantRole`, `revokeRole`, `hasRole` | outside the exported `port/in` tree entirely; the 30+ role hashes must be copied out of `node_modules` by hand |
| `SetConfigurationRequest` | `port/in/request/management/` | `Network.setConfig()` | under an exported path but absent from `request/index.d.ts`; TypeScript reports it missing from 269 exports, and `package.json` `exports` blocks the deep path, so the method cannot be called as designed |
| `UnpauseRequest` | `port/in/request/security/operations/pause/` | `Security.unpause()` | same; `UnpauseRequest is not a constructor` at runtime |

`Security.unpause()` does accept a `PauseRequest`, which is exported — but nothing documents
that, and the missing class is what a consumer reaches for first.

A related case worth separating: `EventParameter<'walletPaired'>` **is** exported, but does
not describe the payload. The reference implementation in `apps/ats/web` casts it to `any`
before reading it, so consumers must declare the shape themselves either way.

**Suggested fix:** re-export the missing request classes from `port/in/request/index.ts`,
export `SecurityRole`, and give the event payloads real types.

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