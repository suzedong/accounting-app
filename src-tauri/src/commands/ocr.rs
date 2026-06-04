use std::process::{Command, Stdio};
use tokio::process::Command as TokioCommand;
use tauri::{State, AppHandle, Emitter, Manager};
use serde::Serialize;

use crate::commands::config::AppConfig;
use crate::db::Database;

// --- Data Structures ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPython {
    pub path: String,
    pub version: String,
    pub minor_version: u8,
    pub is_compatible: bool,
    pub has_paddleocr: bool,
    pub source: String,
    pub is_usable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivePython {
    pub path: String,
    pub version: String,
    pub is_bundled: bool,
    pub has_paddleocr: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paddleocr_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paddlepaddle_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    pub available: bool,
    pub enabled: bool,
    pub active_python: Option<ActivePython>,
    pub system_pythons: Vec<SystemPython>,
    pub bundled_python_installed: bool,
    pub message: String,
}

// --- Intermediate structs for shell script JSON parsing ---

#[derive(serde::Deserialize)]
struct ShellPythonInfo {
    path: String,
    version: String,
    minor_version: u8,
    is_compatible: bool,
    has_paddleocr: bool,
    source: String,
    #[serde(default)]
    is_usable: bool,
}

#[derive(serde::Deserialize)]
struct ShellDiscoverResult {
    pythons: Vec<ShellPythonInfo>,
    #[allow(dead_code)]
    bundled_python_installed: bool,
    #[allow(dead_code)]
    bundled_python_path: String,
}

// --- Log emit ---

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallLog {
    session_id: String,
    text: String,
}

fn emit_line(app: &AppHandle, session_id: &str, text: &str) {
    debug_log(&format!("[emit] session={}, text={}", session_id, text));
    let _ = app.emit("ocr_install_log", InstallLog {
        session_id: session_id.to_string(),
        text: text.to_string(),
    });
}

// --- Shell script invocation ---

fn get_script_path() -> std::path::PathBuf {
    let candidates = if cfg!(windows) {
        [
            "scripts/python_manager.ps1",
            "../scripts/python_manager.ps1",
            "../../scripts/python_manager.ps1",
            "resources/scripts/python_manager.ps1",
        ]
    } else {
        [
            "scripts/python_manager.sh",
            "../scripts/python_manager.sh",
            "../../scripts/python_manager.sh",
            "resources/scripts/python_manager.sh",
        ]
    };
    for path in &candidates {
        let p = std::path::Path::new(path);
        if p.exists() {
            return p.to_path_buf();
        }
    }
    if cfg!(windows) {
        std::path::PathBuf::from("scripts/python_manager.ps1")
    } else {
        std::path::PathBuf::from("scripts/python_manager.sh")
    }
}

/// Windows 下选择 PowerShell 解释器：优先 pwsh (PS7)，回退 powershell (PS5)
fn get_powershell_interpreter() -> &'static str {
    if cfg!(windows) {
        // Try pwsh (PowerShell 7) first — handles UTF-8/Chinese correctly
        let test = Command::new("pwsh").arg("-Command").arg("$true").output();
        if test.map(|o| o.status.success()).unwrap_or(false) {
            return "pwsh";
        }
    }
    "powershell"
}

