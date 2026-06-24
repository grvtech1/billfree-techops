import React from 'react';
import type { ReactNode } from 'react';
import { reportClientError } from '@billfree/api';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary — catches any unhandled render error in child components
 * and displays a recovery UI instead of crashing the entire app.
 *
 * Class component because React does not support error boundaries as hooks yet.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled error:', error, info.componentStack);
    // Best-effort report to the backend (no-op in dev/mock mode).
    reportClientError('react-error-boundary', error.message, error.stack ?? info.componentStack ?? '');
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="error-screen" role="alert">
          <div className="error-icon">⚠️</div>
          <h1>Something went wrong</h1>
          <p>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            className="btn btn-primary"
            onClick={this.handleRetry}
          >
            Try Again
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => window.location.reload()}
            style={{ marginLeft: '8px' }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
