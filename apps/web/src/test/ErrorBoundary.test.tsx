import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Stub the client-error reporter so componentDidCatch doesn't hit the network.
vi.mock('@billfree/api', () => ({ reportClientError: vi.fn() }));

import ErrorBoundary from '../components/common/ErrorBoundary';
import { reportClientError } from '@billfree/api';

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('kaboom');
  return <div>safe content</div>;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('catches a render error, shows the fallback UI, and reports it', () => {
    // jsdom logs the React error boundary stack; silence it for a clean run.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    expect(reportClientError).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('auto-recovers when resetKey changes (e.g. navigating to another view)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="dashboard">
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Switching views changes the key → boundary clears and renders the new,
    // healthy child instead of staying stuck on the error screen.
    rerender(
      <ErrorBoundary resetKey="settings">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.getByText('safe content')).toBeInTheDocument();
    spy.mockRestore();
  });
});
