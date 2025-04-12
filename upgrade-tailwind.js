#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// File to process
const htmlFile = './static/index.html';

// Read the file
let content;
try {
  content = fs.readFileSync(htmlFile, 'utf8');
} catch (err) {
  console.error(`Error reading file: ${err.message}`);
  process.exit(1);
}

console.log('Upgrading Tailwind classes from v3 to v4...');

// 1. Replace renamed utilities
const renamedUtilities = {
  'shadow-sm(?![\\w-])': 'shadow-xs',     // shadow-sm → shadow-xs
  '(?<![\\w-])shadow(?![\\w-])': 'shadow-sm',  // shadow → shadow-sm
  'focus:outline-none': 'focus:outline-hidden', // outline-none → outline-hidden
  'rounded(?![\\w-])': 'rounded-sm', // bare rounded → rounded-sm
};

// Perform replacements
let modifiedContent = content;
Object.entries(renamedUtilities).forEach(([pattern, replacement]) => {
  const regex = new RegExp(`class="([^"]*)(${pattern})([^"]*)"`, 'g');
  modifiedContent = modifiedContent.replace(regex, (match, prefix, target, suffix) => {
    return `class="${prefix}${replacement}${suffix}"`;
  });
});

// 2. Fix space utilities (space-x-* to gap-*)
// This is more complex as it requires processing the class list and ensuring parent has flex or grid
// For simplicity, we're using a regex-based approach but note this might need manual review
const spaceToGapRegex = /class="([^"]*)space-(x|y)-(\d+)([^"]*)"/g;
modifiedContent = modifiedContent.replace(spaceToGapRegex, (match, prefix, axis, size, suffix) => {
  // Check if the class already has flex or grid
  const hasFlexOrGrid = /\b(flex|grid)\b/.test(prefix + suffix);

  // If it has flex or grid, replace space-x/y with gap
  if (hasFlexOrGrid) {
    return `class="${prefix}gap-${size}${suffix}"`;
  }
  // Otherwise keep the original (needs manual review)
  return match;
});

// Write the modified content back to the file
try {
  fs.writeFileSync(htmlFile, modifiedContent, 'utf8');
  console.log(`Successfully upgraded Tailwind classes in ${htmlFile}`);

  // Count changes
  const spacesReplaced = (content.match(/space-(x|y)-\d+/g) || []).length -
                        (modifiedContent.match(/space-(x|y)-\d+/g) || []).length;

  const shadowSmReplaced = (content.match(/shadow-sm(?![a-zA-Z0-9-])/g) || []).length -
                          (modifiedContent.match(/shadow-sm(?![a-zA-Z0-9-])/g) || []).length;

  const shadowReplaced = (content.match(/(?<![a-zA-Z0-9-])shadow(?![a-zA-Z0-9-])/g) || []).length -
                        (modifiedContent.match(/(?<![a-zA-Z0-9-])shadow(?![a-zA-Z0-9-])/g) || []).length;

  const outlineReplaced = (content.match(/focus:outline-none/g) || []).length -
                          (modifiedContent.match(/focus:outline-none/g) || []).length;

  const roundedReplaced = (content.match(/(?<![a-zA-Z0-9-])rounded(?![a-zA-Z0-9-])/g) || []).length -
                        (modifiedContent.match(/(?<![a-zA-Z0-9-])rounded(?![a-zA-Z0-9-])/g) || []).length;

  console.log(`
Changes made:
- Replaced ${shadowSmReplaced} occurrences of 'shadow-sm' with 'shadow-xs'
- Replaced ${shadowReplaced} occurrences of 'shadow' with 'shadow-sm'
- Replaced ${outlineReplaced} occurrences of 'focus:outline-none' with 'focus:outline-hidden'
- Replaced ${roundedReplaced} occurrences of 'rounded' with 'rounded-sm'
- Replaced ${spacesReplaced} occurrences of 'space-x-*' or 'space-y-*' with 'gap-*'
  `);

  console.log('\nNote: You may need to manually review some elements, particularly:');
  console.log('1. Make sure all flex/grid containers with gap-* are properly configured');
  console.log('2. Check if you need explicit border colors anywhere');
  console.log('3. Add explicit focus:ring-color classes where needed');

} catch (err) {
  console.error(`Error writing file: ${err.message}`);
  process.exit(1);
}
