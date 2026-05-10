import './styles.css';
import { SUPPORTED_KEYS, type SupportedKey } from '../shared/contracts';
import { createStore, initialState } from './app/state';
import { mountUi, renderApp } from './app/ui';

const store = createStore(initialState);
const refs = mountUi();

const keyAliases = new Map<string, SupportedKey>([
  ['W', 'W'],
  ['A', 'A'],
  ['S', 'S'],
  ['D', 'D'],
  ['F1', 'F1'],
  ['F2', 'F2'],
  ['F3', 'F3'],
  ['F4', 'F4'],
  ['F5', 'F5'],
  ['F6', 'F6'],
  ['F7', 'F7'],
  ['F8', 'F8'],
  ['F9', 'F9'],
  ['F10', 'F10'],
  ['F11', 'F11'],
  ['F12', 'F12'],
  ['SPACE', 'Space'],
  ['SPACEBAR', 'Space'],
  ['ENTER', 'Enter'],
  ['RETURN', 'Enter'],
  ['ESC', 'Esc'],
  ['ESCAPE', 'Esc'],
  ['SHIFT', 'Shift'],
  ['E', 'E'],
  ['F', 'F'],
  ['R', 'R'],
  ['UP', 'Up'],
  ['ARROWUP', 'Up'],
  ['DOWN', 'Down'],
  ['ARROWDOWN', 'Down'],
  ['LEFT', 'Left'],
  ['ARROWLEFT', 'Left'],
  ['RIGHT', 'Right'],
  ['ARROWRIGHT', 'Right'],
]);

const setBusy = (busy: boolean, statusLine?: string): void => {
  store.setState((state) => ({
    ...state,
    busy,
    statusLine: statusLine ?? state.statusLine,
  }));
};

const setStatus = (statusLine: string): void => {
  store.setState((state) => ({
    ...state,
    statusLine,
  }));
};

const getSelectedHwnd = (): string => {
  const hwnd = store.getState().selectedHwnd;
  if (!hwnd) {
    throw new Error('対象ウィンドウを先に選択してください。');
  }

  return hwnd;
};

const normalizeKey = (value: string): SupportedKey => {
  const normalized = value.trim().toUpperCase();
  const key = keyAliases.get(normalized);
  if (!key || !SUPPORTED_KEYS.includes(key)) {
    throw new Error(
      `未対応のキーです: ${value}. 対応キーは ${SUPPORTED_KEYS.join(', ')} です。`,
    );
  }

  return key;
};

const normalizeSequence = (value: string): SupportedKey[] => {
  const keys = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeKey);

  if (keys.length === 0) {
    throw new Error('キーシーケンスが空です。');
  }

  return keys;
};

const syncSelectedWindow = (hwnd: string | null): void => {
  store.setState((state) => ({
    ...state,
    selectedHwnd: hwnd,
    preview: hwnd === state.selectedHwnd ? state.preview : null,
    lastDecision: hwnd === state.selectedHwnd ? state.lastDecision : null,
  }));
};

const withAction = async <T>(
  statusLine: string,
  action: () => Promise<T>,
): Promise<T | undefined> => {
  setBusy(true, statusLine);

  try {
    const result = await action();
    return result;
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error));
    return undefined;
  } finally {
    setBusy(false);
  }
};

const refreshWindows = async (statusPrefix = 'ウィンドウ一覧を更新しています...') => {
  const windows = await window.gameOperator.listWindows();
  const selectedHwnd =
    windows.find((window) => window.hwnd === store.getState().selectedHwnd)?.hwnd ??
    windows[0]?.hwnd ??
    null;

  store.setState((state) => ({
    ...state,
    windows,
    selectedHwnd,
    preview: selectedHwnd === state.selectedHwnd ? state.preview : null,
    lastDecision: selectedHwnd === state.selectedHwnd ? state.lastDecision : null,
    statusLine: `${statusPrefix.replace(/\.\.\.$/, '')} 完了`,
  }));
};

const refreshProviderHealth = async () => {
  const providerHealth = await window.gameOperator.getProviderHealth();
  store.setState((state) => ({
    ...state,
    providerHealth,
  }));
  setStatus(`${providerHealth.providerLabel} の状態を更新しました。`);
};

const bootstrap = async () => {
  const bootstrapPayload = await window.gameOperator.bootstrap();

  store.setState((state) => ({
    ...state,
    bootstrap: bootstrapPayload,
    helperAvailable: bootstrapPayload.helper.available,
    providerHealth: bootstrapPayload.providerHealth,
    logs: bootstrapPayload.logs,
    statusLine: bootstrapPayload.helper.available
      ? '準備完了。対象ウィンドウを選んで操作できます。'
      : bootstrapPayload.helper.reason ?? 'PowerShell helper が利用できません。',
  }));

  await refreshWindows();
};

