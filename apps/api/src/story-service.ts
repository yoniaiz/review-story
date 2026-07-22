import type {
  AnalyzeRequest,
  AnalyzeResult,
  Analyzer,
  StoryCacheIdentity,
  StoryStreamEvent,
} from "@review-story/contracts";
import { StoryCache } from "./story-cache.js";

export class StoryService {
  readonly #analyzer: Analyzer;
  readonly #cache: StoryCache;
  readonly #jobs = new Map<string, GenerationJob>();

  constructor(analyzer: Analyzer, cache: StoryCache) {
    this.#analyzer = analyzer;
    this.#cache = cache;
  }

  async analyze(request: AnalyzeRequest, signal?: AbortSignal, githubToken?: string): Promise<AnalyzeResult> {
    const { identity, cached } = await this.#lookup(request, signal, githubToken);
    throwIfAborted(signal);
    if (cached) return cached;
    return this.#job(identity, request, githubToken).wait(signal);
  }

  async *stream(
    request: AnalyzeRequest,
    signal?: AbortSignal,
    githubToken?: string,
  ): AsyncIterable<StoryStreamEvent> {
    const { identity, cached } = await this.#lookup(request, signal, githubToken);
    throwIfAborted(signal);
    if (cached) {
      yield* eventsForResult(cached);
      return;
    }
    yield* this.#job(identity, request, githubToken).subscribe(signal);
  }

  async #lookup(
    request: AnalyzeRequest,
    signal?: AbortSignal,
    githubToken?: string,
  ): Promise<{ identity: StoryCacheIdentity; cached: AnalyzeResult | null }> {
    // identify() runs with the caller's token, so a user who cannot see the
    // repository fails here instead of reading another user's cached story.
    const identity = await this.#analyzer.identify(request, {
      ...(signal ? { signal } : {}),
      ...(githubToken ? { githubToken } : {}),
    });
    const entry = await this.#cache.read(identity);
    return { identity, cached: entry?.result ?? null };
  }

  #job(identity: StoryCacheIdentity, request: AnalyzeRequest, githubToken?: string): GenerationJob {
    const key = this.#cache.keyFor(identity);
    const existing = this.#jobs.get(key);
    if (existing) return existing;
    let job!: GenerationJob;
    const removeJob = () => {
      if (this.#jobs.get(key) === job) this.#jobs.delete(key);
    };
    job = new GenerationJob(
      this.#analyzer,
      this.#cache,
      identity,
      request,
      removeJob,
      githubToken,
    );
    this.#jobs.set(key, job);
    void job.result.catch(() => undefined).finally(removeJob);
    return job;
  }
}

class GenerationJob {
  readonly #analyzer: Analyzer;
  readonly #cache: StoryCache;
  readonly #identity: StoryCacheIdentity;
  readonly #request: AnalyzeRequest;
  readonly #onAbandoned: () => void;
  readonly #githubToken: string | undefined;
  readonly #controller = new AbortController();
  readonly #history: StoryStreamEvent[] = [];
  readonly #subscribers = new Set<Subscriber>();
  #waitingConsumers = 0;
  #settled = false;
  #failure: unknown;
  readonly result: Promise<AnalyzeResult>;

  constructor(
    analyzer: Analyzer,
    cache: StoryCache,
    identity: StoryCacheIdentity,
    request: AnalyzeRequest,
    onAbandoned: () => void,
    githubToken?: string,
  ) {
    this.#analyzer = analyzer;
    this.#cache = cache;
    this.#identity = identity;
    this.#request = request;
    this.#onAbandoned = onAbandoned;
    this.#githubToken = githubToken;
    this.result = this.#run();
  }

  async wait(signal?: AbortSignal): Promise<AnalyzeResult> {
    this.#waitingConsumers += 1;
    try {
      return await abortable(this.result, signal);
    } finally {
      this.#waitingConsumers -= 1;
      this.#abortIfUnobserved();
    }
  }

  subscribe(signal?: AbortSignal): AsyncIterable<StoryStreamEvent> {
    const subscriber = new Subscriber(this.#history, this.#settled, this.#failure);
    const abort = () => {
      subscriber.close();
      this.#subscribers.delete(subscriber);
      this.#abortIfUnobserved();
    };
    if (signal?.aborted) subscriber.close();
    else {
      if (!this.#settled) this.#subscribers.add(subscriber);
      signal?.addEventListener("abort", abort, { once: true });
    }
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of subscriber) yield event;
        } finally {
          signal?.removeEventListener("abort", abort);
          self.#subscribers.delete(subscriber);
          subscriber.close();
          self.#abortIfUnobserved();
        }
      },
    };
  }

  async #run(): Promise<AnalyzeResult> {
    let result: AnalyzeResult | undefined;
    try {
      for await (const event of this.#analyzer.stream(this.#request, {
        signal: this.#controller.signal,
        ...(this.#githubToken ? { githubToken: this.#githubToken } : {}),
        onResult: async (completed) => {
          this.#cache.assertResultMatchesIdentity(this.#identity, completed);
          result = (await this.#cache.write(this.#identity, completed)).result;
        },
      })) {
        this.#history.push(event);
        for (const subscriber of this.#subscribers) subscriber.push(event);
      }
      if (!result) throw new Error("Analyzer stream completed without an AnalyzeResult");
      this.#settled = true;
      for (const subscriber of this.#subscribers) subscriber.close();
      return result;
    } catch (error) {
      this.#settled = true;
      this.#failure = error;
      for (const subscriber of this.#subscribers) subscriber.fail(error);
      throw error;
    }
  }

  #abortIfUnobserved(): void {
    if (
      !this.#settled &&
      !this.#controller.signal.aborted &&
      this.#waitingConsumers === 0 &&
      this.#subscribers.size === 0
    ) {
      this.#onAbandoned();
      this.#controller.abort(new Error("All story consumers disconnected"));
    }
  }
}

class Subscriber implements AsyncIterable<StoryStreamEvent> {
  readonly #values: StoryStreamEvent[];
  readonly #waiters: Array<{
    resolve: (value: IteratorResult<StoryStreamEvent>) => void;
    reject: (error: unknown) => void;
  }> = [];
  #closed: boolean;
  #failure: unknown;

  constructor(
    history: StoryStreamEvent[],
    settled: boolean,
    failure: unknown,
  ) {
    this.#values = [...history];
    this.#closed = settled;
    this.#failure = failure;
  }

  push(event: StoryStreamEvent): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve({ value: event, done: false });
    else this.#values.push(event);
  }

  close(): void {
    this.#closed = true;
    while (this.#waiters.length > 0) {
      this.#waiters.shift()!.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    this.#failure = error;
    this.#closed = true;
    while (this.#waiters.length > 0) this.#waiters.shift()!.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<StoryStreamEvent> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.#failure) return Promise.reject(this.#failure);
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
      },
    };
  }
}

function eventsForResult(result: AnalyzeResult): StoryStreamEvent[] {
  const artifact = result.artifact;
  return [
    {
      type: "story.skeleton",
      data: {
        meta: { ...artifact.meta, status: "GENERATING" },
        tracks: artifact.tracks.map(({ id, title, chapter_order }) => ({
          id,
          title,
          chapter_order,
        })),
        chapters: artifact.chapters.map(({ id, title }) => ({ id, title })),
        appendix: artifact.appendix,
      },
    },
    ...artifact.chapters.map(
      (chapter): StoryStreamEvent => ({ type: "story.chapter", data: chapter }),
    ),
    { type: "story.ready", data: artifact },
  ];
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
}