fn run_script(args: &[&str]) -> Result<String, String> {
    let script = get_script_path();

    let (interpreter, script_flag) = if cfg!(windows) {
        (get_powershell_interpreter(), "-File")
    } else {
        ("bash", "")
    };

    let mut cmd = Command::new(interpreter);
    if !script_flag.is_empty() {
        cmd.arg(script_flag);
    }
    cmd.arg(&script).args(args);

    debug_log(&format!("[script] running: {} {} {:?}", interpreter, script.display(), args));
    let output = cmd
        .output()
        .map_err(|e| format!("启动脚本失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(stderr.lines().last().unwrap_or("脚本执行失败").to_string());
    }
    Ok(stdout)
}

/// 获取应用数据目录中内置 Python 的路径
fn get_bundled_python_path() -> std::path::PathBuf {
    let app_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("accounting-app")
        .join("python");
    if cfg!(windows) {
        app_dir.join("python.exe")
    } else {
        app_dir.join("bin").join("python3")
    }
}

/// 判断 Python 是否兼容 PaddleOCR (3.8-3.12)
fn is_python_compatible(minor: u8) -> bool {
    (8..=12).contains(&minor)
}

/// 检查指定 Python 是否安装了某个模块
fn check_module(python: &str, module: &str) -> Option<bool> {
    let output = Command::new(python)
        .arg("-c")
        .arg(format!("import {}; print('ok')", module))
        .output()
        .ok()?;
    Some(output.status.success())
}

/// 获取已安装模块的版本号
fn get_module_version(python: &str, module: &str) -> Option<String> {
    let output = Command::new(python)
        .arg("-c")
        .arg(format!("import {}; print({}.__version__)", module, module))
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

// --- PythonInfo for internal use (with is_bundled) ---

#[derive(Debug, Clone)]
struct PythonInfo {
    path: String,
    version: String,
    minor_version: u8,
    has_paddleocr: bool,
    is_bundled: bool,
    paddleocr_version: Option<String>,
    paddlepaddle_version: Option<String>,
}

fn parse_minor(version: &str) -> Option<u8> {
    let parts: Vec<&str> = version.split_whitespace().collect();
    let ver = parts.last()?;
    let dots: Vec<&str> = ver.split('.').collect();
    if dots.len() >= 2 {
        dots[1].parse::<u8>().ok()
    } else {
        None
    }
}

fn try_python_cmd(cmd: &str) -> Option<PythonInfo> {
    let version_output = Command::new(cmd)
        .arg("--version")
        .output()
        .ok()?;
    if !version_output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&version_output.stdout).trim().to_string();
    let version = if version.is_empty() {
        String::from_utf8_lossy(&version_output.stderr).trim().to_string()
    } else {
        version
    };
    if version.is_empty() {
        return None;
    }
    let minor_version = parse_minor(&version).unwrap_or(0);
    let has_paddleocr = check_module(cmd, "paddleocr").unwrap_or(false);
    
    // Get detailed info only if paddleocr is installed
    let (paddleocr_version, paddlepaddle_version) = if has_paddleocr {
        (
            get_module_version(cmd, "paddleocr"),
            get_module_version(cmd, "paddle"),
        )
    } else {
        (None, None)
    };
    
    Some(PythonInfo {
        path: cmd.to_string(),
        version,
        minor_version,
        has_paddleocr,
        is_bundled: false,
        paddleocr_version,
        paddlepaddle_version,
    })
}

fn build_active_python(info: &PythonInfo) -> ActivePython {
    ActivePython {
        path: info.path.clone(),
        version: info.version.clone(),
        is_bundled: info.is_bundled,
        has_paddleocr: info.has_paddleocr,
        paddleocr_version: info.paddleocr_version.clone(),
        paddlepaddle_version: info.paddlepaddle_version.clone(),
    }
}

// --- System Python Discovery (via shell script) ---

fn discover_system_pythons() -> Vec<SystemPython> {
    match run_script(&["discover"]) {
        Ok(json) => {
            debug_log(&format!("[discover] raw output: {}", json));
            match serde_json::from_str::<ShellDiscoverResult>(&json) {
                Ok(result) => {
                    result.pythons
                        .into_iter()
                        .map(|p| SystemPython {
                            path: p.path,
                            version: p.version,
                            minor_version: p.minor_version,
                            is_compatible: p.is_compatible,
                            has_paddleocr: p.has_paddleocr,
                            source: p.source,
                            is_usable: p.is_usable,
                        })
                        .collect()
                }
                Err(e) => {
                    debug_log(&format!("[discover] JSON parse error: {}", e));
                    Vec::new()
                }
            }
        }
        Err(e) => {
            debug_log(&format!("[discover] script error: {}", e));
            Vec::new()
        }
    }
}

/// 合并内置 + 系统 Python 列表
fn discover_all_pythons(bundled_installed: bool) -> Vec<SystemPython> {
    let mut all: Vec<SystemPython> = Vec::new();

    // Add bundled Python first
    if bundled_installed {
        let bundled_path = get_bundled_python_path();
        if let Some(path_str) = bundled_path.to_str() {
            if let Some(info) = try_python_cmd(path_str) {
                all.push(SystemPython {
                    path: info.path,
                    version: info.version,
                    minor_version: info.minor_version,
                    is_compatible: is_python_compatible(info.minor_version),
                    has_paddleocr: info.has_paddleocr,
                    source: "bundled".to_string(),
                    is_usable: true,
                });
            }
        }
    }

    // Add system Pythons, deduplicate against bundled
    let system = discover_system_pythons();
    let bundled_path_str = get_bundled_python_path()
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .ok();

    for sys_python in system {
        // Skip if same resolved path as bundled
        let sys_resolved = std::path::Path::new(&sys_python.path)
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| sys_python.path.clone());
        if let Some(ref bundled) = bundled_path_str {
            if sys_resolved == *bundled {
                continue;
            }
        }
        all.push(sys_python);
    }

    all
}

