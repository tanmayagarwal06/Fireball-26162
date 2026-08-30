/**
 * Scatter plot.
 *
 * Hand-rolled SVG rather than a charting library. The visual language here is
 * deliberately austere — thin axes, square points, no animation or gradients —
 * and a chart library would fight that while adding a dependency.
 *
 * Answers one operational question: do thermal characteristics separate the
 * classes, or do industrial and natural sources overlap in FRP/temperature space?
 */
import { useId } from 'react';
import { CLASSIFICATIONS } from '../../domain/classification';
import type { ThermalPoint } from '../../domain/aggregate';

export interface ScatterPlotProps {
  points: ThermalPoint[];
  /** Called when a point is clicked, for drill-down into investigation. */
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  height?: number;
}

const PADDING = { top: 12, right: 12, bottom: 32, left: 48 };
const TICKS = 4;

export function ScatterPlot({ points, onSelect, selectedId, height = 240 }: ScatterPlotProps) {
  const titleId = useId();

  if (points.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        No records have both FRP and brightness temperature recorded.
      </p>
    );
  }

  // Nice-ish bounds with a little headroom so points never sit on the axis.
  const frpValues = points.map((point) => point.frp);
  const brightnessValues = points.map((point) => point.brightness);

  const xMin = 0;
  const xMax = Math.max(...frpValues) * 1.08;
  const yMin = Math.min(...brightnessValues) * 0.96;
  const yMax = Math.max(...brightnessValues) * 1.04;

  const width = 520;
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const toX = (frp: number) => PADDING.left + ((frp - xMin) / (xMax - xMin)) * plotWidth;
  const toY = (kelvin: number) =>
    PADDING.top + plotHeight - ((kelvin - yMin) / (yMax - yMin)) * plotHeight;

  const xTicks = Array.from({ length: TICKS + 1 }, (_, i) => xMin + ((xMax - xMin) / TICKS) * i);
  const yTicks = Array.from({ length: TICKS + 1 }, (_, i) => yMin + ((yMax - yMin) / TICKS) * i);

  return (
    <figure className="m-0 flex flex-col gap-1">
      <svg
        aria-labelledby={titleId}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title id={titleId}>
          Fire radiative power against brightness temperature for {points.length} detections,
          coloured by classification
        </title>

        {/* Grid and tick labels */}
        {yTicks.map((value) => (
          <g key={`y-${value}`}>
            <line
              stroke="var(--color-outline-variant)"
              strokeOpacity="0.35"
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={toY(value)}
              y2={toY(value)}
            />
            <text
              fill="var(--color-outline)"
              fontFamily="var(--font-mono)"
              fontSize="9"
              textAnchor="end"
              x={PADDING.left - 6}
              y={toY(value) + 3}
            >
              {Math.round(value)}
            </text>
          </g>
        ))}

        {xTicks.map((value) => (
          <text
            fill="var(--color-outline)"
            fontFamily="var(--font-mono)"
            fontSize="9"
            key={`x-${value}`}
            textAnchor="middle"
            x={toX(value)}
            y={height - PADDING.bottom + 14}
          >
            {Math.round(value)}
          </text>
        ))}

        {/* Axes */}
        <line
          stroke="var(--color-outline-variant)"
          x1={PADDING.left}
          x2={PADDING.left}
          y1={PADDING.top}
          y2={height - PADDING.bottom}
        />
        <line
          stroke="var(--color-outline-variant)"
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={height - PADDING.bottom}
          y2={height - PADDING.bottom}
        />

        {/* Axis titles */}
        <text
          fill="var(--color-on-surface-variant)"
          fontSize="9"
          fontWeight="700"
          letterSpacing="0.05em"
          textAnchor="middle"
          x={PADDING.left + plotWidth / 2}
          y={height - 4}
        >
          FIRE RADIATIVE POWER (MW)
        </text>
        <text
          fill="var(--color-on-surface-variant)"
          fontSize="9"
          fontWeight="700"
          letterSpacing="0.05em"
          textAnchor="middle"
          transform={`rotate(-90 10 ${PADDING.top + plotHeight / 2})`}
          x={10}
          y={PADDING.top + plotHeight / 2}
        >
          BRIGHTNESS TEMP (K)
        </text>

        {/* Points. Squares, per the design language. */}
        {points.map((point) => {
          const definition = CLASSIFICATIONS[point.classification];
          const selected = point.id === selectedId;
          const size = selected ? 10 : 7;

          return (
            <rect
              className={onSelect ? 'cursor-pointer' : undefined}
              fill={`var(${definition.colorVar})`}
              height={size}
              key={point.id}
              onClick={onSelect ? () => onSelect(point.id) : undefined}
              stroke={selected ? 'var(--color-on-surface)' : 'none'}
              strokeWidth={selected ? 1.5 : 0}
              width={size}
              x={toX(point.frp) - size / 2}
              y={toY(point.brightness) - size / 2}
            >
              <title>
                {`${point.id} — ${definition.label}\nFRP ${point.frp.toFixed(1)} MW, ${point.brightness.toFixed(1)} K\nRisk ${point.riskScore}${
                  point.persistenceDays !== null ? `, detected ${point.persistenceDays} d` : ''
                }`}
              </title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}
