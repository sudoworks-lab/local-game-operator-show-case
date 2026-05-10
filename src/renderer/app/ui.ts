import type { AppState } from './state';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing UI element: ${id}`);
  }

  return element as T;
};

const formatTimestamp = (value: string): string =>
  new Date(value).toLocaleTimeString('ja-JP', {
    hour12: false,
  });

const renderLogEntry = (entry: AppState['logs'][number]): HTMLLIElement => {
  const item = document.createElement('li');
  item.className = `log-entry ${entry.success ? 'log-success' : 'log-error'}`;

  const text = [
    formatTimestamp(entry.timestamp),
    entry.command,
    entry.targetWindow ? `target=${entry.targetWindow}` : null,
    entry.message,
    entry.providerSummary ? `provider=${entry.providerSummary}` : null,
    entry.screenshotPath ? `screenshot=${entry.screenshotPath}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  item.textContent = text;
  return item;
};

export interface UiRefs {
  windowSelect: HTMLSelectElement;
  refreshWindowsButton: HTMLButtonElement;
  focusTargetButton: HTMLButtonElement;
  refreshPreviewButton: HTMLButtonElement;
  saveScreenshotButton: HTMLButtonElement;
  previewImage: HTMLImageElement;
  previewEmpty: HTMLDivElement;
  previewMeta: HTMLParagraphElement;
  providerStatus: HTMLParagraphElement;
  providerDecision: HTMLParagraphElement;
  analyzePreviewButton: HTMLButtonElement;
  refreshProviderButton: HTMLButtonElement;
  emergencyStopButton: HTMLButtonElement;
  statusLine: HTMLParagraphElement;
  windowCount: HTMLParagraphElement;
  selectedTarget: HTMLParagraphElement;
  logList: HTMLUListElement;
  customKeyInput: HTMLInputElement;
  customTapButton: HTMLButtonElement;
  customHoldButton: HTMLButtonElement;
  customKeyDownButton: HTMLButtonElement;
  customKeyUpButton: HTMLButtonElement;
  sequenceInput: HTMLInputElement;
  runSequenceButton: HTMLButtonElement;
  releaseAllButton: HTMLButtonElement;
  tapButtons: HTMLButtonElement[];
  holdButtons: HTMLButtonElement[];
}

export const mountUi = (): UiRefs => ({
  windowSelect: byId<HTMLSelectElement>('window-select'),
  refreshWindowsButton: byId<HTMLButtonElement>('refresh-windows'),
  focusTargetButton: byId<HTMLButtonElement>('focus-target'),
  refreshPreviewButton: byId<HTMLButtonElement>('refresh-preview'),
  saveScreenshotButton: byId<HTMLButtonElement>('save-screenshot'),
  previewImage: byId<HTMLImageElement>('preview-image'),
  previewEmpty: byId<HTMLDivElement>('preview-empty'),
  previewMeta: byId<HTMLParagraphElement>('preview-meta'),
  providerStatus: byId<HTMLParagraphElement>('provider-status'),
  providerDecision: byId<HTMLParagraphElement>('provider-decision'),
  analyzePreviewButton: byId<HTMLButtonElement>('analyze-preview'),
  refreshProviderButton: byId<HTMLButtonElement>('refresh-provider'),
  emergencyStopButton: byId<HTMLButtonElement>('emergency-stop'),
  statusLine: byId<HTMLParagraphElement>('status-line'),
  windowCount: byId<HTMLParagraphElement>('window-count'),
  selectedTarget: byId<HTMLParagraphElement>('selected-target'),
  logList: byId<HTMLUListElement>('log-list'),
  customKeyInput: byId<HTMLInputElement>('custom-key'),
  customTapButton: byId<HTMLButtonElement>('custom-tap'),
  customHoldButton: byId<HTMLButtonElement>('custom-hold'),
  customKeyDownButton: byId<HTMLButtonElement>('custom-keydown'),
  customKeyUpButton: byId<HTMLButtonElement>('custom-keyup'),
  sequenceInput: byId<HTMLInputElement>('sequence-input'),
  runSequenceButton: byId<HTMLButtonElement>('run-sequence'),
  releaseAllButton: byId<HTMLButtonElement>('release-all'),
  tapButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('.tap-key')),
  holdButtons: Array.from(
    document.querySelectorAll<HTMLButtonElement>('.hold-key'),
  ),
});

