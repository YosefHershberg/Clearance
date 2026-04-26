import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHttpClient } from '@/hooks/useHttpClient';
import { login as loginApi } from '@/api/auth.api';
import { normalizeHttpError } from '@/lib/http-error';
import { useAuth } from '@/hooks/useAuth';

const schema = z.object({
  email: z.string().email('אנא הזן כתובת אימייל תקינה'),
  password: z.string().min(1, 'שדה חובה'),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });
  const { execute, isLoading } = useHttpClient({ fn: loginApi });

  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, from, navigate]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await execute(values);
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(from, { replace: true });
    } catch (e) {
      const { status, message } = normalizeHttpError(e);
      if (status === 401) {
        form.setError('password', { message: 'פרטי התחברות שגויים' });
      } else if (status === 429) {
        toast.error('יותר מדי ניסיונות — נסה שוב בעוד מספר דקות');
      } else {
        toast.error(message);
      }
    }
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <main className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-tight text-primary">BuildCheck</span>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-foreground">ברוכים הבאים</h1>
            <p className="text-base text-muted-foreground">התחבר כדי להמשיך</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="label-caps">אימייל</label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.co.il"
              aria-invalid={!!form.formState.errors.email}
              className="h-11"
              {...form.register('email')}
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="label-caps">סיסמה</label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={!!form.formState.errors.password}
              className="h-11"
              {...form.register('password')}
            />
            {form.formState.errors.password && (
              <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
            )}
          </div>
          <Button type="submit" size="lg" disabled={isLoading} className="mt-2 h-11 w-full text-base">
            {isLoading ? 'מתחבר…' : 'התחברות'}
          </Button>
        </form>

        <footer className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            לשחזור סיסמה נא לפנות למנהל המערכת
          </p>
        </footer>
      </main>

      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 end-[-10%] h-[400px] w-[400px] rounded-full bg-primary opacity-[0.04] blur-3xl" />
        <div className="absolute -bottom-32 start-[-10%] h-[500px] w-[500px] rounded-full bg-secondary opacity-[0.06] blur-3xl" />
      </div>
    </div>
  );
}
