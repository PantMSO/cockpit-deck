'use strict';
// Sends key presses as hardware scan codes (SendInput), which DirectX / GDK games accept.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const MOUSEINPUT = koffi.struct('MOUSEINPUT', { dx: 'long', dy: 'long', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t' });
const KEYBDINPUT = koffi.struct('KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t' });
const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
const INPUT_UNION = koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION });
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');

const INPUT_KEYBOARD = 1, KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_SCANCODE = 0x8;

// [scancode, extended]
const SC = {
  ESC: [0x01, 0], ESCAPE: [0x01, 0], 1: [0x02, 0], 2: [0x03, 0], 3: [0x04, 0], 4: [0x05, 0], 5: [0x06, 0], 6: [0x07, 0], 7: [0x08, 0], 8: [0x09, 0], 9: [0x0a, 0], 0: [0x0b, 0],
  MINUS: [0x0c, 0], EQUALS: [0x0d, 0], BACKSPACE: [0x0e, 0], TAB: [0x0f, 0],
  Q: [0x10, 0], W: [0x11, 0], E: [0x12, 0], R: [0x13, 0], T: [0x14, 0], Y: [0x15, 0], U: [0x16, 0], I: [0x17, 0], O: [0x18, 0], P: [0x19, 0],
  LBRACKET: [0x1a, 0], RBRACKET: [0x1b, 0], ENTER: [0x1c, 0], CTRL: [0x1d, 0], LCTRL: [0x1d, 0],
  A: [0x1e, 0], S: [0x1f, 0], D: [0x20, 0], F: [0x21, 0], G: [0x22, 0], H: [0x23, 0], J: [0x24, 0], K: [0x25, 0], L: [0x26, 0],
  SEMICOLON: [0x27, 0], APOSTROPHE: [0x28, 0], GRAVE: [0x29, 0], SHIFT: [0x2a, 0], LSHIFT: [0x2a, 0], BACKSLASH: [0x2b, 0],
  Z: [0x2c, 0], X: [0x2d, 0], C: [0x2e, 0], V: [0x2f, 0], B: [0x30, 0], N: [0x31, 0], M: [0x32, 0],
  COMMA: [0x33, 0], PERIOD: [0x34, 0], SLASH: [0x35, 0], RSHIFT: [0x36, 0], ALT: [0x38, 0], LALT: [0x38, 0], SPACE: [0x39, 0], CAPSLOCK: [0x3a, 0],
  F1: [0x3b, 0], F2: [0x3c, 0], F3: [0x3d, 0], F4: [0x3e, 0], F5: [0x3f, 0], F6: [0x40, 0], F7: [0x41, 0], F8: [0x42, 0], F9: [0x43, 0], F10: [0x44, 0], F11: [0x57, 0], F12: [0x58, 0],
  NUM7: [0x47, 0], NUM8: [0x48, 0], NUM9: [0x49, 0], NUMMINUS: [0x4a, 0], NUM4: [0x4b, 0], NUM5: [0x4c, 0], NUM6: [0x4d, 0], NUMPLUS: [0x4e, 0],
  NUM1: [0x4f, 0], NUM2: [0x50, 0], NUM3: [0x51, 0], NUM0: [0x52, 0], NUMPERIOD: [0x53, 0], NUMENTER: [0x1c, 1], NUMSLASH: [0x35, 1], NUMSTAR: [0x37, 0],
  RCTRL: [0x1d, 1], RALT: [0x38, 1],
  HOME: [0x47, 1], UP: [0x48, 1], PAGEUP: [0x49, 1], LEFT: [0x4b, 1], RIGHT: [0x4d, 1], END: [0x4f, 1], DOWN: [0x50, 1], PAGEDOWN: [0x51, 1], INSERT: [0x52, 1], DELETE: [0x53, 1],
};

function parse(combo) {
  const parts = String(combo || '').split('+').map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (!parts.length) throw new Error('empty key');
  return parts.map((p) => {
    const k = SC[p];
    if (!k) throw new Error(`unknown key "${p}"`);
    return k;
  });
}

function ev([scan, ext], up) {
  return { type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: scan, dwFlags: KEYEVENTF_SCANCODE | (ext ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0), time: 0, dwExtraInfo: 0 } } };
}

function send(list) {
  const n = SendInput(list.length, list, koffi.sizeof(INPUT));
  if (n !== list.length) throw new Error(`SendInput sent ${n}/${list.length}`);
}

/** Press a combo like "Ctrl+Shift+H"; keys are held for holdMs so the game sees them. */
function press(combo, holdMs = 60) {
  const keys = parse(combo);
  send(keys.map((k) => ev(k, false)));
  return new Promise((res) => setTimeout(() => { try { send(keys.slice().reverse().map((k) => ev(k, true))); } finally { res(); } }, holdMs));
}

module.exports = { press, parse, INPUT_SIZE: koffi.sizeof(INPUT) };
