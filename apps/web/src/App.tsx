import { useState } from "react";
import {
  Network,
  InitializationRequest,
  ConnectRequest,
  SupportedWallets,
} from "@hashgraph/asset-tokenization-sdk";

const RESOLVER = "0.0.9212226";
const FACTORY = "0.0.9213391";

const BOND_ID = "0.0.10373584";
const FUNDER_ID = "0.0.10377457";
const ISSUER_ID = "0.0.10085748";

const NETWORK_CONFIG = {
  network: "testnet" as const,
  mirrorNode: {
    baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/",
    apiKey: "",
    headerName: "",
  },
  rpcNode: {
    baseUrl: "https://testnet.hashio.io/api",
    apiKey: "",
    headerName: "",
  },
};

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [account, setAccount] = useState<string>("");

  const say = (msg: string) => setLog((prev) => [...prev, msg]);

  // ── 1. Init + connect MetaMask
 async function connect() {
  try {
    await Network.init(new InitializationRequest({
      ...NETWORK_CONFIG,
      configuration: { resolverAddress: RESOLVER, factoryAddress: FACTORY },
    }));
    say('Network initialised');

    const wallet = await Network.connect(new ConnectRequest({
      ...NETWORK_CONFIG,
      wallet: SupportedWallets.METAMASK,
      account: {
        accountId: ISSUER_ID,
        evmAddress: '0xf73bf13d1d76ec352ddb44ea0427bafa7658c012',
      },
    }));
    say(`Connected: ${JSON.stringify(wallet)}`);

    // connect() menghapus konfigurasi yang disetel init(), dan init() menghapus akun
    // yang disetel connect(). setConfig() memulihkan konfigurasi tanpa menyentuh akun.
    //
    // SetConfigurationRequest tidak di-export dari index paket, dan field "exports"
    // di package.json memblokir impor jalur dalam — jadi kelasnya tidak bisa diakses
    // konsumen sama sekali. setConfig() hanya membaca dua properti dan memanggil
    // validate(), jadi objek ini memenuhi kontraknya.
    await Network.setConfig({
      factoryAddress: FACTORY,
      resolverAddress: RESOLVER,
      validate: () => [],
    } as any);

    say(`Config: factory=${await Network.getFactoryAddress()} resolver=${await Network.getResolverAddress()}`);
    setAccount('connected');
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

  return (
    <div style={{ fontFamily: "monospace", padding: 24, lineHeight: 1.6 }}>
      <h1>Forfait — ATS smoke test</h1>
      <button onClick={connect}>1. Connect MetaMask</button>{" "}
      <button onClick={readBond} disabled={!account}>
        2. Read bond
      </button>{" "}
      <button onClick={issueUnits} disabled={!account}>
        3. Issue
      </button>{" "}
      <button onClick={transferToFunder} disabled={!account}>
        4. Transfer
      </button>
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
