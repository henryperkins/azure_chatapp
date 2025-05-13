// Unsafely inserts user HTML via insertAdjacentHTML without sanitizer -- triggers rule 9
export function createDemo(deps) {
  const el = deps.domAPI.create('span');
  el.insertAdjacentHTML('beforeend', deps.userInput); // XSS sink -- unsafe
  return { el };
}
