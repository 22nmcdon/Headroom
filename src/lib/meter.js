// A moving-coil meter, which is what a compressor is recognised by.
//
// Every other display in this app is a picture of something: a curve, a
// spectrum, a decay. This one is not a picture of the reduction, it is the
// reading of it - one number, large, legible from across a room, and
// answering the only question you ask a compressor a hundred times a minute.
// The trace beside it answers the other one, which is what it has been
// doing; neither is a substitute for the other.
//
// A cream dial let into a dark chassis is not decoration for its own sake.
// It is the one place on a plugin's face where the paper this whole app is
// drawn on shows through, and it is also, as it happens, what every
// compressor with a meter on it has looked like for seventy years.
//
// Drawn once as SVG and then only the needle moves, by one attribute on one
// element. The face never changes, so nothing redraws it.

/** How far the needle swings, end to end, in degrees. */
export const VU_SWEEP = 112;

/** The deepest reduction the dial can show. */
export const VU_DEEPEST = -20;

/** And where the scale turns red, because past here it is a shape not a mix. */
export const VU_HEAVY = -12;

/** The face is drawn in this space, and scaled to whatever box it is in. */
const WIDE = 200;
const TALL = 104;
const PIVOT = { x: 100, y: 102 };
const RADIUS = 78;

/** Where a reduction sits on the dial, in degrees from straight up. */
export function vuAngle(db, deepest = VU_DEEPEST) {
  const held = Math.min(0, Math.max(deepest, Number.isFinite(db) ? db : 0));
  return VU_SWEEP / 2 - (held / deepest) * VU_SWEEP;
}

const at = (degrees, radius) => [
  PIVOT.x + Math.sin((degrees * Math.PI) / 180) * radius,
  PIVOT.y - Math.cos((degrees * Math.PI) / 180) * radius,
];

/**
 * The dial, as markup.
 *
 * `marks` are the numbers printed on it and `minor` the ticks between them.
 * Five numbers, because at this sweep a sixth lands on top of its neighbour -
 * the first pass had one at 1 dB and it sat on the 0.
 */
export function vuFace({
  marks = [20, 12, 6, 3, 0],
  minor = [18, 16, 14, 10, 8, 4.5, 1.5],
  deepest = VU_DEEPEST,
  heavy = VU_HEAVY,
  legend = '',
} = {}) {
  const angle = (db) => vuAngle(db, deepest);

  const ticks = marks.map((db) => {
    const degrees = angle(-db);
    const [x1, y1] = at(degrees, RADIUS);
    const [x2, y2] = at(degrees, RADIUS - 8);
    const [tx, ty] = at(degrees, RADIUS - 23);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#241f1d" stroke-width="1.5"/>
      <text class="vu-mark" x="${tx}" y="${ty + 3.5}" text-anchor="middle" font-size="9.5"
            font-family="Jost, sans-serif" font-weight="500" fill="#3a332f">${db}</text>`;
  }).join('');

  const small = minor.map((db) => {
    const [x1, y1] = at(angle(-db), RADIUS);
    const [x2, y2] = at(angle(-db), RADIUS - 4.5);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(36,31,29,.45)" stroke-width="1"/>`;
  }).join('');

  const [ax, ay] = at(angle(0), RADIUS);
  const [bx, by] = at(angle(deepest), RADIUS);
  const [hx, hy] = at(angle(heavy), RADIUS);
  const [nx, ny] = at(angle(0), RADIUS - 9);

  return `<svg viewBox="0 0 ${WIDE} ${TALL}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="M ${bx} ${by} A ${RADIUS} ${RADIUS} 0 0 1 ${ax} ${ay}" fill="none" stroke="#241f1d" stroke-width="1.5"/>
    <path d="M ${bx} ${by} A ${RADIUS} ${RADIUS} 0 0 1 ${hx} ${hy}" fill="none" stroke="#a4553f" stroke-width="3.5"/>
    ${small}${ticks}
    <line class="vu-needle" data-needle x1="${PIVOT.x}" y1="${PIVOT.y}" x2="${nx}" y2="${ny}"
          stroke="#241f1d" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="${PIVOT.x}" cy="${PIVOT.y}" r="5" fill="#241f1d"/>
  </svg>${legend ? `<span class="vu-legend">${legend}</span>` : ''}`;
}

/**
 * Point the needle at a reading.
 *
 * One attribute on one element, which is why this can run every frame
 * without anyone noticing it is there.
 */
export function aimVu(dial, db, deepest = VU_DEEPEST) {
  const needle = dial?.querySelector('[data-needle]');
  if (!needle) return;
  const turn = vuAngle(db, deepest) - vuAngle(0, deepest);
  needle.setAttribute('transform', `rotate(${turn.toFixed(2)} ${PIVOT.x} ${PIVOT.y})`);
}
