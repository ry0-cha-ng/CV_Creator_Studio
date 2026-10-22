import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { Options, Query, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { analyticsBundleSchema, type AnalyticsPost, type ReviewDraft } from '../../../shared/schema/analytics';
import { parseProject } from '../../../shared/schema/project';
import {
  AI_ERROR_MESSAGE,
  AI_SENT,
  analysisDisclaimer,
  buildCaptionContext,
  buildHypothesisContext,
  buildNextActionContext,
  buildNoticesContext,
  buildPrompt,
  clipAiInstruction,
  buildPublishingContext,
  buildSummaryContext,
  findUnsafeContext,
  interpretModelOutput,
  offerHandoff,
  omitApiCredentials,
  planUsageFromRateLimits,
  providersFor,
  shouldContinue,
  type AiErrorCode,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiHandoff,
  type AiHandoffParseRequest,
  type AiKind,
  type AiProviderChoice,
  type AiRuntimeProvider,
  type AiSourceCounts,
  type AiPlanUsage,
  type AiStatus,
  type AiSuggestion,
} from '../../../shared/ai';
import { patchStudioSettings, readStudioSettings } from './studio-settings';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 90_000;

type Running = {
  provider: AiRuntimeProvider;
  cancelled: boolean;
  timedOut: boolean;
  child?: ChildProcess;
  query?: Query;
};

type Prepared = {
  kind: AiKind;
  prompt: string;
  sentSummary: string;
  sourceCounts: AiSourceCounts;
  sourceRefs: string[];
};

const failure = (code: AiErrorCode, handoff?: AiHandoff): AiGenerateResult => ({
  ok: false,
  code,
  message: AI_ERROR_MESSAGE[code],
  ...(handoff ? { handoff } : {}),
});

const countsOf = (context: { referencedPosts: number; referencedExperiments: number }): AiSourceCounts => ({
  posts: context.referencedPosts,
  experiments: context.referencedExperiments,
});

export class AiService {
  private running: Running | null = null;
  private rateLimited = false;
  private cliPath: string | null = null;
  private usageFlight: Promise<AiPlanUsage | null> | null = null;
  private lastUsage: AiPlanUsage | null = null;

  async status(): Promise<AiStatus> {
    const settings = await readStudioSettings();
    const provider = settings.aiProvider ?? 'auto';
    const cliFound = Boolean(await this.findClaude());
    if (provider === 'disabled') {
      return {
        provider,
        phase: 'disabled',
        label: 'AI：無効',
        detail: '手入力のまま制作と振り返りが完結します。従量課金のAPIは使いません。',
        cliFound,
      };
    }
    if (this.rateLimited) {
      return {
        provider,
        phase: 'limited',
        label: 'AI：上限',
        detail: 'Claudeの利用上限に達しました。課金APIには切り替えません。',
        cliFound,
      };
    }
    if (!cliFound) {
      return {
        provider,
        phase: 'manual',
        label: 'AI：手動のみ',
        detail: 'claude コマンドが見つかりません。ボタンを押すと、Claude Code に貼る文を作ります。',
        cliFound,
      };
    }
    return {
      provider,
      phase: 'ready',
      label: 'AI：Claude（サブスク）',
      detail: 'Claudeのサブスクリプションで候補を出します。動画は送らず、採用するまで保存しません。',
      cliFound,
    };
  }

  planUsage(): Promise<AiPlanUsage | null> {
    if (this.running) return Promise.resolve(this.lastUsage);
    if (this.usageFlight) return this.usageFlight;
    this.usageFlight = this.fetchPlanUsage().finally(() => {
      this.usageFlight = null;
    });
    return this.usageFlight;
  }

  async setProvider(provider: AiProviderChoice): Promise<AiStatus> {
    await patchStudioSettings({ aiProvider: provider });
    if (provider !== 'disabled') this.rateLimited = false;
    return this.status();
  }

  cancel(): void {
    if (!this.running) return;
    this.running.cancelled = true;
    this.running.child?.kill();
    this.running.query?.close();
  }

  async generate(raw: unknown): Promise<AiGenerateResult> {
    if (this.running) return failure('busy');
    const settings = await readStudioSettings();
    const choice = settings.aiProvider ?? 'auto';
    if (choice === 'disabled') return failure('disabled');
    const prepared = this.prepare(raw);
    if (!prepared.ok) return prepared.result;
    const chain = providersFor(choice);
    let last = failure('unavailable');
    for (const provider of chain) {
      if (provider === 'claude-code-handoff') {
        return {
          ok: true,
          provider,
          suggestions: [],
          sentSummary: prepared.value.sentSummary,
          handoff: await this.writeHandoff(prepared.value),
        };
      }
      const result = await this.runProvider(provider, prepared.value);
      if (result.ok) {
        this.rateLimited = false;
        return result;
      }
      if (result.code === 'rate_limited') this.rateLimited = true;
      if (result.code === 'cancelled' || result.code === 'timeout' || result.code === 'rate_limited' || result.code === 'busy') {
        return result;
      }
      last = result;
      if (!shouldContinue(choice, result.code)) break;
    }
    if (!last.ok && offerHandoff(last.code)) {
      return { ...last, handoff: await this.writeHandoff(prepared.value) };
    }
    return last;
  }

  parseHandoff(raw: unknown): AiGenerateResult {
    const request = raw as Partial<AiHandoffParseRequest>;
    if (!request || typeof request.text !== 'string' || typeof request.kind !== 'string') {
      return failure('invalid_output');
    }
    const interpreted = interpretModelOutput(request.kind as AiKind, request.text);
    if (!interpreted.ok) return failure(interpreted.code);
    const sourceCounts = request.sourceCounts ?? { posts: 0, experiments: 0 };
    const sourceRefs = Array.isArray(request.sourceRefs) ? request.sourceRefs.filter((item) => typeof item === 'string') : [];
    return {
      ok: true,
      provider: 'claude-code-handoff',
      suggestions: [this.suggestion('claude-code-handoff', request.kind as AiKind, interpreted, sourceCounts, sourceRefs)],
      sentSummary: AI_SENT[request.kind as AiKind],
    };
  }

  private prepare(raw: unknown): { ok: true; value: Prepared } | { ok: false; result: AiGenerateResult } {
    const request = raw as Partial<AiGenerateRequest> | null;
    if (!request || typeof request.kind !== 'string') return { ok: false, result: failure('invalid_output') };
    try {
      if (request.kind === 'captions' || request.kind === 'publishing') {
        const project = parseProject(request.project);
        const context = request.kind === 'captions' ? buildCaptionContext(project) : buildPublishingContext(project);
        const instruction = clipAiInstruction(request.instruction);
        const unsafe = findUnsafeContext(context) ?? (instruction ? findUnsafeContext(instruction) : null);
        if (unsafe) return { ok: false, result: failure('invalid_output') };
        return {
          ok: true,
          value: {
            kind: request.kind,
            prompt: buildPrompt(request.kind, context, instruction),
            sentSummary: AI_SENT[request.kind],
            sourceCounts: countsOf(context),
            sourceRefs: [`project:${project.id}`],
          },
        };
      }
      if (
        request.kind !== 'summary' &&
        request.kind !== 'hypothesis' &&
        request.kind !== 'notices' &&
        request.kind !== 'next-action'
      ) {
        return { ok: false, result: failure('invalid_output') };
      }
      const bundle = analyticsBundleSchema.parse(request.bundle);
      const post = bundle.posts.find((item) => item.id === request.postId);
      if (!post) return { ok: false, result: failure('invalid_output') };
      const context = contextFor(request.kind, bundle, post, request.draft);
      const unsafe = findUnsafeContext(context);
      if (unsafe) return { ok: false, result: failure('invalid_output') };
      return {
        ok: true,
        value: {
          kind: request.kind,
          prompt: buildPrompt(request.kind, context),
          sentSummary: sentSummaryFor(request.kind, context),
          sourceCounts: countsOf(context),
          sourceRefs: [`post:${post.id}`, ...(post.experimentId ? [`experiment:${post.experimentId}`] : [])],
        },
      };
    } catch {
      return { ok: false, result: failure('invalid_output') };
    }
  }

  private async runProvider(provider: AiRuntimeProvider, prepared: Prepared): Promise<AiGenerateResult> {
    if (!(await this.findClaude())) return failure('unavailable');
    const job: Running = { provider, cancelled: false, timedOut: false };
    this.running = job;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cv-ai-'));
    try {
      const text =
        provider === 'claude-local-agent'
          ? await this.runAgent(prepared.prompt, directory, job)
          : await this.runCli(prepared.prompt, directory, job);
      if (job.cancelled) return failure('cancelled');
      if (job.timedOut) return failure('timeout');
      const interpreted = interpretModelOutput(prepared.kind, text);
      if (!interpreted.ok) return failure(interpreted.code);
      return {
        ok: true,
        provider,
        suggestions: [this.suggestion(provider, prepared.kind, interpreted, prepared.sourceCounts, prepared.sourceRefs)],
        sentSummary: prepared.sentSummary,
      };
    } catch (error) {
      if (job.cancelled) return failure('cancelled');
      if (job.timedOut) return failure('timeout');
      const message = error instanceof Error ? error.message : '';
      const interpreted = interpretModelOutput(prepared.kind, message);
      if (!interpreted.ok && interpreted.code !== 'invalid_output') return failure(interpreted.code);
      return failure('unavailable');
    } finally {
      this.running = null;
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async runAgent(prompt: string, cwd: string, job: Running): Promise<string> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      job.timedOut = true;
      controller.abort();
      job.query?.close();
    }, TIMEOUT_MS);
    const options: Options = {
      cwd,
      maxTurns: 1,
      tools: [],
      permissionMode: 'dontAsk',
      settingSources: [],
      thinking: { type: 'disabled' },
      abortController: controller,
      env: omitApiCredentials(process.env),
    };
    try {
      const query = sdk.query({ prompt, options });
      job.query = query;
      let text = '';
      for await (const message of query) {
        if (message.type !== 'result') continue;
        text = resultText(message);
      }
      if (!text.trim()) throw new Error('empty');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runCli(prompt: string, cwd: string, job: Running): Promise<string> {
    const binary = await this.findClaude();
    if (!binary) throw new Error('not logged in: claude command missing');
    const args = ['-p', '--output-format', 'json', '--permission-mode', 'dontAsk', '--max-turns', '1'];
    const child = spawnClaude(binary, args, cwd);
    job.child = child;
    const timer = setTimeout(() => {
      job.timedOut = true;
      child.kill();
    }, TIMEOUT_MS);
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => resolve(exitCode ?? 1));
    }).finally(() => clearTimeout(timer));
    if (job.cancelled || job.timedOut) return '';
    if (code !== 0 && !stdout.trim()) throw new Error(stderr || stdout || 'unavailable');
    return stdout || stderr;
  }

  private suggestion(
    provider: AiRuntimeProvider,
    kind: AiKind,
    interpreted: Extract<ReturnType<typeof interpretModelOutput>, { ok: true }>,
    sourceCounts: AiSourceCounts,
    sourceRefs: string[],
  ): AiSuggestion {
    return {
      id: randomUUID(),
      kind,
      provider,
      createdAt: new Date().toISOString(),
      sourceRefs,
      rationale: interpreted.rationale,
      status: 'proposed',
      sourceCounts,
      disclaimer: analysisDisclaimer(kind),
      payload: interpreted.payload,
    };
  }

  private async writeHandoff(prepared: Prepared): Promise<AiHandoff> {
    const directory = path.join(app.getPath('userData'), 'ai-handoff');
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${prepared.kind}.json`);
    const handoff: AiHandoff = {
      kind: prepared.kind,
      prompt: prepared.prompt,
      filePath,
      sourceCounts: prepared.sourceCounts,
      sourceRefs: prepared.sourceRefs,
    };
    await writeFile(
      filePath,
      JSON.stringify({ prompt: prepared.prompt, sourceCounts: prepared.sourceCounts, sourceRefs: prepared.sourceRefs }, null, 2),
      'utf8',
    );
    return handoff;
  }

  private async fetchPlanUsage(): Promise<AiPlanUsage | null> {
    const settings = await readStudioSettings();
    if ((settings.aiProvider ?? 'auto') === 'disabled') return null;
    if (!(await this.findClaude())) return null;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cv-usage-'));
    let release = (): void => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prompt = {
      async *[Symbol.asyncIterator]() {
        await done;
      },
    };
    try {
      const sdk = await import('@anthropic-ai/claude-agent-sdk');
      const session = sdk.query({
        prompt: prompt as AsyncIterable<SDKUserMessage>,
        options: {
          cwd: directory,
          tools: [],
          maxTurns: 1,
          permissionMode: 'dontAsk',
          settingSources: [],
          persistSession: false,
          thinking: { type: 'disabled' },
          env: omitApiCredentials(process.env),
        },
      });
      const timer = setTimeout(() => session.close(), 20_000);
      try {
        const usage = await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true,
        });
        const plan = usage.rate_limits_available ? planUsageFromRateLimits(usage.rate_limits) : null;
        this.lastUsage = plan;
        return plan;
      } finally {
        clearTimeout(timer);
        release();
        session.close();
      }
    } catch {
      return this.lastUsage;
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async findClaude(): Promise<string | null> {
    if (this.cliPath) return this.cliPath;
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', name),
      path.join(os.homedir(), '.claude', 'local', name),
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        this.cliPath = candidate;
        return candidate;
      } catch {
        // 次の候補を見る。
      }
    }
    try {
      const command = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(command, ['claude'], { windowsHide: true });
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const executable = lines.find((line) => line.toLowerCase().endsWith('.exe')) ?? lines[0] ?? null;
      if (executable) this.cliPath = executable;
      return executable;
    } catch {
      return null;
    }
  }
}

const contextFor = (
  kind: 'summary' | 'hypothesis' | 'notices' | 'next-action',
  bundle: ReturnType<typeof analyticsBundleSchema.parse>,
  post: AnalyticsPost,
  draft: ReviewDraft | undefined,
) => {
  if (kind === 'summary') return buildSummaryContext(bundle, post);
  if (kind === 'hypothesis') return buildHypothesisContext(bundle, post);
  if (kind === 'notices') return buildNoticesContext(bundle, post, draft);
  return buildNextActionContext(bundle, post, draft);
};

const sentSummaryFor = (
  kind: AiKind,
  context: { cohort?: { count: number } },
): string => {
  if (kind === 'summary' && context.cohort) {
    return `この投稿の数字・作り方と、比較${context.cohort.count}件の平均（動画は送りません）`;
  }
  return AI_SENT[kind];
};

const resultText = (message: SDKResultMessage): string => {
  if (message.subtype === 'success') return message.result;
  return message.errors.join('\n');
};

const spawnClaude = (binary: string, args: string[], cwd: string): ChildProcess => {
  const env = omitApiCredentials(process.env);
  const options = { cwd, env, windowsHide: true, shell: false as const };
  if (process.platform === 'win32' && binary.toLowerCase().endsWith('.cmd')) {
    return spawn(binary, args, { ...options, shell: true });
  }
  return spawn(binary, args, options);
};
