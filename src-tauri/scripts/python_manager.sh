#!/bin/bash
# Python 版本发现和依赖管理脚本
# 被 Tauri Rust 后端调用
# 用法: ./python_manager.sh <command> [args...]
#   discover                    - 发现系统中所有 Python
#   install <python_path>        - 在指定 Python 安装 paddlepaddle+paddleocr
#   uninstall <python_path>      - 从指定 Python 卸载 paddleocr
#   check_paddle <python_path>   - 检查指定 Python 是否有 paddleocr

set -euo pipefail

BUNDLED_PYTHON_DIR="$HOME/Library/Application Support/accounting-app/python"
BUNDLED_PYTHON="$BUNDLED_PYTHON_DIR/bin/python3"

# --- install_bundled: 安装内置 Python ---
install_bundled() {
    local session_id="$1"

    # Check brew
    local brew_prefix
    brew_prefix="$(brew --prefix 2>/dev/null)" || {
        echo '{"error":"Homebrew 未安装"}'
        return 1
    }
    local brew_fw="$brew_prefix/opt/python@3.12/Frameworks/Python.framework"

    if [ ! -d "$brew_fw" ]; then
        echo ">>> 正在安装 python@3.12 (通过 Homebrew)..."
        brew install python@3.12 2>&1 || {
            echo '{"error":"安装 python@3.12 失败"}'
            return 1
        }
    fi

    # Clean old installation
    if [ -d "$BUNDLED_PYTHON_DIR" ]; then
        rm -rf "$BUNDLED_PYTHON_DIR"
    fi

    # Create dirs
    mkdir -p "$BUNDLED_PYTHON_DIR/Frameworks"

    # Ditto copy Framework
    echo ">>> 正在复制 Python Framework..."
    ditto "$brew_fw" "$BUNDLED_PYTHON_DIR/Frameworks/Python.framework" 2>&1 || {
        echo '{"error":"复制 Framework 失败"}'
        return 1
    }
    echo "✓ Python Framework 复制完成"

    # Strip signature and re-sign ad-hoc
    local py_bin="$BUNDLED_PYTHON_DIR/Frameworks/Python.framework/Versions/3.12/bin/python3.12"
    if [ -f "$py_bin" ]; then
        echo ">>> 正在处理代码签名..."
        codesign --remove-signature "$py_bin" 2>/dev/null
        codesign -s - "$py_bin" 2>/dev/null && echo "✓ 代码签名处理完成" || echo "⚠ 代码签名处理失败"
    fi

    # Create bin symlink (remove if exists as dir first)
    if [ -d "$BUNDLED_PYTHON_DIR/bin" ]; then
        rm -rf "$BUNDLED_PYTHON_DIR/bin"
    fi
    ln -s "$BUNDLED_PYTHON_DIR/Frameworks/Python.framework/Versions/3.12/bin" "$BUNDLED_PYTHON_DIR/bin"
    ln -s "python3.12" "$BUNDLED_PYTHON_DIR/bin/python3"

    # Verify
    local version
    version=$("$BUNDLED_PYTHON" --version 2>&1) || {
        echo '{"error":"Python 验证失败"}'
        return 1
    }
    echo "✓ 验证成功: $version"
    echo "✓ 内置 Python 安装完成"
}

# --- uninstall_bundled: 卸载内置 Python ---
uninstall_bundled() {
    if [ -d "$BUNDLED_PYTHON_DIR" ]; then
        rm -rf "$BUNDLED_PYTHON_DIR"
        echo "✓ 内置 Python 已卸载"
    fi
    echo "{\"status\":\"ok\"}"
}

