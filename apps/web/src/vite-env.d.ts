/// <reference types="vite/client" />

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface Window {
  ethereum?: EthereumProvider;
}

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}