# Oya Brand Guidelines

## Identity

- **Name:** Oya
- **Tagline:** The runtime for AI employees
- **What it is:** An infrastructure platform that compiles natural language specifications into deterministic Python, executes agents in isolated sandboxes, and connects them to real communication channels
- **What it is NOT:** A chatbot framework, a no-code toy, a prompt wrapper

## Positioning

Oya sits at the infrastructure layer. It is to AI employees what a cloud runtime is to traditional software. Organizations use Oya to deploy AI agents that operate like real employees — deterministic, auditable, connected to the tools and channels where work happens.

## Audience

- Technical teams building autonomous AI agents for production
- Operations leaders replacing manual workflows with AI employees
- Developers who need reliable, repeatable agent execution (not prompt-loop chatbots)

## Voice

### We sound like

A sharp engineer explaining something at a whiteboard. Knows the material cold, respects the listener's time, skips the preamble, leads with what matters.

### Traits

| Trait | In practice |
|-------|------------|
| **Direct** | Lead with the action or outcome. No throat-clearing, no "so basically what we're going to do is..." |
| **Confident** | State facts. No hedging ("you might want to"), no qualifiers ("sort of," "kind of") |
| **Technical but clear** | Use precise terms — sandbox, gateway, skill, compile — but explain on first use for new audiences |
| **Outcome-driven** | Show what they'll achieve, not just what to click. "In 3 minutes you'll have a working agent" |
| **Warm, not corporate** | Approachable expert tone. "Let's build this" not "In this tutorial we will demonstrate" |

### We never sound like

- **Filler-heavy:** "um," "uh," "basically," "sort of," "you know"
- **Hedging:** "you might want to consider potentially..."
- **Hype:** "revolutionary," "game-changing," "cutting-edge AI"
- **Robotic:** "In this video we will demonstrate the following features and functionalities"
- **Over-explaining:** Don't narrate what's already visible on screen

## Terminology

| Always use | Instead of |
|-----------|-----------|
| AI employee | bot, assistant, agent (in marketing context) |
| Skill | tool, capability, function |
| Gateway | integration, connector, channel |
| Sandbox | environment, container, runtime |
| Compile | generate, build, create (when referring to spec-to-code) |
| Mission | description, purpose (when referring to agent objective) |
| Routine | cron job, scheduled task, automation |
| Trigger | webhook, event listener |

Note: "agent" is acceptable in technical/docs context (Agent Builder, agent ID). In marketing and video scripts, prefer "AI employee" when referring to what the user is building.

## Writing (General)

- Short sentences. Active voice.
- Lead with the outcome, follow with the method
- One idea per paragraph in docs
- Code examples over lengthy explanations
- If something can be shown, don't describe it

---

## Visual Identity

### Typography

| Role | Font | Fallbacks |
|------|------|-----------|
| **Body (sans)** | DM Sans | -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif |
| **Display (headings)** | Archivo Black (weight 400) | Impact, Haettenschweiler, Arial Black, sans-serif |
| **Monospace (code)** | Cascadia Code | Cascadia Mono, Source Code Pro, Menlo, Monaco, Consolas, Liberation Mono, monospace |

### Type Scale

| Token | Size | Line Height | Usage |
|-------|------|-------------|-------|
| `text-2xs` | 0.625rem (10px) | 1.4 | Badges, smallest labels |
| `text-caption` | 0.6875rem (11px) | 1.45 | Field labels, hints |
| `text-xs` | 0.75rem (12px) | — | Small UI text |
| `text-sm` | 0.875rem (14px) | — | Default UI text |
| `text-base` | 1rem (16px) | 1.65 | Body copy, chat |
| `h3` | 1.125rem (18px) | — | Subheadings |
| `h2` | 1.25rem (20px) | 1.3 | Section headings |
| `h1` | 1.5rem (24px) | 1.2 | Page headings |

### Icons

- **Library:** Lucide React
- **Style:** Functional, minimal
- **Cursor in videos:** 12px circle, brand primary color, ripple on click

---

## Color System

