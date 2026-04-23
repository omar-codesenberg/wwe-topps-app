import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAdmin } from './components/RequireAdmin';
import { LoginPage } from './pages/LoginPage';
import { EventsListPage } from './pages/EventsListPage';
import { EventCreatePage } from './pages/EventCreatePage';
import { EventDetailPage } from './pages/EventDetailPage';
import { UsersListPage } from './pages/UsersListPage';
import { UserDetailPage } from './pages/UserDetailPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAdmin><Layout /></RequireAdmin>}>
        <Route index element={<EventsListPage />} />
        <Route path="events/new" element={<EventCreatePage />} />
        <Route path="events/:eventId" element={<EventDetailPage />} />
        <Route path="users" element={<UsersListPage />} />
        <Route path="users/:uid" element={<UserDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
