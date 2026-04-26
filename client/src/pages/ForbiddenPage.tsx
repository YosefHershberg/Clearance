import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">403 — גישה נדחתה</h1>
      <p className="text-muted-foreground">אין לך הרשאה לצפות בדף זה.</p>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        חזרה לדף הבית
      </Link>
    </div>
  );
}
