/**
 * Persistence timeline.
 *
 * The Stitch design shows seven dated nodes across a 7-day window. The dataset
 * cannot support that: it records only *how many* days a source was detected
 * (`persistence_7d`), not *which* days, and every record shares one acquisition
 * date. Drawing seven dates would be fabrication.
 *
 * So this renders what the data actually says — a detection ratio over the
 * window, with the undated nodes explicitly marked as unknown — and states the
 * limitation inline. The component is shaped to accept real per-day detections
 * later without changing its consumers.
 */
import { PERSISTENCE_THRESHOLD_DAYS, resolvePersistenceDays } from '../../domain/persistence';
import { formatAcqDate } from '../../domain/format';
import { getClassification } from '../../domain/classification';
import { Icon } from '../ui/Icon';
import type { Hotspot } from '../../types/hotspot';

/** Window length the persistence counts are measured over. */
const WINDOW_DAYS = 7;

export function PersistenceTimeline({ hotspot }: { hotspot: Hotspot }) {
  const days = resolvePersistenceDays(hotspot);
  const classification = getClassification(hotspot.classification);
  const color = `var(${classification.colorVar})`;

  const detected = days ?? 0;
  const ratio = Math.min(1, detected / WINDOW_DAYS);
  const isPersistent = detected >= PERSISTENCE_THRESHOLD_DAYS;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-label uppercase text-on-surface-variant">
          <Icon name="timeline" size={14} />
          {WINDOW_DAYS}-day persistence
        </h3>

        <span
          className="border px-1 text-[9px] font-bold uppercase leading-[14px] tracking-[0.06em] border-outline-variant text-outline"
          title="Derived from persistence_7d in the frontend. The backend's own persistence helper is defective."
        >
          Derived
        </span>

        <span className="ml-auto font-mono text-data text-on-surface">
          {days === null ? 'No data' : `${detected} of ${WINDOW_DAYS} days`}
          {days !== null ? (
            <span className="ml-1.5 text-outline">({Math.round(ratio * 100)}%)</span>
          ) : null}
        </span>
      </div>

      {/*
        Nodes represent the count of detection days, not specific dates. Filled
        nodes are days the source was seen; hollow nodes are days it was not.
        Neither is attributed to a calendar date, because the data does not say.
      */}
      <div className="flex items-center gap-1" role="img" aria-label={`Detected on ${detected} of ${WINDOW_DAYS} days`}>
        {Array.from({ length: WINDOW_DAYS }, (_, index) => {
          const filled = index < detected;

          return (
            <span
              className="flex h-6 flex-1 items-center justify-center border"
              key={index}
              style={{
                backgroundColor: filled ? `color-mix(in srgb, ${color} 22%, transparent)` : 'transparent',
                borderColor: filled ? color : 'var(--color-outline-variant)',
              }}
              title={
                filled
                  ? 'One day on which the source was detected (specific date not recorded)'
                  : 'One day within the window with no detection'
              }
            >
              <span
                className="size-1.5"
                style={{ backgroundColor: filled ? color : 'var(--color-outline-variant)' }}
              />
            </span>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[10px] leading-[13px] text-outline">
          Nodes show the number of detection days within the window, not specific dates — the
          dataset records a count, not a per-day series. Latest acquisition:{' '}
          <span className="font-mono">{formatAcqDate(hotspot.acq_date)}</span>.
        </p>

        {days !== null ? (
          <span
            className="shrink-0 text-label uppercase"
            style={{ color: isPersistent ? color : 'var(--color-on-surface-variant)' }}
          >
            {isPersistent ? 'Persistent source' : 'Below persistence threshold'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
