import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from './services/auth.service';

@Component({
  imports: [RouterOutlet, FormsModule],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected get isLoggedIn() {
    return this.auth.isLoggedIn;
  }
  phone = '';
  loading = false;
  error = '';

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    if (this.isLoggedIn()) {
      this.auth.loadCurrentUser().subscribe({
        next: () => {
          this.isLoggedIn.set(true);
          void this.router.navigate(['/dashboard']);
        },
        error: () => {
          this.auth.logout();
          this.isLoggedIn.set(false);
        },
      });
    }
  }

  login(): void {
    if (!this.phone.trim()) {
      this.error = 'Введите номер телефона';
      return;
    }

    this.loading = true;
    this.error = '';

    this.auth.login(this.phone.trim()).pipe(finalize(() => {
      this.loading = false;
    })).subscribe({
      next: () => {
        this.isLoggedIn.set(true);
        this.phone = '';
        void this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.error = error.error?.message || 'Не удалось подключиться к серверу';
      },
    });
  }
}