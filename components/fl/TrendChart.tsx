"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MIN_N_FOR_VERDICT } from "@/lib/fl/stats";

export interface TrendPoint {
  x: number;
  y: number;
  low?: number;
  high?: number;
  n?: number;
  note?: string;
}

export interface TrendSeries {
  id: string;
  name: string;
  color: string;
  points: TrendPoint[];
}

const HEIGHT = 170;
const AXIS_BAND = 40;
const PAD = { left: 40, right: 16, top: 12 };

/**
 * One metric across runs: lines from a single baseline axis, hairline grid,
 * a crosshair readout and a table twin. A hollow dot marks a figure from
 * too few events to lean on, so a thin number looks thin at a glance.
 */
export function TrendChart({
  title,
  subtitle,
  xLabels,
  series,
  yMax = 1,
  format,
}: {
  title: string;
  subtitle: string;
  xLabels: string[];
  series: TrendSeries[];
  yMax?: number;
  format: (value: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.max(240, entries[0].contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = width - PAD.left - PAD.right;
  const xAt = (x: number) =>
    PAD.left +
    (xLabels.length <= 1 ? plotWidth / 2 : (x / (xLabels.length - 1)) * plotWidth);
  const yAt = (y: number) => PAD.top + (1 - Math.min(y, yMax) / yMax) * HEIGHT;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => step * yMax);

  const nearest = (event: PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    let best = 0;
    let distance = Infinity;
    xLabels.forEach((_, index) => {
      const gap = Math.abs(xAt(index) - PAD.left - px);
      if (gap < distance) {
        distance = gap;
        best = index;
      }
    });
    setActive(best);
  };

  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "ArrowRight") {
      setActive((value) => Math.min((value ?? -1) + 1, xLabels.length - 1));
    } else if (event.key === "ArrowLeft") {
      setActive((value) => Math.max((value ?? 1) - 1, 0));
    }
  };

  const hasData = series.some((item) => item.points.length > 0);
  const nRange = (x: number) => {
    const values = series.flatMap((item) =>
      item.points.filter((point) => point.x === x && point.n !== undefined).map((point) => point.n!),
    );
    if (values.length === 0) return "";
    const low = Math.min(...values);
    const high = Math.max(...values);
    return low === high ? `n=${low}` : `n=${low}–${high}`;
  };

  const tooltipLeft =
    active !== null ? Math.min(Math.max(xAt(active) - 80, 0), width - 170) : 0;

  return (
    <figure className="min-w-0 rounded border border-border bg-surface p-4">
      <figcaption>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-muted">{subtitle}</p>
      </figcaption>

      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
          {series.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: item.color }} />
              {item.name}
            </li>
          ))}
        </ul>
      )}

      <div ref={wrapRef} className="relative mt-2">
        {!hasData ? (
          <p className="py-14 text-center font-mono text-xs text-muted">No live round yet.</p>
        ) : (
          <>
            <svg
              role="img"
              aria-label={`${title}. Values are in the table below this chart.`}
              width={width}
              height={HEIGHT + PAD.top + AXIS_BAND}
              tabIndex={0}
              onKeyDown={onKey}
              onFocus={() => setActive((value) => value ?? xLabels.length - 1)}
              onBlur={() => setActive(null)}
              className="block outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={yAt(tick)}
                    y2={yAt(tick)}
                    stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
                  />
                  <text
                    x={PAD.left - 6}
                    y={yAt(tick)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-muted font-mono text-[10px] tabular-nums"
                  >
                    {format(tick)}
                  </text>
                </g>
              ))}

              {xLabels.map((label, index) => (
                <g key={label + index} className="fill-muted font-mono text-[10px]">
                  <text x={xAt(index)} y={HEIGHT + PAD.top + 16} textAnchor="middle">
                    {label}
                  </text>
                  <text x={xAt(index)} y={HEIGHT + PAD.top + 30} textAnchor="middle">
                    {nRange(index)}
                  </text>
                </g>
              ))}

              {series.map((item) => {
                const sorted = [...item.points].sort((a, b) => a.x - b.x);
                const path = sorted
                  .map((point, i) => `${i === 0 ? "M" : "L"}${xAt(point.x)} ${yAt(point.y)}`)
                  .join(" ");
                return (
                  <g key={item.id}>
                    {sorted.length > 1 && (
                      <path
                        d={path}
                        fill="none"
                        stroke={item.color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                    {sorted.map((point) => {
                      const thin = point.n !== undefined && point.n < MIN_N_FOR_VERDICT;
                      return (
                        <g key={point.x}>
                          {point.low !== undefined && point.high !== undefined && (
                            <line
                              x1={xAt(point.x)}
                              x2={xAt(point.x)}
                              y1={yAt(point.low)}
                              y2={yAt(point.high)}
                              stroke={item.color}
                              strokeOpacity={0.45}
                            />
                          )}
                          <circle
                            cx={xAt(point.x)}
                            cy={yAt(point.y)}
                            r={4}
                            fill={thin ? "var(--surface)" : item.color}
                            stroke={thin ? item.color : "var(--surface)"}
                            strokeWidth={2}
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {active !== null && (
                <line
                  x1={xAt(active)}
                  x2={xAt(active)}
                  y1={PAD.top}
                  y2={HEIGHT + PAD.top}
                  stroke="var(--chart-axis)"
                />
              )}
              <rect
                x={PAD.left}
                y={PAD.top}
                width={plotWidth}
                height={HEIGHT}
                fill="transparent"
                onPointerMove={nearest}
                onPointerLeave={() => setActive(null)}
              />
            </svg>

            {active !== null && (
              <div
                className="pointer-events-none absolute top-1 z-10 w-[170px] rounded border border-border bg-surface-raised p-2 font-mono text-[11px]"
                style={{ left: tooltipLeft }}
              >
                <p className="mb-1 text-muted">{xLabels[active]}</p>
                {series.map((item) => {
                  const point = item.points.find((entry) => entry.x === active);
                  return (
                    <p key={item.id} className="flex items-baseline gap-1.5 text-muted">
                      <span
                        aria-hidden
                        className="h-0.5 w-2.5 shrink-0 rounded"
                        style={{ background: item.color }}
                      />
                      <strong className="text-foreground">
                        {point ? format(point.y) : "none"}
                      </strong>
                      <span className="truncate">
                        {item.name}
                        {point?.n !== undefined ? ` n=${point.n}` : ""}
                      </span>
                    </p>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {hasData && (
        <details className="mt-2 font-mono text-[11px] text-muted">
          <summary className="cursor-pointer">Table</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left tabular-nums">
              <thead>
                <tr>
                  <th className="pr-3 font-normal">Point</th>
                  {series.map((item) => (
                    <th key={item.id} className="pr-3 font-normal">
                      {item.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {xLabels.map((label, index) => (
                  <tr key={label + index}>
                    <td className="pr-3">{label}</td>
                    {series.map((item) => {
                      const point = item.points.find((entry) => entry.x === index);
                      return (
                        <td key={item.id} className="pr-3 text-foreground">
                          {point
                            ? `${format(point.y)}${point.n !== undefined ? ` (n=${point.n})` : ""}${
                                point.low !== undefined
                                  ? ` [${format(point.low)}–${format(point.high!)}]`
                                  : ""
                              }${point.note ? ` ${point.note}` : ""}`
                            : "none"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
