import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const summaryPath = path.join(
  projectRoot,
  'coverage',
  'coverage-summary.json',
);
const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
const metrics = ['statements', 'branches', 'functions', 'lines'];

const globalFloor = {
  statements: 38,
  branches: 28,
  functions: 28,
  lines: 39,
};

// These are security/application modules changed during the hardening push.
// Keeping explicit floors here provides a changed-critical-code gate without
// narrowing Jest's global collection surface.
const criticalFloors = {
  'src/app/navigation/notificationNavigation.ts': [98, 98, 100, 100],
  'src/app/startup/OutboxSyncController.tsx': [90, 80, 90, 90],
  'src/features/auth/registrationService.ts': [95, 85, 90, 97],
  'src/features/events/eventService.ts': [88, 68, 100, 93],
  'src/features/events/useEventDetailController.ts': [92, 77, 90, 97],
  'src/features/matching/compatibility.ts': [100, 85, 100, 100],
  'src/features/matching/matchingService.ts': [83, 69, 100, 100],
  'src/features/messages/messageService.ts': [89, 80, 100, 100],
  'src/features/messages/realtimeChannel.ts': [100, 100, 100, 100],
  'src/features/messages/useConversationPresence.ts': [88, 77, 93, 92],
  'src/features/profile/profileService.ts': [90, 71, 100, 97],
  'src/features/rooms/roomRules.ts': [96, 90, 100, 100],
  'src/features/rooms/roomService.ts': [90, 79, 100, 100],
  'src/features/rooms/useRoomRealtime.ts': [94, 94, 78, 95],
  'src/shared/lib/chatOutbox.ts': [97, 97, 96, 98],
  'src/shared/lib/network.ts': [95, 87, 100, 100],
  'src/shared/lib/pushNotifications.ts': [84, 74, 83, 87],
};

const failures = [];

function percentage(entry, metric) {
  const value = entry?.[metric]?.pct;
  return typeof value === 'number' ? value : Number.NaN;
}

function assertFloor(label, entry, floors) {
  metrics.forEach((metric, index) => {
    const floor = Array.isArray(floors) ? floors[index] : floors[metric];
    const actual = percentage(entry, metric);
    if (!Number.isFinite(actual)) {
      failures.push(`${label}: ${metric} coverage bulunamadı.`);
    } else if (actual < floor) {
      failures.push(
        `${label}: ${metric} ${actual.toFixed(2)}%, taban ${floor.toFixed(2)}%.`,
      );
    }
  });
}

assertFloor('global', summary.total, globalFloor);

const criticalEntries = [];
for (const [relativePath, floors] of Object.entries(criticalFloors)) {
  const absolutePath = path.join(projectRoot, relativePath);
  const entry = summary[absolutePath];
  assertFloor(relativePath, entry, floors);
  if (entry) criticalEntries.push(entry);
}

const criticalAggregate = Object.fromEntries(
  metrics.map(metric => {
    const covered = criticalEntries.reduce(
      (sum, entry) => sum + entry[metric].covered,
      0,
    );
    const total = criticalEntries.reduce(
      (sum, entry) => sum + entry[metric].total,
      0,
    );
    return [metric, total === 0 ? 100 : (covered / total) * 100];
  }),
);

if (failures.length > 0) {
  console.error('Coverage ratchet geriledi:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

const globalResult = metrics
  .map(metric => `${metric}=${percentage(summary.total, metric).toFixed(2)}%`)
  .join(', ');
const criticalResult = metrics
  .map(metric => `${metric}=${criticalAggregate[metric].toFixed(2)}%`)
  .join(', ');
console.log(`Coverage ratchet PASS | global: ${globalResult}`);
console.log(`Changed-critical aggregate | ${criticalResult}`);
