import { useUiStore } from '@billfree/app-state';
import { useTicketStore } from '@billfree/feature-tickets';

type NavSection = {
  label: string;
  labelIcon: string;
  items: { id: string; label: string; icon: string }[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Main',
    labelIcon: '🧭',
    items: [
      { id: 'dashboard', label: 'Dashboard',        icon: '🏠' },
      { id: 'team',      label: 'Team Performance', icon: '🏆' },
    ],
  },
  {
    label: 'Data',
    labelIcon: '💾',
    items: [
      { id: 'analytics', label: 'Manager Analytics', icon: '📊' },
      { id: 'master',    label: 'Master Database',   icon: '🗄️' },
    ],
  },
  {
    label: 'Reports',
    labelIcon: '📝',
    items: [
      { id: 'history',       label: 'Update History',   icon: '📜' },
      { id: 'monthlyreport', label: 'Monthly Reports',  icon: '📊' },
      { id: 'calllog',       label: 'Call Log',         icon: '📞' },
    ],
  },
  {
    label: 'System',
    labelIcon: '⚙️',
    items: [
      { id: 'settings', label: 'Settings', icon: '⚙️' },
    ],
  },
];

export default function Sidebar() {
  const activeView    = useUiStore(s => s.activeView);
  const setView       = useUiStore(s => s.setView);
  const darkMode      = useUiStore(s => s.darkMode);
  const toggleDark    = useUiStore(s => s.toggleDarkMode);
  const isLoading     = useTicketStore(s => s.isLoading);

  return (
    <aside className="sidebar" aria-label="Main navigation">
      {/* Premium Brand Header */}
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">⚡</span>
          BillFree TechSupport
        </div>
        <div className="brand-subtitle">
          <span className="status-dot" aria-hidden="true" />
          Live • v10.0 PRO
        </div>
      </div>

      {/* Navigation Container */}
      <div className="nav-container">
        {NAV_SECTIONS.map((section, si) => (
          <div className="nav-section" key={section.label}>
            <div className={`nav-label ${si === 0 ? 'nav-label-first' : ''}`}>
              <span className="nav-label-icon" aria-hidden="true">{section.labelIcon}</span>
              {section.label}
            </div>
            {section.items.map((item, ii) => (
              <button
                key={item.id}
                className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                onClick={() => setView(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
                style={{ animationDelay: `${(si * 2 + ii) * 0.05 + 0.05}s` } as React.CSSProperties}
              >
                <span className="nav-item-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-item-text">{item.label}</span>
                {isLoading && activeView === item.id && (
                  <span className="nav-badge">…</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Sidebar Footer with Theme Toggle */}
      <div className="sidebar-footer">
        <button
          className="theme-toggle"
          onClick={toggleDark}
          title="Toggle Dark/Light Mode"
          aria-label="Toggle dark mode"
          aria-pressed={darkMode}
        >
          <div className="theme-toggle-track" aria-hidden="true">
            <div className="theme-toggle-thumb">
              <span className={`theme-icon ${darkMode ? 'theme-icon-moon' : 'theme-icon-sun'}`}>
                {darkMode ? '🌙' : '☀️'}
              </span>
            </div>
          </div>
          <span className="theme-label">{darkMode ? 'Dark Mode' : 'Light Mode'}</span>
        </button>
      </div>
    </aside>
  );
}
