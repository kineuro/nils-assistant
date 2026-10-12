// SPDX-License-Identifier: AGPL-3.0-only
// The analysis workspace's `chart` command (2026-10-12): a CSV in the
// workspace drawn as a plain SVG figure, offline, with no library. The
// workspace's Python has the standard library alone (no matplotlib), so this
// is how the one chat draws: bars, a histogram, boxes per group, lines and a
// scatter. The figure is self-contained (its own light surface, no script, no
// link out), so the desk can show it as an image.

import { decodeBytesToUtf8, defineCommand } from "just-bash";

/** A CSV's header and rows, as text. */
export interface Csv {
  columns: string[];
  rows: string[][];
}

/** RFC 4180 CSV: a quoted cell may hold commas, quotes ("") and line breaks; CRLF or LF ends a row. */
export function parseCsv(text: string): Csv {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  return { columns: (head ?? []).map((c) => c.trim()), rows: body };
}

/** Whether a chart is plain SVG the desk may show: no script, no handler, no link out, no foreign content. */
export function plainSvg(svg: string): boolean {
  return (
    /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/u.test(svg) &&
    !/<script|<foreignObject|javascript:|\son[a-z]+\s*=|<iframe|<image[^>]+href\s*=\s*["']?(?!data:)|<use[^>]+href\s*=\s*["']?(?!#)|@import|url\(\s*["']?(?!#|data:)/iu.test(
      svg,
    )
  );
}

export const CHART_KINDS = ["bar", "hist", "box", "line", "scatter"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartSpec {
  kind: ChartKind;
  title: string;
  xLabel: string;
  yLabel: string;
  horizontal?: boolean;
  /** bar: one value per label. */
  bars?: { label: string; value: number }[];
  /** hist: the values and the number of bins. */
  values?: number[];
  bins?: number;
  /** box: the values of each group. */
  groups?: { label: string; values: number[] }[];
  /** line: x labels in order and up to four series. */
  xs?: string[];
  series?: { name: string; values: (number | null)[] }[];
  /** scatter: the points. */
  points?: { x: number; y: number }[];
}

/** The most marks a figure draws; more is refused with how to narrow. */
export const CHART_CAPS = { bars: 40, groups: 20, series: 4, points: 2_000, bins: 50 };

// The figure's colours: one light surface in every theme (the desk shows it as an image), recessive grid and axes,
// text in ink colours, never a series colour; series in a fixed order (the first three hold apart for colour-blind
// readers in any pairing, the fourth beside its neighbours on a line).
const SURFACE = "#fcfcfb";
const INK = "#0b0b0b";
const INK_2 = "#52514e";
const GRID = "#e6e5e1";
const AXIS = "#b8b7b1";
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const W = 720;
const H = 440;

const esc = (s: string) =>
  s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A number as a tick or a label: plain, with thousands grouped and at most three significant decimals. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n);
  const digits = a === 0 || a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return Number(n.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Ticks on a 1, 2, 5 step that cover [lo, hi], about `count` of them. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Number(v.toPrecision(12)));
  return out;
}

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** The frame every chart shares: surface, title, axis titles; the plot area inside it. */
function frame(spec: ChartSpec, inner: string, left: number, legend = ""): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`,
    `<title>${esc(spec.title)}</title>`,
    `<rect width="${W}" height="${H}" fill="${SURFACE}"/>`,
    `<text x="${left}" y="28" font-size="16" font-weight="600" fill="${INK}">${esc(spec.title)}</text>`,
    legend,
    inner,
    "</svg>",
  ].join("\n");
}

/** A value axis: grid lines and labels along y (vertical charts) or x (horizontal bars). */
function valueAxis(
  lo: number,
  hi: number,
  at: (v: number) => number,
  o: { horizontal: boolean; from: number; to: number; label: string; left: number },
): string {
  const out: string[] = [];
  for (const t of ticks(lo, hi)) {
    if (t < lo - 1e-9 || t > hi + 1e-9) continue;
    const p = r1(at(t));
    if (o.horizontal) {
      out.push(`<line x1="${p}" y1="${o.from}" x2="${p}" y2="${o.to}" stroke="${GRID}" stroke-width="1"/>`);
      out.push(
        `<text x="${p}" y="${o.to + 16}" font-size="11" fill="${INK_2}" text-anchor="middle">${fmt(t)}</text>`,
      );
    } else {
      out.push(`<line x1="${o.from}" y1="${p}" x2="${o.to}" y2="${p}" stroke="${GRID}" stroke-width="1"/>`);
      out.push(
        `<text x="${o.from - 8}" y="${p + 4}" font-size="11" fill="${INK_2}" text-anchor="end">${fmt(t)}</text>`,
      );
    }
  }
  // the axis title sits at the middle of the value axis itself
  const mid = r1((at(lo) + at(hi)) / 2);
  if (o.horizontal)
    out.push(
      `<text x="${mid}" y="${H - 12}" font-size="12" fill="${INK_2}" text-anchor="middle">${esc(o.label)}</text>`,
    );
  else
    out.push(
      `<text x="16" y="${mid}" font-size="12" fill="${INK_2}" text-anchor="middle" transform="rotate(-90 16 ${mid})">${esc(o.label)}</text>`,
    );
  return out.join("\n");
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A rectangle with its data end rounded (4px) and its base square, anchored to the baseline. */
function bar(x: number, y: number, w: number, h: number, horizontal: boolean, colour: string): string {
  const rad = Math.min(4, w / 2, h / 2);
  if (rad <= 0.5 || w <= 0 || h <= 0)
    return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(w, 0))}" height="${r1(Math.max(h, 0))}" fill="${colour}"/>`;
  // horizontal: rounded at the right end; vertical: rounded at the top
  const d = horizontal
    ? `M${r1(x)},${r1(y)} h${r1(w - rad)} a${rad},${rad} 0 0 1 ${rad},${rad} v${r1(h - 2 * rad)} a${rad},${rad} 0 0 1 -${rad},${rad} h-${r1(w - rad)} z`
    : `M${r1(x)},${r1(y + h)} v-${r1(h - rad)} a${rad},${rad} 0 0 1 ${rad},-${rad} h${r1(w - 2 * rad)} a${rad},${rad} 0 0 1 ${rad},${rad} v${r1(h - rad)} z`;
  return `<path d="${d}" fill="${colour}"/>`;
}

