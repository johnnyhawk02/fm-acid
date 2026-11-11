// Makes the plug-in's screen from the web app: the index.html that `node build.js` writes, with no install-app links, and the version stamped.
//   node plugin/tools/make-page.js <out-dir> [version] [sha]
// Writes <out-dir>/index.html. The plug-in serves it with irs/irs.json and fonts/VT323-Regular.ttf (plugin/CMakeLists.txt).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../..');
const [out, version = 'dev', sha = 'local'] = process.argv.slice(2);
if (!out) { console.error('usage: node plugin/tools/make-page.js <out-dir> [version] [sha]'); process.exit(2); }
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swap = (re, to, what) => { const n = html; html = html.replace(re, to); if (n === html) throw new Error('make-page: could not find ' + what); };
swap(/<link rel="manifest"[^>]*>\r?\n/, '', 'the manifest link');
html = html.replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\r?\n/g, '');
const date = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
swap('__BUILD_VERSION__', version, 'the version slot');
html = html.replace('__BUILD_SHA__', sha.slice(0, 7)).replace('__BUILD_DATE__', date);
fs.mkdirSync(out, { recursive: true });
// a UTF-8 byte order mark, so a web view reads it as UTF-8 even if it drops the content type (JUCE on Linux does)
fs.writeFileSync(path.join(out, 'index.html'), '\uFEFF' + html);
console.log(`plug-in page ${version}: ${(html.length / 1024).toFixed(0)} kB`);
