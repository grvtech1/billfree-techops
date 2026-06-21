import { describe, it, expect } from 'vitest';
import { STATUSES, isStatus, parseErrorCode, ERROR_MESSAGES } from '@billfree/shared';

// Confirms the @billfree/shared workspace alias resolves from the web app and
// that the shared contract helpers behave as the API client relies on.
describe('@billfree/shared integration', () => {
  it('exposes the canonical statuses', () => {
    expect(STATUSES).toContain('Completed');
    expect(STATUSES).toContain("Can't Do");
    expect(isStatus('Closed')).toBe(true);
    expect(isStatus('Nope')).toBe(false);
  });

  it('parses backend error codes the way api.ts expects', () => {
    expect(parseErrorCode('[E002] Authentication required')).toBe('E002');
    expect(ERROR_MESSAGES.E002).toBeTruthy();
    expect(parseErrorCode('no code here')).toBe('E999');
  });
});
