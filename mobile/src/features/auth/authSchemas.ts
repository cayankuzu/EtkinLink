import { contentLimits, contentMinimums } from '@shared/constants/limits';
import { z } from 'zod';

const email = z
  .string()
  .trim()
  .min(1, 'E-posta adresini yazmalısın.')
  .email('Geçerli bir e-posta adresi yazmalısın.')
  .max(contentLimits.email, 'E-posta adresi çok uzun.');

const password = z
  .string()
  .min(contentMinimums.password, 'Şifre en az 10 karakter olmalı.')
  .max(contentLimits.password, 'Şifre en fazla 72 karakter olabilir.')
  .regex(/[a-zçğıöşü]/, 'En az bir küçük harf kullanmalısın.')
  .regex(/[A-ZÇĞİÖŞÜ]/, 'En az bir büyük harf kullanmalısın.')
  .regex(/[0-9]/, 'En az bir rakam kullanmalısın.');

export const signInSchema = z.object({
  email,
  password: z
    .string()
    .min(1, 'Şifreni yazmalısın.')
    .max(contentLimits.password),
});

export const signUpSchema = z.object({
  email,
  password,
});

export const forgotPasswordSchema = z.object({ email });

export const newPasswordSchema = z.object({ password });

export type SignInValues = z.infer<typeof signInSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;