// --- Config helpers ---

fn get_active_python_path(app_config: &State<'_, AppConfig>) -> Option<String> {
    let config_guard = app_config.data.lock().ok()?;
    config_guard.get("active_python_path").cloned()
}

fn set_active_python_path(app_config: &State<'_, AppConfig>, db: &State<'_, Database>, path: &str) -> Result<(), String> {
    {
        let conn = db.get_conn();
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        conn_guard
            .execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                ("active_python_path", path),
            )
            .map_err(|e| e.to_string())?;
    }
    {
        let mut config_guard = app_config.data.lock().map_err(|e| e.to_string())?;
        config_guard.insert("active_python_path".to_string(), path.to_string());
    }
    Ok(())
}

/// Try to set the bundled Python as active (if no active Python configured yet).
/// Best-effort — callers ignore errors.
/// Try to set the bundled Python as active. Best-effort — callers ignore errors.
fn try_set_active_python(app: &AppHandle, session_id: &str) -> Result<(), String> {
    let app_config: State<'_, AppConfig> = app.state::<AppConfig>();
    let db: State<'_, Database> = app.state::<Database>();

    let bundled_path = get_bundled_python_path();
    if bundled_path.exists() {
        if let Some(path_str) = bundled_path.to_str() {
            set_active_python_path(&app_config, &db, path_str)?;
            emit_line(app, session_id, ">>> 已自动设置为当前使用的 Python");
        }
    }
    Ok(())
}

// --- Status: Fast (no script) + Background Discover ---

/// Fast status: reads SQLite config + probes active Python only.
/// Does NOT run the discover script — returns immediately.
#[tauri::command]
pub fn check_ocr_status_fast(app_config: State<'_, AppConfig>) -> Result<OcrStatus, String> {
    let enabled = {
        let config_guard = app_config.data.lock().map_err(|e| e.to_string())?;
        config_guard.get("ocr_enabled")
            .map(|v| v == "true")
            .unwrap_or(true)
    };

    let bundled_installed = get_bundled_python_path().exists();

    if !enabled {
        return Ok(OcrStatus {
            available: false,
            enabled: false,
            active_python: None,
            system_pythons: Vec::new(),
            bundled_python_installed: bundled_installed,
            message: "OCR 已禁用".to_string(),
        });
    }

    let active_python_path = get_active_python_path(&app_config);
    let active_info = match &active_python_path {
        Some(path) => {
            if std::path::Path::new(path).exists() {
                try_python_cmd(path).map(|mut info| {
                    let bundled_path = get_bundled_python_path();
                    let resolved = std::path::Path::new(path).canonicalize()
                        .unwrap_or_else(|_| std::path::PathBuf::from(path));
                    let bundled_resolved = bundled_path.canonicalize()
                        .unwrap_or_else(|_| bundled_path.clone());
                    if resolved == bundled_resolved {
                        info.is_bundled = true;
                    }
                    info
                })
            } else {
                None
            }
        }
        None => None,
    };

    let (active_info, message) = if let Some(info) = &active_info {
        let msg = if info.has_paddleocr {
            if info.is_bundled {
                "内置 Python + PaddleOCR 已就绪".to_string()
            } else {
                "PaddleOCR 已就绪".to_string()
            }
        } else if info.is_bundled {
            "内置 Python 已安装，需要安装 PaddleOCR 依赖".to_string()
        } else {
            format!("Python 已安装 ({}), 需要安装 paddleocr 依赖", info.version)
        };
        (Some(info.clone()), msg)
    } else {
        (None, "未设置 Python，正在扫描系统 Python...".to_string())
    };

    let available = active_info.as_ref().map(|i| i.has_paddleocr).unwrap_or(false);
    let active_python = active_info.map(|i| build_active_python(&i));

    Ok(OcrStatus {
        available,
        enabled: true,
        active_python,
        system_pythons: Vec::new(), // Will be populated by background discover
        bundled_python_installed: bundled_installed,
        message,
    })
}

