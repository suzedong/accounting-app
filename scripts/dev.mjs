import { spawn, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = dirname(scriptsDir);
const isWin = platform() === 'win32';
const pythonCmd = isWin ? 'python' : 'python3';

const server = spawn(pythonCmd, ['server.py', '18080'], {
  cwd: join(projectRoot, 'server'),
  stdio: 'inherit'
});

const vite = spawn(isWin ? 'cmd.exe' : 'npx', isWin ? ['/c', 'npx vite'] : ['vite'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' }
});

const cleanup = () => {
  console.log('\n正在关闭服务...');
  if (isWin) {
    try { execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: 'ignore' }); } catch {}
    try { execSync(`taskkill /PID ${vite.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  } else {
    server.kill('SIGTERM');
    vite.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 1000);
};

process.on('SIGINT', () => cleanup());
if (!isWin) {
  process.on('SIGTERM', () => cleanup());
}

server.on('exit', (code) => code && cleanup());
vite.on('exit', (code) => code && cleanup());
