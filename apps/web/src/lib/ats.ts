// apps/web/src/lib/ats.ts
//
// Everything that talks to Asset Tokenization Studio.
//
// The connection sequence below is not obvious and is not documented. Three things must
// all be true before a single write succeeds — see FRICTION.md #1, #2 and #3. Changing
// the order or dropping a field fails silently: reads keep working and writes fail with
// errors that name something else entirely.

import type {
  SecurityViewModel,
  WalletEvent,
} from "@hashgraph/asset-tokenization-sdk";
import {
  ConnectRequest,
  InitializationRequest,
  Network,
  SupportedWallets,
} from "@hashgraph/asset-tokenization-sdk";

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

export const RESOLVER = "0.0.9212226";
export const FACTORY = "0.0.9213391";
const NETWORK = "testnet";

const MIRROR_NODE = {
  baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/",
  apiKey: "",
  headerName: "",
};

const RPC_NODE = {
  baseUrl: "https://testnet.hashio.io/api",
  apiKey: "",
  headerName: "",
};

const NETWORK_CONFIG = {
  network: NETWORK,
  mirrorNode: MIRROR_NODE,
  rpcNode: RPC_NODE,
};

/**
 * The plural forms are what the SDK actually reads. Passing only `configuration`
 * succeeds and leaves factoryId and resolverId empty, with no error anywhere.
 */
const FULL_CONFIG = {
  ...NETWORK_CONFIG,
  configuration: { factoryAddress: FACTORY, resolverAddress: RESOLVER },
  mirrorNodes: { nodes: [{ mirrorNode: MIRROR_NODE, environment: NETWORK }] },
  jsonRpcRelays: { nodes: [{ jsonRpcRelay: RPC_NODE, environment: NETWORK }] },
  factories: { factories: [{ factory: FACTORY, environment: NETWORK }] },
  resolvers: { resolvers: [{ resolver: RESOLVER, environment: NETWORK }] },
};

/**
 * Role identifiers. `SecurityRole` is not exported from the package index, so these are
 * copied from build/esm/src/domain/context/security/SecurityRole.d.ts — see FRICTION.md #9.
 */
export const ROLES = {
  ISSUER: "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
  PAUSER: "0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f",
  CONTROLLIST:
    "0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d",
  MATURITY_REDEEMER:
    "0x433f48f8aca23480f6ab07666cbc9131d32a0b4672033453f65e18f4dd390523",
} as const;

/**
 * `SecurityViewModel` types these as strings, but the runtime returns `{ value }`.
 * `Bond.create` returns the same shape for the new security's address. FRICTION.md #10.
 */
const idOf = (v: unknown): string =>
  typeof v === "string" ? v : ((v as { value?: string })?.value ?? "");

// ─────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────

export interface Connection {
  accountId: string;
  evmAddress: string;
  factoryId: string;
  resolverId: string;
}

/**
 * The fields Forfait reads from the walletPaired payload. `EventParameter<'walletPaired'>`
 * is exported but does not describe the payload — the reference implementation in
 * apps/ats/web casts it to `any` before use.
 */
interface WalletPairedEvent {
  data?: { account?: { id?: { value?: string } } };
  network?: { factoryId?: string; resolverId?: string };
}

/**
 * Connects MetaMask and returns the paired account.
 *
 * Order matters and none of it is documented:
 *   1. MetaMask must already be connected to the page. Calling init() first leaves the
 *      SDK without a signer, and writes fail with an ethers UNSUPPORTED_OPERATION error
 *      that says nothing about wallets.
 *   2. init() must carry `events`. The account is delivered through walletPaired, not
 *      returned by connect(), which resolves to `{}`.
 *   3. init() must carry the plural config arrays, or factory and resolver stay empty.
 *
 * Do not pass `account` to ConnectRequest. The type permits it, and it populates the
 * account while leaving the signer unset — reads work, writes do not.
 */
export async function connectWallet(
  onEvent?: (name: string, payload: unknown) => void,
): Promise<Connection> {
  const eth = window.ethereum;
  if (!eth) throw new Error("MetaMask not found");

  const [evmAddress] = (await eth.request({
    method: "eth_requestAccounts",
  })) as string[];

  return new Promise<Connection>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("wallet did not pair within 30 seconds")),
      30_000,
    );

    const events: Partial<WalletEvent> = {
      walletFound: (e) => onEvent?.("walletFound", e),
      walletConnectionStatusChanged: (e) => onEvent?.("statusChanged", e),
      walletDisconnect: (e) => onEvent?.("disconnect", e),
      walletPaired: (e) => {
        onEvent?.("walletPaired", e);

        // The SDK's own type carries no structure here — see WalletPairedEvent above.
        const paired = e as WalletPairedEvent;
        const accountId = paired.data?.account?.id?.value;

        if (!accountId || accountId === "0.0.0") {
          clearTimeout(timer);
          reject(
            new Error(
              "paired without a Hedera account — is MetaMask on Hedera testnet?",
            ),
          );
          return;
        }

        clearTimeout(timer);
        resolve({
          accountId,
          evmAddress,
          factoryId: paired.network?.factoryId ?? "",
          resolverId: paired.network?.resolverId ?? "",
        });
      },
    };

    // The exported constructor type omits `events` and the plural config arrays
    // (factories, resolvers, mirrorNodes, jsonRpcRelays). All are required at runtime:
    // without `events` the account never arrives, and without the plural arrays
    // factoryId and resolverId stay empty with no error. See FRICTION.md #1 and #2.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Network.init(new InitializationRequest({ ...FULL_CONFIG, events } as any))
      .then(() =>
        Network.connect(
          new ConnectRequest({
            ...NETWORK_CONFIG,
            wallet: SupportedWallets.METAMASK,
          }),
        ),
      )
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

