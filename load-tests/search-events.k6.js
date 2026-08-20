import http from "k6/http";
import { check, fail } from "k6";

const targetVus = Number(__ENV.TARGET_VUS || "1000");
if (__ENV.TARGET_ENV !== "staging")
  fail("Yük testi yalnızca TARGET_ENV=staging ile çalışır.");
if (
  !__ENV.SUPABASE_URL ||
  !__ENV.SUPABASE_PUBLISHABLE_KEY ||
  !__ENV.LOAD_TEST_JWT
) {
  fail("Staging Supabase URL, publishable key ve LOAD_TEST_JWT gerekli.");
}
if (targetVus > 10_000) fail("TARGET_VUS 10.000 sınırını aşamaz.");

export const options = {
  scenarios: {
    search_events: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: Math.min(1_000, targetVus) },
        { duration: "3m", target: Math.min(5_000, targetVus) },
        { duration: "5m", target: targetVus },
        { duration: "5m", target: targetVus },
        { duration: "2m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1200"],
    checks: ["rate>0.99"],
  },
};

const headers = {
  apikey: __ENV.SUPABASE_PUBLISHABLE_KEY,
  authorization: `Bearer ${__ENV.LOAD_TEST_JWT}`,
  "content-type": "application/json",
};

export default function () {
  const response = http.post(
    `${__ENV.SUPABASE_URL}/rest/v1/rpc/search_events`,
    JSON.stringify({
      search_text: null,
      city_filter: null,
      category_filter: null,
      starts_after: new Date().toISOString(),
      starts_before: null,
      sort_by: "upcoming",
      page_size: 20,
      cursor_start_at: null,
      cursor_event_id: null,
    }),
    { headers, tags: { route: "search_events" } }
  );
  check(response, {
    "search_events 200": (result) => result.status === 200,
    "yanıt JSON dizisi": (result) => Array.isArray(result.json()),
  });
}
