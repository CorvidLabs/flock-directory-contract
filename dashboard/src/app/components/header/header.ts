import { Component, Input, Output, EventEmitter } from '@angular/core';
import { GlobalState } from '../../types';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <div class="header">
      <div class="header-left">
        <h1>Flock Directory</h1>
        <span class="subtitle">App {{ appId }} &middot; Testnet</span>
      </div>
      @if (globalState) {
        <div class="header-stats">
          <div class="stat-box">
            <div class="stat-value">{{ globalState.agentCount }}</div>
            <div class="stat-label">Agents</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">{{ globalState.challengeCount }}</div>
            <div class="stat-label">Challenges</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">{{ (globalState.minStake / 1_000_000).toFixed(2) }}</div>
            <div class="stat-label">Min Stake (ALGO)</div>
          </div>
        </div>
      }
      <div class="header-actions">
        <span class="last-refresh">{{ lastRefresh }}</span>
        <button class="refresh-btn" (click)="refresh.emit()" [disabled]="loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>
  `,
})
export class HeaderComponent {
  @Input() globalState: GlobalState | null = null;
  @Input() loading = false;
  @Input() lastRefresh = '';
  @Input() appId = 757178329;
  @Output() refresh = new EventEmitter<void>();
}
