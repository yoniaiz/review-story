import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadAnalyzerConfig } from "../src/config.js";
import { StageRunner, UsageCollector } from "../src/stage-runner.js";

const OutputSchema = z.object({ value: z.string() }).strict();

describe("StageRunner", () => {
  it("does not overwrite pricing when both stages use the same model", () => {
    const config = loadAnalyzerConfig({});

    expect(config.strongModel).toBe(config.chapterModel);
    expect(config.pricing[config.strongModel]).toEqual({
      inputPerMillion: 5,
      outputPerMillion: 25,
    });
  });

  it("re-prompts once with validation feedback and accounts for both calls", async () => {
    const prompts: string[] = [];
    let calls = 0;
    const client = {
      messages: {
        parse: async (parameters: { messages: Array<{ content: string }> }) => {
          prompts.push(parameters.messages[0]!.content);
          calls += 1;
          return {
            parsed_output: {
              ok: true,
              output: { value: calls === 1 ? "incomplete" : "complete" },
            },
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        },
      },
    } as unknown as Anthropic;
    const config = {
      ...loadAnalyzerConfig({}),
      pricing: {
        "test-model": { inputPerMillion: 5, outputPerMillion: 25 },
      },
    };
    const usage = new UsageCollector(config);
    const runner = new StageRunner(config, usage, {
      client,
      logger: { info: () => undefined, warn: () => undefined },
    });

    const response = await runner.run({
      stage: "stage1",
      model: "test-model",
      schema: OutputSchema,
      system: "Test",
      prompt: "Build the outline",
      maxTokens: 100,
      accept: (output) => output.value === "complete" || "missing files: src/b.ts",
    });

    expect(response).toMatchObject({ accepted: true, output: { value: "complete" } });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("missing files: src/b.ts");
    expect(usage.summary()).toEqual({
      stages: [{
        stage: "stage1",
        model: "test-model",
        calls: 2,
        failures: 1,
        input_tokens: 200,
        output_tokens: 100,
        cost_usd: 0.0035,
      }],
      total_input_tokens: 200,
      total_output_tokens: 100,
      total_cost_usd: 0.0035,
    });
  });

  it("returns a failure instead of throwing after both attempts fail", async () => {
    let calls = 0;
    const client = {
      messages: {
        parse: async () => {
          calls += 1;
          throw new Error("model unavailable");
        },
      },
    } as unknown as Anthropic;
    const config = loadAnalyzerConfig({});
    const usage = new UsageCollector(config);
    const runner = new StageRunner(config, usage, {
      client,
      logger: { info: () => undefined, warn: () => undefined },
    });

    const response = await runner.run({
      stage: "stage1",
      model: config.strongModel,
      schema: OutputSchema,
      system: "Test",
      prompt: "Build the outline",
      maxTokens: 100,
    });

    expect(calls).toBe(2);
    expect(response.accepted).toBe(false);
    expect(response.error?.message).toBe("model unavailable");
    expect(usage.summary().stages[0]).toMatchObject({
      stage: "stage1",
      calls: 2,
      failures: 2,
      input_tokens: 0,
      output_tokens: 0,
    });
  });

  it("preserves usage when a completed response fails schema parsing", async () => {
    const client = {
      messages: {
        parse: async (parameters: {
          output_config: {
            format: { parse: (content: string) => unknown };
          };
        }) => ({
          parsed_output: parameters.output_config.format.parse('{"value": 42}'),
          usage: { input_tokens: 80, output_tokens: 20 },
        }),
      },
    } as unknown as Anthropic;
    const config = loadAnalyzerConfig({});
    const usage = new UsageCollector(config);
    const runner = new StageRunner(config, usage, {
      client,
      logger: { info: () => undefined, warn: () => undefined },
    });

    const response = await runner.run({
      stage: "stage1",
      model: config.strongModel,
      schema: OutputSchema,
      system: "Test",
      prompt: "Build the outline",
      maxTokens: 100,
    });

    expect(response.accepted).toBe(false);
    expect(usage.summary().stages[0]).toMatchObject({
      calls: 2,
      failures: 2,
      input_tokens: 160,
      output_tokens: 40,
    });
  });
});
