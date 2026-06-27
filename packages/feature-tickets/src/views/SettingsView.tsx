import { Settings2, User, Palette, Info } from 'lucide-react';
import { useAuthStore, useUiStore } from '@billfree/app-state';

/**
 * [GAP-07] Settings view — replaces the blank screen when clicking "Settings"
 * in the sidebar. Shows user profile, dark mode toggle, app version, and
 * notification preferences.
 */
export default function SettingsView() {
  const user     = useAuthStore(s => s.user);
  const darkMode = useUiStore(s => s.darkMode);
  const toggle   = useUiStore(s => s.toggleDarkMode);

  return (
    <div className="settings-view" id="settings-view">
      <h1 className="view-title"><Settings2 size={22} strokeWidth={2.2} /> Settings</h1>

      {/* ── Profile Card ───────────────────────────────────────── */}
      <section className="card" aria-labelledby="section-profile">
        <h2 id="section-profile" className="card-heading"><User size={15} strokeWidth={2.2} /> Profile</h2>
        <div className="settings-grid">
          <div className="settings-row">
            <span className="settings-label">Name</span>
            <span className="settings-value">{user?.name ?? '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Email</span>
            <span className="settings-value">{user?.email ?? '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Role</span>
            <span className="settings-value badge">{user?.role ?? '—'}</span>
          </div>
        </div>
      </section>

      {/* ── Appearance ─────────────────────────────────────────── */}
      <section className="card" aria-labelledby="section-appearance">
        <h2 id="section-appearance" className="card-heading"><Palette size={15} strokeWidth={2.2} /> Appearance</h2>
        <div className="settings-grid">
          <div className="settings-row">
            <span className="settings-label">Dark Mode</span>
            <button
              className={`toggle-switch ${darkMode ? 'on' : 'off'}`}
              onClick={toggle}
              aria-pressed={darkMode}
              aria-label="Toggle dark mode"
              id="settings-dark-mode-toggle"
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>
      </section>

      {/* ── About ──────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="section-about">
        <h2 id="section-about" className="card-heading"><Info size={15} strokeWidth={2.2} /> About</h2>
        <div className="settings-grid">
          <div className="settings-row">
            <span className="settings-label">Application</span>
            <span className="settings-value">BillFree TechSupport</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Version</span>
            <span className="settings-value">v10.0 PRO</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Architecture</span>
            <span className="settings-value">React SPA + Microservices</span>
          </div>
        </div>
      </section>
    </div>
  );
}
