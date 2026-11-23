// Progress: every tool at once.
//
// The shell builds the model from the buckets (src/learn/report.js does the
// arithmetic) and handles the buttons, which carry `data-report`. This only
// draws it.

import { esc } from './markup.js';

/** One cell: a button to go and play it, saying how it has gone so far. */
function cell(entry, row, tierLabel) {
  if (!entry) return '<td><span class="report-gap" title="No such tier">·</span></td>';

  const where = `${row.name}, ${entry.kind === 'drill' ? 'drills' : 'work'}, ${tierLabel}`;
  const go = `data-report="go" data-tool="${esc(row.id)}" data-kind="${entry.kind}" data-tier="${esc(entry.tier)}"`;
  if (entry.rate === null) {
    return `<td><button class="report-cell is-none" type="button" ${go}
      title="${esc(where)}: not tried yet"><span class="report-pct">—</span></button></td>`;
  }
  const pct = Math.round(entry.rate * 100);
  const said = entry.kind === 'drill' ? 'right first time' : 'solved';
  return `<td><button class="report-cell is-${entry.shade}" type="button" ${go}
    title="${esc(where)}: ${pct}% ${said}, over ${entry.played}">
    <span class="report-pct">${pct}%</span><span class="report-n">of ${entry.played}</span>
  </button></td>`;
}

function confusion(item) {
  return `
    <div class="report-card">
      <span class="report-card-what">${esc(item.what)}</span>
      <span class="report-card-as">${esc(item.as)}</span>
      <button class="link-btn" type="button" data-report="go" data-tool="${esc(item.tool)}"
        data-kind="drill" data-tier="${esc(item.tier)}">Drill it</button>
    </div>`;
}

/** Draw the whole page into `el`. */
export function drawReport(el, model) {
  const { tiers, rows, confused, played } = model;
  const span = tiers.length;

  el.innerHTML = `
    <div class="report">
      <div class="report-head">
        <div>
          <h2 class="report-title">How your ears are doing</h2>
          <p class="report-lede">Drills count the first answer. Work counts rounds solved
            without Show me. ${played ? '' : 'Nothing played yet — every cell is a way in.'}</p>
        </div>
        <div class="report-actions">
          <button class="report-btn" type="button" data-report="export">Export</button>
          <button class="report-btn" type="button" data-report="import">Import</button>
        </div>
      </div>

      <div class="report-body">
        <div class="report-wrap">
          <table class="report-table">
            <thead>
              <tr>
                <th scope="col" rowspan="2" class="report-tool-head">Tool</th>
                <th scope="colgroup" colspan="${span}" class="report-kind">Drill · first try</th>
                <th scope="colgroup" colspan="${span}" class="report-kind report-split">Work · solved</th>
              </tr>
              <tr>
                ${['drill', 'work'].map((kind) => tiers.map((tier, i) =>
                  `<th scope="col" class="report-tier${kind === 'work' && i === 0 ? ' report-split' : ''}">${esc(tier.label)}</th>`).join('')).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <th scope="row" class="report-tool">${esc(row.name)}
                    <span class="report-group">${esc(row.group)}</span></th>
                  ${row.cells.map((entry, i) => cell(entry, row, tiers[i % span].label)
                    .replace('<td>', i === span ? '<td class="report-split">' : '<td>')).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <aside class="report-side">
          <h3 class="report-side-title">What you hear things as</h3>
          ${confused.length ? confused.map(confusion).join('') : `
            <p class="report-fine">Nothing yet. When a drill answer keeps being heard as the same
              other thing - 2k as 4k, a dotted eighth as an eighth - it shows up here.</p>`}

          <div class="report-key">
            <span><span class="report-swatch is-high"></span>80% or more</span>
            <span><span class="report-swatch is-mid"></span>50 to 79%</span>
            <span><span class="report-swatch is-low"></span>under 50%</span>
            <span><span class="report-swatch is-none"></span>not tried</span>
          </div>

          <p class="report-fine">All of this lives in this browser. Export saves it as a file;
            Import adds a file's progress to what is here, and never replaces it.</p>
          <button class="link-btn" type="button" data-report="clear">Clear all progress</button>
        </aside>
      </div>
    </div>`;
}
