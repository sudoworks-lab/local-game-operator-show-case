import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppLogEntry,
  CapturePreview,
  CaptureSaveResult,
  CommandResult,
  GameOperatorApi,
  ProviderDecision,
  ProviderHealth,
  SupportedKey,
  WindowSummary,
} from '../shared/contracts';

const api: GameOperatorApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  listWindows: () => ipcRenderer.invoke('windows:list') as Promise<WindowSummary[]>,
  focusWindow: (hwnd: string) =>
    ipcRenderer.invoke('window:focus', hwnd) as Promise<CommandResult>,
  tapKey: (hwnd: string, key: SupportedKey) =>
    ipcRenderer.invoke('input:tap', { hwnd, key }) as Promise<CommandResult>,
  holdKey: (hwnd: string, key: SupportedKey, ms: number) =>
    ipcRenderer.invoke('input:hold', { hwnd, key, ms }) as Promise<CommandResult>,
  keyDown: (hwnd: string, key: SupportedKey) =>
    ipcRenderer.invoke('input:keydown', { hwnd, key }) as Promise<CommandResult>,
  keyUp: (hwnd: string, key: SupportedKey) =>
    ipcRenderer.invoke('input:keyup', { hwnd, key }) as Promise<CommandResult>,
  runSequence: (hwnd: string, keys: SupportedKey[], delayMs?: number) =>
    ipcRenderer.invoke('input:sequence', {
      hwnd,
      keys,
      delayMs,
    }) as Promise<CommandResult>,
  releaseAllKeys: () =>
    ipcRenderer.invoke('input:release-all') as Promise<CommandResult>,
  capturePreview: (hwnd: string) =>
    ipcRenderer.invoke('capture:preview', hwnd) as Promise<CapturePreview>,
  saveScreenshot: (hwnd: string) =>
    ipcRenderer.invoke('capture:save', hwnd) as Promise<CaptureSaveResult>,
  getProviderHealth: () =>
    ipcRenderer.invoke('provider:health') as Promise<ProviderHealth>,
  analyzeWindow: (hwnd: string) =>
    ipcRenderer.invoke('provider:analyze', hwnd) as Promise<ProviderDecision>,
  emergencyStop: () =>
    ipcRenderer.invoke('system:emergency-stop') as Promise<CommandResult>,
  onLogEntry: (listener: (entry: AppLogEntry) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, entry: AppLogEntry) => {
      listener(entry);
    };

    ipcRenderer.on('logs:entry', wrapped);
    return () => {
      ipcRenderer.removeListener('logs:entry', wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('gameOperator', api);
