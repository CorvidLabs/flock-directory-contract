import { Component, Input, Output, EventEmitter } from '@angular/core';
import { AgentRecord } from '../../types';
import { TIER_LABELS, TIER_COLORS } from '../../config';

@Component({
  selector: 'app-agent-list',
  standalone: true,
  template: `
    <div class="card agents-section">
      <h2>Registered Agents</h2>
      @if (agents.length === 0) {
        <div class="empty-state">No agents registered yet.</div>
      } @else {
        <div class="agent-table-wrap">
          <table class="agent-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Tier</th>
                <th>Score</th>
                <th>Tests</th>
                <th>Last Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              @for (agent of agents; track agent.address) {
                <tr
                  (click)="selectAgent.emit(agent)"
                  [class.selected]="selectedAddress === agent.address"
                >
                  <td>
                    <div class="agent-name">{{ agent.name }}</div>
                    <div class="agent-endpoint">{{ agent.endpoint }}</div>
                  </td>
                  <td>
                    <span class="tier-badge" [class]="'tier-' + agent.tier">
                      {{ tierLabel(agent.tier) }}
                    </span>
                  </td>
                  <td class="score-bar-cell">
                    <div class="score-bar">
                      <div class="score-bar-track">
                        <div
                          class="score-bar-fill"
                          [style.width.%]="scorePercent(agent)"
                          [style.background]="scoreColor(agent)"
                        ></div>
                      </div>
                      <span class="score-bar-label">{{ scorePercent(agent) }}%</span>
                    </div>
                  </td>
                  <td>{{ agent.testCount }}</td>
                  <td>{{ agent.lastHeartbeatRound || '-' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AgentListComponent {
  @Input() agents: AgentRecord[] = [];
  @Input() selectedAddress: string | null = null;
  @Output() selectAgent = new EventEmitter<AgentRecord>();

  tierLabel(tier: number): string {
    return TIER_LABELS[tier] ?? 'Unknown';
  }

  scorePercent(agent: AgentRecord): number {
    if (agent.totalMaxScore === 0) return 0;
    return Math.round((agent.totalScore / agent.totalMaxScore) * 100);
  }

  scoreColor(agent: AgentRecord): string {
    const pct = this.scorePercent(agent);
    if (pct >= 80) return '#34d399';
    if (pct >= 50) return '#fbbf24';
    return '#f87171';
  }
}
