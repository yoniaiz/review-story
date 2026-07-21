import { createAnalyzer } from "./index.js";

const [owner = "acme", repo = "review-story-demo", pull = "123"] =
  process.argv.slice(2);
const pullNumber = Number(pull);

if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
  throw new Error(`Expected a positive pull request number, received: ${pull}`);
}

const artifact = await createAnalyzer().analyze({ owner, repo, pullNumber });
process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);

