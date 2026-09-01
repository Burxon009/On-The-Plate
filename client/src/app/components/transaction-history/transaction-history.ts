import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../api.config';
import { LanguageService } from '../../services/language.service';
import type { TranslationKey } from '../../i18n/translations';

interface Transaction {
  id: number;
  type: 'cashback' | 'spend' | 'adjustment' | string;
  amount: string | number;
  balance_after: string | number;
  description: string | null;
  created_at: string;
}

/**
 * Полноэкранный список операций кошелька. Открывается из компактной
 * карточки «История операций» на дашборде. Данные тянет сам —
 * GET /wallet/:storeId/transactions (всегда актуальные на момент открытия).
 */
@Component({
  selector: 'app-transaction-history',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './transaction-history.html',
  styleUrl: './transaction-history.scss',
})
export class TransactionHistory implements OnInit {
  readonly storeId = input.required<number>();
  readonly closed = output<void>();

  private readonly http = inject(HttpClient);
  private readonly apiUrl = API_URL;
  readonly lang = inject(LanguageService);

  readonly transactions = signal<Transaction[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  ngOnInit(): void {
    this.http
      .get<{ transactions: Transaction[] }>(
        `${this.apiUrl}/wallet/${this.storeId()}/transactions`,
      )
      .subscribe({
        next: ({ transactions }) => {
          this.transactions.set(transactions);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.message || this.lang.t('historyLoadError'));
          this.loading.set(false);
        },
      });
  }

  close(): void {
    this.closed.emit();
  }

  sign(t: Transaction): string {
    return t.type === 'spend' ? '−' : '+';
  }

  typeLabel(t: Transaction): string {
    const key: TranslationKey =
      t.type === 'spend'
        ? 'txSpend'
        : t.type === 'cashback'
          ? 'txCashback'
          : 'txAdjustment';
    return this.lang.t(key);
  }
}
