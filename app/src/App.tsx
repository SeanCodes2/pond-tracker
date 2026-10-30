import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AccessGate } from './components/AccessGate';
import { TabBar } from './components/TabBar';
import { ToastProvider } from './components/Toast';
import { CatchEdit } from './pages/CatchEdit';
import { Catches } from './pages/Catches';
import { Dashboard } from './pages/Dashboard';
import { LogCatch } from './pages/LogCatch';
import { PondForm } from './pages/PondForm';
import { Ponds } from './pages/Ponds';
import { RecentlyDeleted } from './pages/RecentlyDeleted';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <AccessGate>
      <BrowserRouter>
        <ToastProvider>
          <div className="app">
            <Routes>
              <Route path="/" element={<LogCatch />} />
              <Route path="/ponds" element={<Ponds />} />
              <Route path="/ponds/new" element={<PondForm />} />
              <Route path="/ponds/:id" element={<Dashboard />} />
              <Route path="/ponds/:id/edit" element={<PondForm />} />
              <Route path="/ponds/:id/catches" element={<Catches />} />
              <Route path="/catches" element={<Catches />} />
              <Route path="/catches/:id" element={<CatchEdit />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/deleted" element={<RecentlyDeleted />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <TabBar />
          </div>
        </ToastProvider>
      </BrowserRouter>
    </AccessGate>
  );
}
