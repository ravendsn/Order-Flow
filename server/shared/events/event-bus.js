const { EventEmitter } = require('node:events');

class EventBus extends EventEmitter {
  publish(eventName, payload) {
    this.emit(eventName, payload);
  }

  subscribe(eventName, listener) {
    this.on(eventName, listener);
    return () => this.off(eventName, listener);
  }
}

module.exports = EventBus;
