import { Routes } from '@angular/router';
import { Dashboard } from './pages/dashboard/dashboard';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: 'dashboard',
    component: Dashboard,
    canActivate: [authGuard],
  },
];