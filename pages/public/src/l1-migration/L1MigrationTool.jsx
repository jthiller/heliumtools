import React, { Suspense } from 'react';
import Header from '../components/Header';

const L1MigrationToolContent = React.lazy(() => import('./L1MigrationToolContent'));

export const L1MigrationTool = () => {
    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <Header />
            <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                <div className="bg-white shadow sm:rounded-lg">
                    <div className="px-4 py-5 sm:p-6">
                        <h3 className="text-lg leading-6 font-medium text-slate-900">
                            L1 Migration Tool
                        </h3>
                        <div className="mt-2 max-w-xl text-sm text-slate-500">
                            <p>
                                This tool is for accounts from the Helium L1 Blockchain which may not have been accessed after the migration to Solana.
                            </p>
                        </div>
                        <div className="mt-5">
                            <Suspense fallback={<div className="text-slate-500">Loading migration tools...</div>}>
                                <L1MigrationToolContent />
                            </Suspense>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default L1MigrationTool;
