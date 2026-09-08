// apps/web/src/lib/chains.ts
//
// Hedera testnet as an EVM chain, for Privy.
//
// Defined explicitly rather than imported from viem/chains so the RPC endpoint is the
// same JSON-RPC relay the rest of the app already uses. Two different relays for the
// same network is the kind of thing that works until it doesn't.

import { defineChain } from 'viem';

export const hederaTestnet = defineChain({
  id: 296,
  name: 'Hedera Testnet',
  network: 'hedera-testnet',
  nativeCurrency: {
    // HBAR is eight decimals natively — a tinybar. The JSON-RPC relay presents it as
    // eighteen, so EVM tooling sees weibars and 1 HBAR is 10^18. Getting this wrong
    // sends a transfer off by ten orders of magnitude.
    decimals: 18,
    name: 'HBAR',
    symbol: 'HBAR',
  },
  rpcUrls: {
    default: { http: ['https://testnet.hashio.io/api'] },
  },
  blockExplorers: {
    default: { name: 'HashScan', url: 'https://hashscan.io/testnet' },
  },
  testnet: true,
});
