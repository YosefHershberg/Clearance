import { Navigate, Outlet } from 'react-router';
import { useAuth } from '@/hooks/useAuth';

export function AdminRoute() {
  const { user } = useAuth();
  if (!user || user.role !== 'ADMIN') {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}
