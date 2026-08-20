import http from "k6/http";
import ws from "k6/ws";
import { check, fail } from "k6";

const targetVus = Number(__ENV.TARGET_VUS || "25");
const plateauDuration = __ENV.TEST_DURATION || "3m";
const loadTokens = (__ENV.LOAD_TEST_JWTS || "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);
const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "WRITE_TEST_JWT",
  "WRITE_TEST_MATCH_ID",
  "WRITE_TEST_ROOM_EVENT_ID",
  "MATCH_TEST_EVENT_ID",
  "MATCH_TEST_USER_ID",
];

if (__ENV.TARGET_ENV !== "staging")
  fail("Yük testi yalnızca TARGET_ENV=staging ile çalışır.");
for (const key of requiredEnvironment) {
  if (!__ENV[key]) fail(`${key} staging yük testi için gerekli.`);
}
if (loadTokens.length === 0)
  fail("En az bir staging yük testi JWT'si gerekli.");
if (!Number.isInteger(targetVus) || targetVus < 1 || targetVus > 10_000)
  fail("TARGET_VUS 1 ile 10.000 arasında bir tam sayı olmalı.");

function ramp(target) {
  return [
    { duration: "2m", target: Math.min(target, 500) },
    { duration: "3m", target },
    { duration: plateauDuration, target },
    { duration: "2m", target: 0 },
  ];
}

function readScenario(exec, ratio) {
  return {
    executor: "ramping-vus",
    exec,
    startVUs: 0,
    stages: ramp(Math.max(1, Math.floor(targetVus * ratio))),
    gracefulRampDown: "30s",
  };
}

function writeScenario(exec, rate) {
  return {
    executor: "constant-arrival-rate",
    exec,
    rate,
    timeUnit: "1m",
    duration: plateauDuration,
    preAllocatedVUs: 2,
    maxVUs: 10,
    startTime: "5m",
  };
}

export const options = {
  scenarios: {
    authenticated_session: readScenario("authenticatedSession", 0.1),
    event_discovery: readScenario("eventDiscovery", 0.3),
    joined_rooms: readScenario("joinedRooms", 0.15),
    matching_reads: readScenario("matchingReads", 0.15),
    media_metadata: readScenario("mediaMetadata", 0.1),
    realtime_connection: readScenario("realtimeConnection", 0.2),
    controlled_attendance: writeScenario("controlledAttendance", 2),
    controlled_matching_mutation: writeScenario(
      "controlledMatchingMutation",
      5
    ),
    controlled_direct_message: writeScenario("controlledDirectMessage", 15),
    controlled_room_message: writeScenario("controlledRoomMessage", 15),
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1200", "p(99)<2500"],
    "http_req_duration{route:auth_user}": ["p(95)<900"],
    "http_req_duration{route:search_events}": ["p(95)<1000"],
    "http_req_duration{route:list_joined_rooms}": ["p(95)<1200"],
    "http_req_duration{route:get_swipe_quota}": ["p(95)<900"],
    "http_req_duration{route:send_direct_message}": ["p(95)<1200"],
    "http_req_duration{route:send_room_message}": ["p(95)<1200"],
    checks: ["rate>0.99"],
  },
};

