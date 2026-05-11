import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const server = spawn('python3', ['server.py', '18080'], {
  cwd: __dirname + '/server',
  stdio: 'inherit'
});

const vite = spawn('npx', ['vite'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' }
});

const cleanup = (signal) => {
  console.log(`\n正在关闭服务...`);
  server.kill(signal);
  vite.kill(signal);
  setTimeout(() => process.exit(0), 1000);
};

process.on('SIGINT', () => cleanup('SIGTERM'));
process.on('SIGTERM', () => cleanup('SIGTERM'));

server.on('exit', (code) => code && vite.kill());
vite.on('exit', (code) => code && server.kill());
