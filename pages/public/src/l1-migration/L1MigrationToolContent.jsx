import React, { useMemo, useState } from 'react';
import { useAsyncCallback } from 'react-async-hook';
import { bulkSendRawTransactions } from '@helium/spl-utils';
import { Connection, PublicKey } from '@solana/web3.js';
import Address from '@helium/address';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import StatusBanner from '../components/StatusBanner.jsx';

const MIGRATION_SERVICE_URL = import.meta.env.VITE_MIGRATION_SERVICE_URL || 'https://migration.web.helium.io';
const SOLANA_URL = import.meta.env.VITE_SOLANA_URL || 'https://solana-rpc.web.helium.io/?session-key=Pluto';

export const L1MigrationToolContent = () => {
    const [wallet, setWallet] = useState("");
    const [status, setStatus] = useState(null);

    const solanaWallet = useMemo(() => {
        try {
            return new PublicKey(wallet);
        } catch (e) {
            try {
                return new PublicKey(Address.fromB58(wallet).publicKey);
            } catch (e) {
                return null;
            }
        }
    }, [wallet]);

    const heliumWallet = useMemo(() => {
        if (!solanaWallet) return null;
        try {
            return new Address(0, 0, 1, solanaWallet.toBytes());
        } catch (e) {
            console.error("Error creating helium address", e);
            return null;
        }
    }, [solanaWallet]);

    const connection = useMemo(() => new Connection(SOLANA_URL), []);

    const {
        execute: executeInflate,
        error: errorInflate,
        loading: loadingInflate,
    } = useAsyncCallback(async (wallet) => {
        setStatus(null);
        async function getTxs() {
            const res = await fetch(`${MIGRATION_SERVICE_URL}/migrate/${wallet.toBase58()}?limit=1000`);
            if (!res.ok) throw new Error(`Migration service error: ${res.status}`);
            return res.json();
        }
        const txs = (await getTxs()).transactions;
        if (!txs || txs.length === 0) {
            setStatus({ tone: 'info', message: "No transactions found to migrate." });
            return true;
        }

        const txBuffers = txs.map((tx) => Buffer.from(tx, 'base64'));
        await bulkSendRawTransactions(connection, txBuffers);

        const txs2 = (await getTxs()).transactions;
        if (txs2.length !== 0) {
            throw new Error(`Failed to migrate ${txs2.length} transactions, try again`);
        }

        setStatus({ tone: 'success', message: "Migration successful!" });
        return true;
    });

    // Determine the banner to show
    const bannerTone = errorInflate ? 'error' : status?.tone;
    const bannerMessage = errorInflate?.message || status?.message;

    return (
        <div className="space-y-6">
            {bannerMessage && <StatusBanner tone={bannerTone} message={bannerMessage} />}

            {/* Input Section */}
            <div>
                <label htmlFor="wallet" className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-2 block">
                    Wallet Address
                </label>
                <input
                    type="text"
                    name="wallet"
                    id="wallet"
                    className="block w-full rounded-lg border border-border bg-surface-inset px-4 py-3 text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    placeholder="Enter Helium or Solana address..."
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                />
            </div>

            {/* Address Display */}
            <div className="grid gap-px bg-border rounded-xl overflow-hidden">
                <div className="bg-surface-raised p-4">
                    <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">Helium Address</p>
                    <p className="font-mono text-sm text-content break-all">{heliumWallet?.b58 || '—'}</p>
                </div>
                <div className="bg-surface-raised p-4">
                    <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">Solana Address</p>
                    {solanaWallet ? (
                        <a
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-sm text-accent-text hover:opacity-80 break-all"
                            href={`https://explorer.solana.com/address/${solanaWallet.toBase58()}`}
                        >
                            {solanaWallet.toBase58()}
                            <ArrowRightIcon className="h-3 w-3 shrink-0 -rotate-45" />
                        </a>
                    ) : (
                        <p className="font-mono text-sm text-content-tertiary">—</p>
                    )}
                </div>
            </div>

            {/* Action Button */}
            <button
                disabled={!solanaWallet || loadingInflate}
                onClick={() => executeInflate(solanaWallet)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {loadingInflate ? 'Submitting...' : 'Seed Wallet'}
            </button>
        </div>
    );
};

export default L1MigrationToolContent;
