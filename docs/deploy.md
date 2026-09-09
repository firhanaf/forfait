# Deploying the web app

The app is a static Vite build. Nothing server-side ships with it, and it holds no
credentials — the platform's Hedera key stays in the root `.env`, which is read only by
the scripts, on the machine that runs them.

## Vercel

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Framework | Vite (detected) |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment | `VITE_PRIVY_APP_ID` |

`VITE_*` variables are inlined into the client bundle at build time, so adding one after
a deploy needs a redeploy — changing it alone does nothing. That also means nothing
secret can ever go in one: whatever is set here is readable by anyone who opens the page.

Only `VITE_PRIVY_APP_ID` is needed, and a Privy app id is public by design. The Hedera
operator key is not here and must never be: it owns the audit topic and holds every role
on every security this project has issued.

After the first deploy, **add the deployed origin to the allowed origins in the Privy
dashboard**. Email sign-in works on localhost either way, so an unregistered origin is a
failure that only appears in production, and only when someone tries to sign in.

## Why Solana packages are in the dependency tree

`@solana/kit`, `@solana-program/system`, `@solana-program/token` and
`@hiero-ledger/proto` are listed as dependencies but never used at runtime.

`@privy-io/react-auth` carries a Solana funding path behind optional peer dependencies.
The dev server never bundles it, so it goes unnoticed locally. A production build has to
resolve every import, and Vite replaces a missing optional peer with a stub that exports
nothing — so every import from that path fails the build:

```
[MISSING_EXPORT] "getTransferSolInstruction" is not exported by
  "__vite-optional-peer-dep:@solana-program/system:@privy-io/react-auth"
```

Installing them satisfies the resolver. The code that would use them is unreachable, so
tree-shaking removes most of it, and nothing Solana-related runs.

The alternative — aliasing those specifiers to an empty module — means fighting a virtual
module id whose behaviour can only be tested through a two-minute deploy cycle. Installing
the packages the library actually asks for is the honest fix, even though it looks odd in
a Hedera project.

## What a visitor sees without a wallet

The receivable list, its terms, the discount arithmetic and the full audit trail all
render without MetaMask — pricing is arithmetic over the index, and the trail comes from
the public mirror node.

Only the on-chain status of each receivable needs a connection today, because reads go
through the ATS SDK and the SDK has no network configured until a wallet pairs. Those
rows read **Connect to verify** until someone does.

Splitting `Network.init` from `Network.connect` would let reads work for everyone, since
initialisation is what reads need and pairing is what writes need. It is not done yet —
that initialisation sequence is the most fragile part of this integration, and changing
it deserves more than an evening. See FRICTION.md #1 through #3.

## Verifying a build the way Vercel sees it

Vercel builds with root directory `apps/web` and never installs the repository root, so
anything hoisted there is invisible to it. Locally the opposite is true: Node resolution
walks upwards, and `apps/web` quietly finds whatever the root has.

That divergence cost two failed deploys. `@hiero-ledger/proto` is a dependency of
`@hashgraph/hedera-wallet-connect`; it was present at the root for the scripts, so every
local build passed while Vercel could not resolve it.

To check honestly, hide the root install first:

```sh
mv node_modules node_modules.bak
cd apps/web && npm run build
cd .. && mv node_modules.bak node_modules
```

Ten seconds, and it removes the whole class of failure — rather than discovering it one
package at a time through a two-minute deploy cycle.