/// Event payload for background discover result.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResult {
    pub system_pythons: Vec<SystemPython>,
}

/// Start background discover — emits `ocr_discover_result` event when done.
/// Returns immediately so the UI is not blocked.
/// Uses std::thread because this is called from a sync command (no Tokio context).
#[tauri::command]
pub fn start_ocr_discover(app: AppHandle) {
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let bundled_installed = get_bundled_python_path().exists();
        let pythons = discover_all_pythons(bundled_installed);
        let _ = app_clone.emit("ocr_discover_result", DiscoverResult {
            system_pythons: pythons,
        });
    });
}

/// Legacy: synchronous check_ocr_status (kept for compatibility).
/// New callers should use check_ocr_status_fast + start_ocr_discover.
#[tauri::command]
pub fn check_ocr_status(app_config: State<'_, AppConfig>) -> Result<OcrStatus, String> {
    let fast = check_ocr_status_fast(app_config)?;
    // If caller needs system_pythons, they should call start_ocr_discover separately.
    // For legacy compatibility, we return fast result (system_pythons empty).
    Ok(fast)
}

// --- Python Selection ---

#[tauri::command]
pub fn select_python(app_config: State<'_, AppConfig>, db: State<'_, Database>, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("Python 路径不存在: {}", path));
    }
    if let Some(info) = try_python_cmd(&path) {
        if !is_python_compatible(info.minor_version) {
            return Err(format!("Python {} 不兼容 PaddleOCR (需要 3.8-3.12)", info.version));
        }
    } else {
        return Err(format!("无效的 Python 可执行文件: {}", path));
    }
    set_active_python_path(&app_config, &db, &path)
}

// --- Per-Python Dependency Management (via shell script) ---

fn spawn_stream_readers(
    app: &AppHandle,
    session_id: &str,
    child: &mut tokio::process::Child,
    last_output_ts: std::sync::Arc<std::sync::atomic::AtomicU64>,
) {
    if let Some(stdout) = child.stdout.take() {
        let app_ref = app.clone();
        let sid = session_id.to_string();
        let ts = last_output_ts.clone();
        tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stdout);
            use tokio::io::AsyncBufReadExt;
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_line(&app_ref, &sid, &line);
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                ts.store(now, std::sync::atomic::Ordering::Relaxed);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_ref = app.clone();
        let sid = session_id.to_string();
        let ts = last_output_ts;
        tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stderr);
            use tokio::io::AsyncBufReadExt;
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_line(&app_ref, &sid, &line);
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                ts.store(now, std::sync::atomic::Ordering::Relaxed);
            }
        });
    }
}

