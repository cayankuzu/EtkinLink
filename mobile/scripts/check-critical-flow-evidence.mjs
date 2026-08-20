import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const flows = JSON.parse(
  readFileSync(resolve(root, 'config/critical-flows.json'), 'utf8'),
);
const failures = flows.flatMap(flow => {
  if (!flow.id || !Array.isArray(flow.evidence) || flow.evidence.length === 0) {
    return [`${flow.id || 'isimsiz'} akışının kanıt listesi eksik.`];
  }
  return flow.evidence.flatMap(path =>
    existsSync(resolve(root, path)) ? [] : [`${flow.id}: ${path} bulunamadı.`],
  );
});
if (failures.length) {
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(
  `${flows.length} kritik akışın kanıt referansları bulundu; davranış doğrulaması test ve cihaz kapılarında yapılır.`,
);
