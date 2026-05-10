export const SUPPORTED_KEYS = [
  'W',
  'A',
  'S',
  'D',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'Space',
  'Enter',
  'Esc',
  'Shift',
  'E',
  'F',
  'R',
  'Up',
  'Down',
  'Left',
  'Right',
] as const;

export type SupportedKey = (typeof SUPPORTED_KEYS)[number];
export type ProviderType = 'mock' | 'http';

export interface WindowSummary {
  hwnd: string;
  title: string;
  processId: number | null;
  processName: string | null;
  className: string | null;
  isVisible: boolean;
  isForeground: boolean;
  isMinimized?: boolean;
  bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  captureAvailable: boolean;
  captureSourceId?: string | null;
  captureSourceName?: string | null;
}

export interface CommandResult {
  success: boolean;
  command: string;
  message: string;
  timestamp: string;
  hwnd?: string;
  key?: string;
  keys?: string[];
  ms?: number;
  cancelled?: boolean;
  details?: Record<string, unknown>;
}

export interface CapturePreview {
  success: boolean;
  hwnd: string;
  sourceId: string;
  sourceName: string;
  width: number;
  height: number;
  dataUrl: string;
  capturedAt: string;
}

export interface CaptureSaveResult {
  success: boolean;
  hwnd: string;
  sourceId: string;
  sourceName: string;
  width: number;
  height: number;
  filePath: string;
  capturedAt: string;
}

export interface ProviderHealth {
  ok: boolean;
  providerId: string;
  providerLabel: string;
  type: ProviderType;
  checkedAt: string;
  latencyMs?: number;
  details?: string;
  configPath?: string;
  endpoint?: string;
}

export interface ProviderDecision {
  success: boolean;
  providerId: string;
  providerLabel: string;
  type: ProviderType;
  analyzedAt: string;
  confidence: number;
  state: string;
  nextAction: string;
  summary: string;
  screenshotPath?: string;
  raw?: unknown;
}

export interface AppLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  targetWindow?: string;
  hwnd?: string;
  command: string;
  success: boolean;
  message: string;
  providerSummary?: string;
  screenshotPath?: string;
  details?: Record<string, unknown>;
}

export interface HelperAvailability {
  available: boolean;
  powershellPath?: string;
  helperScriptPath?: string;
  reason?: string;
}

export interface BootstrapPayload {
  helper: HelperAvailability;
  providerHealth: ProviderHealth;
  logs: AppLogEntry[];
  directories: {
    userData: string;
    logs: string;
    captures: string;
  };
  platform: string;
}

export interface GameOperatorApi {
  bootstrap(): Promise<BootstrapPayload>;
  listWindows(): Promise<WindowSummary[]>;
  focusWindow(hwnd: string): Promise<CommandResult>;
  tapKey(hwnd: string, key: SupportedKey): Promise<CommandResult>;
  holdKey(hwnd: string, key: SupportedKey, ms: number): Promise<CommandResult>;
  keyDown(hwnd: string, key: SupportedKey): Promise<CommandResult>;
  keyUp(hwnd: string, key: SupportedKey): Promise<CommandResult>;
  runSequence(
    hwnd: string,
    keys: SupportedKey[],
    delayMs?: number,
  ): Promise<CommandResult>;
  releaseAllKeys(): Promise<CommandResult>;
  capturePreview(hwnd: string): Promise<CapturePreview>;
  saveScreenshot(hwnd: string): Promise<CaptureSaveResult>;
  getProviderHealth(): Promise<ProviderHealth>;
  analyzeWindow(hwnd: string): Promise<ProviderDecision>;
  emergencyStop(): Promise<CommandResult>;
  onLogEntry(listener: (entry: AppLogEntry) => void): () => void;
}
