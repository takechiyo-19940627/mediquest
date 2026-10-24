export function healthResponse() {
  return { status: 'ok' as const, service: 'mediquest' as const };
}
