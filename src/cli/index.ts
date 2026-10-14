#!/usr/bin/env node
/**
 * ScrapeKit CLI entry point.
 *
 * Usage:
 *   scrapekit inspect <url> [options]
 *   scrapekit extract <url> --selector <css> [options]
 *   scrapekit crawl   <url> [options]
 *   scrapekit --help
 *   scrapekit --version
 */
import { Command } from 'commander';
import { registerInspectCommand } from './commands/inspect.js';
import { registerExtractCommand } from './commands/extract.js';
import { registerCrawlCommand } from './commands/crawl.js';

const program = new Command();

program
  .name('scrapekit')
  .description(
    'Extract useful data from public websites. Responsibly, reliably, and without the boilerplate.\n\n' +
      'ScrapeKit is a Node.js + TypeScript CLI for fetching, extracting, and crawling\n' +
      'publicly accessible web pages. It respects robots.txt, follows conservative\n' +
      'crawling limits, and exports structured JSON or CSV.\n\n' +
      'Run "scrapekit <command> --help" for command-specific options.',
  )
  .version('0.1.0', '-v, --version')
  .configureOutput({
    outputError: (msg, write) => write(`Error: ${msg}\n`),
  });

registerInspectCommand(program);
registerExtractCommand(program);
registerCrawlCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
