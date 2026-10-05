import './env';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../src/lib/auth-store';
import { isMissing } from '../src/lib/content-store';
async function hiddenPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('请在交互式终端运行此命令，密码不会回显。');
  process.stdout.write(prompt); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    function finish(error?: Error) {
      process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', input);
      process.stdout.write('\n');
      if (error) reject(error); else resolve(password);
    }
    function input(buffer: Buffer) {
      for (const char of buffer.toString('utf8')) {
        if (char === '\u0003' || char === '\u0004') { finish(new Error('已取消。')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') password = [...password].slice(0, -1).join('');
        else if (char >= ' ') password += char;
      }
    }
    process.stdin.on('data', input);
  });
}
async function main() {
  if (!process.stdin.isTTY) throw new Error('请在交互式终端运行 npm run setup-admin。');
  const interface_ = createInterface({ input: process.stdin, output: process.stdout });
  const username = (await interface_.question('管理员用户名：')).trim();
  interface_.close();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(username)) throw new Error('用户名只能包含字母、数字、点、下划线和连字符。');
  const password = await hiddenPassword('管理员密码（至少 12 个字符，不回显）：');
  const confirmation = await hiddenPassword('再次输入密码：');
  if (password !== confirmation) throw new Error('两次密码不同，请重新运行。');
  const hash = await hashPassword(password), file = path.resolve('.env.local');
  let env = 'DATA_DIR=./data\nAPP_URL=http://localhost:3000\n';
  try { env = await fs.readFile(file, 'utf8'); } catch (error) { if (!isMissing(error)) throw error; }
  for (const [key, value] of Object.entries({ ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: hash })) {
    const line = `${key}=${value}`, pattern = new RegExp(`^(?:export\\s+)?${key}=.*$`, 'gm');
    env = pattern.test(env) ? env.replace(pattern, line) : env.trimEnd() + '\n' + line + '\n';
  }
  // Credentials configure this process; they must stay local even when books use Blob.
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, env, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
  console.log('已将管理员用户名和密码哈希写入 .env.local。请重启服务使配置生效；旧会话会自动失效。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
