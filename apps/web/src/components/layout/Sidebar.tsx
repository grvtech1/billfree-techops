import { useState } from 'react';
import {
  LayoutDashboard, Trophy, BarChart3, Database,
  History, FileBarChart2, Phone, Settings2,
  Zap, ChevronLeft, Moon, Sun,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore } from '@billfree/app-state';
import { useTicketStore } from '@billfree/feature-tickets';

type NavItem = { id: string; label: string; Icon: LucideIcon };
type NavSection = { label: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Main',
    items: [
      { id: 'dashboard', label: 'Dashboard',        Icon: LayoutDashboard },
      { id: 'team',      label: 'Team Performance', Icon: Trophy },
    ],
  },
  {
    label: 'Data',
    items: [
      { id: 'analytics', label: 'Manager Analytics', Icon: BarChart3 },
      { id: 'master',    label: 'Master Database',   Icon: Database },
    ],
  },
  {
    label: 'Reports',
    items: [
      { id: 'history',       label: 'Update History',  Icon: History },
      { id: 'monthlyreport', label: 'Monthly Reports', Icon: FileBarChart2 },
      { id: 'calllog',       label: 'Call Log',        Icon: Phone },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'settings', label: 'Settings', Icon: Settings2 },
    ],
  },
];

export default function Sidebar() {
  const activeView = useUiStore(s => s.activeView);
  const setView    = useUiStore(s => s.setView);
  const darkMode   = useUiStore(s => s.darkMode);
  const toggleDark = useUiStore(s => s.toggleDarkMode);
  const isLoading  = useTicketStore(s => s.isLoading);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}
      aria-label="Main navigation"
    >
      {/* Brand + collapse control */}
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-icon-wrap" aria-hidden="true">
            <Zap size={17} strokeWidth={2.5} />
          </span>
          {!collapsed && (
            <span className="brand-text">
              <span className="brand-name">BillFree</span>
              <span className="brand-sub">TechOps</span>
            </span>
          )}
        </div>
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft
            size={16}
            style={{
              transform: collapsed ? 'rotate(180deg)' : 'none',
              transition: 'transform 300ms var(--ease-premium)',
            }}
          />
        </button>
      </div>

      {/* Live status pill */}
      {!collapsed && (
        <div className="sidebar-status">
          <span className="status-dot" aria-hidden="true" />
          Live • v12.0 PRO
        </div>
      )}

      {/* Navigation */}
      <nav className="nav-container" role="navigation">
        {NAV_SECTIONS.map((section, si) => (
          <div className="nav-section" key={section.label}>
            <div className={`nav-label ${si === 0 ? 'nav-label-first' : ''}`}>
              {section.label}
            </div>
            {section.items.map((item, ii) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setView(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  data-tip={item.label}
                  style={{ animationDelay: `${(si * 2 + ii) * 0.05 + 0.05}s` } as React.CSSProperties}
                >
                  <span className="nav-item-icon" aria-hidden="true">
                    <item.Icon size={18} strokeWidth={isActive ? 2.3 : 1.85} />
                  </span>
                  {!collapsed && <span className="nav-item-text">{item.label}</span>}
                  {!collapsed && isLoading && isActive && (
                    <span className="nav-loading-dot" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer — theme toggle */}
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
              {darkMode
                ? <Moon size={11} strokeWidth={2.5} />
                : <Sun  size={11} strokeWidth={2.5} />}
            </div>
          </div>
          {!collapsed && (
            <span className="theme-label">{darkMode ? 'Dark Mode' : 'Light Mode'}</span>
          )}
        </button>
      </div>
    </aside>
  );
}
