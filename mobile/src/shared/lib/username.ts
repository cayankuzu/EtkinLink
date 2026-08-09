import { supabase } from './supabase';

const reservedUsernames = new Set([
  'admin',
  'administrator',
  'moderator',
  'etkinlink',
  'support',
  'destek',
  'system',
  'sistem',
  'official',
  'resmi',
  'root',
  'api',
  'null',
  'undefined',
  'test',
  'guest',
]);

export function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR');
}

export function getUsernameValidationError(value: string): string | null {
  const username = value.trim();
  if (username.length < 3) return 'Kullanıcı adı en az 3 karakter olmalı.';
  if (username.length > 24)
    return 'Kullanıcı adı en fazla 24 karakter olabilir.';
  if (!/^[a-z0-9_]+$/.test(username))
    return 'Yalnızca küçük harf, rakam ve alt çizgi kullanabilirsin.';
  if (username.startsWith('_') || username.endsWith('_'))
    return 'Kullanıcı adı alt çizgiyle başlayamaz veya bitemez.';
  if (username.includes('__'))
    return 'Arka arkaya iki alt çizgi kullanamazsın.';
  if (reservedUsernames.has(username.toLocaleLowerCase('tr-TR')))
    return 'Bu kullanıcı adı kullanılamaz.';
  return null;
}

export async function isUsernameAvailable(value: string): Promise<boolean> {
  const username = normalizeUsername(value);
  if (getUsernameValidationError(username)) return false;
  const { data, error } = await supabase.rpc('is_username_available', {
    candidate_username: username,
  });
  if (error) throw error;
  return data;
}
