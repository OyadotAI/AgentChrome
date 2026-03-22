'use client';

import { useRef, useEffect } from 'react';
import { Send, Loader2, MessageSquare, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string }[];
}

interface ChatTabProps {
  selectedBrowser: string | null;
  chatHistory: ChatMessage[];
  chatInput: string;
  setChatInput: (val: string) => void;
  chatSending: boolean;
  onSendMessage: () => void;
}

export default function ChatTab({
  selectedBrowser,
  chatHistory,
  chatInput,
  setChatInput,
  chatSending,
  onSendMessage,
}: ChatTabProps) {
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [chatHistory, chatSending]);

  if (!selectedBrowser) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <MessageSquare className="w-5 h-5 text-text-dim mb-3" />
        <p className="text-text-muted text-sm font-medium">Select a browser to start chatting</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full"
    >
      {/* Messages */}
      <div
        ref={messagesRef}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-3"
      >
        {chatHistory.length === 0 && !chatSending && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="w-5 h-5 text-text-dim mb-2" />
            <p className="text-text-muted text-sm font-medium">Ask me to do something...</p>
            <p className="text-text-dim text-xs mt-1">I can navigate, click, type, and more</p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {chatHistory.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.12 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-500 text-white rounded-br-sm'
                    : 'rounded-lg border border-border bg-bg-card text-text rounded-bl-sm'
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {msg.toolCalls.map((t, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-500/10 text-indigo-400"
                      >
                        <Wrench className="w-3 h-3 mr-1" />
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {chatSending && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="rounded-lg border border-border bg-bg-card rounded-bl-sm px-4 py-2.5">
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                Thinking...
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Input Bar */}
      <div className="border-t border-border bg-bg-card px-6 py-4">
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
            placeholder="Ask me to do something in the browser..."
            spellCheck={false}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSendMessage();
              }
            }}
          />
          <button
            disabled={chatSending || !chatInput.trim()}
            onClick={onSendMessage}
            className="h-9 px-4 rounded-md bg-accent text-neutral-950 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {chatSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
