/**
 * Route tree.
 *
 * Every screen renders inside AppShell so navigation, the status strip and the
 * backend health poll persist across views — the five screens are one product,
 * not five pages.
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ROUTES } from './navigation';
import { BackendStatusProvider } from './state/BackendStatusContext';
import { DatasetProvider } from './state/DatasetContext';
import { FiltersProvider } from './state/FiltersContext';
import { SelectionProvider } from './state/SelectionContext';
import { AlertsPage } from './pages/AlertsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DashboardPage } from './pages/DashboardPage';
import { InvestigationPage } from './pages/InvestigationPage';
import { InvestigatorPage } from './pages/InvestigatorPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SystemStatusPage } from './pages/SystemStatusPage';

export function App() {
  return (
    <BrowserRouter>
      {/*
        Providers sit above the router so filter state, the current selection and
        the health poll all survive navigation between screens.
      */}
      <BackendStatusProvider>
        <DatasetProvider>
          <FiltersProvider>
            <SelectionProvider>
              <Routes>
                <Route element={<AppShell />} path="/">
                  <Route element={<DashboardPage />} index />
                  <Route element={<AnalyticsPage />} path="analytics" />
                  <Route element={<AlertsPage />} path="alerts" />
                  <Route element={<InvestigatorPage />} path="investigator" />
                  <Route element={<SystemStatusPage />} path="status" />

                  {/* Investigation is always scoped to one hotspot. */}
                  <Route element={<InvestigationPage />} path="investigation/:hotspotId" />
                  <Route element={<Navigate replace to={ROUTES.dashboard} />} path="investigation" />

                  <Route element={<NotFoundPage />} path="*" />
                </Route>
              </Routes>
            </SelectionProvider>
          </FiltersProvider>
        </DatasetProvider>
      </BackendStatusProvider>
    </BrowserRouter>
  );
}
