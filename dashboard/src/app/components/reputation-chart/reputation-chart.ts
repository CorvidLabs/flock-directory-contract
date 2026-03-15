import { Component, Input } from '@angular/core';
import { AgentRecord } from '../../types';
import { TIER_LABELS, TIER_COLORS } from '../../config';

@Component({
  selector: 'app-reputation-chart',
  standalone: true,
  template: `
    <div class="card reputation-chart">
      <h3>Tier Distribution</h3>
      @for (tier of tiers; track tier) {
        <div class="tier-bar-row">
          <span class="tier-bar-label">{{ tierLabel(tier) }}</span>
          <div class="tier-bar-track">
            <div
              class="tier-bar-fill"
              [style.width.%]="tierPercent(tier)"
              [style.background]="tierColor(tier)"
            ></div>
          </div>
          <span class="tier-bar-count">{{ tierCount(tier) }}</span>
        </div>
      }
    </div>
  `,
})
export class ReputationChartComponent {
  @Input() agents: AgentRecord[] = [];

  tiers = [4, 3, 2, 1];

  tierLabel(tier: number): string {
    return TIER_LABELS[tier] ?? 'Unknown';
  }

  tierColor(tier: number): string {
    return TIER_COLORS[tier] ?? '#888';
  }

  tierCount(tier: number): number {
    return this.agents.filter(a => a.tier === tier).length;
  }

  tierPercent(tier: number): number {
    if (this.agents.length === 0) return 0;
    return (this.tierCount(tier) / this.agents.length) * 100;
  }
}