function barChart(spec: ChartSpec): string {
  const bars = spec.bars ?? [];
  const horizontal =
    spec.horizontal ?? (bars.length > 12 || bars.reduce((m, b) => Math.max(m, b.label.length), 0) > 10);
  const lo = Math.min(0, ...bars.map((b) => b.value));
  const hi = Math.max(0, ...bars.map((b) => b.value));
  const span = hi > lo ? hi : lo + 1;
  const labelled = bars.length <= 12;
  const out: string[] = [];
  if (horizontal) {
    const left = Math.min(
      220,
      24 +
        7 *
          Math.min(
            28,
            bars.reduce((m, b) => Math.max(m, b.label.length), 0),
          ),
    );
    const top = 52;
    const bottom = H - 44;
    const right = W - (labelled ? 64 : 24);
    const at = (v: number) => left + ((v - lo) / (span - lo)) * (right - left);
    out.push(valueAxis(lo, span, at, { horizontal: true, from: top, to: bottom, label: spec.yLabel, left }));
    const band = (bottom - top) / bars.length;
    const gap = Math.min(2 + band * 0.25, 12);
    bars.forEach((b, i) => {
      const y = top + i * band + gap / 2;
      const x0 = at(Math.min(0, b.value));
      const x1 = at(Math.max(0, b.value));
      out.push(bar(x0, y, x1 - x0, band - gap, true, SERIES[0]));
      out.push(
        `<text x="${left - 8}" y="${r1(y + (band - gap) / 2 + 4)}" font-size="11" fill="${INK}" text-anchor="end">${esc(clip(b.label, 30))}</text>`,
      );
      if (labelled)
        out.push(
          `<text x="${r1(x1 + 6)}" y="${r1(y + (band - gap) / 2 + 4)}" font-size="11" fill="${INK_2}">${fmt(b.value)}</text>`,
        );
    });
    out.push(
      `<line x1="${r1(at(0))}" y1="${top}" x2="${r1(at(0))}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>`,
    );
    return frame(spec, out.join("\n"), 24);
  }
  const left = 64;
  const top = 52;
  const bottom = H - 64;
  const right = W - 24;
  const at = (v: number) => bottom - ((v - lo) / (span - lo)) * (bottom - top);
  out.push(valueAxis(lo, span, at, { horizontal: false, from: left, to: right, label: spec.yLabel, left }));
  const band = (right - left) / Math.max(bars.length, 1);
  const gap = Math.max(2, band * 0.3);
  bars.forEach((b, i) => {
    const x = left + i * band + gap / 2;
    const y0 = at(Math.max(0, b.value));
    const y1 = at(Math.min(0, b.value));
    out.push(bar(x, y0, band - gap, y1 - y0, false, SERIES[0]));
    out.push(
      `<text x="${r1(x + (band - gap) / 2)}" y="${bottom + 16}" font-size="11" fill="${INK}" text-anchor="middle">${esc(clip(b.label, Math.max(4, Math.floor(band / 7))))}</text>`,
    );
    if (labelled)
      out.push(
        `<text x="${r1(x + (band - gap) / 2)}" y="${r1(y0 - 6)}" font-size="11" fill="${INK_2}" text-anchor="middle">${fmt(b.value)}</text>`,
      );
  });
  out.push(
    `<line x1="${left}" y1="${r1(at(0))}" x2="${right}" y2="${r1(at(0))}" stroke="${AXIS}" stroke-width="1"/>`,
  );
  out.push(
    `<text x="${r1((left + right) / 2)}" y="${H - 16}" font-size="12" fill="${INK_2}" text-anchor="middle">${esc(spec.xLabel)}</text>`,
  );
  return frame(spec, out.join("\n"), left);
}