export const renderApp = (refs: UiRefs, state: AppState): void => {
  const selectedWindow =
    state.windows.find((window) => window.hwnd === state.selectedHwnd) ?? null;
  const targetEnabled = Boolean(selectedWindow && state.helperAvailable);

  refs.windowSelect.replaceChildren();

  if (state.windows.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '利用可能なウィンドウがありません';
    refs.windowSelect.append(option);
  } else {
    for (const window of state.windows) {
      const option = document.createElement('option');
      option.value = window.hwnd;
      option.textContent = `${window.title} (${window.processName ?? 'unknown'})${
        window.captureAvailable ? ' / capture' : ''
      }`;
      refs.windowSelect.append(option);
    }
  }

  refs.windowSelect.value = state.selectedHwnd ?? '';
  refs.windowCount.textContent = String(state.windows.length);
  refs.selectedTarget.textContent = selectedWindow
    ? `${selectedWindow.title} / HWND ${selectedWindow.hwnd}`
    : '未選択';

  refs.previewImage.hidden = !state.preview;
  refs.previewEmpty.hidden = Boolean(state.preview);
  if (state.preview) {
    refs.previewImage.src = state.preview.dataUrl;
    refs.previewMeta.textContent = `${state.preview.sourceName} / ${state.preview.width}x${state.preview.height} / ${formatTimestamp(
      state.preview.capturedAt,
    )}`;
  } else {
    refs.previewImage.removeAttribute('src');
    refs.previewMeta.textContent =
      '対象ウィンドウを選び、プレビュー更新を押してください。';
  }

  if (state.providerHealth) {
    refs.providerStatus.textContent = `${state.providerHealth.providerLabel} / ${
      state.providerHealth.ok ? 'healthy' : 'unhealthy'
    }${state.providerHealth.details ? ` / ${state.providerHealth.details}` : ''}`;
  } else {
    refs.providerStatus.textContent = 'provider 情報をまだ取得していません。';
  }

  if (state.lastDecision) {
    refs.providerDecision.textContent = `${state.lastDecision.summary} / next=${state.lastDecision.nextAction} / confidence=${state.lastDecision.confidence}`;
  } else {
    refs.providerDecision.textContent = 'まだ analyze を実行していません。';
  }

  refs.statusLine.textContent = state.statusLine;
  refs.logList.replaceChildren(...state.logs.map(renderLogEntry));

  const disableTargetButtons = !targetEnabled || state.busy;
  refs.focusTargetButton.disabled = disableTargetButtons;
  refs.refreshPreviewButton.disabled = disableTargetButtons;
  refs.saveScreenshotButton.disabled = disableTargetButtons;
  refs.customTapButton.disabled = disableTargetButtons;
  refs.customHoldButton.disabled = disableTargetButtons;
  refs.customKeyDownButton.disabled = disableTargetButtons;
  refs.customKeyUpButton.disabled = disableTargetButtons;
  refs.runSequenceButton.disabled = disableTargetButtons;
  refs.releaseAllButton.disabled = !state.helperAvailable || state.busy;
  refs.analyzePreviewButton.disabled = disableTargetButtons;
  refs.refreshProviderButton.disabled = state.busy;
  refs.refreshWindowsButton.disabled = state.busy;
  refs.windowSelect.disabled = state.busy;

  for (const button of refs.tapButtons) {
    button.disabled = disableTargetButtons;
  }

  for (const button of refs.holdButtons) {
    button.disabled = disableTargetButtons;
  }

  refs.emergencyStopButton.disabled = !state.helperAvailable;
};
