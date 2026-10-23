import { LONGEST_TAIL, DECAY_FLOOR } from './response.js';

// The parts of a plugin's face that are the same in all of them.
//
// Three plugins now draw on a canvas and three of them turn a set of knobs
// into a set of sliders, and neither of those is a thing any one of them
// should own. What is here is what was written out three times: setting a
// canvas up for the screen it is on, turning a knob's range into a slider's
// and back, and the axis that a decay is drawn against.

/**
 * A limit pair, as the two keys a knob wants.
 *
 * So that a plugin's knob and the sketchpad's clamp read the same numbers out
 * of the same table rather than each carrying a copy.
 */
export const span = ([min, max]) => ({ min, max });

/** A knob's range, as a slider's. Log knobs are dialled in octaves. */
export const dialOf = (knob, value) => (knob.log
  ? {
    min: Math.log2(knob.min),
    max: Math.log2(knob.max),
    step: 0.005,
    at: Math.log2(Math.max(knob.min, value)),
  }
  : { min: knob.min, max: knob.max, step: knob.step, at: value });

/** And back again. */
export const offDial = (knob, raw) => (knob.log ? 2 ** Number(raw) : Number(raw));

/** What a canvas is, on the page. */
export function sizeOf(canvas) {
  const box = canvas.getBoundingClientRect();
  return { width: box.width, height: box.height };
}

/**
 * A canvas set up for its own pixels, and a context to draw in.
 *
 * Returns nothing when the canvas has no size yet, which happens on the first
 * draw of a panel that has not been laid out - every caller checks for it.
 */
export function readyCanvas(canvas) {
  const { width, height } = sizeOf(canvas);
  if (!width || !height) return null;

  const dpr = window.devicePixelRatio || 1;
  // Both, not just the width. A panel that changes height and keeps its
  // width - which is what happens when a plugin's deck gets a row taller
  // beside it - was left drawing at the old height and stretched to fit,
  // which on the EQ put the frequency axis off the bottom of the display.
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, width, height);
  return { c, width, height };
}

/**
 * Where a moment and a level sit on a decay display.
 *
 * Time runs logarithmically because a decay is heard as a ratio - the
 * difference between a third of a second and half a second is a different
 * room, and the difference between five seconds and five and a bit is
 * nothing at all.
 */
export const DECAY_FROM = 0.004;

export const decayX = (t, width) => (t <= DECAY_FROM
  ? 0
  : (Math.log2(t / DECAY_FROM) / Math.log2(LONGEST_TAIL / DECAY_FROM)) * width);

export const decayY = (db, height) => (db / DECAY_FLOOR) * height;

/**
 * Redraw when the box changes, not only when the window does.
 *
 * Every panel here listened for `resize` on the window, which is the one
 * thing that moves them the window knows about. A deck that gains a row
 * beside the display, a fold opening, a band type with one knob fewer: all
 * change the box with the window sitting still, and all left the canvas
 * drawing at the size it had before.
 *
 * Returns the way to stop. Safe against a redraw that resizes the bitmap,
 * because a panel's canvas is out of flow and so cannot change the box that
 * is being watched.
 */
export function watchSize(el, redraw) {
  window.addEventListener('resize', redraw);
  const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => redraw()) : null;
  watch?.observe(el);
  return () => {
    window.removeEventListener('resize', redraw);
    watch?.disconnect();
  };
}

/** A length of time, said the way a plugin says it. */
export const writeMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

/** A frequency, as a label. Every face that prints one wanted this, and it
    lived on the compressor, so four of them imported the compressor to get
    it. Nothing about it is a compressor's. */
export const writeHertz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`);
