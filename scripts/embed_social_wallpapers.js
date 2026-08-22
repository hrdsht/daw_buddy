const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..', 'social-assets');
const wp1 = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(baseDir, 'wallpapers', 'wp1.jpg')).toString('base64');
const wp2 = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(baseDir, 'wallpapers', 'wp2.jpg')).toString('base64');
const wp3 = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(baseDir, 'wallpapers', 'wp3.jpg')).toString('base64');
const wp4 = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(baseDir, 'wallpapers', 'wp4.jpg')).toString('base64');
const wp5 = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(baseDir, 'wallpapers', 'wp5.jpg')).toString('base64');

const htmlPath = path.join(baseDir, 'instagram_carousel.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const regex = /const wallpapers = \{[\s\S]*?\};/;
const replacement = `const wallpapers = {\n      wp1: '${wp1}',\n      wp2: '${wp2}',\n      wp3: '${wp3}',\n      wp4: '${wp4}',\n      wp5: '${wp5}'\n    };`;

html = html.replace(regex, replacement);
fs.writeFileSync(htmlPath, html);
console.log('Successfully injected base64 wallpapers!');
