// Safely assigns user HTML to outerHTML using sanitizer -- should NOT trigger rule 9
export function createDemo(deps) {
  const el = deps.domAPI.create('div');
  el.outerHTML = deps.sanitizer.sanitize(deps.userInput); // safe
  return { el };
}
