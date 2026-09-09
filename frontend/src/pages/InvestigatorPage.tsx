/**
 * Screen 5 — AI Investigator.
 *
 * A technical intelligence workstation, structured as: query → evidence →
 * explanation → operator judgement.
 *
 * What is real here:
 *  - The saved queries are genuine predicate sets over API fields, and every
 *    result lists the clauses that made it match.
 *  - The evidence panels read real hotspot fields.
 *  - The explanation comes from `GET /hotspots/{id}/explanation`.
 *  - Notes persist to localStorage.
 *
 * What is not present, and is labelled as such:
 *  - Free-text natural-language querying. No language model is connected, so
 *    there is no text input pretending to understand prose.
 *  - Generated interpretation of an event. The slot exists and is empty.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getHotspotExplanation } from '../api/hotspots';
import { useAsync } from '../hooks/useAsync';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Icon } from '../components/ui/Icon';
import { Metric } from '../components/ui/Metric';
import { ProvenanceTag } from '../components/ui/ProvenanceTag';
import { ClassificationBadge } from '../components/ui/ClassificationBadge';
import { Select } from '../components/ui/Select';
import { EmptyState, ErrorState, LoadingState, Skeleton } from '../components/ui/States';
import { ExplanationPanel } from '../components/investigation/ExplanationPanel';
import { SAVED_QUERIES, runQuery, type SavedQuery } from '../domain/queries';
import { assessEvidence, summariseEvidence } from '../domain/evidence';
import { resolveRiskLevel } from '../domain/risk';
import {
  formatCoordinates,
  formatDays,
  formatFrp,
  formatKelvin,
  formatKm,
  formatRatioAsPercent,
  formatText,
} from '../domain/format';
import { resolvePersistenceDays } from '../domain/persistence';
import { investigationPath } from '../navigation';
import { useDataset } from '../state/DatasetContext';
import { useSelection } from '../state/SelectionContext';
import type { ExplanationResponse } from '../types/api';

export function InvestigatorPage() {
  const navigate = useNavigate();
  const dataset = useDataset();
  const { selectedId, select } = useSelection();

  const [activeQueryId, setActiveQueryId] = useState<string>(SAVED_QUERIES[0].id);

  const activeQuery: SavedQuery =
    SAVED_QUERIES.find((query) => query.id === activeQueryId) ?? SAVED_QUERIES[0];

  const result = useMemo(
    () => runQuery(activeQuery, dataset.all),
    [activeQuery, dataset.all],
  );

  // Counts for every query, so the operator can see where the findings are before
  // running anything. Cheap over a dataset this size.
  const queryCounts = useMemo(
    () =>
      Object.fromEntries(
        SAVED_QUERIES.map((query) => [query.id, runQuery(query, dataset.all).matches.length]),
      ) as Record<string, number>,
    [dataset.all],
  );

  // Default the focus to the top result whenever the query changes.
  useEffect(() => {
    const inResults = result.matches.some((match) => match.hotspot.id === selectedId);
    if (!inResults && result.matches.length > 0) {
      select(result.matches[0].hotspot.id);
    }
  }, [result, selectedId, select]);

  const focused = useMemo(
    () => result.matches.find((match) => match.hotspot.id === selectedId) ?? null,
    [result, selectedId],
  );

  if (dataset.isLoading) return <LoadingState label="Loading dataset" />;

  if (dataset.error) {
    return (
      <ErrorState message={dataset.error} onRetry={dataset.refresh} title="Could not load dataset" />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ------------------------------------------------- Query rail (left) */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-r border-outline-variant bg-surface-container md:flex">
        <header className="shrink-0 border-b border-outline-variant bg-surface-high px-gutter py-2">
          <h1 className="text-headline text-on-surface">AI Investigator</h1>
          <p className="mt-0.5 text-label uppercase text-on-surface-variant">
            Grounded in platform data
          </p>
        </header>

        {/* Set expectations before the operator looks for a chat box. */}
        <div className="shrink-0 border-b border-outline-variant bg-tertiary/5 px-gutter py-2">
          <p className="flex gap-1.5 text-body-sm text-on-surface-variant">
            <Icon className="mt-0.5 shrink-0 text-tertiary" name="info" size={13} />
            <span>
              No language model is connected. These are deterministic rule-based investigations, and
              each result shows the exact conditions it satisfied.
            </span>
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <h2 className="sticky top-0 z-10 border-b border-outline-variant bg-surface-low px-gutter py-1 text-label uppercase text-on-surface-variant">
            Saved investigations
          </h2>

          <ul className="flex flex-col divide-y divide-outline-variant">
            {SAVED_QUERIES.map((query) => {
              const active = query.id === activeQueryId;
              const count = queryCounts[query.id] ?? 0;

              return (
                <li key={query.id}>
                  <button
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full flex-col gap-1 border-l-2 px-gutter py-2 text-left transition-colors hover:bg-surface-high ${
                      active
                        ? 'border-l-primary bg-surface-high'
                        : 'border-l-transparent'
                    }`}
                    onClick={() => setActiveQueryId(query.id)}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon
                        className={active ? 'text-primary' : 'text-on-surface-variant'}
                        name={query.icon}
                        size={14}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-body-sm ${
                          active ? 'font-semibold text-on-surface' : 'text-on-surface-variant'
                        }`}
                      >
                        {query.label}
                      </span>
                      <span
                        className={`shrink-0 border px-1 font-mono text-[10px] ${
                          count > 0
                            ? 'border-primary/40 text-primary'
                            : 'border-outline-variant text-outline'
                        }`}
                      >
                        {count}
                      </span>
                    </span>
                    <span className="text-[10px] leading-[13px] text-outline">{query.question}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* ------------------------------------------- Synthesis (centre) */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        {/*
          Narrow-width query picker. The rail is hidden below md, so without this
          the operator would have no way to change investigation.
        */}
        <div className="shrink-0 border-b border-outline-variant bg-surface-container px-gutter py-2 md:hidden">
          <Select
            label="Saved investigation"
            onChange={setActiveQueryId}
            options={SAVED_QUERIES.map((query) => ({
              label: `${query.label} (${queryCounts[query.id] ?? 0})`,
              value: query.id,
            }))}
            value={activeQueryId}
          />
          <p className="mt-1.5 flex gap-1.5 text-body-sm text-on-surface-variant">
            <Icon className="mt-0.5 shrink-0 text-tertiary" name="info" size={13} />
            <span>
              No language model is connected. These are deterministic rule-based investigations.
            </span>
          </p>
        </div>

        <header className="shrink-0 border-b border-outline-variant bg-surface-lowest px-gutter py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-1.5 text-headline text-on-surface">
              <Icon name="hub" size={16} />
              Synthesis results
            </h2>

            <span className="flex items-center gap-1.5 border border-outline-variant bg-surface-container px-2 py-0.5 text-label uppercase text-on-surface-variant">
              <Icon className="text-tertiary" name="check_circle" size={12} />
              {result.matches.length} of {result.evaluated} detections matched
            </span>

            <ProvenanceTag className="ml-auto" provenance="DERIVED" />
          </div>

          <p className="mt-1.5 text-body-sm text-on-surface">{activeQuery.question}</p>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">{activeQuery.rationale}</p>

          {/* The full predicate, stated openly — this is the whole "reasoning". */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-label uppercase text-on-surface-variant">Conditions:</span>
            {activeQuery.clauses.map((clause, index) => (
              <span className="flex items-center gap-1.5" key={clause.label}>
                {index > 0 ? (
                  <span className="font-mono text-[10px] text-outline">AND</span>
                ) : null}
                <span className="border border-outline-variant bg-surface-container px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
                  {clause.label}
                </span>
              </span>
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-gutter">
          {result.matches.length === 0 ? (
            <EmptyState
              description={`No detection in the dataset satisfies all ${activeQuery.clauses.length} condition${
                activeQuery.clauses.length === 1 ? '' : 's'
              }. That is a finding in itself, not an error.`}
              icon="search_off"
              title="No matching detections"
            />
          ) : (
            <ul className="flex flex-col gap-gutter">
              {result.matches.map((match) => {
                const { hotspot } = match;
                const risk = resolveRiskLevel(hotspot.risk_score);
                const evidence = summariseEvidence(assessEvidence(hotspot));
                const isFocused = hotspot.id === selectedId;

                return (
                  <li key={hotspot.id}>
                    <article
                      className={`border bg-surface-container transition-colors ${
                        isFocused ? 'border-primary/50' : 'border-outline-variant'
                      }`}
                    >
                      <header className="flex flex-wrap items-center gap-2 border-b border-outline-variant px-gutter py-1.5">
                        <span
                          className="size-2 shrink-0"
                          style={{ backgroundColor: `var(${risk.colorVar})` }}
                        />
                        <button
                          className="font-mono text-data-lg text-on-surface hover:underline"
                          onClick={() => select(hotspot.id)}
                          type="button"
                        >
                          {hotspot.id}
                        </button>

                        <ClassificationBadge classification={hotspot.classification} short />

                        <button
                          className="ml-auto flex shrink-0 items-center gap-1 text-label uppercase text-primary transition-colors hover:text-on-surface"
                          onClick={() => {
                            select(hotspot.id);
                            navigate(investigationPath(hotspot.id));
                          }}
                          type="button"
                        >
                          View investigation
                          <Icon name="arrow_forward" size={12} />
                        </button>
                      </header>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-outline-variant p-gutter md:grid-cols-4">
                        <Metric
                          label="Risk"
                          value={`${hotspot.risk_score} / 100`}
                          valueColor={`var(${risk.colorVar})`}
                        />
                        <Metric
                          label="Recorded confidence"
                          value={formatRatioAsPercent(hotspot.classification_confidence)}
                        />
                        <Metric label="FRP" value={formatFrp(hotspot.frp)} />
                        <Metric
                          label="Persistence"
                          provenance="DERIVED"
                          value={formatDays(resolvePersistenceDays(hotspot))}
                        />
                      </div>

                      {/* Why this record was returned. */}
                      <div className="border-b border-outline-variant p-gutter">
                        <h3 className="mb-1.5 text-label uppercase text-on-surface-variant">
                          Matched because
                        </h3>
                        <ul className="flex flex-col gap-1">
                          {match.matchedClauses.map((clause) => (
                            <li
                              className="flex gap-1.5 text-body-sm text-on-surface"
                              key={clause}
                            >
                              <Icon className="mt-0.5 shrink-0 text-primary" name="check" size={13} />
                              {clause}
                            </li>
                          ))}
                        </ul>

                        <p className="mt-2 font-mono text-[10px] text-outline">
                          Evidence axes: {evidence.strong} strong · {evidence.moderate} moderate ·{' '}
                          {evidence.conflicting} weak · {evidence.unavailable} no data
                        </p>
                      </div>

                      {/* Deliberately empty: no component generates free-text model rationale. */}
                      <div className="flex items-start gap-2 bg-tertiary/5 p-gutter">
                        <Icon className="mt-0.5 shrink-0 text-tertiary" name="psychology" size={14} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-label uppercase text-tertiary">
                              Model interpretation
                            </h3>
                            <ProvenanceTag provenance="PENDING_MODEL" />
                          </div>
                          <p className="mt-1 text-body-sm text-on-surface-variant">
                            Reserved for free-text model reasoning, which nothing in this system
                            generates. The classifier&apos;s per-class posterior and its feature
                            attributions are shown on the Investigation page; writing a plausible
                            sentence here would misrepresent what the system can currently do.
                          </p>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}

          {/*
            Narrow-width evidence rail. Below xl the right column is hidden, and
            the notes field only lives there, so it is inlined here instead.
          */}
          {focused ? (
            <section className="mt-gutter flex flex-col border border-outline-variant bg-surface-container xl:hidden">
              <EvidencePanel hotspotId={focused.hotspot.id} />
            </section>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------- Evidence (right) */}
      <aside className="hidden w-[320px] shrink-0 flex-col border-l border-outline-variant bg-surface-container xl:flex">
        {focused ? (
          <EvidencePanel hotspotId={focused.hotspot.id} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-gutter">
            <EmptyState
              description="Select a result to inspect the evidence behind it."
              icon="fact_check"
              title="No result focused"
            />
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * Evidence rail for the focused result.
 *
 * Structured data blocks from real fields, the backend explanation, and operator
 * notes persisted locally.
 */
function EvidencePanel({ hotspotId }: { hotspotId: string }) {
  const dataset = useDataset();
  const hotspot = dataset.all.find((entry) => entry.id === hotspotId) ?? null;

  const explanation = useAsync<ExplanationResponse>(
    (signal) => getHotspotExplanation(hotspotId, signal),
    { deps: [hotspotId] },
  );

  const [notes, setNotes] = useLocalStorage<string>(`ti-notes:${hotspotId}`, '');

  if (!hotspot) {
    return (
      <div className="p-gutter">
        <p className="text-body-sm text-on-surface-variant">
          Hotspot {hotspotId} is not in the loaded dataset.
        </p>
      </div>
    );
  }

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant bg-surface-high px-gutter py-2">
        <h2 className="text-headline text-on-surface">Evidence used</h2>
        <span className="font-mono text-data text-primary">{hotspot.id}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-gutter">
        <div className="flex flex-col gap-gutter">
          <DataBlock title="Thermal">
            <Metric label="FRP" value={formatFrp(hotspot.frp)} />
            <Metric label="Brightness" value={formatKelvin(hotspot.brightness_temperature)} />
          </DataBlock>

          <DataBlock title="Temporal">
            <Metric
              label="Persistence"
              provenance="DERIVED"
              value={formatDays(resolvePersistenceDays(hotspot))}
            />
            <Metric label="Overpass" text value={hotspot.day_night === 'N' ? 'Night' : 'Day'} />
          </DataBlock>

          <DataBlock title="Spatial">
            <Metric label="Coordinates" value={formatCoordinates(hotspot.lat, hotspot.lon, 3)} />
            <Metric label="Distance to industry" value={formatKm(hotspot.distance_to_industry_km)} />
          </DataBlock>

          <DataBlock title="Infrastructure">
            <Metric
              label="Nearest facility"
              text
              value={formatText(hotspot.nearest_facility_type)}
            />
            <Metric
              label="In polygon"
              text
              value={hotspot.inside_industrial_polygon ? 'Yes' : 'No'}
            />
          </DataBlock>

          <DataBlock title="Land cover">
            <Metric label="Class" text value={formatText(hotspot.land_cover_class)} />
            <Metric
              label="Co-located"
              value={hotspot.hotspot_density !== null ? String(hotspot.hotspot_density) : '—'}
            />
          </DataBlock>

          {explanation.isInitialLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ) : explanation.data ? (
            <ExplanationPanel explanation={explanation.data} />
          ) : (
            <p className="text-body-sm text-on-surface-variant">
              {explanation.error ?? 'Explanation unavailable.'}
            </p>
          )}

          {/* Notes: genuinely persisted, and honest about where. */}
          <section className="border border-outline-variant bg-surface-container">
            <header className="flex items-center gap-2 border-b border-outline-variant bg-surface-low px-compact py-1">
              <h3 className="flex items-center gap-1.5 text-label uppercase text-on-surface">
                <Icon name="edit_note" size={14} />
                Investigation notes
              </h3>
            </header>

            <div className="flex flex-col gap-1.5 p-compact">
              <label className="sr-only" htmlFor={`notes-${hotspot.id}`}>
                Investigation notes for hotspot {hotspot.id}
              </label>
              <textarea
                className="min-h-24 w-full resize-y border border-outline-variant bg-input px-2 py-1.5 text-body-sm text-on-surface transition-colors focus:border-on-surface focus:outline-none"
                id={`notes-${hotspot.id}`}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Record observations, follow-up actions or a dissenting assessment…"
                value={notes}
              />
              <p className="text-[10px] leading-[13px] text-outline">
                Saved in this browser only. There is no notes endpoint on the backend, so these are
                not shared with other operators and will not survive clearing site data.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function DataBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-outline-variant">
      <header className="flex items-center gap-2 border-b border-outline-variant bg-surface-highest px-compact py-1">
        <h3 className="text-label uppercase text-on-surface-variant">{title}</h3>
        <ProvenanceTag className="ml-auto" provenance="API" />
      </header>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 bg-surface p-compact">{children}</div>
    </section>
  );
}
