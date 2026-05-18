import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir  = join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const destDir = join(__dirname, '..', 'public');

try {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const wasmFiles = readdirSync(srcDir).filter(f => f.endsWith('.wasm'));
  if (wasmFiles.length === 0) {
    console.warn('No WASM files found in', srcDir);
  } else {
    wasmFiles.forEach(file => {
      copyFileSync(join(srcDir, file), join(destDir, file));
    });
    console.log('ONNX WASM files copied to public/:', wasmFiles.join(', '));
  }
} catch (err) {
  console.warn('Could not copy WASM files (will skip):', err.message);
}