function histChart(spec: ChartSpec): string {
  const values = spec.values ?? [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const n = Math.max(1, Math.min(CHART_CAPS.bins, spec.bins ?? Math.ceil(Math.log2(values.length) + 1)));
  const width = hi > lo ? (hi - lo) / n : 1;
  const counts = new Array<number>(n).fill(0);
  for (const v of values) counts[Math.min(n - 1, Math.floor((v - lo) / width))]++;
  const left = 64;
  const top = 52;
  const bottom = H - 64;
  const right = W - 24;
  const top_ = Math.max(...counts, 1);
  const at = (c: number) => bottom - (c / top_) * (bottom - top);
  const xs = (v: number) => left + ((v - lo) / (width * n)) * (right - left);
  const out: string[] = [
    valueAxis(0, top_, at, { horizontal: false, from: left, to: right, label: spec.yLabel, left }),
  ];
  counts.forEach((c, i) => {
    const x0 = xs(lo + i * width) + 1;
    const x1 = xs(lo + (i + 1) * width) - 1;
    if (c > 0) out.push(bar(x0, at(c), x1 - x0, bottom - at(c), false, SERIES[0]));
  });
  for (const t of ticks(lo, lo + width * n, 6)) {
    if (t < lo - 1e-9 || t > lo + width * n + 1e-9) continue;
    out.push(
      `<text x="${r1(xs(t))}" y="${bottom + 16}" font-size="11" fill="${INK_2}" text-anchor="middle">${fmt(t)}</text>`,
    );
  }
  out.push(
    `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>`,
  );
  out.push(
    `<text x="${r1((left + right) / 2)}" y="${H - 16}" font-size="12" fill="${INK_2}" text-anchor="middle">${esc(spec.xLabel)}</text>`,
  );
  return frame(spec, out.join("\n"), left);
}

function boxChart(spec: ChartSpec): string {
  const groups = (spec.groups ?? []).map((g) => ({ label: g.label, v: [...g.values].sort((a, b) => a - b) }));
  const all = groups.flatMap((g) => g.v);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = hi > lo ? (hi - lo) * 0.05 : 1;
  const left = 64;
  const top = 52;
  const bottom = H - 64;
  const right = W - 24;
  const at = (v: number) => bottom - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (bottom - top);
  const out: string[] = [
    valueAxis(lo - pad, hi + pad, at, { horizontal: false, from: left, to: right, label: spec.yLabel, left }),
  ];
  const band = (right - left) / Math.max(groups.length, 1);
  groups.forEach((g, i) => {
    const cx = left + band * (i + 0.5);
    const w = Math.min(56, band * 0.5);
    const q1 = quantile(g.v, 0.25);
    const q2 = quantile(g.v, 0.5);
    const q3 = quantile(g.v, 0.75);
    const iqr = q3 - q1;
    const wlo = g.v.find((v) => v >= q1 - 1.5 * iqr) ?? q1;
    const whi = [...g.v].reverse().find((v) => v <= q3 + 1.5 * iqr) ?? q3;
    out.push(
      `<line x1="${r1(cx)}" y1="${r1(at(whi))}" x2="${r1(cx)}" y2="${r1(at(wlo))}" stroke="${INK_2}" stroke-width="1.5"/>`,
    );
    out.push(
      `<rect x="${r1(cx - w / 2)}" y="${r1(at(q3))}" width="${r1(w)}" height="${r1(Math.max(1, at(q1) - at(q3)))}" rx="4" fill="${SERIES[0]}" fill-opacity="0.85" stroke="${SURFACE}" stroke-width="2"/>`,
    );
    out.push(
      `<line x1="${r1(cx - w / 2)}" y1="${r1(at(q2))}" x2="${r1(cx + w / 2)}" y2="${r1(at(q2))}" stroke="${SURFACE}" stroke-width="2"/>`,
    );
    for (const v of g.v)
      if (v < wlo || v > whi)
        out.push(
          `<circle cx="${r1(cx)}" cy="${r1(at(v))}" r="4" fill="${SURFACE}" stroke="${SERIES[0]}" stroke-width="2"/>`,
        );
    out.push(
      `<text x="${r1(cx)}" y="${bottom + 16}" font-size="11" fill="${INK}" text-anchor="middle">${esc(clip(g.label, Math.max(4, Math.floor(band / 7))))}</text>`,
    );
    out.push(
      `<text x="${r1(cx + w / 2 + 4)}" y="${r1(at(q2) + 4)}" font-size="10" fill="${INK_2}">${fmt(q2)}</text>`,
    );
  });
  out.push(
    `<text x="${r1((left + right) / 2)}" y="${H - 16}" font-size="12" fill="${INK_2}" text-anchor="middle">${esc(spec.xLabel)}</text>`,
  );
  return frame(spec, out.join("\n"), left);
}

function lineChart(spec: ChartSpec): string {
  const xs = spec.xs ?? [];
  const series = spec.series ?? [];
  const numericX = xs.every((x) => x.trim() !== "" && Number.isFinite(Number(x)));
  const xv = numericX ? xs.map(Number) : xs.map((_, i) => i);
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const lo = Math.min(...vals, ...(vals.every((v) => v >= 0) ? [0] : []));
  const hi = Math.max(...vals);
  const span = hi > lo ? hi : lo + 1;
  const left = 64;
  const top = 52;
  const bottom = H - 64;
  const right = W - (series.length > 1 ? 120 : 24);
  const xlo = Math.min(...xv);
  const xhi = Math.max(...xv);
  const px = (v: number) => left + (xhi > xlo ? (v - xlo) / (xhi - xlo) : 0.5) * (right - left);
  const py = (v: number) => bottom - ((v - lo) / (span - lo)) * (bottom - top);
  const out: string[] = [
    valueAxis(lo, span, py, { horizontal: false, from: left, to: right, label: spec.yLabel, left }),
  ];
  const every = Math.max(1, Math.ceil(xs.length / 10));
  xs.forEach((x, i) => {
    if (i % every !== 0 && i !== xs.length - 1) return;
    out.push(
      `<text x="${r1(px(xv[i]))}" y="${bottom + 16}" font-size="11" fill="${INK_2}" text-anchor="middle">${esc(clip(numericX ? fmt(xv[i]) : x, 12))}</text>`,
    );
  });
  series.forEach((s, k) => {
    const colour = SERIES[k];
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${r1(px(xv[i]))},${r1(py(v))} `;
      pen = true;
    });
    out.push(
      `<path d="${d.trim()}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    if (xs.length <= 24)
      s.values.forEach((v, i) => {
        if (v !== null)
          out.push(
            `<circle cx="${r1(px(xv[i]))}" cy="${r1(py(v))}" r="4" fill="${colour}" stroke="${SURFACE}" stroke-width="2"/>`,
          );
      });
    const last = [...s.values.keys()].reverse().find((i) => s.values[i] !== null);
    if (series.length > 1 && last !== undefined)
      out.push(
        `<text x="${r1(px(xv[last]) + 8)}" y="${r1(py(s.values[last] as number) + 4)}" font-size="11" fill="${INK}">${esc(clip(s.name, 14))}</text>`,
      );
  });
  out.push(
    `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>`,
  );
  out.push(
    `<text x="${r1((left + right) / 2)}" y="${H - 16}" font-size="12" fill="${INK_2}" text-anchor="middle">${esc(spec.xLabel)}</text>`,
  );
  const legend =
    series.length > 1
      ? series
          .map(
            (s, k) =>
              `<rect x="${W - 112}" y="${48 + k * 18}" width="12" height="3" rx="1.5" fill="${SERIES[k]}"/><text x="${W - 94}" y="${53 + k * 18}" font-size="11" fill="${INK}">${esc(clip(s.name, 14))}</text>`,
          )
          .join("\n")
      : "";
  return frame(spec, out.join("\n"), left, legend);
}

function scatterChart(spec: ChartSpec): string {
  const pts = spec.points ?? [];
  const left = 64;
  const top = 52;
  const bottom = H - 64;
  const right = W - 24;
  const xlo = Math.min(...pts.map((p) => p.x));
  const xhi = Math.max(...pts.map((p) => p.x));
  const ylo = Math.min(...pts.map((p) => p.y));
  const yhi = Math.max(...pts.map((p) => p.y));
  const xpad = xhi > xlo ? (xhi - xlo) * 0.04 : 1;
  const ypad = yhi > ylo ? (yhi - ylo) * 0.06 : 1;
  const px = (v: number) => left + ((v - (xlo - xpad)) / (xhi + xpad - (xlo - xpad))) * (right - left);
  const py = (v: number) => bottom - ((v - (ylo - ypad)) / (yhi + ypad - (ylo - ypad))) * (bottom - top);
  const out: string[] = [
    valueAxis(ylo - ypad, yhi + ypad, py, {
      horizontal: false,
      from: left,
      to: right,
      label: spec.yLabel,
      left,
    }),
  ];
  for (const t of ticks(xlo - xpad, xhi + xpad, 6)) {
    if (t < xlo - xpad || t > xhi + xpad) continue;
    out.push(
      `<text x="${r1(px(t))}" y="${bottom + 16}" font-size="11" fill="${INK_2}" text-anchor="middle">${fmt(t)}</text>`,
    );
  }
  const opacity = pts.length > 300 ? 0.45 : 0.8;
  for (const p of pts)
    out.push(
      `<circle cx="${r1(px(p.x))}" cy="${r1(py(p.y))}" r="4" fill="${SERIES[0]}" fill-opacity="${opacity}" stroke="${SURFACE}" stroke-width="1"/>`,
    );
  out.push(
    `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>`,
  );
  out.push(
    `<text x="${r1((left + right) / 2)}" y="${H - 16}" font-size="12" fill="${INK_2}" text-anchor="middle">${esc(spec.xLabel)}</text>`,
  );
  return frame(spec, out.join("\n"), left);
}

/** The figure, as plain SVG text. */
export function renderChart(spec: ChartSpec): string {
  switch (spec.kind) {
    case "bar":
      return barChart(spec);
    case "hist":
      return histChart(spec);
    case "box":
      return boxChart(spec);
    case "line":
      return lineChart(spec);
    case "scatter":
      return scatterChart(spec);
  }
}

export const CHART_USAGE = `usage: chart <kind> <file.csv> [options]   (- reads the CSV from stdin)
  chart bar     data.csv --x <column> [--y <column>]   counts per value of x, or the value y per x
  chart hist    data.csv --x <column> [--bins N]       how a number is spread
  chart box     data.csv --y <column> [--x <group>]    median, quartiles and outliers, per group
  chart line    data.csv --x <column> --y <col>[,col]  one to four series in the file's order
  chart scatter data.csv --x <column> --y <column>     two numbers against each other
options: --title "..."  --xlabel "..."  --ylabel "..."  --horizontal  --out /out/<name>.svg (default /out/chart.svg)
A figure is written as plain SVG under /out, and the person sees it beside your answer.`;

/** The command line, read into a spec; a string is a refusal in plain words. */
export function chartSpec(
  args: readonly string[],
  csv: Csv,
  file: string,
): { spec: ChartSpec; out: string } | string {
  const kind = args[0] as ChartKind;
  const opt: Record<string, string> = {};
  let horizontal: boolean | undefined;
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === "--horizontal") horizontal = true;
    else if (a.startsWith("--")) {
      const [k, v] = a.includes("=")
        ? [a.slice(2, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]
        : [a.slice(2), args[++i]];
      if (v === undefined) return `--${k} needs a value`;
      opt[k] = v;
    } else return `unexpected argument ${JSON.stringify(a)}`;
  }
  const out = opt.out ?? "/out/chart.svg";
  if (!/^\/out\/[\w.-]+\.svg$/u.test(out))
    return "--out is a file under /out ending in .svg, such as /out/scans-by-base.svg";
  const col = (name: string | undefined, what: string): number | string => {
    if (!name) return `--${what} names a column`;
    const i = csv.columns.indexOf(name);
    return i >= 0
      ? i
      : `no column named ${JSON.stringify(name)} in ${file}; its columns are: ${csv.columns.join(", ")}`;
  };
  const num = (s: string | undefined): number | null => {
    const t = (s ?? "").trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const title = opt.title ?? "";
  if (csv.rows.length === 0) return `${file} has no rows`;
  switch (kind) {
    case "bar": {
      const x = col(opt.x, "x");
      if (typeof x === "string") return x;
      const label = (r: string[]) => (r[x] ?? "").trim() || "(empty)";
      let bars: { label: string; value: number }[];
      if (opt.y === undefined) {
        const counts = new Map<string, number>();
        for (const r of csv.rows) counts.set(label(r), (counts.get(label(r)) ?? 0) + 1);
        bars = [...counts].map(([l, value]) => ({ label: l, value })).sort((a, b) => b.value - a.value);
      } else {
        const y = col(opt.y, "y");
        if (typeof y === "string") return y;
        const sums = new Map<string, number>();
        for (const r of csv.rows) {
          const v = num(r[y]);
          if (v === null) continue;
          sums.set(label(r), (sums.get(label(r)) ?? 0) + v);
        }
        bars = [...sums].map(([l, value]) => ({ label: l, value }));
        if (bars.length === 0) return `the column ${opt.y} holds no numbers`;
      }
      if (bars.length > CHART_CAPS.bars)
        return `${bars.length} bars, more than the ${CHART_CAPS.bars} a chart draws; keep the largest or group the rest first`;
      return {
        out,
        spec: {
          kind,
          title: title || (opt.y ? `${opt.y} by ${opt.x}` : `Count by ${opt.x}`),
          xLabel: opt.xlabel ?? (opt.x as string),
          yLabel: opt.ylabel ?? opt.y ?? "count",
          horizontal,
          bars,
        },
      };
    }
    case "hist": {
      const x = col(opt.x, "x");
      if (typeof x === "string") return x;
      const values = csv.rows.map((r) => num(r[x])).filter((v): v is number => v !== null);
      if (values.length === 0) return `the column ${opt.x} holds no numbers`;
      const bins = opt.bins === undefined ? undefined : Number(opt.bins);
      if (bins !== undefined && !(Number.isInteger(bins) && bins >= 1 && bins <= CHART_CAPS.bins))
        return `--bins is a whole number from 1 to ${CHART_CAPS.bins}`;
      return {
        out,
        spec: {
          kind,
          title: title || `Distribution of ${opt.x}`,
          xLabel: opt.xlabel ?? (opt.x as string),
          yLabel: opt.ylabel ?? "count",
          values,
          bins,
        },
      };
    }
    case "box": {
      const y = col(opt.y, "y");
      if (typeof y === "string") return y;
      const x = opt.x === undefined ? null : col(opt.x, "x");
      if (typeof x === "string") return x;
      const by = new Map<string, number[]>();
      for (const r of csv.rows) {
        const v = num(r[y]);
        if (v === null) continue;
        const g = x === null ? (opt.y as string) : (r[x] ?? "").trim() || "(empty)";
        by.set(g, [...(by.get(g) ?? []), v]);
      }
      if (by.size === 0) return `the column ${opt.y} holds no numbers`;
      if (by.size > CHART_CAPS.groups)
        return `${by.size} groups, more than the ${CHART_CAPS.groups} a chart draws; group them first`;
      return {
        out,
        spec: {
          kind,
          title: title || (opt.x ? `${opt.y} by ${opt.x}` : `Spread of ${opt.y}`),
          xLabel: opt.xlabel ?? opt.x ?? "",
          yLabel: opt.ylabel ?? (opt.y as string),
          groups: [...by].map(([label, values]) => ({ label, values })),
        },
      };
    }
    case "line": {
      const x = col(opt.x, "x");
      if (typeof x === "string") return x;
      const names = (opt.y ?? "").split(",").filter(Boolean);
      if (names.length === 0) return "--y names one to four columns, comma separated";
      if (names.length > CHART_CAPS.series)
        return `${names.length} series, more than the ${CHART_CAPS.series} a chart draws apart`;
      const ys: number[] = [];
      for (const n of names) {
        const i = col(n, "y");
        if (typeof i === "string") return i;
        ys.push(i);
      }
      if (csv.rows.length > CHART_CAPS.points)
        return `${csv.rows.length} points, more than the ${CHART_CAPS.points} a chart draws`;
      return {
        out,
        spec: {
          kind,
          title: title || `${names.join(", ")} by ${opt.x}`,
          xLabel: opt.xlabel ?? (opt.x as string),
          yLabel: opt.ylabel ?? (names.length === 1 ? names[0] : ""),
          xs: csv.rows.map((r) => r[x] ?? ""),
          series: names.map((name, k) => ({ name, values: csv.rows.map((r) => num(r[ys[k]])) })),
        },
      };
    }
    case "scatter": {
      const x = col(opt.x, "x");
      if (typeof x === "string") return x;
      const y = col(opt.y, "y");
      if (typeof y === "string") return y;
      const points = csv.rows.flatMap((r) => {
        const a = num(r[x]);
        const b = num(r[y]);
        return a === null || b === null ? [] : [{ x: a, y: b }];
      });
      if (points.length === 0) return `no row holds numbers in both ${opt.x} and ${opt.y}`;
      if (points.length > CHART_CAPS.points)
        return `${points.length} points, more than the ${CHART_CAPS.points} a chart draws`;
      return {
        out,
        spec: {
          kind,
          title: title || `${opt.y} against ${opt.x}`,
          xLabel: opt.xlabel ?? (opt.x as string),
          yLabel: opt.ylabel ?? (opt.y as string),
          points,
        },
      };
    }
    default:
      return `the kind is one of ${CHART_KINDS.join(", ")}`;
  }
}

const fail = (why: string) => ({ stdout: "", stderr: `chart: ${why}\n${CHART_USAGE}\n`, exitCode: 2 });

/** The `chart` command of the analysis workspace. */
export const chartCommand = defineCommand("chart", async (args, ctx) => {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h")
    return { stdout: `${CHART_USAGE}\n`, stderr: "", exitCode: 0 };
  if (!CHART_KINDS.includes(args[0] as ChartKind))
    return fail(`the kind is one of ${CHART_KINDS.join(", ")}`);
  const file = args[1];
  if (!file) return fail("name the CSV file, or - for stdin");
  let text: string;
  try {
    text =
      file === "-" ? decodeBytesToUtf8(ctx.stdin) : await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, file));
  } catch {
    return fail(`no file ${file}`);
  }
  const csv = parseCsv(text);
  const got = chartSpec(args, csv, file);
  if (typeof got === "string") return fail(got);
  const svg = renderChart(got.spec);
  await ctx.fs.mkdir("/out", { recursive: true });
  await ctx.fs.writeFile(got.out, svg);
  return {
    stdout: `wrote ${got.out}: ${got.spec.kind} chart "${got.spec.title}" (${svg.length.toLocaleString("en-US")} characters)\n`,
    stderr: "",
    exitCode: 0,
  };
});
