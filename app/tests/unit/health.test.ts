import { describe, expect, it } from 'vitest';
import { healthResponse } from '../../server/utils/health';

describe('public liveness contract', () => {
  it('reports only service identity and liveness, without host or configuration details', () => {
    expect(healthResponse()).toEqual({ status: 'ok', service: 'mediquest' });
  });
});
