// Unsafely assigns user HTML to outerHTML without sanitization -- must trigger rule 9
export function createDemo(deps) {
  const el = deps.domAPI.create('div');
  el.outerHTML = deps.userInput;       // XSS sink -- unsafe
  return { el };
}
