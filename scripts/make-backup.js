const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const destDir = 'C:\\Users\\hpkal\\Documents\\Codebases\\Versions\\Daw buddy';
const zipName = 'daw_buddy_v0.4.1-beta.1.zip';
const destZip = path.join(destDir, zipName);
const sourceDir = 'C:\\Users\\hpkal\\Documents\\Codebases\\daw_buddy-main';

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}
if (fs.existsSync(destZip)) {
  fs.unlinkSync(destZip);
}

// Use powershell Compress-Archive on filtered files
const psCommand = `powershell -NoProfile -Command "Get-ChildItem -Path '${sourceDir}' | Where-Object { $_.Name -notin @('node_modules', 'dist', '.git', 'release', 'website') } | Compress-Archive -DestinationPath '${destZip}' -CompressionLevel Optimal"`;

console.log('Creating backup archive at:', destZip);
execSync(psCommand, { stdio: 'inherit' });

const stats = fs.statSync(destZip);
console.log(`Backup completed successfully: ${zipName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
