# Python version discovery and dependency management script - Windows version
# Called by Tauri Rust backend
# Usage: .\python_manager.ps1 <command> [args...]
#   discover                    - Discover all Python in system
#   install <python_path>        - Install paddlepaddle+paddleocr on specified Python
#   uninstall <python_path>      - Uninstall paddleocr from specified Python
#   check_paddle <python_path>   - Check if specified Python has paddleocr
#   install_bundled              - Not supported on Windows, returns hint
#   uninstall_bundled            - Delete built-in Python directory

param(
    [Parameter(Position=0)]
    [string]$Command,
    [Parameter(Position=1)]
    [string]$Arg1
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# Force UTF-8 encoding for stdout/stderr (critical for Rust side parsing)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Built-in Python path (Windows)
$BundledPythonDir = Join-Path $env:LOCALAPPDATA 'accounting-app\python'
$BundledPython = Join-Path $BundledPythonDir 'python.exe'

# --- Helper: Run python and get version string ---
function Get-PythonVersion {
    param([string]$path)
    try {
        # For Microsoft Store stub files, use Get-ItemProperty to get version
        if ($path -like '*WindowsApps*') {
            $baseName = [System.IO.Path]::GetFileNameWithoutExtension($path)
            if ($baseName -match 'python(\d+)\.(\d+)') {
                return "Python $($matches[1]).$($matches[2])"
            }
        }
        $output = & $path --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            return $output.Trim()
        }
    } catch {}
    # Fallback: try to get version from registry
    try {
        $regVersions = Get-ChildItem 'HKCU:\SOFTWARE\Python\PythonCore' -ErrorAction SilentlyContinue
        foreach ($ver in $regVersions) {
            $installPath = (Get-ItemProperty "$($ver.PSPath)\InstallPath" -ErrorAction SilentlyContinue).'(default)'
            if ($installPath -and $path.ToLower().Contains($installPath.ToLower())) {
                return "Python $($ver.PSChildName)"
            }
        }
    } catch {}
    return $null
}

