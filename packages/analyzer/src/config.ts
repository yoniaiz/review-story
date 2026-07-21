import { join } from "node:path";
import { tmpdir } from "node:os";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface AnalyzerConfig {
  githubToken?: string;
  anthropicApiKey?: string;
  githubApiBaseUrl: string;
  strongModel: string;
  chapterModel: string;
  stage1MaxTokens: number;
  stage2MaxTokens: number;
  stage3MaxTokens: number;
  stage2Concurrency: number;
  maxFiles: number;
  maxArchiveBytes: number;
  maxExtractedBytes: number;
  maxContextFiles: number;
  maxContextCharacters: number;
  workspaceRoot: string;
  versions: { analyzer: number; prompt: number; schema: 1 };
  pricing: Record<string, ModelPricing>;
}

export function loadAnalyzerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AnalyzerConfig {
  const strongModel = environment.ANALYZER_STRONG_MODEL ?? "claude-sonnet-5";
  const chapterModel = environment.ANALYZER_CHAPTER_MODEL ?? "claude-sonnet-5";

  return {
    ...(environment.GITHUB_TOKEN ? { githubToken: environment.GITHUB_TOKEN } : {}),
    ...(environment.ANTHROPIC_API_KEY
      ? { anthropicApiKey: environment.ANTHROPIC_API_KEY }
      : {}),
    githubApiBaseUrl: environment.GITHUB_API_URL ?? "https://api.github.com",
    strongModel,
    chapterModel,
    stage1MaxTokens: positiveInteger(
      environment.ANALYZER_STAGE1_MAX_TOKENS,
      12_000,
    ),
    stage2MaxTokens: positiveInteger(
      environment.ANALYZER_STAGE2_MAX_TOKENS,
      8_000,
    ),
    stage3MaxTokens: positiveInteger(
      environment.ANALYZER_STAGE3_MAX_TOKENS,
      10_000,
    ),
    stage2Concurrency: positiveInteger(environment.ANALYZER_CONCURRENCY, 5),
    maxFiles: positiveInteger(environment.ANALYZER_MAX_FILES, 300),
    maxArchiveBytes: positiveInteger(
      environment.ANALYZER_MAX_ARCHIVE_BYTES,
      50 * 1024 * 1024,
    ),
    maxExtractedBytes: positiveInteger(
      environment.ANALYZER_MAX_EXTRACTED_BYTES,
      250 * 1024 * 1024,
    ),
    maxContextFiles: Math.min(
      10,
      positiveInteger(environment.ANALYZER_MAX_CONTEXT_FILES, 10),
    ),
    maxContextCharacters: positiveInteger(
      environment.ANALYZER_MAX_CONTEXT_CHARACTERS,
      80_000,
    ),
    workspaceRoot:
      environment.STORY_WORKSPACE_ROOT ?? join(tmpdir(), "review-story", "workspaces"),
    versions: {
      analyzer: positiveInteger(environment.ANALYZER_VERSION, 1),
      prompt: positiveInteger(environment.ANALYZER_PROMPT_VERSION, 1),
      schema: 1,
    },
    pricing: {
      [strongModel]: {
        inputPerMillion: nonnegativeNumber(
          environment.ANALYZER_STRONG_INPUT_USD_PER_MTOK,
          5,
        ),
        outputPerMillion: nonnegativeNumber(
          environment.ANALYZER_STRONG_OUTPUT_USD_PER_MTOK,
          25,
        ),
      },
      ...(chapterModel === strongModel
        ? {}
        : {
            [chapterModel]: {
              inputPerMillion: nonnegativeNumber(
                environment.ANALYZER_CHAPTER_INPUT_USD_PER_MTOK,
                2,
              ),
              outputPerMillion: nonnegativeNumber(
                environment.ANALYZER_CHAPTER_OUTPUT_USD_PER_MTOK,
                10,
              ),
            },
          }),
    },
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonnegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
