export function getSafeHandler(DependencySystem){
  const raw = DependencySystem?.modules?.get?.('safeHandler');
  return (typeof raw === 'function')
         ? raw
         : (typeof raw?.safeHandler === 'function' ? raw.safeHandler : (fn)=>fn);
}
