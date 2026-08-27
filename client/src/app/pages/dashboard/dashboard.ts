import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';

interface Store {
  id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
  primary_color: string | null;
}

interface Wallet {
  balance: string | number;
  store_id: number;
}

interface Transaction {
  id: number;
  type: 'cashback' | 'spend' | 'adjustment' | string;
  amount: string | number;
  description: string | null;
  created_at: string;
}

interface Promotion {
  id: number;
  title: string;
  description: string | null;
  target_count: number;
  reward_title: string;
  current_count: number;
  cycle: number;
}

interface Review {
  id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  author_name: string | null;
}

@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe, DatePipe, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit, OnDestroy {
  // Это zoneless-приложение (без zone.js) — все поля, которые меняются
  // внутри HTTP-callback'ов, ОБЯЗАНЫ быть signals, иначе экран не
  // перерисуется сам после ответа сервера (баг "зависшего" интерфейса,
  // который был на экране входа — та же причина).
  stores = signal<Store[]>([]);
  selectedStore = signal<Store | null>(null);
  wallet = signal<Wallet | null>(null);
  transactions = signal<Transaction[]>([]);
  storeIdInput = signal('');
  qrImageUrl = signal<string | null>(null);
  showQr = signal(false);
  loadingStores = signal(true);
  loadingStoreData = signal(false);
  joiningStore = signal(false);
  loadingQr = signal(false);
  error = signal('');
  storeError = signal('');
  qrError = signal('');

  // Акции
  promotions = signal<Promotion[]>([]);
  loadingPromotions = signal(false);
  promotionsError = signal('');

  // Отзывы — показываются вместо акций, если у магазина нет активной акции
  reviews = signal<Review[]>([]);
  loadingReviews = signal(false);
  reviewsError = signal('');
  reviewRatingInput = signal(5);
  reviewCommentInput = signal('');
  submittingReview = signal(false);
  reviewSubmitError = signal('');
  reviewSubmitSuccess = signal(false);

  private readonly apiUrl = 'http://localhost:3000';

  constructor(
    private readonly http: HttpClient,
    readonly auth: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadStores();
  }

  ngOnDestroy(): void {
    const url = this.qrImageUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }

  loadStores(): void {
    this.loadingStores.set(true);
    this.storeError.set('');

    this.http.get<{ stores: Store[] }>(`${this.apiUrl}/stores/my`).subscribe({
      next: ({ stores }) => {
        this.stores.set(stores);
        const currentSelected = this.selectedStore();
        const selected = currentSelected
          ? stores.find((store) => store.id === currentSelected.id)
          : stores[0];
        this.selectStore(selected ?? null);
        this.loadingStores.set(false);
      },
      error: (error) => {
        this.storeError.set(error.error?.message || 'Не удалось загрузить магазины');
        this.loadingStores.set(false);
      },
    });
  }

  selectStore(store: Store | null): void {
    this.selectedStore.set(store);
    this.wallet.set(null);
    this.transactions.set([]);
    this.promotions.set([]);
    this.reviews.set([]);
    this.error.set('');
    this.resetReviewForm();
    if (store) {
      this.loadStoreData(store.id);
      this.loadPromotions(store.id);
    }
  }

  selectStoreById(storeId: number): void {
    this.selectStore(this.stores().find((store) => store.id === Number(storeId)) ?? null);
  }

  joinStore(): void {
    const storeId = Number(this.storeIdInput());
    if (!Number.isInteger(storeId) || storeId <= 0) {
      this.storeError.set('Введите корректный ID магазина');
      return;
    }

    this.joiningStore.set(true);
    this.storeError.set('');
    this.http.post(`${this.apiUrl}/stores/${storeId}/join`, {}).subscribe({
      next: () => {
        this.storeIdInput.set('');
        this.joiningStore.set(false);
        this.loadStores();
      },
      error: (error) => {
        this.storeError.set(error.error?.message || 'Не удалось добавить магазин');
        this.joiningStore.set(false);
      },
    });
  }

  openQr(): void {
    this.showQr.set(true);
    this.qrError.set('');
    if (this.qrImageUrl() || this.loadingQr()) {
      return;
    }

    this.loadingQr.set(true);
    this.http.get(`${this.apiUrl}/users/me/qr/image`, { responseType: 'blob' }).subscribe({
      next: (image) => {
        this.qrImageUrl.set(URL.createObjectURL(image));
        this.loadingQr.set(false);
      },
      error: () => {
        this.qrError.set('Не удалось загрузить QR-код');
        this.loadingQr.set(false);
      },
    });
  }

  closeQr(): void {
    this.showQr.set(false);
  }

  logout(): void {
    this.auth.logout();
  }

  userLabel(): string {
    const user = this.auth.user();
    return user?.name || user?.phone || 'Клиент';
  }

  transactionSign(transaction: Transaction): string {
    return transaction.type === 'spend' ? '-' : '+';
  }

  promotionProgressPercent(promotion: Promotion): number {
    if (promotion.target_count <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((promotion.current_count / promotion.target_count) * 100));
  }

  submitReview(): void {
    const store = this.selectedStore();
    if (this.submittingReview() || !store) {
      return;
    }

    const rating = this.reviewRatingInput();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      this.reviewSubmitError.set('Выберите оценку от 1 до 5');
      return;
    }

    this.submittingReview.set(true);
    this.reviewSubmitError.set('');
    this.reviewSubmitSuccess.set(false);

    const storeId = store.id;

    this.http
      .post(`${this.apiUrl}/reviews`, {
        storeId,
        rating,
        comment: this.reviewCommentInput().trim() || null,
      })
      .subscribe({
        next: () => {
          this.submittingReview.set(false);
          this.reviewSubmitSuccess.set(true);
          this.resetReviewForm(true);
          this.loadReviews(storeId);
        },
        error: (error) => {
          this.submittingReview.set(false);
          this.reviewSubmitError.set(error.error?.message || 'Не удалось отправить отзыв');
        },
      });
  }

  private resetReviewForm(keepSuccessFlag = false): void {
    this.reviewRatingInput.set(5);
    this.reviewCommentInput.set('');
    this.reviewSubmitError.set('');
    if (!keepSuccessFlag) {
      this.reviewSubmitSuccess.set(false);
    }
  }

  private loadStoreData(storeId: number): void {
    this.loadingStoreData.set(true);
    this.http.get<{ wallet: Wallet }>(`${this.apiUrl}/wallet/${storeId}`).subscribe({
      next: ({ wallet }) => {
        if (wallet.store_id !== storeId) {
          this.error.set('Сервер вернул кошелёк другого магазина');
          this.loadingStoreData.set(false);
          return;
        }
        this.wallet.set(wallet);
        this.loadTransactions(storeId);
      },
      error: (error) => {
        this.error.set(error.error?.message || 'Не удалось загрузить баланс');
        this.loadingStoreData.set(false);
      },
    });
  }

  private loadTransactions(storeId: number): void {
    this.http
      .get<{ transactions: Transaction[] }>(`${this.apiUrl}/wallet/${storeId}/transactions`)
      .subscribe({
        next: ({ transactions }) => {
          this.transactions.set(transactions);
          this.loadingStoreData.set(false);
        },
        error: (error) => {
          this.error.set(error.error?.message || 'Не удалось загрузить историю операций');
          this.loadingStoreData.set(false);
        },
      });
  }

  private loadPromotions(storeId: number): void {
    this.loadingPromotions.set(true);
    this.promotionsError.set('');

    this.http
      .get<{ promotions: Promotion[] }>(`${this.apiUrl}/promotions`, {
        params: { storeId },
      })
      .subscribe({
        next: ({ promotions }) => {
          this.promotions.set(promotions);
          this.loadingPromotions.set(false);

          // Отзывы нужны только как fallback, когда акций нет —
          // не грузим их заранее, если в них нет необходимости.
          if (promotions.length === 0) {
            this.loadReviews(storeId);
          }
        },
        error: (error) => {
          this.promotionsError.set(error.error?.message || 'Не удалось загрузить акции');
          this.loadingPromotions.set(false);
          // Если акции не загрузились — всё равно показываем отзывы,
          // чтобы блок не был пустым.
          this.loadReviews(storeId);
        },
      });
  }

  private loadReviews(storeId: number): void {
    this.loadingReviews.set(true);
    this.reviewsError.set('');

    this.http
      .get<{ reviews: Review[] }>(`${this.apiUrl}/reviews`, {
        params: { storeId },
      })
      .subscribe({
        next: ({ reviews }) => {
          this.reviews.set(reviews);
          this.loadingReviews.set(false);
        },
        error: (error) => {
          this.reviewsError.set(error.error?.message || 'Не удалось загрузить отзывы');
          this.loadingReviews.set(false);
        },
      });
  }
}
