import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { catchError, map, of } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;
  return auth.restoreSession().pipe(
    map((restored) => restored || router.createUrlTree(['/'])),
    catchError(() => of(router.createUrlTree(['/']))),
  );
};
