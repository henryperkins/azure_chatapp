// Safely assigns user HTML using sanitizer -- should NOT trigger rule 9
export function createDemo(deps) {
  const el = deps.domAPI.create('div');
  el.innerHTML = deps.sanitizer.sanitize(deps.userInput); // safe
  return { el };
}
