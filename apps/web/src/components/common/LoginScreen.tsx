import { useState } from 'react';
import { useAuthStore } from '@billfree/app-state';

// Demo identities recognised by auth-service's static directory.
const DEMO_USERS = [
  { email: 'admin@billfree.in', label: 'Admin' },
  { email: 'manager@billfree.in', label: 'Manager' },
  { email: 'agent1@billfree.in', label: 'Agent' },
  { email: 'viewer@billfree.in', label: 'Viewer' },
];

export default function LoginScreen() {
  const loginWithGateway = useAuthStore((s) => s.loginWithGateway);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const login = async (addr: string) => {
    setBusy(true);
    setError('');
    try {
      await loginWithGateway(addr);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="login-screen"
      role="main"
      style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}
    >
      <div
        className="login-card"
        style={{
          width: 'min(420px, 100%)',
          padding: 32,
          borderRadius: 16,
          background: 'var(--surface, #fff)',
          boxShadow: '0 10px 40px rgba(0,0,0,.12)',
          textAlign: 'center',
        }}
      >
        <h1 style={{ margin: '0 0 4px' }}>BillFree TechOps</h1>
        <p style={{ marginTop: 0, opacity: 0.7 }}>Sign in to continue</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email) void login(email);
          }}
          style={{ display: 'flex', gap: 8, marginTop: 16 }}
        >
          <input
            type="email"
            placeholder="you@billfree.in"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
            style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !email}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <span style={{ opacity: 0.6, fontSize: 13 }}>Demo users:</span>
          {DEMO_USERS.map((u) => (
            <button
              key={u.email}
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void login(u.email)}
            >
              {u.label}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" style={{ color: '#dc2626', marginTop: 16 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
