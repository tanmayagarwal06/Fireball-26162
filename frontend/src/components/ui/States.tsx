/**
 * Loading, empty and error states.
 *
 * Every screen that reads from the API uses these, so an operator always gets an
 * explicit answer about why a panel has no content â€” never a silent blank.
 */
import { Icon } from './Icon';

/** Neutral shimmer block for skeleton layouts. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[var(--radius-sm)] bg-surface-high${className ? ` ${className}` : ''}`}
    />
  );
}

/** Skeleton approximating a list of dense rows. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-1${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex flex-1 flex-col items-center justify-center gap-2 p-gutter text-on-surface-variant"
    >
      <Icon className="animate-pulse" name="progress_activity" size={20} />
      <span className="text-label uppercase">{label}</span>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  /** Explain what would populate this panel, not just that it is empty. */
  description?: string;
  icon?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, description, icon = 'filter_alt_off', action }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-gutter text-center">
      <Icon className="text-outline" name={icon} size={24} />
      <p className="text-label uppercase text-on-surface">{title}</p>
      {description ? (
        <p className="max-w-sm text-body-sm text-on-surface-variant">{description}</p>
      ) : null}
      {action ? (
        <button
          className="mt-2 rounded-[var(--radius-sm)] border border-outline-strong bg-surface-high px-3 py-1.5 text-label uppercase text-on-surface hover:bg-surface-highest"
          onClick={action.onClick}
          type="button"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps {
  /** Message from ApiError; already operator-readable. */
  message: string;
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({ message, onRetry, title = 'Request failed' }: ErrorStateProps) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 p-gutter text-center"
      role="alert"
    >
      <Icon className="text-error" name="error" size={24} />
      <p className="text-label uppercase text-error">{title}</p>
      <p className="max-w-md font-mono text-body-sm text-on-surface-variant">{message}</p>
      {onRetry ? (
        <button
          className="mt-2 flex items-center gap-1 rounded-[var(--radius-sm)] border border-outline-strong bg-surface-high px-3 py-1.5 text-label uppercase text-on-surface hover:bg-surface-highest"
          onClick={onRetry}
          type="button"
        >
          <Icon name="refresh" size={14} />
          Retry
        </button>
      ) : null}
    </div>
  );
}
