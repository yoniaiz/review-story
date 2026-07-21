import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { UsageSummary, StageUsage } from "@review-story/contracts";
import type { z } from "zod";
import type { AnalyzerConfig } from "./config.js";

type StageName = StageUsage["stage"];
type ParsedStageOutput<T> =
  | { ok: true; output: T }
  | { ok: false; error: Error };

export interface StageRequest<TSchema extends z.ZodType> {
  stage: StageName;
  model: string;
  schema: TSchema;
  system: string;
  prompt: string;
  maxTokens: number;
  signal?: AbortSignal;
  accept?: (output: z.infer<TSchema>) => boolean | string;
}

export interface StageResponse<T> {
  output?: T;
  accepted: boolean;
  error?: Error;
}

export type AnalyzerLogger = Pick<Console, "info" | "warn">;

export class UsageCollector {
  readonly #records = new Map<string, StageUsage>();
  readonly #pricing: AnalyzerConfig["pricing"];

  constructor(config: AnalyzerConfig) {
    this.#pricing = config.pricing;
  }

  record(
    stage: StageName,
    model: string,
    usage: { input_tokens: number; output_tokens: number } | null,
    failed: boolean,
  ): void {
    const record = this.#ensure(stage, model);
    record.calls += 1;
    if (failed) record.failures += 1;
    if (!usage) return;
    record.input_tokens += usage.input_tokens;
    record.output_tokens += usage.output_tokens;
    const pricing = this.#pricing[model] ?? {
      inputPerMillion: 0,
      outputPerMillion: 0,
    };
    record.cost_usd +=
      (usage.input_tokens * pricing.inputPerMillion +
        usage.output_tokens * pricing.outputPerMillion) /
      1_000_000;
  }

  summary(): UsageSummary {
    const stages = [...this.#records.values()].map((record) => ({
      ...record,
      cost_usd: roundCost(record.cost_usd),
    }));
    return {
      stages,
      total_input_tokens: stages.reduce((sum, stage) => sum + stage.input_tokens, 0),
      total_output_tokens: stages.reduce((sum, stage) => sum + stage.output_tokens, 0),
      total_cost_usd: roundCost(
        stages.reduce((sum, stage) => sum + stage.cost_usd, 0),
      ),
    };
  }

  #ensure(stage: StageName, model: string): StageUsage {
    const key = `${stage}:${model}`;
    let record = this.#records.get(key);
    if (!record) {
      record = {
        stage,
        model,
        calls: 0,
        failures: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
      };
      this.#records.set(key, record);
    }
    return record;
  }
}

export class StageRunner {
  readonly #client: Anthropic | null;
  readonly #usage: UsageCollector;
  readonly #logger: AnalyzerLogger;

  constructor(
    config: AnalyzerConfig,
    usage: UsageCollector,
    options: { client?: Anthropic; logger?: AnalyzerLogger } = {},
  ) {
    this.#client =
      options.client ??
      (config.anthropicApiKey
        ? new Anthropic({
            apiKey: config.anthropicApiKey,
            maxRetries: 0,
            timeout: config.modelTimeoutMs,
          })
        : null);
    this.#usage = usage;
    this.#logger = options.logger ?? console;
  }

  async run<TSchema extends z.ZodType>(
    request: StageRequest<TSchema>,
  ): Promise<StageResponse<z.infer<TSchema>>> {
    if (!this.#client) {
      return {
        accepted: false,
        error: new Error("ANTHROPIC_API_KEY is not configured"),
      };
    }

    let lastOutput: z.infer<TSchema> | undefined;
    let lastError: Error | undefined;
    let prompt = request.prompt;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new Error("Analysis aborted");
      }
      let callUsage: { input_tokens: number; output_tokens: number } | null = null;
      let usageRecorded = false;
      try {
        const outputFormat = zodOutputFormat(request.schema);
        const safeOutputFormat = {
          ...outputFormat,
          parse: (content: string): ParsedStageOutput<z.infer<TSchema>> => {
            try {
              return { ok: true, output: outputFormat.parse(content) };
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error : new Error(String(error)),
              };
            }
          },
        };
        const message = await this.#client.messages.parse(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: "user", content: prompt }],
            output_config: { format: safeOutputFormat },
          },
          {
            ...(request.signal ? { signal: request.signal } : {}),
            maxRetries: 0,
          },
        );
        callUsage = message.usage;
        const parsed = message.parsed_output;
        if (!parsed) throw new Error("Model response contained no parsed output");
        if (!parsed.ok) throw parsed.error;
        const output = parsed.output;
        lastOutput = output;
        const decision = request.accept?.(output) ?? true;
        const accepted = decision === true;
        this.#usage.record(request.stage, request.model, message.usage, !accepted);
        usageRecorded = true;
        if (accepted) return { output, accepted: true };
        lastError = new Error(
          typeof decision === "string"
            ? decision
            : `${request.stage} output failed deterministic validation`,
        );
      } catch (error) {
        if (request.signal?.aborted) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!usageRecorded) {
          this.#usage.record(request.stage, request.model, callUsage, true);
        }
      }
      this.#logger.warn(
        `${request.stage} attempt ${attempt} failed: ${lastError.message}`,
      );
      if (attempt === 1) {
        prompt = `${request.prompt}\n\nCorrection required: the previous response was rejected because ${lastError.message}. Return a complete corrected response that satisfies every requirement.`;
      }
    }

    return {
      ...(lastOutput === undefined ? {} : { output: lastOutput }),
      accepted: false,
      ...(lastError ? { error: lastError } : {}),
    };
  }
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
