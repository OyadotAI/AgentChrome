import { createInterface, type Interface } from 'node:readline';
import { stdin, stdout } from 'node:process';

/**
 * Terminal prompts. No dependency earns its place for this.
 *
 * On a TTY, menus are arrow-key selectable and redraw in place. Everywhere else
 * — a pipe, CI, a test — the same call falls back to a numbered list read line by
 * line, so scripted input behaves identically to typing.
 *
 * One readline for the whole process, and our own line queue rather than
 * rl.question(): closing a readline discards what it has buffered, and readline
 * emits 'line' for every buffered line at once while question() only catches the
 * one arriving as it waits. Queueing them is what makes piped input work at all.
 */

const ESC = '\u001b';

// ── Colour ──────────────────────────────────────────────────────────────────

const plain = !stdout.isTTY || !!process.env.NO_COLOR || process.env.TERM === 'dumb';
const wrap = (open: string) => (s: string) => (plain ? s : `${ESC}[${open}m${s}${ESC}[0m`);

export const style = {
  bold: wrap('1'),
  dim: wrap('2'),
  green: wrap('32'),
  cyan: wrap('36'),
  yellow: wrap('33'),
  red: wrap('31'),
  grey: wrap('90'),
};

export const icon = {
  ok: style.green('✔'),
  fail: style.red('✗'),
  warn: style.yellow('!'),
  arrow: style.green('❯'),
};

const clearLine = plain ? '' : `${ESC}[K`;
const up = (n: number) => `${ESC}[${n}A`;

// ── Framing ─────────────────────────────────────────────────────────────────

const width = () => Math.min(stdout.columns || 80, 74);

export function banner(title: string, subtitle?: string): void {
  const line = '─'.repeat(width());
  stdout.write(`\n${style.grey(line)}\n  ${style.bold(title)}\n`);
  if (subtitle) stdout.write(`  ${style.grey(subtitle)}\n`);
  stdout.write(`${style.grey(line)}\n`);
}

let stepNumber = 0;
let stepTotal = 0;
export function steps(total: number): void { stepTotal = total; stepNumber = 0; }
export function step(title: string, hint?: string): void {
  stepNumber += 1;
  const counter = stepTotal ? style.grey(`${stepNumber}/${stepTotal}`) : '';
  stdout.write(`\n${style.cyan('◆')} ${style.bold(title)} ${counter}\n`);
  if (hint) stdout.write(`${style.grey('  ' + hint)}\n`);
}

export function note(text: string): void { stdout.write(`${style.grey('  ' + text)}\n`); }
export function success(text: string): void { stdout.write(`${icon.ok} ${text}\n`); }
export function warn(text: string): void { stdout.write(`${icon.warn} ${style.yellow(text)}\n`); }

/** A spinner for work slow enough that silence reads as a hang. */
export function spinner(label: string) {
  if (plain) {
    stdout.write(`  ${label}… `);
    return {
      done: (msg = 'ok') => stdout.write(`${msg}\n`),
      fail: (msg = 'failed') => stdout.write(`${msg}\n`),
    };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const timer = setInterval(() => {
    stdout.write(`\r  ${style.cyan(frames[i++ % frames.length])} ${label}…   `);
  }, 80);
  const stop = (mark: string, msg: string) => {
    clearInterval(timer);
    stdout.write(`\r  ${mark} ${label}  ${style.grey(msg)}${clearLine}\n`);
  };
  return { done: (msg = '') => stop(icon.ok, msg), fail: (msg = '') => stop(icon.fail, msg) };
}

// ── Line input ──────────────────────────────────────────────────────────────

let rl: Interface | null = null;
let masked = false;
const pending: string[] = [];
let waiter: ((line: string) => void) | null = null;
let ended = false;

function iface(): Interface {
  if (rl) return rl;
  rl = createInterface({ input: stdin, output: stdout, terminal: !!stdin.isTTY });
  const deliver = (line: string) => {
    if (waiter) { const w = waiter; waiter = null; w(line); } else pending.push(line);
  };
  rl.on('line', deliver);
  rl.on('close', () => { ended = true; if (waiter) { const w = waiter; waiter = null; w(''); } });
  const asAny = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: (s: string) => void };
  // Only a terminal echoes what is typed, so masking only has to work there.
  asAny._writeToOutput = (s: string) => {
    if (!masked) { asAny.output.write(s); return; }
    asAny.output.write(s.includes('\n') ? '\n' : '*');
  };
  return rl;
}

function nextLine(): Promise<string> {
  const queued = pending.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  if (ended) return Promise.resolve('');
  iface();
  return new Promise((resolve) => { waiter = resolve; });
}

export function closePrompts(): void {
  if (stdin.isTTY && stdin.isRaw) stdin.setRawMode(false);
  rl?.close();
  rl = null;
}

/** Thrown when input is rejected and there is no interactive way to retry. */
export class InputError extends Error {}

export interface AskOptions {
  /** Return a message to reject and re-prompt; return nothing to accept. */
  validate?: (value: string) => string | void;
  secret?: boolean;
}

/**
 * Re-prompts rather than throwing. A wizard that exits on a typo throws away
 * every answer given so far, which is the worst possible response to a typo.
 */
async function readValidated(render: () => void, fallback: string, options: AskOptions): Promise<string> {
  for (;;) {
    render();
    masked = !!options.secret;
    let answer: string;
    try {
      answer = (await nextLine()).trim() || fallback;
    } finally {
      if (options.secret) { masked = false; stdout.write('\n'); }
    }
    if (!stdin.isTTY && !options.secret) stdout.write(`${answer}\n`);
    const problem = options.validate?.(answer);
    if (!problem) return answer;
    stdout.write(`  ${icon.fail} ${style.red(problem)}\n`);
    // Re-prompting needs somewhere to read from; a closed pipe has nothing left.
    if (ended && !pending.length) throw new InputError(problem);
  }
}

