import { createClient } from "npm:@supabase/supabase-js@2.112.1";

const MAX_SESSION_AGE_SECONDS = 10 * 60;
const STORAGE_PAGE_SIZE = 100;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function readIssuedAt(token: string): number | null {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) return null;
  try {
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { iat?: unknown };
    return typeof payload.iat === "number" ? payload.iat : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Yalnızca POST desteklenir." });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return jsonResponse(401, { error: "Oturum gerekli." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: "Sunucu yapılandırması eksik." });
  }

  const issuedAt = readIssuedAt(token);
  const now = Math.floor(Date.now() / 1000);
  if (
    issuedAt === null ||
    issuedAt > now + 60 ||
    now - issuedAt > MAX_SESSION_AGE_SECONDS
  ) {
    return jsonResponse(403, {
      error: "Güvenlik için hesabını silmeden önce yeniden giriş yapmalısın.",
      code: "RECENT_LOGIN_REQUIRED",
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse(401, { error: "Oturum doğrulanamadı." });
  }

  const lastSignInAt = userData.user.last_sign_in_at
    ? new Date(userData.user.last_sign_in_at).getTime()
    : Number.NaN;
  if (
    !Number.isFinite(lastSignInAt) ||
    Date.now() - lastSignInAt > MAX_SESSION_AGE_SECONDS * 1000
  ) {
    return jsonResponse(403, {
      error: "Güvenlik için hesabını silmeden önce yeniden giriş yapmalısın.",
      code: "RECENT_LOGIN_REQUIRED",
    });
  }

  const userId = userData.user.id;
  const storagePaths: string[] = [];
  let offset = 0;

  while (true) {
    const { data: objects, error: listError } = await admin.storage
      .from("profile-photos")
      .list(userId, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (listError) {
      return jsonResponse(502, {
        error: "Hesap dosyaları güvenli biçimde hazırlanamadı.",
      });
    }

    for (const object of objects ?? []) {
      if (object.name) storagePaths.push(`${userId}/${object.name}`);
    }
    if (!objects || objects.length < STORAGE_PAGE_SIZE) break;
    offset += objects.length;
  }

  for (let index = 0; index < storagePaths.length; index += 100) {
    const { error: storageError } = await admin.storage
      .from("profile-photos")
      .remove(storagePaths.slice(index, index + 100));
    if (storageError) {
      return jsonResponse(502, {
        error: "Profil fotoğrafları silinemedi. Hesap silme durduruldu.",
      });
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(
    userId,
    false,
  );
  if (deleteError) {
    return jsonResponse(502, { error: "Hesap kalıcı olarak silinemedi." });
  }

  return jsonResponse(200, { deleted: true });
});
