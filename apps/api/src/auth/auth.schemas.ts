import { z } from 'zod';

export const password = z.string().min(10, 'Au moins 10 caractères').max(128, 'Au plus 128 caractères');
const email = z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(254);

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(2, 'Au moins 2 caractères').max(80),
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const emailOnlySchema = z.object({ email });
export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password });
