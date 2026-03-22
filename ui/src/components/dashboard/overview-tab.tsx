'use client';

import { Globe, Clock, List, Monitor } from 'lucide-react';
import { motion } from 'framer-motion';

interface OverviewTabProps {
  selectedBrowser: string | null;
  liveFrameSrc: string | null;
  liveFps: string;
  infoUrl: string;
  infoSession: string;
  infoTabs: string;
}

export default function OverviewTab({
  selectedBrowser,
  liveFrameSrc,
  liveFps,
  infoUrl,
  infoSession,
  infoTabs,
}: OverviewTabProps) {
  if (!selectedBrowser) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <Monitor className="w-5 h-5 text-text-dim mb-3" />
        <p className="text-text-muted text-sm font-medium">Select a browser to view live feed</p>
        <p className="text-text-dim text-xs mt-1">Choose from the sidebar or connect a new browser</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-4 p-6"
    >
      {/* Live View */}
      <div className="relative rounded-lg border border-border bg-bg-card overflow-hidden aspect-video">
        {liveFrameSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={liveFrameSrc}
            alt="Live browser view"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-bg flex items-center justify-center">
                <Monitor className="w-5 h-5 text-text-dim" />
              </div>
              <p className="text-text-dim text-xs">Connecting live view...</p>
            </div>
          </div>
        )}
        {liveFps && (
          <div className="absolute top-2 right-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent font-mono">
            {liveFps}
          </div>
        )}
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-bg-card p-4 hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-text-dim shrink-0" />
            <span className="text-xs font-medium text-text-dim uppercase tracking-wider">URL</span>
          </div>
          <p className="text-sm text-text truncate font-mono" title={infoUrl}>{infoUrl}</p>
        </div>
        <div className="rounded-lg border border-border bg-bg-card p-4 hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-text-dim shrink-0" />
            <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Session</span>
          </div>
          <p className="text-2xl font-bold text-text font-mono">{infoSession}</p>
        </div>
        <div className="rounded-lg border border-border bg-bg-card p-4 hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <List className="w-4 h-4 text-text-dim shrink-0" />
            <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Tabs</span>
          </div>
          <p className="text-2xl font-bold text-text font-mono">{infoTabs}</p>
        </div>
      </div>
    </motion.div>
  );
}
