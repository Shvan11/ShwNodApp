// services/state/index.ts
/**
 * State management exports
 */

export { default as StateManager, StateManager as StateManagerClass } from './StateManager.js';
export { default as messageState } from './messageState.js';
export type { Person, StateDump } from './messageState.js';
export { default as stateEvents, StateEventTypes } from './stateEvents.js';
export type {
  BaseEventData,
  ClientEventData,
  MessageEventData,
  DatabaseEventData,
  SystemEventData,
  EventData,
  StateEventType,
} from './stateEvents.js';
