'use client';

import { useState, useMemo } from 'react';
import { Copy, Check, Server, Globe } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from './toast';

interface McpTabProps {
  selectedBrowser: string | null;
  apiKey: string;
}

export default function McpTab({ selectedBrowser, apiKey }: McpTabProps) {
  const toast = useToast();
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

  const config = useMemo(() => {
    const baseUrl = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : API_URL;
    const browserUrl = selectedBrowser ? `${baseUrl}/mcp/${selectedBrowser}` : 'Select a browser';
    const poolUrl = `${baseUrl}/mcp/pool`;
    const authEntry = apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {};

    const browserConfig = selectedBrowser
      ? JSON.stringify({ mcpServers: { 'oya-browser': { url: browserUrl, transport: 'streamable-http', ...authEntry } } }, null, 2)
      : '// Select a browser first';
    const poolConfig = JSON.stringify({ mcpServers: { 'oya-browser-pool': { url: poolUrl, transport: 'streamable-http', ...authEntry } } }, null, 2);

    return { browserUrl, poolUrl, browserConfig, poolConfig };
  }, [selectedBrowser, apiKey, API_URL]);

  const copySection = (key: string, text: string) => {
    if (text.startsWith('//')) return;
    navigator.clipboard.writeText(text);
    setCopiedSection(key);
    toast('Copied!', 'success');
    setTimeout(() => setCopiedSection(null), 1500);
  };

  const CopyButton = ({ sectionKey, text }: { sectionKey: string; text: string }) => (
    <button
      onClick={() => copySection(sectionKey, text)}
      className="h-9 px-3 rounded-md text-sm font-medium text-text-muted hover:bg-white/5 hover:text-text transition-colors flex items-center gap-1.5"
    >
      {copiedSection === sectionKey ? (
        <>
          <Check className="w-4 h-4 text-accent" />
          <span className="text-accent text-xs">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" />
          <span className="text-xs">Copy</span>
        </>
      )}
    </button>
  );

  const sections = [
    {
      key: 'browser-endpoint',
      title: 'Per-Browser MCP Endpoint',
      icon: Globe,
      showUrl: true,
      url: config.browserUrl,
      code: null,
    },
    {
      key: 'pool-endpoint',
      title: 'Pool MCP Endpoint',
      icon: Server,
      showUrl: true,
      url: config.poolUrl,
      code: null,
    },
    {
      key: 'cursor',
      title: 'Cursor (.cursor/mcp.json)',
      icon: null,
      showUrl: false,
      url: null,
      code: config.browserConfig,
    },
    {
      key: 'claude',
      title: 'Claude Desktop (config)',
      icon: null,
      showUrl: false,
      url: null,
      code: selectedBrowser ? config.browserConfig : config.poolConfig,
    },
    {
      key: 'windsurf',
      title: 'Windsurf',
      icon: null,
      showUrl: false,
      url: null,
      code: selectedBrowser ? config.browserConfig : config.poolConfig,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="p-6 space-y-4 overflow-y-auto"
    >
      {sections.map(section => (
        <div key={section.key} className="rounded-lg border border-border bg-bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              {section.icon && <section.icon className="w-4 h-4 text-text-dim shrink-0" />}
              <span className="text-sm font-medium text-text-muted">{section.title}</span>
            </div>
            <CopyButton sectionKey={section.key} text={(section.url || section.code) ?? ''} />
          </div>
          <div className="p-4">
            {section.showUrl && section.url ? (
              <input
                type="text"
                readOnly
                value={section.url}
                className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
              />
            ) : (
              <pre className="rounded-lg bg-bg border border-border p-4 text-sm font-mono text-text-muted overflow-x-auto whitespace-pre leading-relaxed">
                {section.code}
              </pre>
            )}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
