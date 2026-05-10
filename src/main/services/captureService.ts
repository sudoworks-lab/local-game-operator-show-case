import fs from 'node:fs/promises';
import path from 'node:path';
import { app, desktopCapturer } from 'electron';
import type {
  CapturePreview,
  CaptureSaveResult,
} from '../../shared/contracts';

interface WindowCaptureSource {
  id: string;
  hwnd: string | null;
  name: string;
  width: number;
  height: number;
}

interface CaptureAsset {
  sourceId: string;
  sourceName: string;
  width: number;
  height: number;
  buffer: Buffer;
  dataUrl: string;
  capturedAt: string;
}

const THUMBNAIL_SIZE = { width: 1280, height: 720 };

const sanitizeFileName = (value: string): string =>
  (Array.from(value)
    .map((character) => {
      const charCode = character.charCodeAt(0);
      if (charCode < 32 || /[<>:"/\\|?*]/.test(character)) {
        return '-';
      }

      if (/\s/.test(character)) {
        return '-';
      }

      return character;
    })
    .join('')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')
    .toLowerCase()) || 'window';

const timestampForFile = (): string =>
  new Date().toISOString().replace(/[:.]/g, '-');

export class CaptureService {
  private captureDirectory = '';

  async getCaptureDirectory(): Promise<string> {
    if (!this.captureDirectory) {
      this.captureDirectory = path.join(app.getPath('userData'), 'captures');
      await fs.mkdir(this.captureDirectory, { recursive: true });
    }

    return this.captureDirectory;
  }

  async listWindowSources(): Promise<WindowCaptureSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: THUMBNAIL_SIZE,
      fetchWindowIcons: false,
    });

    return sources.map((source) => {
      const size = source.thumbnail.getSize();
      return {
        id: source.id,
        hwnd: this.extractHwnd(source.id),
        name: source.name,
        width: size.width,
        height: size.height,
      };
    });
  }

  async capturePreview(hwnd: string): Promise<CapturePreview> {
    const asset = await this.captureAsset(hwnd);
    return {
      success: true,
      hwnd,
      sourceId: asset.sourceId,
      sourceName: asset.sourceName,
      width: asset.width,
      height: asset.height,
      dataUrl: asset.dataUrl,
      capturedAt: asset.capturedAt,
    };
  }

  async saveScreenshot(hwnd: string): Promise<CaptureSaveResult> {
    const asset = await this.captureAsset(hwnd);
    const filePath = await this.persistCapture(asset);
    return {
      success: true,
      hwnd,
      sourceId: asset.sourceId,
      sourceName: asset.sourceName,
      width: asset.width,
      height: asset.height,
      filePath,
      capturedAt: asset.capturedAt,
    };
  }

  async captureForProvider(
    hwnd: string,
  ): Promise<CaptureSaveResult & { buffer: Buffer }> {
    const asset = await this.captureAsset(hwnd);
    const filePath = await this.persistCapture(asset);
    return {
      success: true,
      hwnd,
      sourceId: asset.sourceId,
      sourceName: asset.sourceName,
      width: asset.width,
      height: asset.height,
      filePath,
      capturedAt: asset.capturedAt,
      buffer: asset.buffer,
    };
  }

  private async captureAsset(hwnd: string): Promise<CaptureAsset> {
    const source = await this.resolveSource(hwnd);
    const size = source.thumbnail.getSize();

    return {
      sourceId: source.id,
      sourceName: source.name,
      width: size.width,
      height: size.height,
      buffer: source.thumbnail.toPNG(),
      dataUrl: source.thumbnail.toDataURL(),
      capturedAt: new Date().toISOString(),
    };
  }

  private async resolveSource(hwnd: string): Promise<Electron.DesktopCapturerSource> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: THUMBNAIL_SIZE,
      fetchWindowIcons: false,
    });

    const source = sources.find((item) => this.extractHwnd(item.id) === hwnd);
    if (!source) {
      throw new Error(
        '対象ウィンドウに対応する desktop capture source が見つかりませんでした。',
      );
    }

    return source;
  }

  private async persistCapture(asset: CaptureAsset): Promise<string> {
    const captureDirectory = await this.getCaptureDirectory();
    const filePath = path.join(
      captureDirectory,
      `${timestampForFile()}-${sanitizeFileName(asset.sourceName)}.png`,
    );

    await fs.writeFile(filePath, asset.buffer);
    return filePath;
  }

  private extractHwnd(sourceId: string): string | null {
    const match = /^window:(\d+):/.exec(sourceId);
    return match?.[1] ?? null;
  }
}