# --- discover: 发现所有 Python ---
discover() {
    local candidates=()

    # Homebrew (Apple Silicon)
    for dir in /opt/homebrew/Cellar/python@3.*/; do
        [ -d "$dir" ] || continue
        for ver_dir in "$dir"*/; do
            [ -d "$ver_dir" ] || continue
            for bin in "$ver_dir"bin/python3 "$ver_dir"bin/python3.[0-9]*; do
                [ -f "$bin" ] && [[ "$bin" != *-config* ]] && candidates+=("$bin")
            done
        done
    done

    # Homebrew (Intel)
    for dir in /usr/local/Cellar/python@3.*/; do
        [ -d "$dir" ] || continue
        for ver_dir in "$dir"*/; do
            [ -d "$ver_dir" ] || continue
            for bin in "$ver_dir"bin/python3 "$ver_dir"bin/python3.[0-9]*; do
                [ -f "$bin" ] && [[ "$bin" != *-config* ]] && candidates+=("$bin")
            done
        done
    done

    # Python.org frameworks
    for ver_dir in /Library/Frameworks/Python.framework/Versions/*/; do
        [ -d "$ver_dir" ] || continue
        [ -f "${ver_dir}bin/python3" ] && candidates+=("${ver_dir}bin/python3")
    done

    # pyenv
    if [ -d "$HOME/.pyenv/versions" ]; then
        for ver_dir in "$HOME/.pyenv/versions/"*/; do
            [ -d "$ver_dir" ] || continue
            [ -f "${ver_dir}bin/python" ] && candidates+=("${ver_dir}bin/python")
        done
    fi

    # System Python
    [ -f /usr/bin/python3 ] && candidates+=("/usr/bin/python3")
    [ -f /usr/bin/python ] && candidates+=("/usr/bin/python")

    # Common paths
    local extra_paths=(
        /opt/local/bin/python3.12 /opt/local/bin/python3.11 /opt/local/bin/python3.10
        /opt/local/bin/python3.9 /opt/local/bin/python3.8 /opt/local/bin/python3
        /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3.10
        /opt/homebrew/bin/python3.9 /opt/homebrew/bin/python3
        /usr/local/bin/python3.12 /usr/local/bin/python3.11 /usr/local/bin/python3.10
        /usr/local/bin/python3.9 /usr/local/bin/python3
        /Library/Frameworks/Python.framework/Versions/3.12/bin/python3
        /Library/Frameworks/Python.framework/Versions/3.11/bin/python3
        /Library/Frameworks/Python.framework/Versions/3.10/bin/python3
        /Library/Frameworks/Python.framework/Versions/3.9/bin/python3
        /Library/Frameworks/Python.framework/Versions/3.8/bin/python3
    )
    for p in "${extra_paths[@]}"; do
        [ -f "$p" ] && candidates+=("$p")
    done

    # PATH fallback
    IFS=':' read -ra PATH_DIRS <<< "$PATH"
    for dir in "${PATH_DIRS[@]}"; do
        for name in python3.12 python3.11 python3.10 python3.9 python3.8 python3; do
            [ -f "$dir/$name" ] && candidates+=("$dir/$name")
        done
    done

    # Deduplicate by resolving symlinks, using a temp file
    local tmp_seen
    tmp_seen=$(mktemp)
    local json_items=()

    for path in "${candidates[@]}"; do
        local resolved
        resolved="$(readlink -f "$path" 2>/dev/null || echo "$path")"
        # Check if already seen
        grep -qFx "$resolved" "$tmp_seen" 2>/dev/null && continue
        echo "$resolved" >> "$tmp_seen"

        # Check python version
        local version
        version=$("$path" --version 2>&1) || continue

        local minor
        minor=$(echo "$version" | sed -n 's/Python [0-9]*\.\([0-9]*\).*/\1/p')
        [ -z "$minor" ] && continue

        local is_compatible="false"
        [ "$minor" -ge 8 ] 2>/dev/null && [ "$minor" -le 12 ] 2>/dev/null && is_compatible="true"

        # Check paddleocr
        local has_paddle="false"
        if "$path" -c "import paddleocr" 2>/dev/null; then
            has_paddle="true"
        fi

        # Detect Python source
        local source=""
        if [[ "$resolved" == *"/Library/Developer/CommandLineTools"* ]] || [[ "$resolved" == "/usr/bin/python"* ]]; then
            source="macos"
        elif [[ "$resolved" == *"/.local/share/uv/python"* ]] || [[ "$resolved" == *"/.local/bin/python"* ]]; then
            source="uv"
        elif [[ "$resolved" == *"/opt/homebrew/"* ]]; then
            source="homebrew"
        elif [[ "$resolved" == *"/usr/local/"* ]]; then
            source="homebrew"
        elif [[ "$resolved" == *"/Library/Frameworks/"* ]]; then
            source="pythonorg"
        elif [[ "$resolved" == *"/.pyenv/"* ]]; then
            source="pyenv"
        else
            source="unknown"
        fi

        json_items+=("{\"path\":\"$path\",\"version\":\"$version\",\"minor_version\":$minor,\"is_compatible\":$is_compatible,\"has_paddleocr\":$has_paddle,\"source\":\"$source\"}")
    done

    # Build JSON array
    local json="["
    local first=true
    for item in "${json_items[@]}"; do
        if $first; then first=false; else json+=","; fi
        json+="$item"
    done
    json+="]"

    # Check bundled
    local bundled_installed="false"
    [ -f "$BUNDLED_PYTHON" ] && bundled_installed="true"

    rm -f "$tmp_seen"
    echo "{\"pythons\":$json,\"bundled_python_installed\":$bundled_installed,\"bundled_python_path\":\"$BUNDLED_PYTHON\"}"
}