#[tauri::command]
pub async fn install_paddleocr_for_python(
    app: AppHandle,
    app_config: State<'_, AppConfig>,
    db: State<'_, Database>,
    python_path: String,
    session_id: String,
) -> Result<String, String> {
    // Quick check if already installed
    match run_script(&["check_paddle", &python_path]) {
        Ok(out) if out.trim() == "true" => {
            emit_line(&app, &session_id, "PaddleOCR 已安装，无需重复安装");
            return Ok("PaddleOCR 已安装".to_string());
        }
        _ => {}
    }

    emit_line(&app, &session_id, ">>> 正在安装 PaddleOCR 依赖...");

    let script = get_script_path();
    let (interpreter, script_flag) = if cfg!(windows) {
        (get_powershell_interpreter(), "-File")
    } else {
        ("bash", "")
    };

    let mut child_cmd = TokioCommand::new(interpreter);
    child_cmd.env("PYTHONUNBUFFERED", "1");
    child_cmd.env("PIP_PROGRESS_BAR", "on");
    if !script_flag.is_empty() {
        child_cmd.arg(script_flag);
    }
    child_cmd
        .arg(&script)
        .args(["install", &python_path])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = child_cmd
        .spawn()
        .map_err(|e| format!("启动安装脚本失败: {}", e))?;

    // Shared heartbeat: stream readers update this timestamp on each line
    let last_output_ts = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    ));

    spawn_stream_readers(&app, &session_id, &mut child, last_output_ts.clone());

    // Heartbeat: emit progress message every 5 seconds if no recent output
    let heartbeat_sid = session_id.clone();
    let heartbeat_app = app.clone();
    let heartbeat_ts = last_output_ts.clone();
    let heartbeat = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            let last = heartbeat_ts.load(std::sync::atomic::Ordering::Relaxed);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            if now - last > 5000 {
                emit_line(&heartbeat_app, &heartbeat_sid, "  ⏳ 正在下载依赖包，请稍候...");
                heartbeat_ts.store(now, std::sync::atomic::Ordering::Relaxed);
            }
        }
    });

    let status = child.wait().await
        .map_err(|e| format!("等待安装完成失败: {}", e))?;

    heartbeat.abort();
    let _ = heartbeat.await;

    if !status.success() {
        emit_line(&app, &session_id, "✗ 安装失败");
        return Err("安装 PaddleOCR 失败".to_string());
    }

    let _ = set_active_python_path(&app_config, &db, &python_path);
    emit_line(&app, &session_id, ">>> 全部安装完成！");
    Ok("安装完成".to_string())
}

#[tauri::command]
pub async fn uninstall_paddleocr_for_python(
    app: AppHandle,
    python_path: String,
    session_id: String,
) -> Result<String, String> {
    let script = get_script_path();
    let (interpreter, script_flag) = if cfg!(windows) {
        (get_powershell_interpreter(), "-File")
    } else {
        ("bash", "")
    };

    let mut child_cmd = TokioCommand::new(interpreter);
    if !script_flag.is_empty() {
        child_cmd.arg(script_flag);
    }
    child_cmd
        .arg(&script)
        .args(["uninstall", &python_path])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = child_cmd
        .spawn()
        .map_err(|e| format!("启动卸载脚本失败: {}", e))?;

    spawn_stream_readers(&app, &session_id, &mut child, Default::default());

    let status = child.wait().await
        .map_err(|e| format!("等待卸载完成失败: {}", e))?;

    if !status.success() {
        emit_line(&app, &session_id, "✗ 卸载失败");
        return Err("卸载 PaddleOCR 失败".to_string());
    }

    Ok("卸载完成".to_string())
}

#[tauri::command]
pub async fn reinstall_paddleocr_for_python(
    app: AppHandle,
    app_config: State<'_, AppConfig>,
    db: State<'_, Database>,
    python_path: String,
    session_id: String,
) -> Result<String, String> {
    let _ = uninstall_paddleocr_for_python(app.clone(), python_path.clone(), session_id.clone()).await;
    // install_paddleocr_for_python 会输出 ">>> 正在安装 PaddleOCR 依赖..."，不再重复
    install_paddleocr_for_python(app, app_config, db, python_path, session_id).await
}

// --- Built-in Python Commands ---

#[tauri::command]
pub async fn reinstall_bundled_python(
    app: AppHandle,
    session_id: String,
) -> Result<String, String> {
    emit_line(&app, &session_id, ">>> 正在重新安装内置 Python...");
    let python_dir = get_bundled_python_path();
    if python_dir.exists() {
        emit_line(&app, &session_id, ">>> 正在删除旧版本...");
        std::fs::remove_dir_all(&python_dir)
            .map_err(|e| format!("清理旧版本失败: {}", e))?;
    }
    install_bundled_python(app.clone(), session_id).await
}

