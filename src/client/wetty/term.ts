import { FitAddon } from '@xterm/addon-fit';
import { ImageAddon } from '@xterm/addon-image';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';

import { terminal as termElement } from './disconnect/elements';
import { configureTerm } from './term/configuration';
import { loadOptions } from './term/load';
import { setTitle } from './title';
import type { Options } from './term/options';
import type { Socket } from 'socket.io-client';

const isMobile =
  /iPhone|iPad|iPod|Android|webOS|BlackBerry|Opera Mini|IEMobile/i.test(
    navigator.userAgent,
  );

// Browsers cap AudioContext instances per page (~6 in Chrome). Reuse one.
let audioCtx: AudioContext | undefined;

function getAudioCtx(): AudioContext | undefined {
  if (audioCtx) return audioCtx;
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctx = win.AudioContext ?? win.webkitAudioContext;
  if (!Ctx) return undefined;
  try {
    audioCtx = new Ctx();
  } catch {
    return undefined;
  }
  return audioCtx;
}

function beep(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const play = (): void => {
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      o.start();
      o.stop(ctx.currentTime + 0.15);
    } catch {
      // ignore
    }
  };
  if (ctx.state === 'suspended') {
    ctx.resume().then(play, (): void => {
      // resume can reject before user gesture; just skip the beep
    });
  } else {
    play();
  }
}

let blinkInterval: number | undefined;
let blinkOn = false;
let baseFaviconHref: string | undefined;

function getFaviconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"]',
  );
}

function setFavicon(href: string): void {
  const link = getFaviconLink();
  if (link) link.href = href;
}

function startBlink(): void {
  if (blinkInterval !== undefined) return;
  if (!document.hidden && document.hasFocus()) return;
  if (!baseFaviconHref) {
    const link = getFaviconLink();
    if (!link) return;
    baseFaviconHref = link.href;
  }
  const baseHref = baseFaviconHref;
  const alertHref = baseHref.replace('favicon.svg', 'favicon-alert.svg');
  blinkOn = true;
  blinkInterval = window.setInterval(() => {
    setFavicon(blinkOn ? alertHref : baseHref);
    blinkOn = !blinkOn;
  }, 600);
}

function stopBlink(): void {
  if (blinkInterval === undefined) return;
  window.clearInterval(blinkInterval);
  blinkInterval = undefined;
  if (baseFaviconHref) setFavicon(baseFaviconHref);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) stopBlink();
});
window.addEventListener('focus', stopBlink);

function showNotification(title: string, body: string, sound = false): void {
  startBlink();
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (sound) beep();
  try {
    // eslint-disable-next-line no-new
    new Notification(title, { body });
  } catch {
    // Some browsers (Safari) throw when constructing Notification directly.
  }
}

export class Term extends Terminal {
  socket: Socket;
  fitAddon: FitAddon;
  loadOptions: () => Options;

  constructor(socket: Socket) {
    super({ allowProposedApi: true });
    this.socket = socket;
    this.fitAddon = new FitAddon();
    this.loadAddon(this.fitAddon);
    this.loadAddon(new WebLinksAddon());
    this.loadAddon(new ImageAddon());
    this.loadOptions = loadOptions;
    if (!isMobile) {
      try {
        this.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available — DOM renderer will be used
      }
    }
    this.registerNotificationHandlers();
    this.onTitleChange(setTitle);
  }

  /**
   * Register OSC escape-sequence handlers for desktop notifications.
   *   OSC 9   ; <body>             ST   (iTerm2)
   *   OSC 777 ; notify ; <title> ; <body> ST  (urxvt)
   */
  private registerNotificationHandlers(): void {
    this.parser.registerOscHandler(9, (data: string): boolean => {
      showNotification('Terminal', data);
      return true;
    });
    this.parser.registerOscHandler(777, (data: string): boolean => {
      const parts = data.split(';');
      if (parts[0] !== 'notify') return false;
      showNotification(parts[1] || 'Terminal', parts[2] || '', true);
      return true;
    });
  }

  resizeTerm(): void {
    this.refresh(0, this.rows - 1);
    if (this.shouldFitTerm) this.fitAddon.fit();
    this.socket.emit('resize', { cols: this.cols, rows: this.rows });
  }

  get shouldFitTerm(): boolean {
    return this.loadOptions().wettyFitTerminal;
  }
}

const ctrlButton = document.getElementById('onscreen-ctrl');
let ctrlFlag = false; // This indicates whether the CTRL key is pressed or not

/**
 * Toggles the state of the `ctrlFlag` variable and updates the visual state
 * of the `ctrlButton` element accordingly. If `ctrlFlag` is set to `true`,
 * the `active` class is added to the `ctrlButton`; otherwise, it is removed.
 * After toggling, the terminal (`wetty_term`) is focused if it exists.
 */
const toggleCTRL = (): void => {
  ctrlFlag = !ctrlFlag;
  if (ctrlButton) {
    if (ctrlFlag) {
      ctrlButton.classList.add('active');
    } else {
      ctrlButton.classList.remove('active');
    }
  }
  window.wetty_term?.focus();
};

/**
 * Simulates a backspace key press by sending the backspace character
 * (ASCII code 127) to the terminal. This function is intended to be used
 * in conjunction with the `simulateCTRLAndKey` function to handle
 * keyboard shortcuts.
 *
 */
const simulateBackspace = (): void => {
  window.wetty_term?.input('\x7F', true);
};

