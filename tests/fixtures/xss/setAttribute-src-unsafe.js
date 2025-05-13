// Unsafely sets src attribute from user input -- must trigger rule 9
export function createDemo(deps) {
  const img = deps.domAPI.create('img');
  img.setAttribute('src', deps.userInput); // XSS sink -- unsafe
  return { img };
}
