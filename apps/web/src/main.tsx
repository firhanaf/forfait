// apps/web/src/main.tsx
//
// reflect-metadata must be imported before anything that pulls in the ATS SDK — it
// decorates its request classes at module load, and loading it late throws with a
// message about metadata that names nothing useful.
import 'reflect-metadata';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';

import App from './App.tsx';
import { hederaTestnet } from './lib/chains';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        defaultChain: hederaTestnet,
        supportedChains: [hederaTestnet],
        loginMethods: ['email'],
        embeddedWallets: { ethereum: { createOnLogin: 'all-users' } },
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
);

