// scripts/audit.js
import fs from 'fs';
import path from 'path';

// Adjust to scan both your src and static/js folders
const scanDirs = ['src', 'static/js'];
const checks = [
    { regex: /\bwindow\./, desc: 'Direct window.* usage' },
    { regex: /\bsetTimeout\b|\bsetInterval\b/, desc: 'Timing hacks' },
];

scanDirs.forEach(dir => {
    fs.readdirSync(dir)
        .filter(f => f.endsWith('.js') && f !== 'app.js')
        .forEach(file => {
            const fullPath = path.join(dir, file);
            const src = fs.readFileSync(fullPath, 'utf8');
            const issues = checks
                .filter(c => c.regex.test(src))
                .map(c => `  ⚠️ ${c.desc}`);
            if (issues.length) {
                console.log(`\n=== ${fullPath} ===`);
                issues.forEach(i => console.log(i));
            }
        });
});
