# Python 版本发现和依赖管理脚本 — Windows 版本
# 被 Tauri Rust 后端调用
# 用法: ./python_manager.ps1 <command> [args...]
#   discover                    - 发现系统中所有 Python
#   install <python_path>        - 在指定 Python 安装 paddlepaddle+paddleocr
#   uninstall <python_path>      - 从指定 Python 卸载 paddleocr
#   check_paddle <python_path>   - 检查指定 Python 是否有 paddleocr
#   install_bundled              - Windows 不支持，返回提示
#   uninstall_bundled            - 删除内置 Python 目录

param(
    [Parameter(Position=0)]
    [string]$Command,
    [Parameter(Position=1)]
    [string]$Arg1
)

$ErrorActionPreference = 'Continue'

# 内置 Python 路径 (Windows)
$BundledPythonDir = Join-Path $env:LOCALAPPDATA 'accounting-app\python'
$BundledPython = Join-Path $BundledPythonDir 'python.exe'

# --- Helper: Run python and get version string ---
function Get-PythonVersion {
    param([string]$path)
    try {
        $output = & $path --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            return $output.Trim()
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
        if ($version -match 'Python\s+(\d+)\.(\d+)') {
            $minor = [int]$Matches[2]
            return ($minor -ge 8 -and $minor -le 12)
        }
    } catch {}
    return $false
}

function Get-PythonMinor {
    param([string]$version)
    if ($version -match 'Python\s+\d+\.(\d+)') {
        return [int]$Matches[1]
    }
    return 0
}

# --- Helper: Detect Python source ---
function Get-PythonSource {
    param([string]$resolvedPath)
    $p = $resolvedPath.ToLower()
    if ($p -match 'windowsapps') { return 'store' }
    if ($p -match 'programs\\python' -or $p -match 'python\\python') { return 'pythonorg' }
    if ($p -match '\\pyenv\\') { return 'pyenv' }
    if ($p -match '\\uv\\' -or $p -match 'uv\\python') { return 'uv' }
    return 'unknown'
}

# --- Helper: Add unique python candidate ---
$script:SeenPaths = @{}

function Add-UniquePythonCandidate {
    param([string]$path)
    if (-not (Test-Path $path)) { return }
    try {
        $resolved = (Resolve-Path $path).ProviderPath
        if (-not $script:SeenPaths.ContainsKey($resolved)) {
            $script:SeenPaths[$resolved] = $true
            return $path
        }
    } catch {}
    return $null
}

# --- discover: 发现所有 Python ---
function Invoke-Discover {
    $candidates = @()

    # 1. PATH 中的常见命令
    $pathCommands = @('python', 'python3', 'python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3.8')
    foreach ($cmd in $pathCommands) {
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($found -and $found.Source) {
            $path = Add-UniquePythonCandidate $found.Source
            if ($path) { $candidates += $path }
        }
    }

    # 2. py launcher: 列出所有已注册的 Python
    $pyLauncher = Get-Command 'py' -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        try {
            $pyOutput = & py -0p 2>$null
            foreach ($line in $pyOutput) {
                $line = $line.Trim()
                if ($line -match '^.*-\s*(.+)$') {
                    $pyPath = $Matches[1].Trim()
                    $path = Add-UniquePythonCandidate $pyPath
                    if ($path) { $candidates += $path }
                }
            }
        } catch {}
    }

    # 3. 注册表查询 - HKLM (所有用户)
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

    # 4. 注册表查询 - HKCU (当前用户)
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

    # 5. 常见安装路径
    $commonPaths = @()
    if ($env:LOCALAPPDATA) {
        $commonPaths += Join-Path $env:LOCALAPPDATA 'Programs\Python\Python3*\python.exe'
    }
    if ($env:PROGRAMFILES) {
        $commonPaths += Join-Path $env:PROGRAMFILES 'Python3*\python.exe'
    }
    if ($env:PROGRAMFILES -and (Test-Path 'C:\Program Files (x86)')) {
        $commonPaths += 'C:\Program Files (x86)\Python3*\python.exe'
    }
    foreach ($pattern in $commonPaths) {
        try {
            $matches = [System.IO.Directory]::GetFiles(
                [System.IO.Path]::GetDirectoryName($pattern),
                [System.IO.Path]::GetFileName($pattern)
            )
            foreach ($m in $matches) {
                $path = Add-UniquePythonCandidate $m
                if ($path) { $candidates += $path }
            }
        } catch {}
    }

    # 6. PATH 目录遍历（额外 fallback）
    $extraCommands = @('python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3.8')
    foreach ($cmd in $extraCommands) {
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($found -and $found.Source) {
            $path = Add-UniquePythonCandidate $found.Source
            if ($path) { $candidates += $path }
        }
    }

    # 构建 JSON 输出
    $jsonItems = @()
    foreach ($path in $candidates) {
        $version = Get-PythonVersion $path
        if (-not $version) { continue }

        $minor = Get-PythonMinor $version
        $isCompatible = (Test-PythonCompatible $version).ToString().ToLower()
        $hasPaddle = (Test-PaddleOCR $path).ToString().ToLower()
        $source = Get-PythonSource $path

        # Escape path for JSON
        $escapedPath = $path -replace '\\', '\\'
        $jsonItems += @{
            path = $path
            version = $version
            minor_version = $minor
            is_compatible = [bool]($isCompatible -eq 'true')
            has_paddleocr = [bool]($hasPaddle -eq 'true')
            source = $source
        }
    }

    $bundledInstalled = (Test-Path $BundledPython).ToString().ToLower()

    $result = @{
        pythons = $jsonItems
        bundled_python_installed = [bool]($bundledInstalled -eq 'true')
        bundled_python_path = $BundledPython
    }

    return ($result | ConvertTo-Json -Depth 3 -Compress)
}

