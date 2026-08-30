/**
 * Screen 2 — Hotspot Investigation.
 *
 * Forensic view of one detection. Layout follows the Stitch design: a compact
 * identity header, a focused map on the left, stacked intelligence panels on the
 * right, and the persistence timeline along the bottom.
 *
 * Two requests back this screen, both real: `GET /hotspots/{id}` for the record
 * and `GET /hotspots/{id}/explanation` for the backend's rule-based evidence
 * summary. The record load is treated as fatal; the explanation is treated as
 * degradable, since the record itself is still worth showing without it.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Circle } from 'react-leaflet';

import { getHotspot, getHotspotExplanation } from '../api/hotspots';
import { useAsync } from '../hooks/useAsync';
import { MapView } from '../components/map/MapView';
import { EvidenceSection, EvidenceRow } from '../components/investigation/EvidenceSection';
import { ClassificationPanel } from '../components/investigation/ClassificationPanel';
import { ExplanationPanel } from '../components/investigation/ExplanationPanel';
import { PersistenceTimeline } from '../components/investigation/PersistenceTimeline';
import { ClassificationBadge } from '../components/ui/ClassificationBadge';
import { Icon } from '../components/ui/Icon';
import { RiskBadge } from '../components/ui/RiskBadge';
import { ErrorState, LoadingState, Skeleton } from '../components/ui/States';
import { assessEvidence, summariseEvidence } from '../domain/evidence';
import { getClassification } from '../domain/classification';
import { formatAcquisition, formatCoordinates, formatKm } from '../domain/format';
import { ROUTES } from '../navigation';
import { useSelection } from '../state/SelectionContext';
import type { Hotspot } from '../types/hotspot';
import type { ExplanationResponse } from '../types/api';

export function InvestigationPage() {
  const { hotspotId } = useParams<{ hotspotId: string }>();
  const navigate = useNavigate();
  const { select } = useSelection();

  const id = hotspotId ?? '';

  const record = useAsync<Hotspot>((signal) => getHotspot(id, signal), {
    deps: [id],
    enabled: id.length > 0,
  });

  const explanation = useAsync<ExplanationResponse>(
    (signal) => getHotspotExplanation(id, signal),
    { deps: [id], enabled: id.length > 0 },
  );

  // Keep the global selection aligned so returning to the dashboard lands on the
  // same hotspot the operator was just investigating.
  useEffect(() => {
    if (id) select(id);
  }, [id, select]);

  const hotspot = record.data;

  const assessments = useMemo(() => (hotspot ? assessEvidence(hotspot) : []), [hotspot]);
  const evidenceSummary = useMemo(() => summariseEvidence(assessments), [assessments]);

  /**
   * Export the investigation as JSON.
   *
   * A genuine download of exactly what the console holds: the API record, the
   * backend explanation and the frontend's derived assessment, each labelled with
   * its origin so the file cannot be mistaken for model output.
   */
  const handleExport = useCallback(() => {
    if (!hotspot) return;

    const payload = {
      exported_at: new Date().toISOString(),
      source: 'Thermal Intelligence console (SIH26162) — prototype backed by a mock dataset',
      notice:
        'api_record and backend_explanation are verbatim API responses. derived_assessment is computed by the frontend using documented heuristics. No machine-learning model was involved.',
      api_record: hotspot,
      backend_explanation: explanation.data ?? null,
      derived_assessment: assessments.map((assessment) => ({
        axis: assessment.axis,
        strength: assessment.strength,
        provenance: assessment.provenance,
        interpretation: assessment.interpretation,
        basis: assessment.strengthBasis,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `hotspot-${hotspot.id}-investigation.json`;
    link.click();

    URL.revokeObjectURL(url);
  }, [hotspot, explanation.data, assessments]);

  if (!id) {
    return <ErrorState message="No hotspot id was supplied in the URL." title="Invalid route" />;
  }

  if (record.isInitialLoading) {
    return <LoadingState label={`Loading hotspot ${id}`} />;
  }

  if (record.error || !hotspot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-gutter">
        <ErrorState
          message={record.error ?? `Hotspot ${id} could not be loaded.`}
          onRetry={record.refresh}
          title={`Hotspot ${id} not available`}
        />
        <Link
          className="flex items-center gap-1 border border-outline-variant bg-surface-high px-3 py-1 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest"
          to={ROUTES.dashboard}
        >
          <Icon name="arrow_back" size={14} />
          Back to dashboard
        </Link>
      </div>
    );
  }

  const classification = getClassification(hotspot.classification);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ------------------------------------------------------------ Header */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-outline-variant bg-surface-low px-gutter py-2">
        <button
          aria-label="Go back"
          className="flex size-7 shrink-0 items-center justify-center border border-outline-variant bg-surface-high text-on-surface transition-colors hover:bg-surface-highest"
          onClick={() => navigate(-1)}
          type="button"
        >
          <Icon name="arrow_back" size={16} />
        </button>

        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="font-mono text-data-lg text-on-surface">{hotspot.id}</h1>
          <ClassificationBadge classification={hotspot.classification} showIcon />
          <RiskBadge score={hotspot.risk_score} showDenominator />

          <span aria-hidden="true" className="hidden h-4 w-px bg-outline-variant sm:block" />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-body-sm text-on-surface-variant">
            <span className="flex items-center gap-1">
              <Icon name="location_on" size={13} />
              {formatCoordinates(hotspot.lat, hotspot.lon)}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="schedule" size={13} />
              {formatAcquisition(hotspot.acq_date, hotspot.acq_time)}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="satellite_alt" size={13} />
              {hotspot.satellite}
            </span>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Evidence tally: an at-a-glance read on how supported the call is. */}
          <div
            className="hidden items-center gap-2 border border-outline-variant bg-surface-container px-2 py-1 md:flex"
            title="Count of evidence axes by assessed strength"
          >
            <span className="text-label uppercase text-on-surface-variant">Evidence</span>
            <span className="font-mono text-body-sm text-primary">{evidenceSummary.strong} strong</span>
            <span className="font-mono text-body-sm text-on-surface-variant">
              {evidenceSummary.moderate} moderate
            </span>
            <span className="font-mono text-body-sm text-tertiary">
              {evidenceSummary.conflicting} weak
            </span>
          </div>

          <button
            className="flex items-center gap-1 border border-outline-variant bg-surface-container px-2 py-1 text-label uppercase text-on-surface-variant transition-colors hover:bg-surface-high hover:text-on-surface"
            onClick={handleExport}
            title="Download this investigation as JSON"
            type="button"
          >
            <Icon name="download" size={14} />
            Export JSON
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------- Workspace */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Map, with the industrial proximity buffer drawn to scale. */}
        <div className="relative flex min-h-[280px] shrink-0 flex-col border-b border-outline-variant lg:min-h-0 lg:w-[52%] lg:border-b-0 lg:border-r">
          <MapView
            focusId={hotspot.id}
            hotspots={[hotspot]}
            onSelect={() => undefined}
            selectedId={hotspot.id}
            showLegend={false}
          >
            {typeof hotspot.distance_to_industry_km === 'number' ? (
              <Circle
                center={[hotspot.lat, hotspot.lon]}
                pathOptions={{
                  color: `var(${classification.colorVar})`,
                  fillColor: `var(${classification.colorVar})`,
                  fillOpacity: 0.05,
                  weight: 1,
                  dashArray: '4 4',
                }}
                radius={hotspot.distance_to_industry_km * 1000}
              />
            ) : null}
          </MapView>

          {/* Explain the ring rather than leaving the operator to infer it. */}
          {typeof hotspot.distance_to_industry_km === 'number' ? (
            <div className="pointer-events-none absolute bottom-8 left-3 z-[500] max-w-[280px] border border-outline-variant bg-surface-lowest/95 p-compact">
              <p className="text-label uppercase text-on-surface-variant">Proximity buffer</p>
              <p className="mt-1 font-mono text-data text-on-surface">
                {formatKm(hotspot.distance_to_industry_km)}
              </p>
              <p className="mt-1 text-[10px] leading-[13px] text-outline">
                Radius at which the nearest industrial feature lies
                {hotspot.nearest_facility_type ? ` (${hotspot.nearest_facility_type})` : ''}. The
                dataset records the distance only, not the facility's bearing, so no direction is
                drawn.
              </p>
            </div>
          ) : null}
        </div>

        {/* Intelligence column */}
        <div className="flex min-h-0 flex-1 flex-col gap-gutter overflow-y-auto p-gutter">
          <ClassificationPanel hotspot={hotspot} />

          {explanation.isInitialLoading ? (
            <div className="flex flex-col gap-2 border border-outline-variant bg-surface-container p-compact">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : explanation.data ? (
            <ExplanationPanel explanation={explanation.data} />
          ) : (
            /* Degrade rather than fail: the record is still fully usable. */
            <div className="border border-outline-variant bg-surface-container p-compact">
              <p className="flex items-center gap-1.5 text-label uppercase text-tertiary">
                <Icon name="warning" size={14} />
                Explanation unavailable
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {explanation.error ?? 'The explanation endpoint returned no data.'}
              </p>
              <button
                className="mt-2 flex items-center gap-1 border border-outline-variant bg-surface-high px-2 py-0.5 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest"
                onClick={explanation.refresh}
                type="button"
              >
                <Icon name="refresh" size={12} />
                Retry
              </button>
            </div>
          )}

          {/* Six evidence axes */}
          <div className="flex flex-col gap-gutter">
            <h2 className="flex items-center gap-1.5 text-label uppercase text-on-surface-variant">
              <Icon name="hub" size={14} />
              Evidence fusion
            </h2>

            {assessments.map((assessment) => (
              <EvidenceSection
                icon={assessment.icon}
                interpretation={assessment.interpretation}
                key={assessment.axis}
                provenance={assessment.provenance}
                strength={assessment.strength}
                strengthBasis={assessment.strengthBasis}
                title={assessment.title}
              >
                <div className="flex flex-col gap-1 border-t border-outline-variant pt-1.5">
                  {assessment.measurements.map((measurement) => (
                    <EvidenceRow
                      emphasis={measurement.emphasis}
                      key={measurement.label}
                      label={measurement.label}
                      value={measurement.value}
                    />
                  ))}
                </div>
              </EvidenceSection>
            ))}
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------- Timeline */}
      <footer className="shrink-0 border-t border-outline-variant bg-surface-container px-gutter py-2">
        <PersistenceTimeline hotspot={hotspot} />
      </footer>
    </div>
  );
}
