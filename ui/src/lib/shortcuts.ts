'use client';

import { useEffect } from 'react';

export interface Shortcut {
  /** e.g. 'n', '/', 'Escape', 'mod+1', 'shift+?' — `mod` is ⌘ on Mac and Ctrl elsewhere. */
  keys: string;
  label: string;
  /** Group shown in the help sheet. */
  group: 'Fleet' | 'Browser' | 'Navigate';
  /** Fire even while an input is focused (Escape usually wants this). */
  global?: boolean;
  handler: (e: KeyboardEvent) => void;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function matches(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.toLowerCase().split('+');
  const key = parts.pop()!;
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (wantMod !== mod) return false;
  if (wantAlt !== e.altKey) return false;
  // '?' already implies shift on most layouts; do not require it twice.
  if (wantShift && !e.shiftKey && key !== '?') return false;
  const pressed = e.key.toLowerCase();
  if (key === 'escape') return pressed === 'escape';
  if (key === 'enter') return pressed === 'enter';
  if (key === 'up') return pressed === 'arrowup';
  if (key === 'down') return pressed === 'arrowdown';
  return pressed === key;
}

const EDITABLE = /^(input|textarea|select)$/i;

/**
 * One listener for the whole console. Keys typed into a field stay in the
 * field unless the binding says `global`; the live view marks itself with
 * data-captures-keys so its own keyboard handling wins while it has focus.
 */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && (EDITABLE.test(target.tagName) || target.isContentEditable);
      const captured = !!target?.closest?.('[data-captures-keys]');
      // While the live view holds the keyboard, every key is the browser's —
      // including Escape, which it uses to hand the keyboard back.
      if (captured) return;
      for (const s of shortcuts) {
        if (!matches(e, s.keys)) continue;
        if (inField && !s.global) return;
        e.preventDefault();
        s.handler(e);
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcuts, enabled]);
}

/** How a binding reads on a key cap: 'mod+1' → ['⌘', '1'] or ['Ctrl', '1']. */
export function keyCaps(keys: string): string[] {
  return keys.split('+').map((k) => {
    switch (k) {
      case 'mod': return IS_MAC ? '⌘' : 'Ctrl';
      case 'shift': return '⇧';
      case 'alt': return IS_MAC ? '⌥' : 'Alt';
      case 'escape': case 'Escape': return 'Esc';
      case 'enter': case 'Enter': return '↵';
      case 'up': return '↑';
      case 'down': return '↓';
      default: return k.length === 1 ? k.toUpperCase() : k;
    }
  });
}