export function ask(question: string, fallback = '', options: AskOptions = {}): Promise<string> {
  return readValidated(
    () => stdout.write(`  ${style.green('?')} ${question}${fallback ? style.grey(` (${fallback})`) : ''} `),
    fallback, options,
  );
}

/** Same, but the terminal does not echo — for keys and secrets. */
export function askSecret(question: string, options: AskOptions = {}): Promise<string> {
  return readValidated(
    () => stdout.write(`  ${style.green('?')} ${question} `),
    '', { ...options, secret: true },
  );
}

export async function confirm(question: string, fallback = false): Promise<boolean> {
  const answer = await ask(`${question} ${style.grey(fallback ? '[Y/n]' : '[y/N]')}`, fallback ? 'y' : 'n');
  return /^y/i.test(answer);
}

// ── Menus ───────────────────────────────────────────────────────────────────

export interface Option { id: string; label: string; note?: string; disabled?: string }

/** Printable width, ignoring the colour codes that take no columns. */
const visible = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '').length;

/**
 * Returns the number of terminal ROWS drawn, which is not the number of lines: a
 * label longer than the window wraps. Redrawing in place means moving the cursor
 * up by rows, and counting lines instead leaves the previous menu on screen.
 */
function renderOptions(options: Option[], active: number, interactive: boolean): number {
  const columns = stdout.columns || 80;
  let rows = 0;
  options.forEach((o, i) => {
    const chosen = interactive && i === active;
    const bullet = chosen ? icon.arrow : ' ';
    const number = interactive ? '' : style.grey(`${i + 1}) `);
    const hint = o.disabled ? `— ${o.disabled}` : o.note ? `— ${o.note}` : '';
    const label = o.disabled ? style.grey(o.label) : chosen ? style.green(o.label) : o.label;
    const line = `  ${bullet} ${number}${label}${hint ? style.grey(`  ${hint}`) : ''}`;
    stdout.write(`${line}${clearLine}\n`);
    rows += Math.max(1, Math.ceil(visible(line) / columns));
  });
  return rows;
}

/**
 * `disabled` keeps a planned option visible without pretending it works: it is
 * listed, dimmed, and skipped over. A menu that silently omits what the docs
 * promise is more confusing than one that says "not yet".
 */
export async function choose(question: string, options: Option[]): Promise<string> {
  const pickable = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  if (!pickable.length) throw new Error(`No option available for: ${question}`);

  stdout.write(`  ${style.green('?')} ${style.bold(question)}\n`);

  // Not a terminal: numbered list, one line of input, validated and re-prompted.
  if (!stdin.isTTY) {
    renderOptions(options, -1, false);
    const answer = await ask('choice:', String(pickable[0] + 1), {
      validate: (v) => {
        const picked = options[Number(v) - 1] || options.find((o) => o.id === v);
        if (!picked) return 'Pick one of the numbers above.';
        if (picked.disabled) return `${picked.label} is ${picked.disabled}. Pick another.`;
      },
    });
    return (options[Number(answer) - 1] || options.find((o) => o.id === answer))!.id;
  }

  const hint = style.grey('  ↑↓ move · enter select');
  let active = pickable[0];
  let rows = renderOptions(options, active, true) + 1;   // + the hint line
  // Redrawing relies on the whole menu still being on screen; once it has
  // scrolled, moving the cursor up lands somewhere else entirely.
  const canRedraw = rows < (stdout.rows || 24) - 1;

  rl?.pause();
  const wasRaw = !!stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  stdout.write(`${hint}\n`);

  const redraw = () => {
    if (!canRedraw) return;
    stdout.write(up(rows));
    rows = renderOptions(options, active, true) + 1;
    stdout.write(`${hint}\n`);
  };
  const move = (delta: number) => {
    const here = pickable.indexOf(active);
    active = pickable[(here + delta + pickable.length) % pickable.length];
    redraw();
  };

  try {
    return await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        stdin.off('data', onData);
        if (!wasRaw) stdin.setRawMode(false);
        rl?.resume();
      };
      const onData = (buf: Buffer) => {
        const key = buf.toString();
        if (key === '') { cleanup(); stdout.write('\n'); reject(new InputError('Cancelled.')); return; }
        if (key === `${ESC}[A` || key === 'k') return move(-1);
        if (key === `${ESC}[B` || key === 'j') return move(1);
        if (/^[1-9]$/.test(key)) {
          const target = Number(key) - 1;
          if (options[target] && !options[target].disabled) { active = target; redraw(); }
          return;
        }
        if (key === '\r' || key === '\n') {
          cleanup();
          if (canRedraw) {
            // Collapse the menu to just the chosen line, as a record of the answer.
            stdout.write(up(rows));
            for (let i = 0; i < rows; i++) stdout.write(`${clearLine}\n`);
            stdout.write(up(rows));
            // The cursor is left directly under the chosen line; the rest of the
            // region is already blank, so the next prompt simply writes over it.
            stdout.write(`  ${icon.arrow} ${style.green(options[active].label)}${clearLine}\n`);
          } else {
            stdout.write(`  ${icon.arrow} ${style.green(options[active].label)}\n`);
          }
          resolve(options[active].id);
        }
      };
      stdin.on('data', onData);
    });
  } finally {
    if (!wasRaw && stdin.isTTY && stdin.isRaw) stdin.setRawMode(false);
  }
}
