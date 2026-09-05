import { useState } from "react";
import {
  Network,
  InitializationRequest,
  ConnectRequest,
  SupportedWallets,
} from "@hashgraph/asset-tokenization-sdk";

const RESOLVER = "0.0.9212226";
const FACTORY = "0.0.9213391";

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
      const config = {
        ...NETWORK_CONFIG,
        configuration: { resolverAddress: RESOLVER, factoryAddress: FACTORY },
      };

      await Network.init(
        new InitializationRequest({
          ...NETWORK_CONFIG,
          configuration: { resolverAddress: RESOLVER, factoryAddress: FACTORY },
        }),
      );
      say("Network initialised");

      const wallet = await Network.connect(
        new ConnectRequest({
          ...NETWORK_CONFIG,
          wallet: SupportedWallets.METAMASK,
        }),
      );
      say(`Connected: ${JSON.stringify(wallet)}`);
      // connect mereset configuration — pasang ulang
      await Network.init(new InitializationRequest(config));
      say("Configuration re-applied");

      setAccount("connected");
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
        countries: "",
        info: "",

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

  return (
    <div style={{ fontFamily: "monospace", padding: 24, lineHeight: 1.6 }}>
      <h1>Forfait — ATS smoke test</h1>
      <button onClick={connect}>1. Connect MetaMask</button>{" "}
      <button onClick={createBond} disabled={!account}>
        2. Create bond
      </button>
      <pre style={{ marginTop: 24, whiteSpace: "pre-wrap" }}>
        {log.join("\n")}
      </pre>
    </div>
  );
}
