// Unsafely assigns user HTML without sanitization -- must trigger rule 9
export function createDemo(deps) {
  const el = deps.domAPI.create('div');
  el.innerHTML = deps.userInput;        // XSS sink -- unsafe
  return { el };
}
