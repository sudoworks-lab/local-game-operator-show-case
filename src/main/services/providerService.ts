import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type {
  ProviderDecision,
  ProviderHealth,
} from '../../shared/contracts';
import type {
  AnalyzeFrameInput,
  DecisionProvider,
  HttpProviderConfig,
  ProviderConfig,
  ProviderConfigFile,
} from '../types/provider';

const FALLBACK_CONFIG: ProviderConfigFile = {
  activeProvider: 'mock',
  providers: {
    mock: {
      type: 'mock',
      label: 'Built-in Mock Provider',
    },
  },
};

const DEFAULT_TIMEOUT_MS = 2500;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const summarizePayload = (payload: unknown): string => {
  if (payload === null || payload === undefined) {
    return 'No payload returned.';
  }

  if (typeof payload === 'string') {
    return payload.slice(0, 240);
  }

  if (typeof payload === 'object') {
    return JSON.stringify(payload).slice(0, 240);
  }

  return String(payload);
};

class MockDecisionProvider implements DecisionProvider {
  readonly type = 'mock' as const;

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly configPath: string,
  ) {}

  async getHealth(): Promise<ProviderHealth> {
    return {
      ok: true,
      providerId: this.id,
      providerLabel: this.label,
      type: this.type,
      checkedAt: new Date().toISOString(),
      details:
        'Built-in mock provider is active. It always returns a deterministic noop-style decision.',
      configPath: this.configPath,
    };
  }

  async analyzeFrame(input: AnalyzeFrameInput): Promise<ProviderDecision> {
    const sourceHint = input.imagePath ? path.basename(input.imagePath) : 'buffer-only';
    return {
      success: true,
      providerId: this.id,
      providerLabel: this.label,
      type: this.type,
      analyzedAt: new Date().toISOString(),
      confidence: 0.42,
      state: 'idle',
      nextAction: 'noop',
      summary: `Mock provider inspected ${sourceHint} and returned a fixed noop decision.`,
      raw: {
        context: input.context ?? {},
      },
    };
  }
}

class HttpDecisionProvider implements DecisionProvider {
  readonly type = 'http' as const;

  private readonly timeoutMs: number;

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly config: HttpProviderConfig,
    private readonly configPath: string,
  ) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getHealth(): Promise<ProviderHealth> {
    const healthUrl = this.config.healthEndpoint ?? this.config.endpoint;
    const startedAt = Date.now();

    try {
      const response = await this.fetchWithTimeout(healthUrl, {
        method: 'GET',
        headers: this.config.headers,
      });

      return {
        ok: response.ok,
        providerId: this.id,
        providerLabel: this.label,
        type: this.type,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        details: response.ok
          ? 'HTTP provider endpoint is reachable.'
          : `HTTP provider returned ${response.status}.`,
        endpoint: healthUrl,
        configPath: this.configPath,
      };
    } catch (error) {
      return {
        ok: false,
        providerId: this.id,
        providerLabel: this.label,
        type: this.type,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        details: toErrorMessage(error),
        endpoint: healthUrl,
        configPath: this.configPath,
      };
    }
  }

  async analyzeFrame(input: AnalyzeFrameInput): Promise<ProviderDecision> {
    const response = await this.fetchWithTimeout(this.config.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify({
        imagePath: input.imagePath,
        imageBase64: input.imageBuffer?.toString('base64'),
        context: input.context ?? {},
      }),
    });

    const raw = await this.parseResponseBody(response);
    if (!response.ok) {
      throw new Error(
        `HTTP provider returned ${response.status}: ${summarizePayload(raw)}`,
      );
    }

    const parsed = raw as Record<string, unknown>;
    return {
      success: true,
      providerId: this.id,
      providerLabel: this.label,
      type: this.type,
      analyzedAt: new Date().toISOString(),
      confidence:
        typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      state: typeof parsed.state === 'string' ? parsed.state : 'unknown',
      nextAction:
        typeof parsed.nextAction === 'string' ? parsed.nextAction : 'noop',
      summary:
        typeof parsed.summary === 'string'
          ? parsed.summary
          : 'HTTP provider returned a response.',
      raw,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
}

export class ProviderService {
  private providerInstance: DecisionProvider | null = null;

  private configPath = '';

  async getHealth(): Promise<ProviderHealth> {
    const provider = await this.resolveProvider();
    return provider.getHealth();
  }

  async analyzeFrame(input: AnalyzeFrameInput): Promise<ProviderDecision> {
    const provider = await this.resolveProvider();
    return provider.analyzeFrame(input);
  }

  async getConfigPath(): Promise<string> {
    await this.resolveProvider();
    return this.configPath;
  }

  private async resolveProvider(): Promise<DecisionProvider> {
    if (this.providerInstance) {
      return this.providerInstance;
    }

    const { config, configPath } = await this.loadConfig();
    this.configPath = configPath;

    const activeConfig = config.providers[config.activeProvider];
    const fallbackConfig =
      activeConfig ?? config.providers.mock ?? FALLBACK_CONFIG.providers.mock;
    const providerId = activeConfig ? config.activeProvider : 'mock';

    this.providerInstance = this.createProvider(
      providerId,
      fallbackConfig,
      configPath,
    );
    return this.providerInstance;
  }

  private createProvider(
    providerId: string,
    providerConfig: ProviderConfig,
    configPath: string,
  ): DecisionProvider {
    if (providerConfig.type === 'http') {
      return new HttpDecisionProvider(
        providerId,
        providerConfig.label ?? 'Local HTTP Provider',
        providerConfig,
        configPath,
      );
    }

    return new MockDecisionProvider(
      providerId,
      providerConfig.label ?? 'Built-in Mock Provider',
      configPath,
    );
  }

  private async loadConfig(): Promise<{
    config: ProviderConfigFile;
    configPath: string;
  }> {
    const candidates = this.resolveConfigCandidates();

    for (const candidate of candidates) {
      if (!candidate || !existsSync(candidate)) {
        continue;
      }

      const file = await fs.readFile(candidate, 'utf8');
      const parsed = JSON.parse(file) as ProviderConfigFile;
      return {
        config: parsed,
        configPath: candidate,
      };
    }

    return {
      config: FALLBACK_CONFIG,
      configPath: 'built-in fallback',
    };
  }

  private resolveConfigCandidates(): string[] {
    const appRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();

    return [
      process.env.LOCAL_GAME_OPERATOR_PROVIDER_CONFIG ?? '',
      path.join(appRoot, 'config', 'providers.local.json'),
      path.join(appRoot, 'config', 'providers.example.json'),
    ].filter(Boolean);
  }
}
