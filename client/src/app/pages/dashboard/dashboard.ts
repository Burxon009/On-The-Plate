import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
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
  stores: Store[] = [];
  selectedStore: Store | null = null;
  wallet: Wallet | null = null;
  transactions: Transaction[] = [];
  storeIdInput = '';
  qrImageUrl: string | null = null;
  showQr = false;
  loadingStores = true;
  loadingStoreData = false;
  joiningStore = false;
  loadingQr = false;
  error = '';
  storeError = '';
  qrError = '';

  // Акции
  promotions: Promotion[] = [];
  loadingPromotions = false;
  promotionsError = '';

  // Отзывы — показываются вместо акций, если у магазина нет активной акции
  reviews: Review[] = [];
  loadingReviews = false;
  reviewsError = '';
  reviewRatingInput = 5;
  reviewCommentInput = '';
  submittingReview = false;
  reviewSubmitError = '';
  reviewSubmitSuccess = false;

  private readonly apiUrl = 'http://localhost:3000';

  constructor(
    private readonly http: HttpClient,
    readonly auth: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadStores();
  }

  ngOnDestroy(): void {
    if (this.qrImageUrl) {
      URL.revokeObjectURL(this.qrImageUrl);
    }
  }

  loadStores(): void {
    this.loadingStores = true;
    this.storeError = '';

    this.http.get<{ stores: Store[] }>(`${this.apiUrl}/stores/my`).subscribe({
      next: ({ stores }) => {
        this.stores = stores;
        const selected = this.selectedStore
          ? stores.find((store) => store.id === this.selectedStore?.id)
          : stores[0];
        this.selectStore(selected ?? null);
        this.loadingStores = false;
      },
      error: (error) => {
        this.storeError = error.error?.message || 'Не удалось загрузить магазины';
        this.loadingStores = false;
      },
    });
  }

  selectStore(store: Store | null): void {
    this.selectedStore = store;
    this.wallet = null;
    this.transactions = [];
    this.promotions = [];
    this.reviews = [];
    this.error = '';
    this.resetReviewForm();
    if (store) {
      this.loadStoreData(store.id);
      this.loadPromotions(store.id);
    }
  }

  selectStoreById(storeId: number): void {
    this.selectStore(this.stores.find((store) => store.id === Number(storeId)) ?? null);
  }

  joinStore(): void {
    const storeId = Number(this.storeIdInput);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      this.storeError = 'Введите корректный ID магазина';
      return;
    }

    this.joiningStore = true;
    this.storeError = '';
    this.http.post(`${this.apiUrl}/stores/${storeId}/join`, {}).subscribe({
      next: () => {
        this.storeIdInput = '';
        this.joiningStore = false;
        this.loadStores();
      },
      error: (error) => {
        this.storeError = error.error?.message || 'Не удалось добавить магазин';
        this.joiningStore = false;
      },
    });
  }

  openQr(): void {
    this.showQr = true;
    this.qrError = '';
    if (this.qrImageUrl || this.loadingQr) {
      return;
    }

    this.loadingQr = true;
    this.http.get(`${this.apiUrl}/users/me/qr/image`, { responseType: 'blob' }).subscribe({
      next: (image) => {
        this.qrImageUrl = URL.createObjectURL(image);
        this.loadingQr = false;
      },
      error: () => {
        this.qrError = 'Не удалось загрузить QR-код';
        this.loadingQr = false;
      },
    });
  }

  closeQr(): void {
    this.showQr = false;
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
    if (this.submittingReview || !this.selectedStore) {
      return;
    }

    if (!Number.isInteger(this.reviewRatingInput) || this.reviewRatingInput < 1 || this.reviewRatingInput > 5) {
      this.reviewSubmitError = 'Выберите оценку от 1 до 5';
      return;
    }

    this.submittingReview = true;
    this.reviewSubmitError = '';
    this.reviewSubmitSuccess = false;

    const storeId = this.selectedStore.id;

    this.http
      .post(`${this.apiUrl}/reviews`, {
        storeId,
        rating: this.reviewRatingInput,
        comment: this.reviewCommentInput.trim() || null,
      })
      .subscribe({
        next: () => {
          this.submittingReview = false;
          this.reviewSubmitSuccess = true;
          this.resetReviewForm(true);
          this.loadReviews(storeId);
        },
        error: (error) => {
          this.submittingReview = false;
          this.reviewSubmitError = error.error?.message || 'Не удалось отправить отзыв';
        },
      });
  }

  private resetReviewForm(keepSuccessFlag = false): void {
    this.reviewRatingInput = 5;
    this.reviewCommentInput = '';
    this.reviewSubmitError = '';
    if (!keepSuccessFlag) {
      this.reviewSubmitSuccess = false;
    }
  }

  private loadStoreData(storeId: number): void {
    this.loadingStoreData = true;
    this.http.get<{ wallet: Wallet }>(`${this.apiUrl}/wallet/${storeId}`).subscribe({
      next: ({ wallet }) => {
        if (wallet.store_id !== storeId) {
          this.error = 'Сервер вернул кошелёк другого магазина';
          this.loadingStoreData = false;
          return;
        }
        this.wallet = wallet;
        this.loadTransactions(storeId);
      },
      error: (error) => {
        this.error = error.error?.message || 'Не удалось загрузить баланс';
        this.loadingStoreData = false;
      },
    });
  }

  private loadTransactions(storeId: number): void {
    this.http
      .get<{ transactions: Transaction[] }>(`${this.apiUrl}/wallet/${storeId}/transactions`)
      .subscribe({
        next: ({ transactions }) => {
          this.transactions = transactions;
          this.loadingStoreData = false;
        },
        error: (error) => {
          this.error = error.error?.message || 'Не удалось загрузить историю операций';
          this.loadingStoreData = false;
        },
      });
  }

  private loadPromotions(storeId: number): void {
    this.loadingPromotions = true;
    this.promotionsError = '';

    this.http
      .get<{ promotions: Promotion[] }>(`${this.apiUrl}/promotions`, {
        params: { storeId },
      })
      .subscribe({
        next: ({ promotions }) => {
          this.promotions = promotions;
          this.loadingPromotions = false;

          // Отзывы нужны только как fallback, когда акций нет —
          // не грузим их заранее, если в них нет необходимости.
          if (promotions.length === 0) {
            this.loadReviews(storeId);
          }
        },
        error: (error) => {
          this.promotionsError = error.error?.message || 'Не удалось загрузить акции';
          this.loadingPromotions = false;
          // Если акции не загрузились — всё равно показываем отзывы,
          // чтобы блок не был пустым.
          this.loadReviews(storeId);
        },
      });
  }

  private loadReviews(storeId: number): void {
    this.loadingReviews = true;
    this.reviewsError = '';

    this.http
      .get<{ reviews: Review[] }>(`${this.apiUrl}/reviews`, {
        params: { storeId },
      })
      .subscribe({
        next: ({ reviews }) => {
          this.reviews = reviews;
          this.loadingReviews = false;
        },
        error: (error) => {
          this.reviewsError = error.error?.message || 'Не удалось загрузить отзывы';
          this.loadingReviews = false;
        },
      });
  }
}
