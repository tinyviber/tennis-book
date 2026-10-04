import fs from 'node:fs/promises';
import path from 'node:path';

// Next.js copies .env and .env.production into standalone output independently
// of tracing excludes. Deployment credentials and runtime data must stay external.
const root = path.resolve('.next/standalone');
let files;
try { files = await fs.readdir(root); }
catch (error) { if (error.code === 'ENOENT') process.exit(0); throw error; }
for (const file of files.filter(name => name.startsWith('.env'))) {
  await fs.rm(path.join(root, file), { force: true });
}
for (const directory of ['data', 'content', 'out', 'public/books', 'src/generated']) {
  await fs.rm(path.join(root, directory), { recursive: true, force: true });
}
console.log('Standalone output contains framework only; runtime data and credentials stay external.');