# --- install: 在指定 Python 上安装 paddleocr ---
function Invoke-Install {
    param([string]$pythonPath)
    if (-not (Test-Path $pythonPath)) {
        Write-Error "Python 可执行文件不存在: $pythonPath"
        return
    }

    $packages = @('paddlepaddle', 'paddleocr')
    foreach ($pkg in $packages) {
        Write-Output ">>> 正在安装 $pkg ..."
        & $pythonPath -m pip install --upgrade $pkg 2>&1 | ForEach-Object { Write-Output $_ }
        if ($LASTEXITCODE -ne 0) {
            Write-Output "✗ 安装 $pkg 失败"
            return
        }
        Write-Output "✓ $pkg 安装完成"
    }
    Write-Output ">>> 全部安装完成！"
}

# --- uninstall: 卸载 paddleocr ---
function Invoke-Uninstall {
    param([string]$pythonPath)
    if (-not (Test-Path $pythonPath)) {
        Write-Error "Python 可执行文件不存在: $pythonPath"
        return
    }

    $packages = @('paddleocr', 'paddlepaddle')
    foreach ($pkg in $packages) {
        Write-Output ">>> 正在卸载 $pkg ..."
        & $pythonPath -m pip uninstall -y $pkg 2>&1 | ForEach-Object { Write-Output $_ }
        Write-Output "✓ $pkg 已卸载"
    }
    Write-Output ">>> 卸载完成"
}

# --- check_paddle: 检查 paddleocr ---
function Invoke-CheckPaddle {
    param([string]$pythonPath)
    if (Test-PaddleOCR $pythonPath) {
        Write-Output "true"
    } else {
        Write-Output "false"
    }
}

# --- install_bundled: Windows 不支持 ---
function Invoke-InstallBundled {
    param([string]$sessionId)
    Write-Output ">>> Windows 平台不支持内置 Python 自动安装"
    Write-Output ">>> 请从 python.org 下载 Python 3.12，或通过 Microsoft Store 安装"
    Write-Output '{"error":"Windows 平台不支持内置 Python 自动安装"}'
    return 1
}

# --- uninstall_bundled: 删除内置 Python 目录 ---
function Invoke-UninstallBundled {
    if (Test-Path $BundledPythonDir) {
        try {
            Remove-Item $BundledPythonDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Output "✓ 内置 Python 已卸载"
        } catch {
            Write-Output "⚠ 卸载内置 Python 时出错: $_"
        }
    }
    Write-Output '{"status":"ok"}'
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
        Write-Error '{"error":"未知操作。用法: discover|install|uninstall|check_paddle|install_bundled|uninstall_bundled [args]"}'
        exit 1
    }
}
