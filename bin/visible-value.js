#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { canonicalJson, summarize, validateReceipt, formatIndicator, VERSION } from '../src/index.js';

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--version' && !args.length) console.log(VERSION);
  else if (command === '--help' && !args.length) console.log('visible-value summarize|validate [FILE|-] [--quiet]\nJSON on stdout; operator indicator on stderr. Default input: stdin.');
  else {
    if (!['summarize', 'validate'].includes(command)) throw new Error('Expected summarize or validate; use --help');
    const quiet = args.includes('--quiet');
    const paths = args.filter(a => a !== '--quiet');
    if (paths.length > 1 || paths.some(a => a.startsWith('--'))) throw new Error('Unknown argument');
    const source = readFileSync(!paths.length || paths[0] === '-' ? 0 : paths[0]);
    if (source.length > 10_000_000) throw new Error('Input exceeds 10 MB');
    const input = JSON.parse(source.toString('utf8'));
    const result = command === 'summarize' ? summarize(input) : validateReceipt(input);
    process.stdout.write(`${canonicalJson(result)}\n`);
    if (!quiet) process.stderr.write(`${command === 'summarize' ? formatIndicator(result) : '[Visible Value] receipt validated'}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: 'VISIBLE_VALUE_FAILED', message: error.message })}\n`);
  process.exitCode = 1;
}