### Light Mode (`:root`)

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#f4f3ef` | Page background (warm beige) |
| `--foreground` | `#0c0c0a` | Primary text (warm near-black) |
| `--muted` | `#eceae4` | Muted backgrounds |
| `--muted-foreground` | `#72726a` | Secondary text |
| `--card` | `#ffffff` | Card backgrounds |
| `--card-foreground` | `#0c0c0a` | Card text |
| `--primary` | `#157a13` | Primary actions (forest green) |
| `--primary-foreground` | `#ffffff` | Text on primary |
| `--accent` | `#eceae4` | Accent backgrounds |
| `--accent-foreground` | `#0c0c0a` | Accent text |
| `--popover` | `#ffffff` | Popover backgrounds |
| `--popover-foreground` | `#0c0c0a` | Popover text |
| `--border` | `rgba(12,12,10,0.14)` | Borders |
| `--input` | `rgba(12,12,10,0.16)` | Input borders |
| `--ring` | `#157a13` | Focus rings |
| `--green-bright` | `#39ed35` | Bright green accents |
| `--green-surface` | `rgba(21,122,19,0.07)` | Green tinted backgrounds |
| `--green-border` | `rgba(21,122,19,0.18)` | Green tinted borders |
| `--surface-elevated` | `#ffffff` | Elevated surfaces |
| `--surface-sunken` | `#fafaf8` | Recessed surfaces |
| `--surface-3` | `#e2e0d8` | Tertiary surface |
| `--rule` | `rgba(12,12,10,0.07)` | Subtle dividers |
| `--ink-2` | `#1c1c18` | Secondary text |
| `--ink-3` | `#3a3a34` | Tertiary text |
| `--ink-5` | `#a8a89e` | Faint text |
| `--section-inverted` | `#0c0c0a` | Dark section bg |
| `--section-inverted-fg` | `#ffffff` | Dark section text |
| `--section-inverted-muted` | `rgba(255,255,255,0.42)` | Dark section muted text |
| `--section-inverted-border` | `rgba(255,255,255,0.07)` | Dark section borders |

### Dark Mode (`.dark`)

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#0c0c0a` | Page background (warm near-black) |
| `--foreground` | `rgba(255,255,255,0.88)` | Primary text |
| `--muted` | `#141410` | Muted backgrounds |
| `--muted-foreground` | `rgba(255,255,255,0.42)` | Secondary text |
| `--card` | `#1c1c18` | Card backgrounds |
| `--card-foreground` | `rgba(255,255,255,0.88)` | Card text |
| `--primary` | `#39ed35` | Primary actions (neon green) |
| `--primary-foreground` | `#0c0c0a` | Text on primary |
| `--accent` | `#242420` | Accent backgrounds |
| `--accent-foreground` | `rgba(255,255,255,0.88)` | Accent text |
| `--popover` | `#1c1c18` | Popover backgrounds |
| `--popover-foreground` | `rgba(255,255,255,0.88)` | Popover text |
| `--border` | `rgba(255,255,255,0.12)` | Borders |
| `--input` | `rgba(255,255,255,0.12)` | Input borders |
| `--ring` | `#39ed35` | Focus rings |
| `--green-bright` | `#39ed35` | Bright green accents |
| `--green-surface` | `rgba(57,237,53,0.1)` | Green tinted backgrounds |
| `--green-border` | `rgba(57,237,53,0.22)` | Green tinted borders |
| `--surface-elevated` | `#242420` | Elevated surfaces |
| `--surface-sunken` | `#141410` | Recessed surfaces |
| `--surface-3` | `#2c2c28` | Tertiary surface |
| `--rule` | `rgba(255,255,255,0.07)` | Subtle dividers |
| `--ink-2` | `rgba(255,255,255,0.62)` | Secondary text |
| `--ink-3` | `rgba(255,255,255,0.42)` | Tertiary text |
| `--ink-5` | `rgba(255,255,255,0.14)` | Faint text |
| `--section-inverted` | `#1c1c18` | Inverted section bg |
| `--section-inverted-fg` | `rgba(255,255,255,0.88)` | Inverted section text |
| `--section-inverted-muted` | `rgba(255,255,255,0.26)` | Inverted section muted |
| `--section-inverted-border` | `rgba(255,255,255,0.07)` | Inverted section borders |

### Semantic Colors

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--destructive` | `#b91c1c` | `#ff6b6b` | Errors, delete actions |
| `--destructive-foreground` | `#ffffff` | `#ffffff` | Text on destructive |
| `--warning` | `#92400e` | `#f5a623` | Warnings, caution |
| `--warning-foreground` | `#ffffff` | `#000000` | Text on warning |
| `--info` | `#1d4ed8` | `#6cb4ff` | Information, links |
| `--info-foreground` | `#ffffff` | `#ffffff` | Text on info |
| `--success` | `#157a13` | `#39ed35` | Success, confirmations |
| `--success-foreground` | `#ffffff` | `#0c0c0a` | Text on success |

---

