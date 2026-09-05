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
fails with `Factory not found in request` — blaming the request, which never carries a factory
at all. Re-initialising fixes creation but breaks `issue` and `transfer`, which fail with
`GET /api/v1/accounts/0.0.0 → 404` because the account is now empty.

**The SDK already solves this.** `Network.setConfig()` restores the configuration without
touching the wallet. It is not mentioned anywhere in the integration guide.

Working sequence:

```ts
await Network.init(new InitializationRequest({ ...cfg, configuration }));
await Network.connect(new ConnectRequest({ ...cfg, wallet, account }));
await Network.setConfig({ factoryAddress, resolverAddress, validate: () => [] } as any);
```

**Suggested fix:** document `setConfig`, or stop `connect` from clearing configuration.

### 2. Timestamps are milliseconds, but nothing says so

**Impact:** blocking, misleading error.

`startingDate` and `maturityDate` are typed `string`. Passing Unix **seconds** yields:

```
Invalid Timestamp Wed Jan 21 1970 23:49:41 GMT+0700, outside range [...]
```

The value is being read as milliseconds. The error shows 1970 dates but never says
"expected milliseconds".

**Suggested fix:** document the unit, and detect second-scale values to emit a targeted hint.

### 3. `regulationType` is typed optional but is required at runtime

**Impact:** blocking.

`CreateBondRequest.d.ts` declares `regulationType?: number`, so TypeScript accepts omitting
it. `CreateBondCommandHandler` then throws `MissingRegulationType`. Same for
`regulationSubType`.

**Suggested fix:** make the fields required in the type, or default them.

### 4. Valid regulation type/subtype pairs are undocumented

**Impact:** blocking, requires reading source.

`RegulationType` and `RegulationSubType` are string enums (`NONE`, `REG_S`, `REG_D` /
`NONE`, `506_B`, `506_C`) but the request takes numbers. The mapping lives in
`CastRegulationType.fromNumber`, and the validity rule in `CheckRegulations.typeAndSubtype`:

| Type | Value | Allowed subtype |
|---|---|---|
| `NONE` | 0 | — |
| `REG_S` | 1 | `NONE` (0) only |
| `REG_D` | 2 | `506_B` (1) or `506_C` (2) |

None of this appears in the docs. The error `Regulation Sub Type 1 is not valid for
regulation type 1` states the rejection without stating the rule.

**Suggested fix:** document the table, and export the enums for consumers.

### 5. Optional array fields must be passed explicitly or the SDK throws on `.length`

**Impact:** blocking, opaque error.

Omitting `externalPausesIds`, `externalControlListsIds`, `externalKycListsIds`,
`proceedRecipientsIds`, `proceedRecipientsData` produces:

```
Cannot read properties of undefined (reading 'length')
```

No field name, no stack pointing at user code.

**Suggested fix:** default to empty arrays.

### 6. `configId` and `configVersion` are required but absent from the integration guide

**Impact:** blocking.

The guide's `CreateEquityRequest` example omits both. `CreateBondRequest` requires them, and
the handler throws `Config Id not found in request` if missing. Bond config ID is
`0x…0002`; the value is only discoverable from `apps/ats/web/.env.example` in the monorepo.

### 7. The SDK requires a browser wallet — there is no headless path documented

**Impact:** architectural surprise.

`Network.connect()` supports MetaMask and WalletConnect only. A Node script cannot issue a
security, which means every integration test or backend job needs a browser. This is not
stated anywhere in the integration guide.

---

## ATS monorepo

### 8. `npm run ats:setup` fails on a fresh clone

**Impact:** blocking for anyone wanting the local web app.

Version 8.0.0, Node 22.15.0, Windows. Contracts compile, then `tsc -p tsconfig.build.json`
fails with 11 errors, all of the form:

```
error TS2339: Property 'DEFAULT_ADMIN_ROLE' does not exist on type '{}'.
```

Preceded by:

```
[WARN] 111 facets missing resolver keys: AccessControlFacet, AdjustBalancesFacet, ...
```

The registry generator appears to emit an empty constants module, so `ATS_ROLES` is typed
`{}`. Adding `"exclude": ["scripts/**/*", "test/**/*"]` to `tsconfig.build.json` did not
resolve it.

**Workaround:** skip the monorepo entirely and install `@hashgraph/asset-tokenization-sdk`
from npm. The factory and resolver are already deployed on testnet, so a local contract build
is unnecessary for most integrations — but nothing says this.

---

## Hedera native SDK

### 9. `INSUFFICIENT_TX_FEE` does not say what fee would have sufficed

Raising `setMaxTransactionFee` is the fix, but the error gives no target. The receipt does
carry the exchange rate, so the required amount is computable — it just is not surfaced.

### 10. Setting `kycKey` silently activates KYC enforcement

Creating a token with a `kycKey` means no account can receive it until explicitly granted.
Nothing warns at creation; the first transfer fails with
`ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN`. The relationship between setting a key and enabling
enforcement is not obvious from the API surface.

### 11. `client.setOperator()` makes negative access-control tests pass silently

Every transaction is auto-signed by the operator. Adding a different signer does not replace
that signature, so a test intended to prove "this account may not write" succeeds — because
the operator key was attached too. Testing unauthorised access requires a separate `Client`
instance.

This is the most dangerous item here: it makes broken access control look correct.

### 12. Chunked HCS message receipts return before all chunks land

`TopicMessageSubmitTransaction` with a message over 1024 bytes splits into chunks. The
receipt returns the first chunk's sequence number, while later chunks are still in flight.
Querying `TopicInfoQuery` immediately gives an undercount — non-deterministically.

### 13. The MetaMask example omits the required `account` field

**Impact:** blocking, and silent.

The guide's MetaMask example:

```ts
const connectRequest = new ConnectRequest({ /* network config */, wallet: SupportedWallets.METAMASK });
```

`ConnectRequest` accepts an optional `account?: RequestAccount`. Omitting it makes
`Network.connect()` resolve **successfully**, returning `{}` — no error, no warning. Reads keep
working. Every write then fails with `accounts/0.0.0 → 404`, several layers away from the cause.

Supplying `account: { accountId, evmAddress }` fixes it.

**Suggested fix:** reject a MetaMask connection with no resolvable account, or document the
field as required for this wallet.

### 14. `SetConfigurationRequest` cannot be imported by consumers at all

`Network.setConfig()` calls `req.validate()`, so a plain object throws
`args.validate is not a function`. But the class is **not exported from the package index**, and
the `exports` field in `package.json` blocks the deep path:

The only workaround is an object supplying its own `validate: () => []`.

**Suggested fix:** export it from the index.

### 15. `getFactoryAddress()` and `getResolverAddress()` are typed `string` but return `Promise<string>`

Logging them without `await` prints `[object Promise]`. The declaration in `Network.d.ts` is
wrong.

### 16. `getAccountEvmAddress` fails on a valid account — open

**Status:** unresolved as of day 2.

The mirror node **does** return `evm_address` for this account. The inner error is an empty
string being parsed as a Hedera ID somewhere in that path, while the outer message blames the
account. Same pattern as #1: the error names the wrong thing.