/**
 * Simulates a CTRL + key press by sending the corresponding character
 * (converted from the key's ASCII code) to the terminal. This function
 * is intended to be used in conjunction with the `toggleCTRL` function
 * to handle keyboard shortcuts.
 *
 * @param key - The key that was pressed, which will be converted to
 *              its corresponding character code.
 */
const simulateCTRLAndKey = (key: string): void => {
  window.wetty_term?.input(
    String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64),
    false,
  );
};

/**
 * Handles the keydown event for the CTRL key. When the CTRL key is pressed,
 * it sets the `ctrlFlag` variable to true and updates the visual state of
 * the `ctrlButton` element. If the CTRL key is released, it sets `ctrlFlag`
 * to false and updates the visual state of the `ctrlButton` element.
 *
 * @param e - The keyboard event object.
 */
document.addEventListener('keyup', (e) => {
  if (ctrlFlag) {
    // if key is a character
    if (e.key.length === 1 && /^[a-zA-Z0-9]$/.exec(e.key)) {
      simulateCTRLAndKey(e.key);
      // delayed backspace is needed to remove the character added to the terminal
      // when CTRL + key is pressed.
      // this is a workaround because e.preventDefault() cannot be used.
      setTimeout(() => {
        simulateBackspace();
      }, 100);
    }
    toggleCTRL();
  }
});

/**
 * Simulates pressing the ESC key by sending the ESC character (ASCII code 27)
 * to the terminal. If the CTRL key is active, it toggles the CTRL state off.
 * After sending the ESC character, the terminal is focused.
 */
const pressESC = (): void => {
  if (ctrlFlag) {
    toggleCTRL();
  }
  window.wetty_term?.input('\x1B', false);
  window.wetty_term?.focus();
};

/**
 * Simulates pressing the UP arrow key by sending the UP character (ASCII code 65)
 * to the terminal. If the CTRL key is active, it toggles the CTRL state off.
 * After sending the UP character, the terminal is focused.
 */
const pressUP = (): void => {
  if (ctrlFlag) {
    toggleCTRL();
  }
  window.wetty_term?.input('\x1B[A', false);
  window.wetty_term?.focus();
};

/**
 * Simulates pressing the DOWN arrow key by sending the DOWN character (ASCII code 66)
 * to the terminal. If the CTRL key is active, it toggles the CTRL state off.
 * After sending the DOWN character, the terminal is focused.
 */
const pressDOWN = (): void => {
  if (ctrlFlag) {
    toggleCTRL();
  }
  window.wetty_term?.input('\x1B[B', false);
  window.wetty_term?.focus();
};

/**
 * Simulates pressing the TAB key by sending the TAB character (ASCII code 9)
 * to the terminal. If the CTRL key is active, it toggles the CTRL state off.
 * After sending the TAB character, the terminal is focused.
 */
const pressTAB = (): void => {
  if (ctrlFlag) {
    toggleCTRL();
  }
  window.wetty_term?.input('\x09', false);
  window.wetty_term?.focus();
};

/**
 * Simulates pressing the LEFT arrow key by sending the LEFT character (ASCII code 68)
 * to the terminal. If the CTRL key is active, it toggles the CTRL state off.
 * After sending the LEFT character, the terminal is focused.
 */
const pressLEFT = (): void => {
  if (ctrlFlag) {
    toggleCTRL();
  }
  window.wetty_term?.input('\x1B[D', false);
  window.wetty_term?.focus();
};

/**
 * Simulates pressing the RIGHT arrow key by sending the RIGHT character (ASCII code 67)
 * to the terminal. If the CTRL key is active, it toggles the CTRL state off.
 * After sending the RIGHT character, the terminal is focused.
 */
const pressRIGHT = (): void => {
  if (ctrlFlag) {
    toggleCTRL();
  }
  window.wetty_term?.input('\x1B[C', false);
  window.wetty_term?.focus();
};

/**
 * Toggles the visibility of the onscreen buttons by adding or removing
 * the 'active' class to the element with the ID 'onscreen-buttons'.
 */
const toggleFunctions = (): void => {
  const element = document.querySelector(
    'div#functions > div.onscreen-buttons',
  );
  if (element?.classList.contains('active')) {
    element.classList.remove('active');
  } else {
    element?.classList.add('active');
    document.getElementById('options')?.classList.remove('opened');
  }
};

declare global {
  interface Window {
    wetty_term?: Term;
    clipboardData: DataTransfer;
    toggleFunctions?: () => void;
    toggleCTRL?: () => void;
    pressESC?: () => void;
    pressUP?: () => void;
    pressDOWN?: () => void;
    pressTAB?: () => void;
    pressLEFT?: () => void;
    pressRIGHT?: () => void;
  }
}

export function terminal(socket: Socket): Term | undefined {
  const term = new Term(socket);
  if (termElement === null) return undefined;
  termElement.innerHTML = '';
  term.open(termElement);
  configureTerm(term);
  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'default'
  ) {
    termElement.addEventListener(
      'click',
      () => {
        if (Notification.permission === 'default') {
          void Notification.requestPermission();
        }
      },
      { once: true },
    );
  }
  window.onresize = function onResize() {
    term.resizeTerm();
  };
  window.wetty_term = term;
  window.toggleFunctions = toggleFunctions;
  window.toggleCTRL = toggleCTRL;
  window.pressESC = pressESC;
  window.pressUP = pressUP;
  window.pressDOWN = pressDOWN;
  window.pressTAB = pressTAB;
  window.pressLEFT = pressLEFT;
  window.pressRIGHT = pressRIGHT;
  return term;
}