#[tauri::command]
pub async fn install_bundled_python(
    app: AppHandle,
    session_id: String,
) -> Result<String, String> {
    emit_line(&app, &session_id, ">>> 正在安装内置 Python 3.12...");

    let script = get_script_path();
    let (interpreter, script_flag) = if cfg!(windows) {
        (get_powershell_interpreter(), "-File")
    } else {
        ("bash", "")
    };

    let mut child_cmd = TokioCommand::new(interpreter);
    if !script_flag.is_empty() {
        child_cmd.arg(script_flag);
    }
    child_cmd
        .arg(&script)
        .args(["install_bundled", &session_id])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = child_cmd
        .spawn()
        .map_err(|e| format!("启动安装脚本失败: {}", e))?;

    let last_output_ts = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    ));

    spawn_stream_readers(&app, &session_id, &mut child, last_output_ts.clone());

    let heartbeat_sid = session_id.clone();
    let heartbeat_app = app.clone();
    let heartbeat_ts = last_output_ts.clone();
    let heartbeat = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            let last = heartbeat_ts.load(std::sync::atomic::Ordering::Relaxed);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            if now - last > 5000 {
                emit_line(&heartbeat_app, &heartbeat_sid, "  ⏳ 正在下载依赖包，请稍候...");
                heartbeat_ts.store(now, std::sync::atomic::Ordering::Relaxed);
            }
        }
    });

    let status = child.wait().await
        .map_err(|e| format!("等待安装完成失败: {}", e))?;
    heartbeat.abort();
    let _ = heartbeat.await;

    if !status.success() {
        emit_line(&app, &session_id, "✗ 安装失败");
        return Err("安装内置 Python 失败".to_string());
    }

    // Auto-set as active Python
    let _ = try_set_active_python(&app, &session_id);

    Ok("安装完成".to_string())
}

#[tauri::command]
pub async fn uninstall_bundled_python() -> Result<String, String> {
    let result = run_script(&["uninstall_bundled"])?;
    if result.contains("error") {
        Err("卸载内置 Python 失败".to_string())
    } else {
        Ok("内置 Python 已卸载".to_string())
    }
}

// --- Legacy compatibility ---

fn detect_python() -> Option<PythonInfo> {
    let bundled_path = get_bundled_python_path();
    if bundled_path.exists() {
        let resolved = bundled_path.canonicalize().unwrap_or(bundled_path.clone());
        let path_str = resolved.to_string_lossy().to_string();
        if let Some(info) = try_python_cmd(&path_str) {
            return Some(PythonInfo { is_bundled: true, ..info });
        }
    }
    let candidates = if cfg!(windows) {
        vec!["py", "python", "python3", "python3.11", "python3.12"]
    } else if cfg!(target_os = "macos") {
        vec!["python3", "python", "/usr/bin/python3", "/opt/homebrew/bin/python3"]
    } else {
        vec!["python3", "python", "/usr/bin/python3"]
    };
    for cmd in &candidates {
        if let Some(info) = try_python_cmd(cmd) {
            return Some(PythonInfo { is_bundled: false, ..info });
        }
    }
    None
}

