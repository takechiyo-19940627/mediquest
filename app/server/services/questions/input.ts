import { SourceError } from '../source-errors';
// Issue #50: stopping a logical question takes an empty JSON object. The
// question comes from the route and the administrator from the server; the
// saved status is the only key of this one-way transition, so no revision,
// fingerprint or idempotency field exists and client-chosen user/status/reason
// fields, arrays and non-objects are rejected before any database access.
export function stopInput(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length
  )
    throw new SourceError('invalid');
  return {};
}
