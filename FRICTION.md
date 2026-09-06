# Developer friction log — Hedera & ATS

Kept while building Forfait during ETHOnline 2026. Every entry is something that cost real
time and would cost the next developer the same. Written to be usable as upstream issues.

---

## ATS SDK

### 1. `Network.init()` and `Network.connect()` destroy each other's state

**Impact:** blocking. No sequence of the two documented calls produces a usable state.

- `Network.init(config)` sets factory and resolver, but not the account.
- `Network.connect(account)` sets the account **and clears the configuration**.
- Calling `init` again restores the configuration **and clears the account**.

The [integration guide](https://docs.tokenization-studio.hedera.com/ats/developer-guides/sdk-integration)
shows exactly `init` → `connect`, which leaves the configuration empty. `Bond.create()` then
fails with:

```
An error occurred while creating the bond: Factory not found in request
```

The message blames the request, which never carries a factory at all — it comes from network
configuration. Re-initialising fixes creation but breaks `issue` and `transfer`, which then
fail with `GET /api/v1/accounts/0.0.0 → 404` because the account has been cleared.

**The SDK already solves this.** `Network.setConfig()` restores the configuration without
touching the wallet. It is not mentioned anywhere in the integration guide.

Working sequence:

```ts
await Network.init(new InitializationRequest({ ...cfg, configuration }));
await Network.connect(new ConnectRequest({ ...cfg, wallet, account }));
await Network.setConfig({ factoryAddress, resolverAddress, validate: () => [] } as any);
```

**Suggested fix:** document `setConfig`, or stop `connect` from clearing configuration.

### 2. The MetaMask example omits the required `account` field

**Impact:** blocking, and silent.

The guide's MetaMask example:

```ts
const connectRequest = new ConnectRequest({
  // ...network config...
  wallet: SupportedWallets.METAMASK,
});
```

`ConnectRequest` declares `account?: RequestAccount` — optional. Omitting it makes
`Network.connect()` resolve **successfully**, returning `{}`. No error, no warning. Read
operations keep working. Every write then fails several layers away:

```
GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.0 → 404
10009 - Value "" does not have the correct format (0.0.0)
```

Supplying `account: { accountId, evmAddress }` fixes it.

**Suggested fix:** reject a MetaMask connection with no resolvable account, or document the
field as required for this wallet.

### 3. Timestamps are milliseconds, but nothing says so

**Impact:** blocking, misleading error.

`startingDate` and `maturityDate` are typed `string`. Passing Unix **seconds** yields:

```
Invalid Timestamp Wed Jan 21 1970 23:49:41 GMT+0700 (Indochina Time), outside range
[Wed Jan 21 1970 23:49:41 GMT+0700, Thu Jan 22 1970 01:16:05 GMT+0700]
```

The value is being read as milliseconds. The error shows 1970 dates but never says "expected
milliseconds".

**Suggested fix:** document the unit, and detect second-scale values to emit a targeted hint.

### 4. `regulationType` is typed optional but is required at runtime

**Impact:** blocking.

`CreateBondRequest.d.ts` declares `regulationType?: number`, so TypeScript accepts omitting
it. `CreateBondCommandHandler` then throws:

```
An error occurred while creating the bond: Regulation type is missing
```

Same for `regulationSubType`.

**Suggested fix:** make the fields required in the type, or default them.

### 5. Valid regulation type/subtype pairs are undocumented

**Impact:** blocking, requires reading source.

`RegulationType` and `RegulationSubType` are string enums (`NONE`, `REG_S`, `REG_D` /
`NONE`, `506_B`, `506_C`) but the request takes numbers. The mapping lives in
`CastRegulationType.fromNumber`, and the validity rule in `CheckRegulations.typeAndSubtype`:

| Type | Value | Allowed subtype |
|---|---|---|
| `NONE` | 0 | — |
| `REG_S` | 1 | `NONE` (0) only |
| `REG_D` | 2 | `506_B` (1) or `506_C` (2) |

None of this appears in the docs. Passing `REG_S` with subtype `506_B` gives:

```
Validation for class CreateBondRequest was not successful:
{ "name": "regulationSubType", "errors": [{ "message":
  "Regulation Sub Type 1 is not valid for regulation type 1", "errorCode": "10031" }] }
```

The error states the rejection without stating the rule.

**Suggested fix:** document the table, and export the enums for consumers.

### 6. Optional array fields must be passed explicitly or the SDK throws on `.length`

**Impact:** blocking, opaque error.

Omitting `externalPausesIds`, `externalControlListsIds`, `externalKycListsIds`,
`proceedRecipientsIds`, `proceedRecipientsData` produces:

```
An error occurred while creating the bond:
Cannot read properties of undefined (reading 'length')
```

No field name, and no stack frame pointing at user code.

**Suggested fix:** default to empty arrays.

### 7. `configId` and `configVersion` are required but absent from the integration guide

**Impact:** blocking.

The guide's `CreateEquityRequest` example omits both. `CreateBondRequest` requires them:

```
An error occurred while creating the bond: Config Id not found in request
```

The bond config ID is `0x…0002`. That value is only discoverable from
`apps/ats/web/.env.example` inside the monorepo — not from the SDK or its documentation.

### 8. `SetConfigurationRequest` cannot be imported by consumers at all

**Impact:** forces a workaround in every integration that needs `setConfig` (see #1).

`Network.setConfig()` calls `req.validate()`, so a plain object throws:

```
TypeError: args.validate is not a function
```

But the class is **not exported from the package index** — TypeScript reports it missing from
269 exports — and the `exports` field in `package.json` blocks the deep path:

```
"./build/esm/src/port/in/request/management/SetConfigurationRequest" is not exported
under the conditions ["module", "browser", "development", "import"] from package
@hashgraph/asset-tokenization-sdk
```

The only workaround is an object supplying its own `validate: () => []`.

**Suggested fix:** export it from the index.

### 9. `getFactoryAddress()` and `getResolverAddress()` are typed `string` but return `Promise<string>`

`Network.d.ts` declares both as returning `string`. Logging them without `await` prints
`[object Promise]`. The declaration is wrong.

### 10. The SDK requires a browser wallet — no headless path is documented

**Impact:** architectural surprise.

`Network.connect()` supports MetaMask and WalletConnect only. A Node script cannot issue a
security, which means every integration test or backend job needs a browser. Custodial
settings (DFNS, Fireblocks, AWS KMS) exist in `ConnectRequest` but are not covered by the
integration guide.

### 11. `getAccountEvmAddress` fails on a valid account — open

**Status:** unresolved as of day 1.

```
An error occurred while issuing tokens: An error occurred while querying if account has role:
EVM address could not be retrieved for 0.0.10085748, error: An invalid response was received
from the server: 10009 - Value "" does not have the correct format (0.0.0)
```

The mirror node **does** return `evm_address` for this account:

```json
{ "account": "0.0.10085748", "evm_address": "0xf73bf13d1d76ec352ddb44ea0427bafa7658c012" }
```

The inner error is an empty string being parsed as a Hedera ID somewhere in that path, while
the outer message blames the account. Same pattern as #1 and #2: the error names the wrong
thing.

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

The registry generator appears to emit an empty constants module, so `ATS_ROLES` is typed
`{}`. Adding `"exclude": ["scripts/**/*", "test/**/*"]` to `tsconfig.build.json` did not
resolve it.

**Workaround:** skip the monorepo and install `@hashgraph/asset-tokenization-sdk` from npm.
The factory and resolver are already deployed on testnet, so a local contract build is
unnecessary for most integrations — but nothing in the documentation says so.

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