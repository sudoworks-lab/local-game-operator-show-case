import type { GameOperatorApi } from '../shared/contracts';

declare global {
  interface Window {
    gameOperator: GameOperatorApi;
  }
}

export {};
