import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { AppLogEntry } from '../../shared/contracts';

const MAX_ENTRIES = 200;

type LogInput = Omit<AppLogEntry, 'id' | 'timestamp'>;

export class LoggingService {
  private readonly emitter = new EventEmitter();

  private readonly entries: AppLogEntry[] = [];

  private initialized = false;

  private logDirectory = '';

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logDirectory = path.join(app.getPath('userData'), 'logs');
    await fs.mkdir(this.logDirectory, { recursive: true });
    this.initialized = true;
  }

  getLogDirectory(): string {
    return this.logDirectory;
  }

  getEntries(): AppLogEntry[] {
    return [...this.entries];
  }

  subscribe(listener: (entry: AppLogEntry) => void): () => void {
    this.emitter.on('entry', listener);
    return () => {
      this.emitter.off('entry', listener);
    };
  }

  async log(input: LogInput): Promise<AppLogEntry> {
    await this.initialize();

    const entry: AppLogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      ...input,
    };

    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.length = MAX_ENTRIES;
    }

    const logFilePath = path.join(
      this.logDirectory,
      `${entry.timestamp.slice(0, 10)}.log`,
    );
    await fs.appendFile(logFilePath, `${JSON.stringify(entry)}\n`, 'utf8');
    this.emitter.emit('entry', entry);
    return entry;
  }
}
