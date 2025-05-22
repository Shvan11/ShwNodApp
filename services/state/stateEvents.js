// services/state/stateEvents.js
import EventEmitter from 'events';

// Create a singleton event bus for state-related events
const stateEvents = new EventEmitter();

export default stateEvents;