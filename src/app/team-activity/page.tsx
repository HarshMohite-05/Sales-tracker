'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import DirectorAnalysis from '@/components/dashboard/DirectorAnalysis';

export default function TeamActivityPage() {
  const router = useRouter();
  const [isDirector, setIsDirector] = useState(false);

  // Team activity is for directors only; anyone else goes back to their dashboard
  useEffect(() => {
    fetch('/api/auth/me')
      .then((response) => response.json())
      .then((data) => (data.user?.role === 'DIRECTOR' ? setIsDirector(true) : router.replace('/dashboard')))
      .catch(() => router.replace('/dashboard'));
  }, [router]);

  return (
    <AppShell theme="dark">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Team Activity</h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Work done by each salesperson in the chosen period</p>
        </div>
        {isDirector && <DirectorAnalysis />}
      </div>
    </AppShell>
  );
}
