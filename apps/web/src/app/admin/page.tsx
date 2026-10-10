import type { Metadata } from 'next';
import { AdminView } from '@/components/admin/admin-view';

export const metadata: Metadata = { title: 'Admin · Docs Assistant' };

export default function AdminPage() {
  return (
    <main className="flex-1">
      <AdminView />
    </main>
  );
}
