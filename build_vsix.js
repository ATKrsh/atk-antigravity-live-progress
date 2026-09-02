const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname);
const distDir = path.join(rootDir, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const version = pkg.version || '1.0.0';
const vsixName = `${pkg.name}-${version}.vsix`;
const stageDir = path.join(distDir, 'stage');
const extStage = path.join(stageDir, 'extension');

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(extStage, { recursive: true });

// Copy extension files
const filesToCopy = ['package.json', 'extension.js', 'README.md', 'icon.png'];
for (const f of filesToCopy) {
  const src = path.join(rootDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(extStage, f));
  }
}

// Generate [Content_Types].xml
const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>`;
fs.writeFileSync(path.join(stageDir, '[Content_Types].xml'), contentTypesXml, 'utf8');

// Generate extension.vsixmanifest
const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Id="${pkg.name}" Version="${version}" Publisher="${pkg.publisher || 'atk'}" Language="en-US"/>
    <DisplayName>${pkg.displayName || pkg.name}</DisplayName>
    <Description xml:space="preserve">${pkg.description || ''}</Description>
    <Tags>Antigravity, telemetry, statusbar, progress</Tags>
    <Categories>Other</Categories>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true"/>
  </Assets>
</PackageManifest>`;
fs.writeFileSync(path.join(stageDir, 'extension.vsixmanifest'), vsixManifest, 'utf8');

const zipOut = path.join(distDir, `${pkg.name}-${version}.zip`);
const vsixOut = path.join(distDir, vsixName);

if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);
if (fs.existsSync(vsixOut)) fs.unlinkSync(vsixOut);

const psScript = `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipOut}' -Force`;
execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: 'inherit' });
fs.renameSync(zipOut, vsixOut);

console.log(`[BUILD SUCCESS] Packaged extension: ${vsixOut}`);
