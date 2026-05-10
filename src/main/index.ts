import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerHandlers } from './ipc/registerHandlers';
import { CaptureService } from './services/captureService';
import { HelperBridge } from './services/helperBridge';
import { LoggingService } from './services/loggingService';
import { ProviderService } from './services/providerService';

if (started) {
  app.quit();
}

const loggingService = new LoggingService();
const captureService = new CaptureService();
const providerService = new ProviderService();
const helperBridge = new HelperBridge();

let mainWindow: BrowserWindow | null = null;

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

void app.whenReady().then(async () => {
  await loggingService.initialize();
  registerHandlers(() => mainWindow, {
    captureService,
    helperBridge,
    loggingService,
    providerService,
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  void helperBridge.emergencyStop().catch(() => undefined);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
