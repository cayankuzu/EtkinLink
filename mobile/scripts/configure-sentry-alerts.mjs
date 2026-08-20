const required = [
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_ALERT_TARGET_TYPE',
  'SENTRY_ALERT_TARGET_ID',
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} eksik.`);
}
if (!['user', 'team'].includes(process.env.SENTRY_ALERT_TARGET_TYPE)) {
  throw new Error('SENTRY_ALERT_TARGET_TYPE user veya team olmalı.');
}

const apiBase = (
  process.env.SENTRY_API_BASE_URL || 'https://sentry.io'
).replace(/\/$/u, '');
const org = encodeURIComponent(process.env.SENTRY_ORG);
const project = encodeURIComponent(process.env.SENTRY_PROJECT);
const headers = {
  Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}`,
  'Content-Type': 'application/json',
};

async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Sentry API ${response.status}: ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

const definitions = [
  {
    name: 'EtkinLink · üretim hata artışı',
    query: 'release:etkinlink-mobile@*',
    threshold: 10,
    window: 300,
  },
  {
    name: 'EtkinLink · auth hataları',
    query: 'error_domain:auth.*',
    threshold: 5,
    window: 300,
  },
  {
    name: 'EtkinLink · mesaj gönderim hataları',
    query: 'error_domain:message.* OR error_domain:outbox.flush',
    threshold: 3,
    window: 300,
  },
  {
    name: 'EtkinLink · push kayıt hataları',
    query: 'error_domain:push.*',
    threshold: 3,
    window: 900,
  },
  {
    name: 'EtkinLink · fatal crash',
    query: 'level:fatal',
    threshold: 1,
    window: 300,
  },
  {
    name: 'EtkinLink · ANR',
    query: 'error.type:ApplicationNotResponding',
    threshold: 1,
    window: 300,
  },
];

const detectorsEndpoint = `/api/0/organizations/${org}/detectors/?project=${project}`;
const existing = await request(detectorsEndpoint);
const detectorIds = [];
for (const definition of definitions) {
  const found = existing.find(item => item.name === definition.name);
  if (found) {
    detectorIds.push(Number(found.id));
    continue;
  }
  const created = await request(
    `/api/0/organizations/${org}/projects/${project}/detectors/`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: definition.name,
        description: 'EtkinLink production mobil sağlık alarmı.',
        type: 'metric_issue',
        enabled: true,
        owner: `${process.env.SENTRY_ALERT_TARGET_TYPE}:${process.env.SENTRY_ALERT_TARGET_ID}`,
        dataSources: [
          {
            aggregate: 'count()',
            dataset: 'events',
            environment: 'production',
            eventTypes: ['default', 'error'],
            query: definition.query,
            queryType: 0,
            timeWindow: definition.window,
          },
        ],
        config: { detectionType: 'static' },
        conditionGroup: {
          logicType: 'any',
          conditions: [
            {
              type: 'gt',
              comparison: definition.threshold,
              conditionResult: 75,
            },
            {
              type: 'lte',
              comparison: definition.threshold,
              conditionResult: 0,
            },
          ],
          actions: [],
        },
      }),
    },
  );
  detectorIds.push(Number(created.id));
}

const workflowName = 'EtkinLink · production mobil alarm bildirimi';
const workflows = await request(
  `/api/0/organizations/${org}/workflows/?query=${encodeURIComponent(
    workflowName,
  )}`,
);
if (!workflows.some(item => item.name === workflowName)) {
  await request(`/api/0/organizations/${org}/workflows/`, {
    method: 'POST',
    body: JSON.stringify({
      name: workflowName,
      enabled: true,
      environment: 'production',
      owner: `${process.env.SENTRY_ALERT_TARGET_TYPE}:${process.env.SENTRY_ALERT_TARGET_ID}`,
      detectorIds,
      config: { frequency: 5 },
      triggers: {
        logicType: 'any-short',
        conditions: [
          {
            type: 'first_seen_event',
            comparison: true,
            conditionResult: true,
          },
          {
            type: 'reappeared_event',
            comparison: true,
            conditionResult: true,
          },
          {
            type: 'regression_event',
            comparison: true,
            conditionResult: true,
          },
        ],
        actions: [],
      },
      actionFilters: [
        {
          logicType: 'any',
          conditions: [
            {
              type: 'level',
              comparison: { level: 50, match: 'gte' },
              conditionResult: true,
            },
          ],
          actions: [
            {
              type: 'email',
              integrationId: null,
              data: {},
              config: {
                targetType: process.env.SENTRY_ALERT_TARGET_TYPE,
                targetDisplay: null,
                targetIdentifier: process.env.SENTRY_ALERT_TARGET_ID,
              },
              status: 'active',
            },
          ],
        },
      ],
    }),
  });
}

console.log(
  `${detectorIds.length} production Sentry detectorü ve e-posta alarm akışı hazır.`,
);