#[tauri::command]
pub async fn install_ocr_dependencies(
    app: AppHandle,
    session_id: String,
) -> Result<String, String> {
    let python_info = detect_python().ok_or("未找到 Python，请先安装 Python")?;
    if python_info.has_paddleocr {
        emit_line(&app, &session_id, "PaddleOCR 已安装，无需重复安装");
        return Ok("PaddleOCR 已安装".to_string());
    }
    let python = &python_info.path;
    let is_bundled = python_info.is_bundled;
    let packages = ["paddlepaddle", "paddleocr"];
    for pkg in &packages {
        emit_line(&app, &session_id, &format!(">>> 检查 {} 是否已安装...", pkg));
        if check_module(python, pkg.split('-').next().unwrap()).unwrap_or(false) {
            emit_line(&app, &session_id, &format!("{} 已安装，跳过", pkg));
            continue;
        }
        emit_line(&app, &session_id, &format!(">>> 正在安装 {}...", pkg));
        let mut args = vec!["-m", "pip", "install", "--upgrade"];
        // Windows 不需要 --break-system-packages
        if !cfg!(windows) && !is_bundled {
            args.push("--break-system-packages");
        }
        args.push(pkg);
        let mut child = TokioCommand::new(python)
            .env("PYTHONUNBUFFERED", "1")
            .env("PIP_PROGRESS_BAR", "on")
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("pip 启动失败: {}", e))?;

        let last_output_ts = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        ));
        spawn_stream_readers(&app, &session_id, &mut child, last_output_ts.clone());

        let heartbeat_sid = session_id.clone();
        let heartbeat_app = app.clone();
        let heartbeat_ts = last_output_ts.clone();
        let heartbeat = tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                let last = heartbeat_ts.load(std::sync::atomic::Ordering::Relaxed);
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                if now - last > 5000 {
                    emit_line(&heartbeat_app, &heartbeat_sid, "  ⏳ 正在下载依赖包，请稍候...");
                    heartbeat_ts.store(now, std::sync::atomic::Ordering::Relaxed);
                }
            }
        });

        let status = child.wait().await
            .map_err(|e| format!("等待进程失败: {}", e))?;
        heartbeat.abort();
        let _ = heartbeat.await;
        if !status.success() {
            emit_line(&app, &session_id, &format!("✗ 安装 {} 失败", pkg));
            return Err(format!("安装 {} 失败", pkg));
        }
        emit_line(&app, &session_id, &format!("✓ {} 安装完成", pkg));
    }
    emit_line(&app, &session_id, ">>> 全部安装完成！");
    Ok("安装完成".to_string())
}

// --- OCR Recognition ---

#[tauri::command]
pub async fn ocr_recognize(
    app_config: State<'_, AppConfig>,
    image_base64: String,
) -> Result<String, String> {
    {
        let config_guard = app_config.data.lock().map_err(|e| e.to_string())?;
        if config_guard.get("ocr_enabled").map(|v| v != "true").unwrap_or(false) {
            return Err("OCR 识别已关闭".to_string());
        }
    }
    let python_path = get_active_python_path(&app_config)
        .ok_or("未设置 Python，请前往设置页选择")?;
    let info = try_python_cmd(&python_path)
        .ok_or(format!("Python 不可用: {}", python_path))?;
    if !info.has_paddleocr {
        return Err("PaddleOCR 未安装，请在设置中安装依赖".to_string());
    }
    let clean_base64 = if image_base64.contains(',') {
        image_base64.split(',').last().unwrap_or(&image_base64).to_string()
    } else {
        image_base64
    };
    let script_dir = find_script_dir()
        .ok_or("找不到 scripts/ocr_service.py，请确保项目结构正确")?;
    call_paddle_ocr(&info.path, &script_dir, &clean_base64).await
}