# --- install: 在指定 Python 上安装 paddleocr ---
install_paddleocr() {
    local python_path="$1"
    local packages=("paddlepaddle" "paddleocr")

    # Check if pip supports --break-system-packages (pip >= 23.0.1 / PEP 668)
    local break_flag=""
    local pip_major
    pip_major=$("$python_path" -m pip --version 2>/dev/null | grep -o 'pip [0-9]*' | head -1 | grep -o '[0-9]*')
    if [ -n "$pip_major" ] && [ "$pip_major" -ge 23 ] 2>/dev/null; then
        break_flag="--break-system-packages"
    fi

    for pkg in "${packages[@]}"; do
        echo ">>> 正在安装 $pkg ..."
        if [ -n "$break_flag" ]; then
            "$python_path" -m pip install --upgrade "$break_flag" "$pkg" 2>&1 || {
                echo "✗ 安装 $pkg 失败"
                return 1
            }
        else
            "$python_path" -m pip install --upgrade "$pkg" 2>&1 || {
                echo "✗ 安装 $pkg 失败"
                return 1
            }
        fi
        echo "✓ $pkg 安装完成"
    done
    echo ">>> 全部安装完成！"
}

# --- uninstall: 卸载 paddleocr ---
uninstall_paddleocr() {
    local python_path="$1"
    local packages=("paddleocr" "paddlepaddle")

    # Check if pip supports --break-system-packages
    local break_flag=""
    local pip_major
    pip_major=$("$python_path" -m pip --version 2>/dev/null | grep -o 'pip [0-9]*' | head -1 | grep -o '[0-9]*')
    if [ -n "$pip_major" ] && [ "$pip_major" -ge 23 ] 2>/dev/null; then
        break_flag="--break-system-packages"
    fi

    for pkg in "${packages[@]}"; do
        echo ">>> 正在卸载 $pkg ..."
        if [ -n "$break_flag" ]; then
            "$python_path" -m pip uninstall -y "$break_flag" "$pkg" 2>&1 || {
                echo "⚠ 卸载 $pkg 可能不完整"
            }
        else
            "$python_path" -m pip uninstall -y "$pkg" 2>&1 || {
                echo "⚠ 卸载 $pkg 可能不完整"
            }
        fi
        echo "✓ $pkg 已卸载"
    done
    echo ">>> 卸载完成"
}

# --- check_paddle: 检查 paddleocr ---
check_paddle() {
    local python_path="$1"
    if "$python_path" -c "import paddleocr" 2>/dev/null; then
        echo "true"
    else
        echo "false"
    fi
}

# Main
case "${1:-}" in
    discover)
        discover
        ;;
    install)
        shift
        install_paddleocr "$1"
        ;;
    uninstall)
        shift
        uninstall_paddleocr "$1"
        ;;
    check_paddle)
        shift
        check_paddle "$1"
        ;;
    install_bundled)
        shift
        install_bundled "${1:-}"
        ;;
    uninstall_bundled)
        uninstall_bundled
        ;;
    *)
        echo '{"error":"未知操作。用法: discover|install|uninstall|check_paddle [python_path]"}' >&2
        exit 1
        ;;
esac
