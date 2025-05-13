// Safely inserts user HTML via insertAdjacentHTML using sanitizer -- should NOT trigger rule 9
export function createDemo(deps) {
  const el = deps.domAPI.create('span');
  el.insertAdjacentHTML('beforeend', deps.sanitizer.sanitize(deps.userInput)); // safe
  return { el };
}
