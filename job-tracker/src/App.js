import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';

import './App.css';
import { useApi } from './api';
import { ToastProvider } from './ui';
import TrackerPage from './pages/TrackerPage';
import FeedPage from './pages/FeedPage';
import AnalyticsPage from './pages/AnalyticsPage';
import PreferencesPage from './pages/PreferencesPage';

/* ---- Shared app data ----------------------------------------------------- */

const AppDataContext = createContext({ pendingUpdates: [], refreshPending: () => {} });

export function useAppData() {
  return useContext(AppDataContext);
}

function AppDataProvider({ children }) {
  const api = useApi();
  const [pendingUpdates, setPendingUpdates] = useState([]);

  const refreshPending = useCallback(async () => {
    try {
      setPendingUpdates(await api.getPendingUpdates());
    } catch {
      // A failed badge refresh shouldn't interrupt whatever the user is doing.
    }
  }, [api]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  return (
    <AppDataContext.Provider value={{ pendingUpdates, refreshPending }}>
      {children}
    </AppDataContext.Provider>
  );
}

/* ---- Chrome -------------------------------------------------------------- */

function Nav() {
  const { pendingUpdates } = useAppData();

  return (
    <nav className="nav">
      <div className="nav-inner">
        <NavLink to="/tracker" className="brand">
          <span className="brand-mark">JT</span>
          <span>Job Tracker</span>
        </NavLink>

        <div className="nav-links">
          <NavLink to="/tracker" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            Tracker
            {pendingUpdates.length > 0 && (
              <span className="nav-count alert" title="Listings changed upstream">
                {pendingUpdates.length}
              </span>
            )}
          </NavLink>
          <NavLink to="/feed" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            Listings
          </NavLink>
          <NavLink
            to="/analytics"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            Analytics
          </NavLink>
          <NavLink
            to="/preferences"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            Preferences
          </NavLink>
        </div>

        <div className="nav-right">
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    </nav>
  );
}

function Landing() {
  return (
    <div className="landing">
      <div className="landing-inner">
        <h1>Stop scrolling job boards. Start shipping applications.</h1>
        <p>
          Job Tracker pulls thousands of internship and new-grad listings into one place, scores
          them against what you actually want, and turns applying into a single click — then keeps
          watching the posting after you apply.
        </p>
        <SignInButton mode="modal">
          <button className="btn btn-primary" style={{ padding: '11px 22px', fontSize: 15 }}>
            Sign in to get started
          </button>
        </SignInButton>

        <div className="landing-features">
          <div className="landing-feature">
            <strong>One-click apply</strong>
            <span>Company, role, link and location land in your tracker already filled in.</span>
          </div>
          <div className="landing-feature">
            <strong>AI matching</strong>
            <span>Every listing scored against your requirements, values and deal breakers.</span>
          </div>
          <div className="landing-feature">
            <strong>Change detection</strong>
            <span>If a posting you applied to gets edited, see the diff and decide.</span>
          </div>
          <div className="landing-feature">
            <strong>Real analytics</strong>
            <span>Response rates, funnel and momentum from your own application history.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Root ---------------------------------------------------------------- */

export default function App() {
  return (
    <ToastProvider>
      <SignedOut>
        <Landing />
      </SignedOut>

      <SignedIn>
        <AppDataProvider>
          <div className="app-shell">
            <Nav />
            <Routes>
              <Route path="/" element={<Navigate to="/tracker" replace />} />
              <Route path="/tracker" element={<TrackerPage />} />
              <Route path="/feed" element={<FeedPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/preferences" element={<PreferencesPage />} />
              <Route path="*" element={<Navigate to="/tracker" replace />} />
            </Routes>
          </div>
        </AppDataProvider>
      </SignedIn>
    </ToastProvider>
  );
}
