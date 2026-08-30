import { Link, useLocation } from 'react-router-dom';
import { ROUTES } from '../navigation';
import { Icon } from '../components/ui/Icon';

export function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="surface-grid flex min-h-0 flex-1 items-center justify-center p-gutter">
      <div className="flex max-w-md flex-col items-center gap-3 border border-outline-variant bg-surface-container p-gutter text-center">
        <Icon className="text-outline" name="explore_off" size={24} />
        <h1 className="text-headline text-on-surface">Route not found</h1>
        <p className="font-mono text-body-sm text-on-surface-variant">{location.pathname}</p>
        <Link
          className="mt-1 flex items-center gap-1 border border-outline-variant bg-surface-high px-3 py-1 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest"
          to={ROUTES.dashboard}
        >
          <Icon name="arrow_back" size={14} />
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}
