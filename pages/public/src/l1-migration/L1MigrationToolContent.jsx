import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { useAsyncCallback } from 'react-async-hook';
import { bulkSendRawTransactions } from '@helium/spl-utils';
import { Connection, PublicKey } from '@solana/web3.js';
import Address from '@helium/address';
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

const MIGRATION_SERVICE_URL = import.meta.env.VITE_MIGRATION_SERVICE_URL || 'https://migration.web.helium.io';
const SOLANA_URL = import.meta.env.VITE_SOLANA_URL || 'https://solana-rpc.web.helium.io/?session-key=Pluto';

function StatusBanner({ type, message }) {
    if (!message) return null;

    const config = {
        success: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800', Icon: CheckCircleIcon },
        error: { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-800', Icon: ExclamationTriangleIcon },
        info: { bg: 'bg-sky-50 border-sky-200', text: 'text-sky-800', Icon: InformationCircleIcon },
    };

    const { bg, text, Icon } = config[type] || config.info;

    return (
        <div className={`flex gap-3 rounded-lg border p-4 ${bg}`}>
            <Icon className={`h-5 w-5 shrink-0 ${text}`} />
            <p className={`text-sm ${text}`}>{message}</p>
        </div>
    );
}

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
        try {
            async function getTxs() {
                return (await axios.get(`${MIGRATION_SERVICE_URL}/migrate/${wallet.toBase58()}?limit=1000`)).data;
            }
            const txs = (await getTxs()).transactions;
            if (!txs || txs.length === 0) {
                setStatus({ type: 'info', message: "No transactions found to migrate." });
                return true;
            }

            const txBuffers = txs.map((tx) => Buffer.from(tx, 'base64'));
            await bulkSendRawTransactions(connection, txBuffers);

            const txs2 = (await getTxs()).transactions;
            if (txs2.length !== 0) {
                throw new Error(`Failed to migrate ${txs2.length} transactions, try again`);
            }

            setStatus({ type: 'success', message: "Migration successful!" });
            return true;
        } catch (e) {
            throw e;
        }
    });

    return (
        <div className="space-y-6">
            {(errorInflate || status) && (
                <StatusBanner type={errorInflate ? 'error' : status?.type} message={errorInflate?.message || status?.message} />
            )}

            {/* Input Section */}
            <div>
                <label htmlFor="wallet" className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2 block">
                    Wallet Address
                </label>
                <input
                    type="text"
                    name="wallet"
                    id="wallet"
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    placeholder="Enter Helium or Solana address..."
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                />
            </div>

            {/* Address Display */}
            <div className="grid gap-px bg-slate-200 rounded-xl overflow-hidden">
                <div className="bg-white p-4">
                    <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-1">Helium Address</p>
                    <p className="font-mono text-sm text-slate-900 break-all">{heliumWallet?.b58 || '—'}</p>
                </div>
                <div className="bg-white p-4">
                    <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-1">Solana Address</p>
                    {solanaWallet ? (
                        <a
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-sm text-sky-600 hover:text-sky-500 break-all"
                            href={`https://explorer.solana.com/address/${solanaWallet.toBase58()}`}
                        >
                            {solanaWallet.toBase58()}
                            <ArrowRightIcon className="h-3 w-3 shrink-0 -rotate-45" />
                        </a>
                    ) : (
                        <p className="font-mono text-sm text-slate-400">—</p>
                    )}
                </div>
            </div>

            {/* Action Button */}
            <button
                disabled={!solanaWallet || loadingInflate}
                onClick={() => executeInflate(solanaWallet)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {loadingInflate ? 'Submitting...' : 'Seed Wallet'}
            </button>
        </div>
    );
};

export default L1MigrationToolContent;
