// Safely sets src attribute using sanitizer -- should NOT trigger rule 9
export function createDemo(deps) {
  const img = deps.domAPI.create('img');
  img.setAttribute('src', deps.sanitizer.sanitize(deps.userInput)); // safe
  return { img };
}
