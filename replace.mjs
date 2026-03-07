import fs from 'fs';
import path from 'path';

const re = /(?<![a-zA-Z0-9\-_])\.openclaw(?![a-zA-Z0-9\-_\.]|cn)/g;

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        if (['node_modules', '.git', 'dist', 'target', '.artifacts', 'tests_tmp', 'src-tauri/target', 'ui/dist'].includes(file)) continue;
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);
        if (stat.isDirectory()) {
            results = results.concat(walk(filepath));
        } else {
            results.push(filepath);
        }
    }
    return results;
}

const files = walk(process.cwd());
let changedFiles = 0;
for (const file of files) {
    if (!file.match(/\.(ts|rs|js|mjs|tsx|md|json|sh|ps1|txt|yaml|yml)$/)) continue;
    if (file.includes('pnpm-lock.yaml') || file.includes('package-lock.json') || file.includes('install/')) continue;
    if (file.includes('replace-openclaw.js') || file.includes('test-regex.js') || file.includes('replace.mjs')) continue;
    
    let content = fs.readFileSync(file, 'utf-8');
    let originalContent = content;
    
    content = content.replace(re, '.openclawcn');

    if (content !== originalContent) {
        fs.writeFileSync(file, content, 'utf-8');
        console.log('Updated:', file);
        changedFiles++;
    }
}
console.log('Total files changed:', changedFiles);
