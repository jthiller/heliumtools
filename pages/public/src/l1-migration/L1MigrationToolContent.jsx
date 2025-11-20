import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { useAsyncCallback } from 'react-async-hook';
import { bulkSendRawTransactions } from '@helium/spl-utils';
import { Connection, PublicKey } from '@solana/web3.js';
import Address from '@helium/address';
// import { ED25519_KEY_TYPE } from '@helium/address/build/KeyTypes'; // This might need adjustment based on export

const MIGRATION_SERVICE_URL = import.meta.env.VITE_MIGRATION_SERVICE_URL || 'https://migration.web.helium.io';
const SOLANA_URL = import.meta.env.VITE_SOLANA_URL || 'https://solana-rpc.web.helium.io/?session-key=Pluto';

export const L1MigrationToolContent = () => {
    const [wallet, setWallet] = useState("");
    const [status, setStatus] = useState(null); // { type: 'success' | 'error', message: string }

    const solanaWallet = useMemo(() => {
        try {
            return new PublicKey(wallet);
        } catch (e) {
            // ignore
            try {
                return new PublicKey(Address.fromB58(wallet).publicKey);
            } catch (e) {
                // ignore
            }
        }
    }, [wallet]);

    const heliumWallet = useMemo(
        () => {
            if (!solanaWallet) return null;
            try {
                // Address constructor: version, netType, keyType, publicKey
                // ED25519_KEY_TYPE is 1. 
                return new Address(0, 0, 1, solanaWallet.toBytes());
            } catch (e) {
                console.error("Error creating helium address", e);
                return null;
            }
        },
        [solanaWallet]
    );

    const connection = useMemo(
        () => new Connection(SOLANA_URL),
        []
    );

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

            // Fix: Decode base64 strings correctly
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
                <div className={`rounded-md p-4 ${status?.type === 'success' ? 'bg-green-50' : status?.type === 'info' ? 'bg-blue-50' : 'bg-red-50'}`}>
                    <div className="flex">
                        <div className="ml-3">
                            <h3 className={`text-sm font-medium ${status?.type === 'success' ? 'text-green-800' : status?.type === 'info' ? 'text-blue-800' : 'text-red-800'}`}>
                                {status?.type === 'success' ? 'Success' : status?.type === 'info' ? 'Info' : 'Error'}
                            </h3>
                            <div className={`mt-2 text-sm ${status?.type === 'success' ? 'text-green-700' : status?.type === 'info' ? 'text-blue-700' : 'text-red-700'}`}>
                                <p>{errorInflate?.message || status?.message}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div>
                <label htmlFor="wallet" className="block text-sm font-medium text-slate-700">
                    Helium or Solana Wallet Address
                </label>
                <div className="mt-1">
                    <input
                        type="text"
                        name="wallet"
                        id="wallet"
                        className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-md p-2 border"
                        placeholder="Enter address..."
                        value={wallet}
                        onChange={(e) => setWallet(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-md space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-slate-500">Helium Address:</span>
                    <span className="font-mono text-slate-900 break-all">{heliumWallet?.b58 || '-'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-slate-500">Solana Address:</span>
                    <span className="font-mono text-slate-900 break-all">
                        {solanaWallet ? (
                            <a
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-600 hover:text-indigo-500"
                                href={`https://explorer.solana.com/address/${solanaWallet.toBase58()}`}
                            >
                                {solanaWallet.toBase58()}
                            </a>
                        ) : '-'}
                    </span>
                </div>
            </div>

            <button
                disabled={!solanaWallet || loadingInflate}
                onClick={() => executeInflate(solanaWallet)}
                className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white 
            ${!solanaWallet || loadingInflate ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'}`}
            >
                {loadingInflate ? 'Submitting...' : 'Seed Wallet'}
            </button>
        </div>
    );
};

export default L1MigrationToolContent;
