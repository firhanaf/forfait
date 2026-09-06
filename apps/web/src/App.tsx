import { useState } from "react";
import {
  Network,
  InitializationRequest,
  ConnectRequest,
  SupportedWallets,
} from "@hashgraph/asset-tokenization-sdk";

const RESOLVER = '0.0.9212226';
const FACTORY  = '0.0.9213391';
const NETWORK  = 'testnet';

const MIRROR_NODE = { baseUrl: 'https://testnet.mirrornode.hedera.com/api/v1/', apiKey: '', headerName: '' };
const RPC_NODE    = { baseUrl: 'https://testnet.hashio.io/api',                 apiKey: '', headerName: '' };

const NETWORK_CONFIG = {
  network: NETWORK as const,
  mirrorNode: MIRROR_NODE,
  rpcNode: RPC_NODE,
};


// Bentuk jamak — inilah yang benar-benar dibaca SDK.
// `configuration` sendirian menghasilkan factoryId/resolverId kosong.
const FULL_CONFIG = {
  ...NETWORK_CONFIG,
  configuration:  { factoryAddress: FACTORY, resolverAddress: RESOLVER },
  mirrorNodes:    { nodes: [{ mirrorNode: MIRROR_NODE, environment: NETWORK }] },
  jsonRpcRelays:  { nodes: [{ jsonRpcRelay: RPC_NODE,  environment: NETWORK }] },
  factories:      { factories: [{ factory: FACTORY,   environment: NETWORK }] },
  resolvers:      { resolvers: [{ resolver: RESOLVER, environment: NETWORK }] },
};

const BOND_ID = "0.0.10373584";
const FUNDER_ID = "0.0.10377457";
const ISSUER_ID = "0.0.10085748";

const ROLES = {
  ISSUER:            '0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f',
  PAUSER:            '0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f',
  CONTROLLIST:       '0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d',
  MATURITY_REDEEMER: '0x433f48f8aca23480f6ab07666cbc9131d32a0b4672033453f65e18f4dd390523',
} as const;

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [account, setAccount] = useState<string>("");

  const say = (msg: string) => setLog((prev) => [...prev, msg]);

  // ── 1. Init + connect MetaMask
 async function connect() {
  try {
    const eth = (window as any).ethereum;
    if (!eth) { say('MetaMask tidak ditemukan'); return; }

    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    say(`MetaMask: ${accounts[0]}`);

    const walletEvents = {
      walletFound: (e: any) => console.log('walletFound', e),
      walletConnectionStatusChanged: (e: any) => console.log('statusChanged', e),
      walletDisconnect: (e: any) => console.log('disconnect', e),
      walletPaired: (e: any) => {
        console.log('walletPaired', e);
        const id = e?.data?.account?.id?.value;
        const net = e?.network;
        say(`PAIRED: ${id} | factory=${net?.factoryId} resolver=${net?.resolverId}`);
        if (id && id !== '0.0.0') setAccount(id);
      },
    };

    await Network.init(new InitializationRequest({
      ...FULL_CONFIG,
      events: walletEvents,
    } as any));
    say('Network initialised');

    const wallet = await Network.connect(new ConnectRequest({
      ...NETWORK_CONFIG,
      wallet: SupportedWallets.METAMASK,
    }));
    say(`Connected: ${JSON.stringify(wallet)}`);
  } catch (e) {
    say(`ERROR ${String(e)}`);
    console.error(e);
  }
}

  // ── 2. Terbitkan bond
  async function createBond() {
    try {
      const { Bond, CreateBondRequest } =
        await import("@hashgraph/asset-tokenization-sdk");

      const now = Date.now();
      const start = now + 5 * 60 * 1000;
      const maturity = start + 60 * 24 * 60 * 60 * 1000;

      const request = new CreateBondRequest({
        name: "Forfait Test Receivable",
        symbol: "FRF01",
        isin: "US9311421039", // ISIN valid dari dokumentasi — lihat catatan di bawah
        decimals: 0,

        isWhiteList: false,
        erc20VotesActivated: false,
        isControllable: true, // perlu untuk forced transfer / compliance nanti
        arePartitionsProtected: false,
        isMultiPartition: false,
        clearingActive: false,
        internalKycActivated: false, // matikan dulu untuk smoke test

        currency: "0x555344", // 'USD'
        numberOfUnits: "1",
        nominalValue: "2000",
        nominalValueDecimals: 2,
        startingDate: String(start),
        maturityDate: String(maturity),
        regulationType: 1,
        regulationSubType: 0,

        diamondOwnerAccount: "0.0.10085748", // hedera account
        externalPausesIds: [],
        externalControlListsIds: [],
        externalKycListsIds: [],
        proceedRecipientsIds: [],
        proceedRecipientsData: [],
        countries: "ID,SG,MY,US,GB,FR,DE,JP,CN",
        info: "Forfait cross-border receivable",
        isCountryControlListWhiteList: false,

        configId:
          "0x0000000000000000000000000000000000000000000000000000000000000002",
        configVersion: 1,
      });

      const response = await Bond.create(request);
      say(`BOND CREATED: ${JSON.stringify(response)}`);
      console.log(response);
    } catch (e) {
      say(`ERROR ${String(e)}`);
      console.error(e);
    }
  }

  // ── 3. Baca detail bond
  async function readBond() {
    try {
      const { Security, GetSecurityDetailsRequest, GetSecurityHoldersRequest } =
        await import("@hashgraph/asset-tokenization-sdk");

      const info = await Security.getInfo(
        new GetSecurityDetailsRequest({ securityId: BOND_ID }),
      );
      say(
        `SUPPLY: ${JSON.stringify(info.totalSupply)} / ${JSON.stringify(info.maxSupply)}`,
      );

      const holders = await Security.getSecurityHolders(
        new GetSecurityHoldersRequest({
          securityId: BOND_ID,
          start: 0,
          end: 10,
        } as any),
      );
      say(`HOLDERS: ${JSON.stringify(holders)}`);
      console.log(info, holders);
      say(`SUPPLY: ${info.totalSupply} / ${info.maxSupply} | paused=${info.paused}`);
    } catch (e) {
      say(`ERROR ${String(e)}`);
      console.error(e);
    }
  }

  async function issueUnits() {
    try {
      const { Security, IssueRequest } =
        await import("@hashgraph/asset-tokenization-sdk");
      const res = await Security.issue(
        new IssueRequest({
          securityId: BOND_ID,
          targetId: ISSUER_ID,
          amount: "1",
        }),
      );
      say(`ISSUED: ${res.payload} tx=${res.transactionId}`);
    } catch (e) {
      say(`ERROR ${String(e)}`);
      console.error(e);
    }
  }

  async function transferToFunder() {
    try {
      const { Security, TransferRequest } =
        await import("@hashgraph/asset-tokenization-sdk");
      const res = await Security.transfer(
        new TransferRequest({
          securityId: BOND_ID,
          targetId: FUNDER_ID,
          amount: "1",
        }),
      );
      say(`TRANSFERRED: ${res.payload} tx=${res.transactionId}`);
    } catch (e) {
      say(`ERROR ${String(e)}`);
      console.error(e);
    }
  }

  async function pauseSecurity() {
  try {
    const { Security, PauseRequest } = await import('@hashgraph/asset-tokenization-sdk');
    const res = await Security.pause(new PauseRequest({ securityId: BOND_ID }));
    say(`PAUSED: ${JSON.stringify(res)}`);
  } catch (e) { say(`ERROR ${String(e)}`); console.error(e); }
}

