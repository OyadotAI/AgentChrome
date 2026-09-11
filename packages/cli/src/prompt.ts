import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/** Minimal interactive prompts. No dependency earns its place for this. */
export async function ask(question: string, fallback = ''): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(fallback ? `${question} [${fallback}] ` : `${question} `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

/** Same, but the terminal does not echo — for keys and secrets. */
export async function askSecret(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const asAny = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: (s: string) => void };
  asAny._writeToOutput = (s: string) => {
    // Let the prompt itself through; mask whatever is typed after it.
    asAny.output.write(s.includes(question) ? s : '*');
  };
  try {
    const answer = (await rl.question(`${question} `)).trim();
    stdout.write('\n');
    return answer;
  } finally {
    rl.close();
  }
}

export async function choose(question: string, options: Array<{ id: string; label: string; note?: string }>): Promise<string> {
  console.log(`\n${question}`);
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}${o.note ? `  — ${o.note}` : ''}`));
  while (true) {
    const answer = await ask('  choice:', '1');
    const index = Number(answer) - 1;
    if (options[index]) return options[index].id;
    const byId = options.find((o) => o.id === answer);
    if (byId) return byId.id;
    console.log('  Pick one of the numbers above.');
  }
}
