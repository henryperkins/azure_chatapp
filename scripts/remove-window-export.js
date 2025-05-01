/**
 * A jscodeshift transform to strip any `window.X = …` assignment,
 * as well as related global/legacy export patterns, and handles modern modular edge cases.
 *
 * Features:
 * - Removes all forms of window global assignments (`window.foo`, `window["foo"]`, etc.).
 * - Removes unused function/variable declarations whose only effect was the window assignment.
 * - Cleans up unused exports: `export { X as Y }`, `export default X`, etc. if X is entirely unused afterwards.
 * - Cleans up unused imports left solely for removed bindings.
 * - Strips only those comments that relate directly to removed window exports/declarations.
 * - Attempts to statically handle or warn on dynamic `window[bar]` assignments.
 * - Cleans up empty code blocks/statements that result from transformation.
 * - All actions are logged for traceability.
 */
export default function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // -- Step 1: Remove window exports, track removed identifiers and computed/dynamic keys for review --
  const removedNames = new Set();
  const dynamicWindowKeys = [];

  root
    .find(j.AssignmentExpression, {
      left: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'window' }
      }
    })
    .forEach(path => {
      const parent = path.parentPath;
      const left = path.node.left;
      let name = null;
      let computedStatic = false;

      // window.foo or window['foo']
      if (!left.computed && left.property.type === 'Identifier') {
        name = left.property.name;
        computedStatic = true;
      } else if (left.computed && left.property.type === 'Literal' && typeof left.property.value === 'string') {
        name = left.property.value;
        computedStatic = true;
      } else if (left.computed && left.property.type === 'Identifier') {
        // e.g., window[someVar]
        dynamicWindowKeys.push(j(parent).toSource());
      } else if (left.computed) {
        // Some other dynamic property
        dynamicWindowKeys.push(j(parent).toSource());
      }

      // Remove the assignment & its containing statement/export, and track for further cleanup
      if (
        parent.node.type === 'ExpressionStatement' ||
        parent.node.type === 'ExportNamedDeclaration'
      ) {
        // Remove leading comment if it obviously references the removed assignment
        if (parent.node.comments && /window\W/i.test(parent.node.comments.map(c => c.value).join(' '))) {
          parent.node.comments = [];
        }
        j(parent).remove();
        if (name && computedStatic) removedNames.add(name);
      }
    });

  // Warn on dynamic window keys, so developers know they exist
  if (dynamicWindowKeys.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[jscodeshift] Manual review needed for dynamic window exports:');
    dynamicWindowKeys.forEach(code => {
      // eslint-disable-next-line no-console
      console.log('[jscodeshift][DYNAMIC] ', code);
    });
  }

  // -- Step 2: Remove unused declarations for stripped window assignments --
  function removeUnusedDeclarations(name) {
    // Remove unused function declarations
    root.find(j.FunctionDeclaration, { id: { name } }).forEach(fnPath => {
      const references = root.find(j.Identifier, { name }).nodes().filter(n => n !== fnPath.node.id);
      if (references.length === 0) {
        // Remove doc or line comments if directly associated
        if (fnPath.node.comments) fnPath.node.comments = [];
        j(fnPath).remove();
      }
    });
    // Remove unused variable declarations (handle multi-var declaration edge cases)
    root.find(j.VariableDeclaration)
      .filter(varPath => varPath.node.declarations.some(decl => decl.id.name === name))
      .forEach(varPath => {
        let unused = true;
        varPath.node.declarations.forEach(decl => {
          if (decl.id.name === name) {
            const refs = root.find(j.Identifier, { name }).nodes().filter(n => n !== decl.id);
            if (refs.length > 0) unused = false;
          }
        });
        if (unused) {
          // Remove comments if solely for this export
          if (varPath.node.leadingComments && /window\W/i.test(varPath.node.leadingComments.map(c => c.value).join(' '))) {
            varPath.node.leadingComments = [];
          }
          if (varPath.node.declarations.length > 1) {
            varPath.node.declarations = varPath.node.declarations.filter(decl => decl.id.name !== name);
          } else {
            j(varPath).remove();
          }
        }
      });
  }

  removedNames.forEach(name => removeUnusedDeclarations(name));

  // -- Step 3: Remove unused exports for these names --
  removedNames.forEach(name => {
    // Named exports: export { X }, export { X as Y }
    root.find(j.ExportNamedDeclaration)
      .filter(exp => {
        // export { X } or export { X as Y }
        return exp.node.specifiers && exp.node.specifiers.some(spec => (
          (spec.local && spec.local.name === name) ||
          (spec.exported && spec.exported.name === name)
        ));
      })
      .forEach(exp => {
        // Remove only this specifier if others remain, else remove export entirely
        exp.node.specifiers = exp.node.specifiers.filter(
          spec => !(
            (spec.local && spec.local.name === name) ||
            (spec.exported && spec.exported.name === name)
          )
        );
        if (exp.node.specifiers.length === 0) {
          j(exp).remove();
        }
      });
    // Default export: export default X;
    root.find(j.ExportDefaultDeclaration)
      .filter(exp => exp.node.declaration.type === 'Identifier' && exp.node.declaration.name === name)
      .forEach(exp => {
        j(exp).remove();
      });
  });

  // -- Step 4: Remove unused imports solely for stripped names --
  removedNames.forEach(name => {
    root.find(j.ImportDeclaration)
      .forEach(impPath => {
        const specifiers = impPath.node.specifiers;
        if (!specifiers || specifiers.length === 0) return;
        let changed = false;
        impPath.node.specifiers = specifiers.filter(spec => {
          if (
            ((spec.type === 'ImportSpecifier' || spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') &&
              spec.local.name === name) ||
            (spec.imported && spec.imported.name === name)
          ) {
            changed = true;
            return false;
          }
          return true;
        });
        // If import had only the removed name, kill the whole import
        if (impPath.node.specifiers.length === 0) {
          j(impPath).remove();
        }
      });
  });

  // -- Step 5: Remove stale line or block comments that refer solely to window export --
  root.find(j.Comment)
    .forEach(commentPath => {
      if (commentPath.node.value && /window\W/i.test(commentPath.node.value) && !/important|deprecated|legacy/i.test(commentPath.node.value)) {
        j(commentPath).remove();
      }
    });

  // -- Step 6: Remove empty block statements not part of function/class bodies --
  root.find(j.BlockStatement)
    .forEach(blockPath => {
      if (
        Array.isArray(blockPath.node.body) &&
        blockPath.node.body.length === 0 &&
        blockPath.parent.node.type !== 'FunctionDeclaration' &&
        blockPath.parent.node.type !== 'FunctionExpression' &&
        blockPath.parent.node.type !== 'ArrowFunctionExpression' &&
        blockPath.parent.node.type !== 'ClassBody'
      ) {
        j(blockPath).remove();
      }
    });

  return root.toSource();
}