# --- Helper: Check if Python has paddleocr ---
function Test-PaddleOCR {
    param([string]$path)
    try {
        & $path -c "import paddleocr" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# --- Helper: Check Python version compatibility (3.8-3.12) ---
function Test-PythonCompatible {
    param([string]$version)
    try {
        $regexMatch = [regex]::Match($version, 'Python\s+(\d+)\.(\d+)')
        if ($regexMatch.Success) {
            $minor = [int]$regexMatch.Groups[2].Value
            return ($minor -ge 8 -and $minor -le 12)
        }
    } catch {}
    return $false
}

function Get-PythonMinor {
    param([string]$version)
    try {
        $regexMatch = [regex]::Match($version, 'Python\s+\d+\.(\d+)')
        if ($regexMatch.Success) {
            return [int]$regexMatch.Groups[1].Value
        }
    } catch {}
    return 0
}

# --- Helper: Detect Python source ---
function Get-PythonSource {
    param([string]$resolvedPath)
    $p = $resolvedPath.ToLower()
    if ($p.Contains('windowsapps')) { return 'store' }
    if ($p.Contains('programs\python') -or $p.Contains('python\python')) { return 'pythonorg' }
    if ($p.Contains('\pyenv\')) { return 'pyenv' }
    if ($p.Contains('\uv\') -or $p.Contains('uv\python')) { return 'uv' }
    return 'unknown'
}

# --- Helper: Add unique python candidate ---
$script:SeenPaths = @{}

function Add-UniquePythonCandidate {
    param([string]$path)
    if (-not (Test-Path $path)) { return $null }
    try {
        $resolved = (Resolve-Path $path).ProviderPath
        if (-not $script:SeenPaths.ContainsKey($resolved)) {
            $script:SeenPaths[$resolved] = $true
            return $path
        }
    } catch {}
    return $null
}

# --- discover: Discover all Python ---
function Invoke-Discover {
    $candidates = @()

    # 1. Common commands in PATH
    $pathCommands = @('python', 'python3', 'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3.8')
    foreach ($cmd in $pathCommands) {
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($found -and $found.Source) {
            $path = Add-UniquePythonCandidate $found.Source
            if ($path) { $candidates += $path }
        }
    }

    # 2. py launcher: List all registered Python
    $pyLauncher = Get-Command 'py' -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        try {
            $pyOutput = & py -0p 2>$null
            foreach ($line in $pyOutput) {
                $line = $line.Trim()
                $regexMatch = [regex]::Match($line, '.*-\s*(.+)$')
                if ($regexMatch.Success) {
                    $pyPath = $regexMatch.Groups[1].Value.Trim()
                    $path = Add-UniquePythonCandidate $pyPath
                    if ($path) { $candidates += $path }
                }
            }
        } catch {}
    }

    # 3. Registry query - HKLM (all users)
    $regPaths = @(
        'HKLM:\SOFTWARE\Python\PythonCore',
        'HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore'
    )
    foreach ($regBase in $regPaths) {
        try {
            if (Test-Path $regBase) {
                $versions = Get-ChildItem $regBase -ErrorAction SilentlyContinue
                foreach ($ver in $versions) {
                    $installPath = Join-Path $ver.PSPath 'InstallPath'
                    if (Test-Path $installPath) {
                        $exePath = (Get-ItemProperty $installPath -ErrorAction SilentlyContinue).'(default)'
                        if ($exePath) {
                            $fullPath = Join-Path $exePath 'python.exe'
                            $path = Add-UniquePythonCandidate $fullPath
                            if ($path) { $candidates += $path }
                        }
                    }
                }
            }
        } catch {}
    }

    # 4. Registry query - HKCU (current user)
    try {
        if (Test-Path 'HKCU:\SOFTWARE\Python\PythonCore') {
            $versions = Get-ChildItem 'HKCU:\SOFTWARE\Python\PythonCore' -ErrorAction SilentlyContinue
            foreach ($ver in $versions) {
                $installPath = Join-Path $ver.PSPath 'InstallPath'
                if (Test-Path $installPath) {
                    $exePath = (Get-ItemProperty $installPath -ErrorAction SilentlyContinue).'(default)'
                    if ($exePath) {
                        $fullPath = Join-Path $exePath 'python.exe'
                        $path = Add-UniquePythonCandidate $fullPath
                        if ($path) { $candidates += $path }
                    }
                }
            }
        }
    } catch {}

    # 5. Common installation paths
    $searchDirs = @()
    if ($env:LOCALAPPDATA) {
        $searchDirs += Join-Path $env:LOCALAPPDATA 'Programs\Python'
    }
    if ($env:PROGRAMFILES) {
        $searchDirs += $env:PROGRAMFILES
    }
    if (Test-Path 'C:\Program Files (x86)') {
        $searchDirs += 'C:\Program Files (x86)'
    }
    foreach ($dir in $searchDirs) {
        try {
            if (Test-Path $dir) {
                $foundExes = Get-ChildItem -Path $dir -Filter 'python.exe' -Recurse -File -ErrorAction SilentlyContinue
                foreach ($f in $foundExes) {
                    $path = Add-UniquePythonCandidate $f.FullName
                    if ($path) { $candidates += $path }
                }
            }
        } catch {}
    }

    # Build JSON output
    $jsonItems = @()
    foreach ($path in $candidates) {
        $version = Get-PythonVersion $path
        if (-not $version) { continue }

        $minor = Get-PythonMinor $version
        $isCompatible = Test-PythonCompatible $version
        $hasPaddle = Test-PaddleOCR $path
        $source = Get-PythonSource $path
        
        # Mark Microsoft Store Python as unusable for installation
        $isUsable = $true
        if ($source -eq 'store') {
            $isUsable = $false
        }

        $jsonItems += @{
            path = $path
            version = $version
            minor_version = $minor
            is_compatible = $isCompatible
            has_paddleocr = $hasPaddle
            source = $source
            is_usable = $isUsable
        }
    }

    $bundledInstalled = Test-Path $BundledPython

    $result = @{
        pythons = $jsonItems
        bundled_python_installed = $bundledInstalled
        bundled_python_path = $BundledPython
    }

    return ($result | ConvertTo-Json -Depth 3 -Compress)
}

# --- install: Install paddlepaddle + paddleocr on specified Python ---
function Invoke-Install {
    param([string]$pythonPath)
    if (-not (Test-Path $pythonPath)) {
        Write-Output "error: Python executable not found: $pythonPath"
        return
    }

    # Check if this is a Microsoft Store stub file
    if ($pythonPath -like '*WindowsApps*') {
        Write-Output "error: Microsoft Store Python stub files cannot be used for package installation."
        Write-Output "Please install Python from python.org and select that path instead."
        Write-Output "Download: https://www.python.org/downloads/"
        $err = @{ error = "Microsoft Store Python not supported for installation. Please use python.org version." }
        Write-Output ($err | ConvertTo-Json -Compress)
        exit 1
    }

    $packages = @('paddlepaddle', 'paddleocr')
    foreach ($pkg in $packages) {
        Write-Output ">>> Installing $pkg ..."
        & $pythonPath -m pip install --upgrade $pkg 2>&1 | ForEach-Object { Write-Output $_ }
        if ($LASTEXITCODE -ne 0) {
            Write-Output "[FAIL] Failed to install $pkg"
            return
        }
        Write-Output "[OK] $pkg installed"
    }
    Write-Output ">>> All packages installed"
}

# --- uninstall: Uninstall paddleocr + paddlepaddle ---
function Invoke-Uninstall {
    param([string]$pythonPath)
    if (-not (Test-Path $pythonPath)) {
        Write-Output "error: Python executable not found: $pythonPath"
        return
    }

    $packages = @('paddleocr', 'paddlepaddle')
    foreach ($pkg in $packages) {
        Write-Output ">>> Uninstalling $pkg ..."
        & $pythonPath -m pip uninstall -y $pkg 2>&1 | ForEach-Object { Write-Output $_ }
        Write-Output "[OK] $pkg uninstalled"
    }
    Write-Output ">>> Uninstall complete"
}

# --- check_paddle: Check paddleocr ---
function Invoke-CheckPaddle {
    param([string]$pythonPath)
    if (Test-PaddleOCR $pythonPath) {
        Write-Output "true"
    } else {
        Write-Output "false"
    }
}

# --- install_bundled: Not supported on Windows ---
function Invoke-InstallBundled {
    param([string]$sessionId)
    Write-Output ">>> Windows does not support automatic built-in Python installation"
    Write-Output ">>> Please download Python 3.12 from python.org, or install via Microsoft Store"
    $err = @{ error = "Windows does not support automatic built-in Python installation" }
    Write-Output ($err | ConvertTo-Json -Compress)
    exit 1
}

# --- uninstall_bundled: Delete built-in Python directory ---
function Invoke-UninstallBundled {
    if (Test-Path $BundledPythonDir) {
        try {
            Remove-Item $BundledPythonDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Output "[OK] Built-in Python uninstalled"
        } catch {
            Write-Output "[WARN] Error uninstalling built-in Python: $_"
        }
    }
    $ok = @{ status = "ok" }
    Write-Output ($ok | ConvertTo-Json -Compress)
}

# Main
switch ($Command) {
    'discover'           { Invoke-Discover }
    'install'            { Invoke-Install $Arg1 }
    'uninstall'          { Invoke-Uninstall $Arg1 }
    'check_paddle'       { Invoke-CheckPaddle $Arg1 }
    'install_bundled'    { Invoke-InstallBundled $Arg1 }
    'uninstall_bundled'  { Invoke-UninstallBundled }
    default {
        Write-Output "error: Unknown operation. Usage: discover|install|uninstall|check_paddle|install_bundled|uninstall_bundled [args]"
        exit 1
    }
}
