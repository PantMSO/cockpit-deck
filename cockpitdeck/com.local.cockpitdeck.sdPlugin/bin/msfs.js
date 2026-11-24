'use strict';
// SimConnect link to Microsoft Flight Simulator 2024: reads SimVars, sends key events.
const { EventEmitter } = require('events');
const {
  open, Protocol, SimConnectDataType, SimConnectPeriod, DataRequestFlag, EventFlag, SimConnectConstants,
} = require('node-simconnect');

const USER = SimConnectConstants.OBJECT_ID_USER; // 0
const PRIORITY_HIGHEST = 1; // SIMCONNECT_GROUP_PRIORITY_HIGHEST (type-only enum in node-simconnect)
const RETRY_MS = 5000;
const PAUSE_EVENT_ID = 1;

class Msfs extends EventEmitter {
  constructor(log) {
    super();
    this.log = log;
    this.handle = null;
    this.connected = false;
    this.vars = new Map();      // key "NAME|unit" -> { name, unit, id, value }
    this.events = new Map();    // event name -> client event id
    this.nextEventId = 100;
    this.paused = null;
    this.sendIds = new Map();   // packet id -> description, for exception reports
    this.stopped = false;
    this.connecting = false;
    this.lastError = '';
  }

  start() { this.stopped = false; this._tryConnect(); }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    try { this.handle && this.handle.close(); } catch (_) {}
  }

  /** Register a SimVar to watch. Returns its key. */
  watch(name, unit) {
    const key = `${name}|${unit}`;
    if (!this.vars.has(key)) {
      const v = { name, unit, id: this.vars.size + 1, value: null, bad: false };
      this.vars.set(key, v);
      if (this.connected) this._subscribe(v);
    }
    return key;
  }

  get(key) { const v = this.vars.get(key); return v ? v.value : null; }

  /** Fire a sim key event (e.g. "GEAR_TOGGLE"), optional numeric data. */
  send(eventName, data = 0) {
    if (!this.connected) return false;
    let id = this.events.get(eventName);
    try {
      if (id === undefined) {
        id = this.nextEventId++;
        const sid = this.handle.mapClientEventToSimEvent(id, eventName);
        this.sendIds.set(sid, `event ${eventName}`);
        this.events.set(eventName, id);
      }
      const sid = this.handle.transmitClientEvent(USER, id, data >>> 0, PRIORITY_HIGHEST, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY);
      this.sendIds.set(sid, `send ${eventName}`);
      return true;
    } catch (e) {
      this.log('msfs send failed', eventName, e.message);
      return false;
    }
  }

  async _tryConnect() {
    if (this.stopped || this.connected || this.connecting) return;
    this.connecting = true;
    let res = null;
    // MSFS 2024 publishes its pipe/port in the registry while running; fall back to the static IPv4 port 500 from SimConnect.xml.
    for (const opts of [undefined, { host: '127.0.0.1', port: 500 }]) {
      try { res = await withTimeout(open('Cockpit Deck', Protocol.KittyHawk, opts), 4000); break; } catch (e) { this.lastError = e.message || String(e); }
    }
    this.connecting = false;
    if (!res) { this.retry = setTimeout(() => this._tryConnect(), RETRY_MS); return; }
    this._attach(res.handle, res.recvOpen);
  }

  _attach(handle, info) {
    this.handle = handle;
    this.connected = true;
    this.events.clear();
    this.sendIds.clear();
    this.log('msfs connected:', info && info.applicationName, info && info.applicationVersionMajor);
    handle.on('simObjectData', (d) => {
      for (const v of this.vars.values()) {
        if (v.id === d.requestID) {
          const val = d.data.readFloat64();
          if (v.value !== val) { v.value = val; this.emit('change', v); }
          return;
        }
      }
    });
    handle.on('event', (e) => {
      if (e.clientEventId === PAUSE_EVENT_ID) { this.paused = e.data !== 0; this.emit('pause', this.paused); }
    });
    handle.on('exception', (ex) => {
      const what = this.sendIds.get(ex.sendId) || `packet ${ex.sendId}`;
      this.log('msfs exception', ex.exception, 'on', what);
      for (const v of this.vars.values()) if (what === `var ${v.name}`) { v.bad = true; v.value = null; this.emit('change', v); }
    });
    const lost = (why) => {
      if (!this.connected) return;
      this.connected = false;
      this.handle = null;
      this.paused = null;
      for (const v of this.vars.values()) v.value = null;
      this.log('msfs disconnected:', why);
      this.emit('status', false);
      if (!this.stopped) this.retry = setTimeout(() => this._tryConnect(), RETRY_MS);
    };
    handle.on('quit', () => lost('sim quit'));
    handle.on('close', () => lost('socket closed'));
    handle.on('error', (e) => lost('error ' + (e && e.message)));
    try { handle.subscribeToSystemEvent(PAUSE_EVENT_ID, 'Pause'); } catch (_) {}
    for (const v of this.vars.values()) this._subscribe(v);
    this.emit('status', true);
  }

  _subscribe(v) {
    try {
      // One definition per variable, so a SimVar an aircraft lacks cannot shift the others.
      const sid = this.handle.addToDataDefinition(v.id, v.name, v.unit, SimConnectDataType.FLOAT64);
      this.sendIds.set(sid, `var ${v.name}`);
      this.handle.requestDataOnSimObject(v.id, v.id, USER, SimConnectPeriod.SIM_FRAME, DataRequestFlag.DATA_REQUEST_FLAG_CHANGED, 0, 3, 0);
    } catch (e) {
      this.log('msfs subscribe failed', v.name, e.message);
    }
  }
}

// Resolves with the connection, or rejects after ms; a connection that opens too late is closed.
function withTimeout(p, ms) {
  return new Promise((res, rej) => {
    let late = false;
    const t = setTimeout(() => { late = true; rej(new Error('timeout')); }, ms);
    p.then((x) => {
      if (late) { try { x.handle.close(); } catch (_) {} return; }
      clearTimeout(t); res(x);
    }, (e) => { clearTimeout(t); if (!late) rej(e); });
  });
}

module.exports = { Msfs };
