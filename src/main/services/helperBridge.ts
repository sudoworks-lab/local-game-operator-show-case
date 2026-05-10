import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type {
  CommandResult,
  HelperAvailability,
  SupportedKey,
  WindowSummary,
} from '../../shared/contracts';

interface HelperEnvelope<TPayload extends object> {
  success: boolean;
  command?: string;
  message?: string;
  timestamp?: string;
  error?: {
    message?: string;
  };
  payload?: TPayload;
}

interface ActiveHelperOperation {
  child: ChildProcessWithoutNullStreams;
  command: string;
  cancelFilePath: string;
}

const POWERSHELL_IN_WSL =
  'powershell.exe';

const INTERRUPT_GUARD_COMMANDS = new Set([
  'focus',
  'tap',
  'keydown',
  'keyup',
  'hold',
  'sequence',
]);

const isRunningInWsl = (): boolean =>
  Boolean(process.env.WSL_DISTRO_NAME) ||
  os.release().toLowerCase().includes('microsoft');

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class HelperBridge {
  private activeOperation: ActiveHelperOperation | null = null;

  getAvailability(): HelperAvailability {
    const powershellPath = this.resolvePowerShellPath();
    const helperScriptPath = this.resolveHelperScriptPath();

    if (!powershellPath) {
      return {
        available: false,
        reason:
          'powershell.exe was not found. This helper only supports Windows or WSL interop.',
      };
    }

    if (!helperScriptPath) {
      return {
        available: false,
        reason: 'tools/windows/input-bridge.ps1 could not be resolved.',
      };
    }

    return {
      available: true,
      powershellPath,
      helperScriptPath,
    };
  }

  async listWindows(): Promise<WindowSummary[]> {
    const response = await this.invoke<{ windows?: WindowSummary[] }>(
      ['list-windows'],
      { allowWhileBusy: true },
    );
    return response.windows ?? [];
  }

  async focusWindow(hwnd: string): Promise<CommandResult> {
    return this.invokeCommand(['focus', '--hwnd', hwnd]);
  }

  async tapKey(hwnd: string, key: SupportedKey): Promise<CommandResult> {
    return this.invokeCommand(['tap', '--hwnd', hwnd, '--key', key]);
  }

  async keyDown(hwnd: string, key: SupportedKey): Promise<CommandResult> {
    return this.invokeCommand(['keydown', '--hwnd', hwnd, '--key', key]);
  }

  async keyUp(hwnd: string, key: SupportedKey): Promise<CommandResult> {
    return this.invokeCommand(['keyup', '--hwnd', hwnd, '--key', key]);
  }

  async holdKey(
    hwnd: string,
    key: SupportedKey,
    ms: number,
  ): Promise<CommandResult> {
    return this.invokeCommand(
      ['hold', '--hwnd', hwnd, '--key', key, '--ms', String(ms)],
      { cancellable: true },
    );
  }

  async runSequence(
    hwnd: string,
    keys: SupportedKey[],
    delayMs = 120,
  ): Promise<CommandResult> {
    return this.invokeCommand(
      [
        'sequence',
        '--hwnd',
        hwnd,
        '--keys',
        keys.join(','),
        '--delay-ms',
        String(delayMs),
      ],
      { cancellable: true },
    );
  }

  async releaseAllKeys(): Promise<CommandResult> {
    return this.invokeCommand(['release-all'], { allowWhileBusy: true });
  }

  async emergencyStop(): Promise<CommandResult> {
    const activeOperation = this.activeOperation;

    if (activeOperation) {
      await fs
        .writeFile(activeOperation.cancelFilePath, 'cancelled', 'utf8')
        .catch(() => undefined);
      await this.waitForProcessExit(activeOperation.child, 1500);

      if (activeOperation.child.exitCode === null && !activeOperation.child.killed) {
        activeOperation.child.kill();
      }
    }

    let releaseMessage = 'Sent release-all as a safety fallback.';
    try {
      const releaseResult = await this.releaseAllKeys();
      releaseMessage = releaseResult.message;
    } catch (error) {
      releaseMessage = `release-all failed: ${toErrorMessage(error)}`;
    }

    return {
      success: true,
      command: 'emergency-stop',
      message: activeOperation
        ? `Cancellation requested. ${releaseMessage}`
        : `No running helper sequence was active. ${releaseMessage}`,
      timestamp: new Date().toISOString(),
      cancelled: Boolean(activeOperation),
      details: {
        interruptedCommand: activeOperation?.command ?? null,
      },
    };
  }

  private async invokeCommand(
    args: string[],
    options: {
      cancellable?: boolean;
      allowWhileBusy?: boolean;
    } = {},
  ): Promise<CommandResult> {
    const result = await this.invoke<Record<string, unknown>>(args, options);

    return {
      success: true,
      command: String(result.command ?? args[0]),
      message: String(result.message ?? `${args[0]} completed.`),
      timestamp: String(result.timestamp ?? new Date().toISOString()),
      hwnd: typeof result.hwnd === 'string' ? result.hwnd : undefined,
      key: typeof result.key === 'string' ? result.key : undefined,
      keys: Array.isArray(result.keys)
        ? result.keys.map((item) => String(item))
        : undefined,
      ms: typeof result.ms === 'number' ? result.ms : undefined,
      cancelled:
        typeof result.cancelled === 'boolean' ? result.cancelled : undefined,
      details:
        typeof result.details === 'object' && result.details !== null
          ? (result.details as Record<string, unknown>)
          : undefined,
    };
  }

  private async invoke<TPayload extends object>(
    args: string[],
    options: {
      cancellable?: boolean;
      allowWhileBusy?: boolean;
    } = {},
  ): Promise<TPayload & { command?: string; message?: string; timestamp?: string }> {
    if (
      this.activeOperation &&
      !options.allowWhileBusy &&
      INTERRUPT_GUARD_COMMANDS.has(args[0])
    ) {
      throw new Error(
        `Another long-running helper command is active (${this.activeOperation.command}). Stop it before sending more keyboard input.`,
      );
    }

    const availability = this.getAvailability();
    if (
      !availability.available ||
      !availability.powershellPath ||
      !availability.helperScriptPath
    ) {
      throw new Error(availability.reason ?? 'PowerShell helper is unavailable.');
    }

    const powershellPath = availability.powershellPath;
    const helperScriptPath = availability.helperScriptPath;

    const cancelFilePath = options.cancellable
      ? path.join(
          os.tmpdir(),
          `local-game-operator-${Date.now()}-${Math.random()
            .toString(16)
            .slice(2, 10)}.cancel`,
        )
      : undefined;

    const spawnArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperScriptPath,
      ...args,
    ];

    if (cancelFilePath) {
      spawnArgs.push('--cancel-file', cancelFilePath);
    }

    return new Promise((resolve, reject) => {
      const child: ChildProcessWithoutNullStreams = spawn(
        powershellPath,
        spawnArgs,
        {
          stdio: 'pipe',
        },
      );
      let stdout = '';
      let stderr = '';

      if (cancelFilePath) {
        this.activeOperation = {
          child,
          command: args[0],
          cancelFilePath,
        };
      }

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', async (error: Error) => {
        if (this.activeOperation?.child === child) {
          this.activeOperation = null;
        }

        if (cancelFilePath) {
          await fs.rm(cancelFilePath, { force: true }).catch(() => undefined);
        }

        reject(error);
      });

      child.on('close', async (code: number | null) => {
        if (this.activeOperation?.child === child) {
          this.activeOperation = null;
        }

        if (cancelFilePath) {
          await fs.rm(cancelFilePath, { force: true }).catch(() => undefined);
        }

        const rawOutput = stdout.trim() || stderr.trim();
        if (!rawOutput) {
          reject(
            new Error(
              `Helper command "${args[0]}" exited with code ${code ?? 'null'} and no JSON output.`,
            ),
          );
          return;
        }

        let parsed: HelperEnvelope<TPayload> & TPayload;
        try {
          parsed = JSON.parse(rawOutput) as HelperEnvelope<TPayload> & TPayload;
        } catch {
          reject(new Error(`Failed to parse helper JSON output: ${rawOutput}`));
          return;
        }

        if (code !== 0 || parsed.success === false) {
          reject(
            new Error(
              parsed.error?.message ??
                parsed.message ??
                stderr.trim() ??
                `Helper command "${args[0]}" failed.`,
            ),
          );
          return;
        }

        resolve(parsed);
      });
    });
  }

  private async waitForProcessExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, timeoutMs);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private resolvePowerShellPath(): string | undefined {
    if (process.platform === 'win32') {
      return 'powershell.exe';
    }

    if (isRunningInWsl()) {
      return POWERSHELL_IN_WSL;
    }

    return undefined;
  }

  private resolveHelperScriptPath(): string | undefined {
    const appRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const candidates = [
      path.join(appRoot, 'tools', 'windows', 'input-bridge.ps1'),
      path.join(process.cwd(), 'tools', 'windows', 'input-bridge.ps1'),
    ];

    return candidates.find((candidate) => existsSync(candidate));
  }
}
