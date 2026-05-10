import type {
  ProviderDecision,
  ProviderHealth,
  ProviderType,
} from '../../shared/contracts';

export interface AnalyzeFrameInput {
  imagePath?: string;
  imageBuffer?: Buffer;
  context?: Record<string, unknown>;
}

export interface MockProviderConfig {
  type: 'mock';
  label?: string;
}

export interface HttpProviderConfig {
  type: 'http';
  label?: string;
  endpoint: string;
  healthEndpoint?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export type ProviderConfig = MockProviderConfig | HttpProviderConfig;

export interface ProviderConfigFile {
  activeProvider: string;
  providers: Record<string, ProviderConfig>;
}

export interface DecisionProvider {
  id: string;
  label: string;
  type: ProviderType;
  getHealth(): Promise<ProviderHealth>;
  analyzeFrame(input: AnalyzeFrameInput): Promise<ProviderDecision>;
}
