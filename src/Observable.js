class Observable {

    constructor() {
        this._listeners = {};
    }

    on(event, callback) {
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        this._listeners[event].push(callback);
    }

    fire(event, ...args) {
        if (event && this._listeners[event]) {
            this._listeners[event].forEach(listener => listener.apply(null, args));
        }
    }
}

module.exports = Observable;
