const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '../src/renderer/assets/bloo-wireframe');
const manifestPath = path.join(baseDir, 'manifest');

if (!fs.existsSync(manifestPath)) {
  console.error('Manifest not found at', manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// 1. Process embedded image resources in resources/
const resDir = path.join(baseDir, 'resources');
const imagesDir = path.join(baseDir, 'extracted-images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const resFiles = fs.readdirSync(resDir);
const imageMap = [];

resFiles.forEach((file) => {
  const fullPath = path.join(resDir, file);
  if (fs.statSync(fullPath).isFile()) {
    const buf = fs.readFileSync(fullPath);
    // Check if PNG
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const outName = `${file}.png`;
      fs.writeFileSync(path.join(imagesDir, outName), buf);
      imageMap.push({ id: file, format: 'png', size: buf.length, path: `extracted-images/${outName}` });
    }
  }
});

// 2. Parse all artboards from the manifest
const artworkChildren = manifest.children?.find(c => c.name === 'artwork')?.children || [];
const artboardList = [];

artworkChildren.forEach((art) => {
  if (art.name && art.path) {
    const bounds = art['uxdesign#bounds'] || {};
    artboardList.push({
      id: art.id,
      name: art.name,
      path: art.path,
      width: bounds.width || 375,
      height: bounds.height || 812,
      x: bounds.x || 0,
      y: bounds.y || 0
    });
  }
});

// 3. Collect distinct UI categories
const categories = {};
artboardList.forEach((ab) => {
  const parts = ab.name.split('–')[0].split('-')[0].trim();
  if (!categories[parts]) categories[parts] = [];
  categories[parts].push(ab);
});

// 4. Save metadata summary JSON
const summary = {
  name: 'Bloo Lo-Fi Wireframe Kit v1.0',
  totalArtboards: artboardList.length,
  totalImages: imageMap.length,
  categories: Object.keys(categories),
  artboards: artboardList,
  images: imageMap
};

fs.writeFileSync(path.join(baseDir, 'bloo-kit-summary.json'), JSON.stringify(summary, null, 2));

console.log('=== Bloo Lo-Fi Wireframe Kit Extraction Complete ===');
console.log(`Total Artboards: ${artboardList.length}`);
console.log(`Extracted Images: ${imageMap.length}`);
console.log(`Categories (${Object.keys(categories).length}):`, Object.keys(categories).slice(0, 15).join(', '));
console.log(`Saved summary to: ${path.join(baseDir, 'bloo-kit-summary.json')}`);