// ─────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────

export interface SecurityInfo {
  name: string;
  symbol: string;
  isin: string;
  type: string;
  decimals: number;
  totalSupply: string;
  maxSupply: string;
  paused: boolean;
  diamondAddress: string;
  evmDiamondAddress: string;
}

export async function getSecurity(securityId: string): Promise<SecurityInfo> {
  const { Security, GetSecurityDetailsRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );
  const info = (await Security.getInfo(
    new GetSecurityDetailsRequest({ securityId }),
  )) as SecurityViewModel;

  return {
    name: info.name ?? "",
    symbol: info.symbol ?? "",
    isin: info.isin ?? "",
    type: info.type ?? "",
    decimals: info.decimals ?? 0,
    totalSupply: String(info.totalSupply ?? "0"),
    maxSupply: String(info.maxSupply ?? "0"),
    paused: !!info.paused,
    diamondAddress: idOf(info.diamondAddress),
    evmDiamondAddress: idOf(info.evmDiamondAddress),
  };
}

export async function getHolders(securityId: string): Promise<string[]> {
  const { Security, GetSecurityHoldersRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );
  return Security.getSecurityHolders(
    // The exported type omits the pagination parameters the runtime requires.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new GetSecurityHoldersRequest({ securityId, start: 0, end: 100 } as any),
  );
}

// ─────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────

export interface TxResult {
  ok: boolean;
  transactionId: string;
}

/** Every write operation resolves to this shape. */
interface RawTxResponse {
  payload?: boolean | number;
  transactionId?: string;
}

const asResult = (r: RawTxResponse): TxResult => ({
  ok: !!r?.payload,
  transactionId: r?.transactionId ?? "",
});

/** Grants a role. The creator holds DEFAULT_ADMIN_ROLE but no operational roles. */
export async function grantRole(
  securityId: string,
  targetId: string,
  role: string,
): Promise<TxResult> {
  const { Role, RoleRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );
  return asResult(
    await Role.grantRole(new RoleRequest({ securityId, targetId, role })),
  );
}

/** Grants every role Forfait needs. Four wallet prompts; run once per security. */
export async function grantOperationalRoles(
  securityId: string,
  targetId: string,
  onProgress?: (label: string, result: TxResult) => void,
): Promise<void> {
  for (const [label, role] of Object.entries(ROLES)) {
    const result = await grantRole(securityId, targetId, role);
    onProgress?.(label, result);
  }
}

/** Creates units of the receivable and assigns them to the issuer. */
export async function issue(
  securityId: string,
  targetId: string,
  amount: string,
): Promise<TxResult> {
  const { Security, IssueRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );
  return asResult(
    await Security.issue(new IssueRequest({ securityId, targetId, amount })),
  );
}

/**
 * Issues a new receivable. Three phases, six wallet prompts: deploy the security, grant
 * the operational roles the creator does not receive automatically, then mint the single
 * unit that represents the invoice.
 *
 * Creating a security grants DEFAULT_ADMIN_ROLE only. Without ISSUER the mint that
 * follows fails with "the account trying to perform the operation doesn't have the
 * needed role", naming a role hash rather than the role.
 */
export async function createReceivable(
  params: Record<string, unknown>,
  ownerAccountId: string,
  onStep?: (label: string) => void,
): Promise<string> {
  const { Bond, CreateBondRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );

  onStep?.("Deploying security…");

  // CreateBondRequest's constructor type does not match what the runtime requires;
  // toBondParams() produces the shape that works. See FRICTION.md #5, #7 and #8.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (await Bond.create(new CreateBondRequest(params as any))) as any;

  const securityId = idOf(res?.security?.diamondAddress);
  if (!securityId) throw new Error("no security id returned");
  onStep?.(`Deployed ${securityId}`);

  await grantOperationalRoles(securityId, ownerAccountId, (label) =>
    onStep?.(`Granted ${label}`),
  );

  onStep?.("Minting the unit…");
  await issue(securityId, ownerAccountId, "1");
  onStep?.("Done");

  return securityId;
}

/** Moves the receivable to a funder. */
export async function transfer(
  securityId: string,
  targetId: string,
  amount: string,
): Promise<TxResult> {
  const { Security, TransferRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );
  return asResult(
    await Security.transfer(
      new TransferRequest({ securityId, targetId, amount }),
    ),
  );
}

/** Halts all transfers. Used when a receivable is disputed. */
export async function pause(securityId: string): Promise<TxResult> {
  const { Security, PauseRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );
  return asResult(await Security.pause(new PauseRequest({ securityId })));
}

/** `UnpauseRequest` is not exported; `PauseRequest` carries the same shape. FRICTION.md #9. */
export async function unpause(securityId: string): Promise<TxResult> {
  const { Security, PauseRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );
  return asResult(await Security.unpause(new PauseRequest({ securityId })));
}

/** Redeems the receivable at maturity — the client has paid, the funder is made whole. */
export async function redeemAtMaturity(
  securityId: string,
  sourceId: string,
): Promise<TxResult> {
  const { Bond, FullRedeemAtMaturityRequest } = await import(
    "@hashgraph/asset-tokenization-sdk"
  );
  return asResult(
    await Bond.fullRedeemAtMaturity(
      new FullRedeemAtMaturityRequest({ securityId, sourceId }),
    ),
  );
}

export const hashscan = {
  contract: (id: string) => `https://hashscan.io/testnet/contract/${id}`,
  account: (id: string) => `https://hashscan.io/testnet/account/${id}`,
  topic: (id: string) => `https://hashscan.io/testnet/topic/${id}`,
};