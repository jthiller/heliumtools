import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";

// RPC endpoint for every wallet-connected tool. Set `VITE_SOLANA_URL` at build
// time: a Cloudflare Pages build environment variable in production,
// `.env.development` locally (both gitignored, see `.env.example`).
//
// This is NOT a secret and the variable does not make it one. Vite inlines
// every `VITE_*` value into the client bundle at build time, so whatever
// endpoint is configured here is readable by anyone who opens the shipped JS.
// The point of the variable is that the URL is no longer in source control and
// can be swapped per environment without a code change. If the endpoint carries
// an API key, restrict that key by origin at the provider — that, not this
// indirection, is what stops someone else from spending it.
const FALLBACK_RPC_URL = "https://api.mainnet-beta.solana.com";
const RPC_URL = import.meta.env.VITE_SOLANA_URL || FALLBACK_RPC_URL;

if (!import.meta.env.VITE_SOLANA_URL) {
  // Degrade rather than white-screen every wallet tool, but say so loudly: the
  // public RPC is aggressively rate limited, so balance reads and sends will be
  // flaky under any real use.
  console.warn(
    "VITE_SOLANA_URL is not set; falling back to the public Solana RPC. Wallet reads and transaction sends will be rate limited.",
  );
}

export default function SolanaProvider({ children }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