async function unpauseSecurity() {
  try {
    const { Security, PauseRequest } = await import('@hashgraph/asset-tokenization-sdk');
    const res = await Security.unpause(new PauseRequest({ securityId: BOND_ID }));
    say(`UNPAUSED: ${JSON.stringify(res)}`);
  } catch (e) { say(`ERROR ${String(e)}`); console.error(e); }
}

async function grantRoles() {
  try {
    const { Role, RoleRequest } = await import('@hashgraph/asset-tokenization-sdk');

    for (const [label, role] of Object.entries(ROLES)) {
      const res = await Role.grantRole(new RoleRequest({
        securityId: BOND_ID,
        targetId: ISSUER_ID,
        role,
      }));
      say(`GRANTED ${label}: ${res.payload}`);
    }
  } catch (e) { say(`ERROR ${String(e)}`); console.error(e); }
}

  return (
    <div style={{ fontFamily: "monospace", padding: 24, lineHeight: 1.6 }}>
      <h1>Forfait — ATS smoke test</h1>
      <button onClick={connect}>1. Connect MetaMask</button>{" "}
      <button onClick={readBond} disabled={!account}>
        2. Read bond
      </button>{" "}
      <button onClick={grantRoles} disabled={!account}>
        2b. Grant roles
        </button>{" "}
      <button onClick={issueUnits} disabled={!account}>
        3. Issue
      </button>{" "}
      <button onClick={transferToFunder} disabled={!account}>
        4. Transfer
      </button>{" "}
      <button onClick={pauseSecurity} disabled={!account}>
        5. Pause
      </button>{" "}
      <button onClick={unpauseSecurity} disabled={!account}>
        6. Unpause
      </button>{" "}
      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", color: "#a00" }}>
          Buat bond baru (jangan disentuh)
        </summary>
        <button onClick={createBond} disabled={!account}>
          Create bond
        </button>
      </details>
      <pre style={{ marginTop: 24, whiteSpace: "pre-wrap" }}>
        {log.join("\n")}
      </pre>
    </div>
  );
}
