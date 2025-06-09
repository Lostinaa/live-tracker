'use client'

import dynamic from 'next/dynamic'

const RunnerTracker = dynamic(() => import('./RunnerTracker'), {
  ssr: false,
  loading: () => (
    <div className="h-screen flex items-center justify-center">
      <p className="text-xl">Loading map...</p>
    </div>
  ),
})

export default function ClientRunnerTracker() {
  return <RunnerTracker />
} 