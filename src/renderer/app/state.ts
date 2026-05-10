import type {
  AppLogEntry,
  BootstrapPayload,
  CapturePreview,
  ProviderDecision,
  ProviderHealth,
  WindowSummary,
} from '../../shared/contracts';

export interface AppState {
  windows: WindowSummary[];
  selectedHwnd: string | null;
  preview: CapturePreview | null;
  providerHealth: ProviderHealth | null;
  lastDecision: ProviderDecision | null;
  logs: AppLogEntry[];
  statusLine: string;
  helperAvailable: boolean;
  bootstrap: BootstrapPayload | null;
  busy: boolean;
}

export type StateUpdater = Partial<AppState> | ((state: AppState) => AppState);
export type StateListener = (state: AppState) => void;

export const initialState: AppState = {
  windows: [],
  selectedHwnd: null,
  preview: null,
  providerHealth: null,
  lastDecision: null,
  logs: [],
  statusLine: '起動中...',
  helperAvailable: false,
  bootstrap: null,
  busy: false,
};

export const createStore = (seed: AppState) => {
  let state = seed;
  const listeners = new Set<StateListener>();

  return {
    getState(): AppState {
      return state;
    },
    setState(updater: StateUpdater): void {
      state =
        typeof updater === 'function'
          ? updater(state)
          : {
              ...state,
              ...updater,
            };

      for (const listener of listeners) {
        listener(state);
      }
    },
    subscribe(listener: StateListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