async fn call_paddle_ocr(python: &str, script_dir: &std::path::Path, base64_str: &str) -> Result<String, String> {
    use std::time::Duration;
    use tokio::time::timeout;

    // region debug-point ocr-env-check
    debug_log(&format!("[ocr-debug] Python 路径: {}", python));
    debug_log(&format!("[ocr-debug] Script 目录: {}", script_dir.display()));
    debug_log(&format!("[ocr-debug] Base64 长度: {} 字符", base64_str.len()));
    // endregion

    let tmp_dir = std::env::temp_dir();
    let b64_path = tmp_dir.join(format!("ocr_b64_{}.txt", uuid::Uuid::new_v4()));
    std::fs::write(&b64_path, base64_str)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    
    // region debug-point ocr-gpu-env
    // 检测 GPU 环境变量
    let cuda_visible = std::env::var("CUDA_VISIBLE_DEVICES").unwrap_or_else(|_| "未设置".to_string());
    let cuda_home = std::env::var("CUDA_HOME").unwrap_or_else(|_| "未设置".to_string());
    debug_log(&format!("[ocr-debug] CUDA_VISIBLE_DEVICES: {}", cuda_visible));
    debug_log(&format!("[ocr-debug] CUDA_HOME: {}", cuda_home));
    // endregion
    
    let wrapper = format!(
        r#"
import sys, os
sys.path.insert(0, r'{script_dir}')

# region debug-point ocr-python-runtime
import paddle
print(f"[OCR-DEBUG] PaddlePaddle 版本: {{paddle.__version__}}", file=sys.stderr)
print(f"[OCR-DEBUG] CUDA 编译: {{paddle.is_compiled_with_cuda()}}", file=sys.stderr)
print(f"[OCR-DEBUG] CUDA 可用: {{paddle.device.is_compiled_with_cuda()}}", file=sys.stderr)
try:
    print(f"[OCR-DEBUG] CUDA 设备数: {{paddle.device.cuda.device_count()}}", file=sys.stderr)
    print(f"[OCR-DEBUG] 当前设备: {{paddle.device.cuda.current_device()}}", file=sys.stderr)
except Exception as e:
    print(f"[OCR-DEBUG] 获取 CUDA 设备信息失败: {{e}}", file=sys.stderr)
# endregion

from ocr_service import recognize_image
with open(r'{b64_path}', 'r', encoding='utf-8') as f:
    b64 = f.read()
result = recognize_image(b64)
print(result['text'])
"#,
        script_dir = script_dir.display(),
        b64_path = b64_path.display(),
    );

    // 克隆字符串以满足 'static 生命周期要求
    let python_clone = python.to_string();
    let b64_path_clone = b64_path.clone();

    debug_log(&format!("[ocr-debug] 开始执行 Python OCR 脚本..."));

    // 使用异步超时执行，避免 Python 进程卡住导致应用崩溃
    let output = timeout(
        Duration::from_secs(60),  // 60 秒超时
        tokio::task::spawn_blocking(move || {
            Command::new(&python_clone)
                .arg("-c")
                .arg(&wrapper)
                .env("PYTHONIOENCODING", "utf-8")
                .env("CUDA_LAUNCH_BLOCKING", "1")  // 同步 CUDA 操作以便捕获错误
                .output()
        })
    ).await
    .map_err(|e| format!("OCR 识别超时: {}", e))?
    .map_err(|e| format!("执行任务失败: {}", e))?
    .map_err(|e| format!("启动 Python 失败: {}", e))?;

    // 确保清理临时文件
    let _ = std::fs::remove_file(&b64_path_clone);

    // region debug-point ocr-result
    debug_log(&format!("[ocr-debug] Python 进程退出码: {}", output.status.code().unwrap_or(-1)));
    debug_log(&format!("[ocr-debug] Stdout 长度: {}", output.stdout.len()));
    debug_log(&format!("[ocr-debug] Stderr 长度: {}", output.stderr.len()));
    // endregion

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            Ok("未识别到文字".to_string())
        } else {
            Ok(text)
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        debug_log(&format!("[ocr] python error: {}", stderr));
        Err(format!("OCR 识别失败: {}", stderr.lines().last().unwrap_or(&stderr)))
    }
}

#[tauri::command]
pub async fn set_ocr_enabled(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
    enabled: bool,
) -> Result<(), String> {
    let val = if enabled { "true" } else { "false" };
    {
        let conn = state.get_conn();
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        conn_guard
            .execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                ("ocr_enabled", val),
            )
            .map_err(|e| e.to_string())?;
    }
    {
        let mut config_guard = app_config.data.lock().map_err(|e| e.to_string())?;
        config_guard.insert("ocr_enabled".to_string(), val.to_string());
    }
    Ok(())
}

// --- Helpers ---

fn find_script_dir() -> Option<std::path::PathBuf> {
    let candidates = [
        "scripts/ocr_service.py",
        "../scripts/ocr_service.py",
        "../../scripts/ocr_service.py",
        "resources/scripts/ocr_service.py",
    ];
    for path in &candidates {
        let p = std::path::Path::new(path);
        if p.exists() {
            return p.parent().map(|p| p.to_path_buf());
        }
    }
    None
}

fn debug_log(msg: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("ocr_debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", msg);
    }
}
