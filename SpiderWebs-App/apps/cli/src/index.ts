import { createProcessContext } from './context.js';
import { runCli } from './program.js';

const ctx = createProcessContext();
process.exitCode = await runCli(ctx, process.argv.slice(2));
