export function createFoo({ eventService }) {
  if (!eventService) {
    throw new Error('[createFoo] Missing eventService dependency');
  }
  eventService.emit('foo');
  return { cleanup() {} };
}
