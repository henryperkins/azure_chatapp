/**
 * A jscodeshift transform that strips any `window.X = …` assignment,
 * catching both direct and exported assignments, and computed properties.
 * Now logs matches for easier debugging.
 */
export default function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Match any `window.foo = bar` or `window['foo'] = bar`
  root
    .find(j.AssignmentExpression, {
      left: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'window' }
      }
    })
    .forEach(path => {
      const parent = path.parentPath;
      // Debug: log matches to verify traversal correctness
      // eslint-disable-next-line no-console
      console.log('[jscodeshift] Found assignment:', j(parent).toSource());
      // Remove ExpressionStatement or ExportNamedDeclaration wrapper
      if (
        parent.node.type === 'ExpressionStatement' ||
        parent.node.type === 'ExportNamedDeclaration'
      ) {
        j(parent).remove();
      }
    });

  return root.toSource();
}
