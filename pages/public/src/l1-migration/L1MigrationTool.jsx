import React, { Suspense } from 'react';
import Header from '../components/Header';

const L1MigrationToolContent = React.lazy(() => import('./L1MigrationToolContent'));

export const L1MigrationTool = () => {
    return (
        <div className="min-h-screen bg-surface">
            <Header breadcrumb="L1 Migration" />
            <main className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
                {/* Page Header */}
                <div className="mb-10">
                    <p className="text-[13px] font-mono font-medium uppercase tracking-[0.08em] text-accent-text mb-2">
                        L1 Migration
                    </p>
                    <h1 className="text-3xl sm:text-4xl font-display font-bold text-content tracking-[-0.03em] mb-4">
                        Wallet Migration Tool
                    </h1>
                    <p className="text-lg text-content-secondary">
                        This tool is for accounts from the Helium L1 Blockchain which may not have been accessed after the migration to Solana in April 2023.
                    </p>
                </div>

                {/* Content */}
                <Suspense fallback={
                    <div className="text-sm text-content-tertiary">Loading migration tools...</div>
                }>
                    <L1MigrationToolContent />
                </Suspense>
            </main>
        </div>
    );
};

export default L1MigrationTool;