function headers(token) {
  return {
    apikey: __ENV.SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function tokenForVu() {
  return loadTokens[(__VU - 1) % loadTokens.length];
}

function rpc(name, payload, token, route = name) {
  return http.post(
    `${__ENV.SUPABASE_URL}/rest/v1/rpc/${name}`,
    JSON.stringify(payload),
    { headers: headers(token), tags: { route } }
  );
}

function isSuccessfulJson(response) {
  if (response.status !== 200) return false;
  try {
    response.json();
    return true;
  } catch {
    return false;
  }
}

function isSuccessfulStatus(response) {
  return response.status >= 200 && response.status < 300;
}

export function authenticatedSession() {
  const response = http.get(`${__ENV.SUPABASE_URL}/auth/v1/user`, {
    headers: headers(tokenForVu()),
    tags: { route: "auth_user" },
  });
  check(response, {
    "kimliği doğrulanmış oturum okunabildi": isSuccessfulJson,
  });
}

export function eventDiscovery() {
  const response = rpc(
    "search_events",
    {
      search_text: null,
      city_filter: null,
      category_filter: null,
      starts_after: new Date().toISOString(),
      starts_before: null,
      sort_by: "upcoming",
      page_size: 20,
      cursor_start_at: null,
      cursor_event_id: null,
    },
    tokenForVu()
  );
  check(response, {
    "etkinlik araması başarılı": isSuccessfulJson,
    "etkinlik yanıtı dizi": (result) => {
      try {
        return Array.isArray(result.json());
      } catch {
        return false;
      }
    },
  });
}

export function joinedRooms() {
  const response = rpc(
    "list_joined_rooms",
    { page_size: 30, cursor_joined_at: null, cursor_event_id: null },
    tokenForVu()
  );
  check(response, { "oda listesi başarılı": isSuccessfulJson });
}

export function matchingReads() {
  const response = rpc("get_swipe_quota", {}, tokenForVu());
  check(response, { "eşleşme kotası başarılı": isSuccessfulJson });
}

export function mediaMetadata() {
  const response = http.get(
    `${__ENV.SUPABASE_URL}/rest/v1/profile_photos?select=id,storage_path,position,created_at&limit=20`,
    {
      headers: headers(tokenForVu()),
      tags: { route: "media_metadata" },
    }
  );
  check(response, {
    "RLS kapsamındaki medya metadata okundu": isSuccessfulJson,
  });
}

export function realtimeConnection() {
  const base = __ENV.SUPABASE_URL.replace(/^http/u, "ws");
  const url = `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(
    __ENV.SUPABASE_PUBLISHABLE_KEY
  )}&vsn=1.0.0`;
  const response = ws.connect(
    url,
    {
      headers: { Authorization: `Bearer ${tokenForVu()}` },
      tags: { route: "realtime_connect" },
    },
    (socket) => {
      socket.on("open", () => {
        socket.send(
          JSON.stringify({
            topic: "phoenix",
            event: "heartbeat",
            payload: {},
            ref: `${__VU}-${__ITER}`,
          })
        );
        socket.setTimeout(() => socket.close(), 1_000);
      });
    }
  );
  check(response, {
    "Realtime WebSocket bağlantısı kuruldu": (result) => result?.status === 101,
  });
}

function requestId() {
  const seed = `${__VU.toString(16)}${__ITER.toString(16)}${Date.now().toString(
    16
  )}`
    .padEnd(30, "0")
    .slice(-30);
  return `10${seed.slice(0, 6)}-${seed.slice(6, 10)}-4${seed.slice(
    10,
    13
  )}-8${seed.slice(13, 16)}-${seed.slice(16, 28)}`;
}

export function controlledAttendance() {
  const join = rpc(
    "join_event",
    { target_event_id: __ENV.WRITE_TEST_ROOM_EVENT_ID },
    __ENV.WRITE_TEST_JWT
  );
  const leave = rpc(
    "leave_event",
    { target_event_id: __ENV.WRITE_TEST_ROOM_EVENT_ID },
    __ENV.WRITE_TEST_JWT
  );
  check(join, { "kontrollü etkinlik katılımı başarılı": isSuccessfulStatus });
  check(leave, { "kontrollü etkinlik ayrılması başarılı": isSuccessfulStatus });
}

export function controlledMatchingMutation() {
  const response = rpc(
    "swipe_event_candidate_v2",
    {
      target_event_id: __ENV.MATCH_TEST_EVENT_ID,
      target_user_id: __ENV.MATCH_TEST_USER_ID,
      action: __ITER % 2 === 0 ? "like" : "pass",
      request_id: requestId(),
    },
    __ENV.WRITE_TEST_JWT
  );
  check(response, {
    "kontrollü eşleşme mutasyonu başarılı": isSuccessfulStatus,
  });
}

export function controlledDirectMessage() {
  const response = rpc(
    "send_direct_message",
    {
      target_match_id: __ENV.WRITE_TEST_MATCH_ID,
      message_body: `k6 staging doğrulama ${__VU}/${__ITER}`,
      client_message_id: requestId(),
    },
    __ENV.WRITE_TEST_JWT
  );
  check(response, {
    "DM yazımı ve alıcı push enqueue zinciri başarılı": isSuccessfulJson,
  });
}

export function controlledRoomMessage() {
  const response = rpc(
    "send_room_message",
    {
      target_event_id: __ENV.WRITE_TEST_ROOM_EVENT_ID,
      message_body: `k6 oda doğrulama ${__VU}/${__ITER}`,
      client_message_id: requestId(),
    },
    __ENV.WRITE_TEST_JWT
  );
  check(response, { "kontrollü oda mesajı başarılı": isSuccessfulJson });
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data.metrics, null, 2),
    "artifacts/staging-mixed-load-summary.json": JSON.stringify(data, null, 2),
  };
}
