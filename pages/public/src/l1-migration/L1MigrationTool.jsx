import React, { Suspense } from 'react';
import Header from '../components/Header';

const L1MigrationToolContent = React.lazy(() => import('./L1MigrationToolContent'));

export const L1MigrationTool = () => {
    return (
        <div className="min-h-screen bg-white">
            <Header />
            <main className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
                {/* Page Header */}
                <div className="mb-10">
                    <p className="text-sm font-mono uppercase tracking-widest text-sky-600 mb-2">
                        L1 Migration
                    </p>
                    <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
                        Helium L1 Migration Tool
                    </h1>
                    <p className="text-lg text-slate-600">
                        This tool is for accounts from the Helium L1 Blockchain which may not have been accessed after the migration to Solana in April 2023.
                    </p>
                </div>

                {/* Content */}
                <Suspense fallback={
                    <div className="text-sm text-slate-500">Loading migration tools...</div>
                }>
                    <L1MigrationToolContent />
                </Suspense>
            </main>
        </div>
    );
};

export default L1MigrationTool;
