import { contentLimits, contentMinimums } from '@shared/constants/limits';
import { getUsernameValidationError } from '@shared/lib/username';
import { z } from 'zod';

export const profileBasicsSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(contentMinimums.fullName, 'Ad soyad en az 2 karakter olmalı.')
    .max(contentLimits.fullName, 'Ad soyad en fazla 70 karakter olabilir.'),
  username: z
    .string()
    .trim()
    .min(contentMinimums.username, 'Kullanıcı adı en az 3 karakter olmalı.')
    .max(contentLimits.username, 'Kullanıcı adı en fazla 24 karakter olabilir.')
    .superRefine((value, context) => {
      const message = getUsernameValidationError(value);
      if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
    }),
  birthDate: z
    .date()
    .max(
      new Date(new Date().setFullYear(new Date().getFullYear() - 18)),
      'EtkinLink yalnızca 18 yaş ve üzeri kullanıcılar içindir.',
    ),
  gender: z.enum(['woman', 'man', 'non_binary', 'prefer_not_to_say'], {
    errorMap: () => ({ message: 'Bir seçenek belirlemelisin.' }),
  }),
});

export type ProfileBasicsValues = z.infer<typeof profileBasicsSchema>;
