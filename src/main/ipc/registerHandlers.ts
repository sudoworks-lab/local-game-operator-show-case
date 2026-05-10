import { app, BrowserWindow, ipcMain } from 'electron';
import type {
  AppLogEntry,
  CapturePreview,
  CaptureSaveResult,
  CommandResult,
  ProviderDecision,
  ProviderHealth,
  SupportedKey,
  WindowSummary,
} from '../../shared/contracts';
import { CaptureService } from '../services/captureService';
import { HelperBridge } from '../services/helperBridge';
import { LoggingService } from '../services/loggingService';
import { ProviderService } from '../services/providerService';

interface MainServices {
  captureService: CaptureService;
  helperBridge: HelperBridge;
  loggingService: LoggingService;
  providerService: ProviderService;
}

interface InputPayload {
  hwnd: string;
  key: SupportedKey;
}

interface HoldPayload extends InputPayload {
  ms: number;
}

interface SequencePayload {
  hwnd: string;
  keys: SupportedKey[];
  delayMs?: number;
}

const CHANNELS = [
  'app:bootstrap',
  'windows:list',
  'window:focus',
  'input:tap',
  'input:hold',
  'input:keydown',
  'input:keyup',
  'input:sequence',
  'input:release-all',
  'capture:preview',
  'capture:save',
  'provider:health',
  'provider:analyze',
  'system:emergency-stop',
] as const;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const registerHandlers = (
  getMainWindow: () => BrowserWindow | null,
  services: MainServices,
): void => {
  const {
    captureService,
    helperBridge,
    loggingService,
    providerService,
  } = services;

  const emitLog = (entry: AppLogEntry): void => {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('logs:entry', entry);
    }
  };

  loggingService.subscribe(emitLog);

  for (const channel of CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  const listWindowsWithCapture = async (): Promise<WindowSummary[]> => {
    const [windows, sources] = await Promise.all([
      helperBridge.listWindows(),
      captureService.listWindowSources().catch(() => []),
    ]);

    const sourceByHwnd = new Map(
      sources
        .filter((source) => source.hwnd)
        .map((source) => [source.hwnd as string, source]),
    );

    return windows
      .map((window) => {
        const captureSource =
          sourceByHwnd.get(window.hwnd) ??
          sources.find((source) => source.name === window.title);

        return {
          ...window,
          captureAvailable: Boolean(captureSource),
          captureSourceId: captureSource?.id ?? null,
          captureSourceName: captureSource?.name ?? null,
        };
      })
      .sort((left, right) => {
        if (left.isForeground === right.isForeground) {
          return left.title.localeCompare(right.title);
        }

        return left.isForeground ? -1 : 1;
      });
  };

  const resolveTargetWindow = async (
    hwnd: string,
  ): Promise<WindowSummary | undefined> =>
    (await listWindowsWithCapture()).find((window) => window.hwnd === hwnd);

  const logAction = async (input: {
    command: string;
    success: boolean;
    message: string;
    hwnd?: string;
    targetWindow?: string;
    providerSummary?: string;
    screenshotPath?: string;
    details?: Record<string, unknown>;
  }): Promise<void> => {
    await loggingService.log({
      level: input.success ? 'info' : 'error',
      command: input.command,
      success: input.success,
      message: input.message,
      hwnd: input.hwnd,
      targetWindow: input.targetWindow,
      providerSummary: input.providerSummary,
      screenshotPath: input.screenshotPath,
      details: input.details,
    });
  };

  const withCommandLog = async <T>(
    args: {
      command: string;
      hwnd?: string;
      targetWindow?: string;
      providerSummary?: string;
      screenshotPath?: string;
      extractMessage: (result: T) => string;
      extractDetails?: (result: T) => Record<string, unknown> | undefined;
    },
    run: () => Promise<T>,
  ): Promise<T> => {
    try {
      const result = await run();
      await logAction({
        command: args.command,
        success: true,
        message: args.extractMessage(result),
        hwnd: args.hwnd,
        targetWindow: args.targetWindow,
        providerSummary: args.providerSummary,
        screenshotPath: args.screenshotPath,
        details: args.extractDetails?.(result),
      });
      return result;
    } catch (error) {
      await logAction({
        command: args.command,
        success: false,
        message: toErrorMessage(error),
        hwnd: args.hwnd,
        targetWindow: args.targetWindow,
      });
      throw error;
    }
  };

  ipcMain.handle('app:bootstrap', async () => {
    await loggingService.initialize();
    const providerHealth = await providerService.getHealth();

    return {
      helper: helperBridge.getAvailability(),
      providerHealth,
      logs: loggingService.getEntries(),
      directories: {
        userData: app.getPath('userData'),
        logs: loggingService.getLogDirectory(),
        captures: await captureService.getCaptureDirectory(),
      },
      platform: process.platform,
    };
  });

  ipcMain.handle('windows:list', async () =>
    withCommandLog<WindowSummary[]>(
      {
        command: 'windows:list',
        extractMessage: (windows) => `Refreshed ${windows.length} top-level windows.`,
      },
      listWindowsWithCapture,
    ));

  ipcMain.handle('window:focus', async (_event, hwnd: string) => {
    const target = await resolveTargetWindow(hwnd);
    return withCommandLog<CommandResult>(
      {
        command: 'window:focus',
        hwnd,
        targetWindow: target?.title,
        extractMessage: (result) => result.message,
        extractDetails: (result) => result.details,
      },
      () => helperBridge.focusWindow(hwnd),
    );
  });

  ipcMain.handle('input:tap', async (_event, payload: InputPayload) => {
    const target = await resolveTargetWindow(payload.hwnd);
    return withCommandLog<CommandResult>(
      {
        command: 'input:tap',
        hwnd: payload.hwnd,
        targetWindow: target?.title,
        extractMessage: (result) => result.message,
        extractDetails: (result) => result.details,
      },
      () => helperBridge.tapKey(payload.hwnd, payload.key),
    );
  });

  ipcMain.handle('input:keydown', async (_event, payload: InputPayload) => {
    const target = await resolveTargetWindow(payload.hwnd);
    return withCommandLog<CommandResult>(
      {
        command: 'input:keydown',
        hwnd: payload.hwnd,
        targetWindow: target?.title,
        extractMessage: (result) => result.message,
        extractDetails: (result) => result.details,
      },
      () => helperBridge.keyDown(payload.hwnd, payload.key),
    );
  });

  ipcMain.handle('input:keyup', async (_event, payload: InputPayload) => {
    const target = await resolveTargetWindow(payload.hwnd);
    return withCommandLog<CommandResult>(
      {
        command: 'input:keyup',
        hwnd: payload.hwnd,
        targetWindow: target?.title,
        extractMessage: (result) => result.message,
        extractDetails: (result) => result.details,
      },
      () => helperBridge.keyUp(payload.hwnd, payload.key),
    );
  });

  ipcMain.handle('input:hold', async (_event, payload: HoldPayload) => {
    const target = await resolveTargetWindow(payload.hwnd);
    return withCommandLog<CommandResult>(
      {
        command: 'input:hold',
        hwnd: payload.hwnd,
        targetWindow: target?.title,
        extractMessage: (result) => result.message,
        extractDetails: (result) => result.details,
      },
      () => helperBridge.holdKey(payload.hwnd, payload.key, payload.ms),
    );
  });

  ipcMain.handle('input:sequence', async (_event, payload: SequencePayload) => {
    const target = await resolveTargetWindow(payload.hwnd);
    return withCommandLog<CommandResult>(
      {
        command: 'input:sequence',
        hwnd: payload.hwnd,
        targetWindow: target?.title,
        extractMessage: (result) => result.message,
        extractDetails: (result) => result.details,
      },
      () =>
        helperBridge.runSequence(payload.hwnd, payload.keys, payload.delayMs),
    );
  });

  ipcMain.handle('input:release-all', async () =>
    withCommandLog<CommandResult>(
      {
        command: 'input:release-all',
        extractMessage: (result) => result.message,
        extractDetails: (result) => result.details,
      },
      () => helperBridge.releaseAllKeys(),
    ));

  ipcMain.handle('capture:preview', async (_event, hwnd: string) => {
    const target = await resolveTargetWindow(hwnd);
    return withCommandLog<CapturePreview>(
      {
        command: 'capture:preview',
        hwnd,
        targetWindow: target?.title,
        extractMessage: (result) =>
          `Updated preview from ${result.sourceName} (${result.width}x${result.height}).`,
      },
      () => captureService.capturePreview(hwnd),
    );
  });

  ipcMain.handle('capture:save', async (_event, hwnd: string) => {
    const target = await resolveTargetWindow(hwnd);
    return withCommandLog<CaptureSaveResult>(
      {
        command: 'capture:save',
        hwnd,
        targetWindow: target?.title,
        extractMessage: (result) => `Saved screenshot to ${result.filePath}.`,
        extractDetails: (result) => ({
          filePath: result.filePath,
          sourceId: result.sourceId,
        }),
      },
      async () => captureService.saveScreenshot(hwnd),
    );
  });

  ipcMain.handle('provider:health', async () =>
    withCommandLog<ProviderHealth>(
      {
        command: 'provider:health',
        extractMessage: (result) =>
          `${result.providerLabel}: ${result.ok ? 'healthy' : 'unhealthy'}${
            result.details ? ` (${result.details})` : ''
          }`,
      },
      () => providerService.getHealth(),
    ));

  ipcMain.handle('provider:analyze', async (_event, hwnd: string) => {
    const target = await resolveTargetWindow(hwnd);
    return withCommandLog<ProviderDecision>(
      {
        command: 'provider:analyze',
        hwnd,
        targetWindow: target?.title,
        extractMessage: (result) => result.summary,
        extractDetails: (result) => ({
          state: result.state,
          nextAction: result.nextAction,
          confidence: result.confidence,
          screenshotPath: result.screenshotPath,
        }),
      },
      async () => {
        const capture = await captureService.captureForProvider(hwnd);
        const decision = await providerService.analyzeFrame({
          imagePath: capture.filePath,
          imageBuffer: capture.buffer,
          context: {
            hwnd,
            windowTitle: target?.title ?? capture.sourceName,
            sourceId: capture.sourceId,
            capturedAt: capture.capturedAt,
          },
        });

        const annotatedDecision: ProviderDecision = {
          ...decision,
          screenshotPath: capture.filePath,
        };

        await logAction({
          command: 'provider:decision',
          success: true,
          message: annotatedDecision.summary,
          hwnd,
          targetWindow: target?.title,
          providerSummary: `${annotatedDecision.state} -> ${annotatedDecision.nextAction} (${annotatedDecision.confidence})`,
          screenshotPath: capture.filePath,
        });

        return annotatedDecision;
      },
    );
  });

  ipcMain.handle('system:emergency-stop', async () =>
    withCommandLog<CommandResult>(
      {
        command: 'system:emergency-stop',
        extractMessage: (result) => result.message,
        extractDetails: (result) => result.details,
      },
      () => helperBridge.emergencyStop(),
    ));
};
