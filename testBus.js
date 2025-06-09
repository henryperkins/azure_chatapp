export function createFoo({ eventService }) {
  const bus = new EventTarget();
  bus.dispatchEvent(new Event('foo'));
  return { cleanup() {} };
}