## Radius System

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `3px` | Small elements (badges, tags) |
| `--radius-md` | `4px` | Medium elements (inputs, buttons) |
| `--radius-lg` | `8px` | Cards, containers |
| `--radius-xl` | `10px` | Large containers, modals |
| `full` | `9999px` | Pills |

---

## Effects & Aesthetic

### Glassmorphism

The Oya aesthetic uses subtle glassmorphism — backdrop blur on elevated surfaces:

| Effect | Value | Usage |
|--------|-------|-------|
| Backdrop blur (strong) | `backdrop-blur-[12px]` | Headers, elevated surfaces |
| Backdrop blur (subtle) | `backdrop-blur-sm` | Light overlays |
| Backdrop blur (minimal) | `backdrop-blur-[2px]` | Dialog overlays |
| Background opacity | `bg-background/95` | Translucent headers |
| Card opacity | `bg-card/80` | Semi-transparent cards |
| Overlay | `bg-foreground/10` | Dialog overlays |

### Noise Texture

A subtle fractal noise overlay on `body::after` adds texture:
- Light mode: `opacity: 0.022`
- Dark mode: `opacity: 0.032`

### Shadows

| Usage | Value |
|-------|-------|
| Card/modal | `0 8px 32px rgba(12,12,10,0.12)` |
| Button (ink) | `0 2px 8px rgba(12,12,10,0.18)` |
| Button (bright) | `0 2px 10px rgba(57,237,53,0.25)` |
| Status dot (green) | `0 0 6px rgba(57,237,53,0.55)` |
| Glow (green) | `0 0 40px -10px rgba(57,237,53,0.3)` |
| Glow (info) | `0 0 40px -10px rgba(74,158,255,0.3)` |
| Glow (warning) | `0 0 40px -10px rgba(245,166,35,0.3)` |
| Glow (destructive) | `0 0 40px -10px rgba(240,64,64,0.3)` |

### Gradients

| Usage | Value |
|-------|-------|
| Page subtle | `bg-gradient-to-b from-background via-background to-muted/10` |
| Green radial (bottom) | `radial-gradient(ellipse 70% 60% at 50% 100%, rgba(16,185,129,0.08), transparent 60%)` |
| Green radial (top) | `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(16,185,129,0.06), transparent)` |

---

## Animations

| Name | Keyframes | Usage |
|------|-----------|-------|
| `shimmer` | `translateX(-100%)` to `translateX(100%)` | Loading states |
| `fadeInUp` | `opacity: 0, translateY(8px)` to `opacity: 1, translateY(0)` | Element entry |
| Button press | `active:scale-[0.97]` | Tactile feedback |
| Dialog | `animate-in` / `animate-out` with zoom + slide | Modal open/close |

---

## Button Variants

| Variant | Style |
|---------|-------|
| `default` | `bg-primary text-primary-foreground` — solid green |
| `secondary` | `bg-card text-foreground border border-input` — card-style |
| `outline` | `bg-transparent text-foreground border border-input` — ghost border |
| `ghost` | `text-muted-foreground hover:bg-accent` — minimal |
| `destructive` | `bg-destructive text-destructive-foreground` — solid red |
| `destructive-outline` | `border border-destructive/35 text-destructive` — outlined red |
| `primary-outline` | `border border-green-border text-primary` — outlined green |
| `ink` | `bg-foreground text-background` — inverted solid |
| `bright` | `bg-green-bright text-foreground font-bold` — neon green CTA |

### Button Sizes

| Size | Height | Padding | Font |
|------|--------|---------|------|
| `xs` | 26px | px-2.5 | 0.7rem (caption) |
| `sm` | 32px | px-3.5 | 0.75rem |
| `default` | 38px | px-[18px] | 0.875rem |
| `lg` | 44px | px-6 | 0.9rem |
| `xl` | 52px | px-8 | 1rem |

---

## Quick Reference: CSS Variables for Static Sites

For landing pages and static HTML that don't use Tailwind, apply the dark mode palette directly:

```css
:root {
  --bg: #0c0c0a;
  --fg: rgba(255,255,255,0.88);
  --muted: rgba(255,255,255,0.42);
  --card: #1c1c18;
  --border: rgba(255,255,255,0.12);
  --primary: #39ed35;
  --primary-fg: #0c0c0a;
  --green-bright: #39ed35;
  --green-surface: rgba(57,237,53,0.1);
  --green-border: rgba(57,237,53,0.22);
  --surface-elevated: #242420;
  --surface-sunken: #141410;
  --destructive: #ff6b6b;
  --warning: #f5a623;
  --info: #6cb4ff;
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
```
