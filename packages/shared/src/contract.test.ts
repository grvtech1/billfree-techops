import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STATUSES, isStatus } from './status';
import { ERROR_CODES, ERROR_MESSAGES, parseErrorCode } from './errors';
import { POST_ACTIONS } from './api';

const here = dirname(fileURLToPath(import.meta.url));
const CODE_GS = readFileSync(join(here, '..', '..', '..', 'apps', 'gas', 'src', 'Code.gs'), 'utf8');

describe('helpers', () => {
  it('isStatus accepts canonical values and rejects others', () => {
    expect(isStatus('Completed')).toBe(true);
    expect(isStatus('Bogus')).toBe(false);
    expect(isStatus(42)).toBe(false);
  });

  it('parseErrorCode extracts a code and defaults safely', () => {
    expect(parseErrorCode('[E008] nope')).toBe('E008');
    expect(parseErrorCode('plain message')).toBe('E999');
    expect(parseErrorCode(undefined)).toBe('E999');
  });

  it('every error code has a user-facing message', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
});

// These tests fail loudly if the GAS backend and the shared contract drift.
describe('contract parity with GAS backend (apps/gas/src/Code.gs)', () => {
  it('STATUSES match STATUS_ENUM values', () => {
    const block = CODE_GS.match(/const STATUS_ENUM = Object\.freeze\(\{([\s\S]*?)\}\)/)?.[1] ?? '';
    const gasValues = [...block.matchAll(/:\s*("[^"]*"|'[^']*')/g)].map((m) => m[1].slice(1, -1));
    expect(gasValues.sort()).toEqual([...STATUSES].sort());
  });

  it('ERROR_CODES match the backend ERROR_CODES map', () => {
    const block = CODE_GS.match(/const ERROR_CODES = Object\.freeze\(\{([\s\S]*?)\}\)/)?.[1] ?? '';
    const gasCodes = [...block.matchAll(/:\s*'(E\d{3})'/g)].map((m) => m[1]);
    expect(gasCodes.sort()).toEqual(Object.values(ERROR_CODES).sort());
  });

  it('every POST_ACTION (except portal/external/cdr) is routed in doPost', () => {
    // These actions are dispatched by the SPA; confirm the backend handles them.
    const spaActions = POST_ACTIONS.filter(
      (a) => !['createticket', 'portal_create', 'portal_lookup', 'provider_cdr'].includes(a),
    );
    for (const action of spaActions) {
      expect(CODE_GS.includes(`action === '${action}'`)).toBe(true);
    }
  });
});
