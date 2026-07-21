import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createAnalyzer } from "./index.js";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const cliArguments = process.argv.slice(2);
const deterministic = cliArguments.includes("--deterministic");
const positionalArguments = cliArguments.filter(
  (argument) => argument !== "--deterministic",
);
const [owner, repo, pull, ...unexpectedArguments] = positionalArguments;
if (!owner || !repo || !pull) {
  throw new Error(
    "Usage: pnpm analyze <owner> <repo> <pull-number> [--deterministic]",
  );
}
if (unexpectedArguments.length > 0) {
  throw new Error(`Unexpected arguments: ${unexpectedArguments.join(" ")}`);
}
const pullNumber = Number(pull);

if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
  throw new Error(`Expected a positive pull request number, received: ${pull}`);
}

const result = await createAnalyzer({
  mode: deterministic ? "deterministic" : "full",
  logger: {
    info: (...data) => console.error(...data),
    warn: (...data) => console.error(...data),
  },
}).analyze({ owner, repo, pullNumber });
process.stdout.write(`${JSON.stringify(result.artifact, null, 2)}\n`);
process.stderr.write("\nAnalyzer usage\n");
for (const stage of result.usage.stages) {
  process.stderr.write(
    `${stage.stage} ${stage.model}: ${stage.calls} calls (${stage.failures} failed), ${stage.input_tokens} input + ${stage.output_tokens} output tokens, $${stage.cost_usd.toFixed(4)}\n`,
  );
}
process.stderr.write(
  `total: ${result.usage.total_input_tokens} input + ${result.usage.total_output_tokens} output tokens, $${result.usage.total_cost_usd.toFixed(4)}\n`,
);
