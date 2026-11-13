# Requires Node.js, project dependencies, and Microsoft Edge.
[CmdletBinding()]
param(
    [uri]$Url = 'http://127.0.0.1:5188/',
    [ValidateRange(320, 7680)][int]$Width = 1920,
    [ValidateRange(240, 4320)][int]$Height = 1080,
    [ValidateRange(1, 4)][double]$DeviceScaleFactor = 2,
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$EdgePath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Url.Scheme -ne 'http' -or -not $Url.IsLoopback -or $Url.UserInfo) {
    throw 'Url must be a local HTTP address without credentials.'
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCommand) { throw 'Node.js was not found. Install it separately first.' }
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules\@playwright\test\package.json'))) {
    throw 'Project Playwright is missing. Install dependencies separately using the lockfile.'
}
if (-not $EdgePath) {
    $candidates = @([Environment]::GetEnvironmentVariable('ProgramFiles(x86)'), $env:ProgramFiles, $env:LOCALAPPDATA) |
        Where-Object { $_ } |
        ForEach-Object { Join-Path $_ 'Microsoft\Edge\Application\msedge.exe' }
    $EdgePath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $EdgePath -or -not (Test-Path -LiteralPath $EdgePath -PathType Leaf)) {
    throw 'Microsoft Edge was not found. Supply its executable with -EdgePath.'
}
$EdgePath = (Resolve-Path -LiteralPath $EdgePath).Path
$client = New-Object System.Net.Sockets.TcpClient
try {
    $connection = $client.ConnectAsync($Url.DnsSafeHost, $Url.Port)
    if (-not $connection.Wait(2500) -or -not $client.Connected) { throw 'No listener.' }
} catch {
    Write-Host "Preview service is not reachable at $Url."
    Write-Host 'In a separate PowerShell window run:'
    Write-Host ("Set-Location -LiteralPath '{0}'" -f $ProjectRoot.Replace("'", "''"))
    Write-Host ("node .\node_modules\vite\bin\vite.js --host '{0}' --port {1}" -f $Url.DnsSafeHost.Replace("'", "''"), $Url.Port)
    throw 'Start the local project service, then run this script again.'
} finally { $client.Dispose() }
$javascript = @'
const { createRequire } = require('node:module');
const path = require('node:path');
(async () => {
  const [root, url, edge, width, height, dpr] = process.argv.slice(2);
  const { chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test');
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: edge, headless: false,
      args: ['--window-size=' + (Number(width) + 32) + ',' + (Number(height) + 120)]
    });
    process.once('SIGINT', () => { browser.close().catch(() => {}); });
    const closed = new Promise(resolve => browser.once('disconnected', resolve));
    const context = await browser.newContext({
      viewport: { width: Number(width), height: Number(height) },
      deviceScaleFactor: Number(dpr)
    });
    const page = await context.newPage();
    // Closing the last window can leave the Playwright browser process alive.
    context.on('pageclose', () => {
      if (context.pages().length === 0) browser.close().catch(() => {});
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response || !response.ok()) throw new Error('Page HTTP status: ' + response?.status());
    await page.waitForSelector('.pond-canvas', { state: 'visible', timeout: 30000 });
    console.log(JSON.stringify(await page.evaluate(() => {
      const c = document.querySelector('.pond-canvas');
      return { viewport: [innerWidth, innerHeight], deviceScaleFactor: devicePixelRatio,
        canvas: [c.width, c.height] };
    }), null, 2));
    console.log('Independent preview is open. Keep this terminal open.');
    console.log('Close this preview window or press Ctrl+C to stop this browser only.');
    await closed;
  } catch (error) {
    console.error('Preview failed: ' + error.message);
    if (browser) await browser.close().catch(() => {});
    process.exitCode = 1;
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'@
$scaleArgument = $DeviceScaleFactor.ToString([System.Globalization.CultureInfo]::InvariantCulture)
$javascript | & $nodeCommand.Source '-' $ProjectRoot $Url.AbsoluteUri $EdgePath $Width $Height $scaleArgument
if ($LASTEXITCODE -ne 0) { throw "Browser preview exited with code $LASTEXITCODE." }