window.gameOperator.onLogEntry((entry) => {
  store.setState((state) => ({
    ...state,
    logs: [entry, ...state.logs].slice(0, 200),
  }));
});

refs.windowSelect.addEventListener('change', () => {
  syncSelectedWindow(refs.windowSelect.value || null);
});

refs.refreshWindowsButton.addEventListener('click', () => {
  void withAction('ウィンドウ一覧を更新しています...', () => refreshWindows());
});

refs.focusTargetButton.addEventListener('click', () => {
  void withAction('対象ウィンドウを前面化しています...', async () => {
    const result = await window.gameOperator.focusWindow(getSelectedHwnd());
    setStatus(result.message);
  });
});

refs.refreshPreviewButton.addEventListener('click', () => {
  void withAction('スクリーンプレビューを更新しています...', async () => {
    const preview = await window.gameOperator.capturePreview(getSelectedHwnd());
    store.setState((state) => ({
      ...state,
      preview,
    }));
    setStatus(`プレビューを更新しました: ${preview.sourceName}`);
  });
});

refs.saveScreenshotButton.addEventListener('click', () => {
  void withAction('スクリーンショットを保存しています...', async () => {
    const result = await window.gameOperator.saveScreenshot(getSelectedHwnd());
    setStatus(`スクリーンショットを保存しました: ${result.filePath}`);
  });
});

refs.refreshProviderButton.addEventListener('click', () => {
  void withAction('provider 状態を確認しています...', refreshProviderHealth);
});

refs.analyzePreviewButton.addEventListener('click', () => {
  void withAction('provider analyze を実行しています...', async () => {
    const decision = await window.gameOperator.analyzeWindow(getSelectedHwnd());
    store.setState((state) => ({
      ...state,
      lastDecision: decision,
    }));
    setStatus(decision.summary);
  });
});

refs.emergencyStopButton.addEventListener('click', () => {
  void withAction('緊急停止を実行しています...', async () => {
    const result = await window.gameOperator.emergencyStop();
    setStatus(result.message);
  });
});

refs.releaseAllButton.addEventListener('click', () => {
  void withAction('全キーを解放しています...', async () => {
    const result = await window.gameOperator.releaseAllKeys();
    setStatus(result.message);
  });
});

for (const button of refs.tapButtons) {
  button.addEventListener('click', () => {
    void withAction(`キー ${button.dataset.key} を送信しています...`, async () => {
      const key = normalizeKey(button.dataset.key ?? '');
      const result = await window.gameOperator.tapKey(getSelectedHwnd(), key);
      setStatus(result.message);
    });
  });
}

for (const button of refs.holdButtons) {
  button.addEventListener('click', () => {
    void withAction(`キー ${button.dataset.key} を hold しています...`, async () => {
      const key = normalizeKey(button.dataset.key ?? '');
      const durationMs = Number(button.dataset.ms ?? '500');
      const result = await window.gameOperator.holdKey(
        getSelectedHwnd(),
        key,
        durationMs,
      );
      setStatus(result.message);
    });
  });
}

refs.customTapButton.addEventListener('click', () => {
  void withAction('任意キー tap を送信しています...', async () => {
    const key = normalizeKey(refs.customKeyInput.value);
    const result = await window.gameOperator.tapKey(getSelectedHwnd(), key);
    setStatus(result.message);
  });
});

refs.customHoldButton.addEventListener('click', () => {
  void withAction('任意キー hold を送信しています...', async () => {
    const key = normalizeKey(refs.customKeyInput.value);
    const result = await window.gameOperator.holdKey(getSelectedHwnd(), key, 500);
    setStatus(result.message);
  });
});

refs.customKeyDownButton.addEventListener('click', () => {
  void withAction('任意キー keydown を送信しています...', async () => {
    const key = normalizeKey(refs.customKeyInput.value);
    const result = await window.gameOperator.keyDown(getSelectedHwnd(), key);
    setStatus(result.message);
  });
});

refs.customKeyUpButton.addEventListener('click', () => {
  void withAction('任意キー keyup を送信しています...', async () => {
    const key = normalizeKey(refs.customKeyInput.value);
    const result = await window.gameOperator.keyUp(getSelectedHwnd(), key);
    setStatus(result.message);
  });
});

refs.runSequenceButton.addEventListener('click', () => {
  void withAction('キーシーケンスを送信しています...', async () => {
    const keys = normalizeSequence(refs.sequenceInput.value);
    const result = await window.gameOperator.runSequence(getSelectedHwnd(), keys);
    setStatus(result.message);
  });
});

store.subscribe((state) => {
  renderApp(refs, state);
});

renderApp(refs, store.getState());

void withAction('アプリを初期化しています...', bootstrap);
