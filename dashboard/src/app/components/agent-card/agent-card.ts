import { Component, Input } from '@angular/core';
import { AgentRecord, TestResult } from '../../types';
import { TIER_LABELS } from '../../config';

@Component({
  selector: 'app-agent-card',
  standalone: true,
  template: `
    @if (agent) {
      <div class="card">
        <div class="agent-card-header">
          <div>
            <h3>
              {{ agent.name }}
              <span class="tier-badge" [class]="'tier-' + agent.tier">
                {{ tierLabel(agent.tier) }}
              </span>
            </h3>
            <div class="agent-card-address">{{ agent.address }}</div>
          </div>
        </div>

        <div class="agent-detail-grid">
          <div class="detail-item">
            <div class="detail-label">Endpoint</div>
            <div class="detail-value mono">{{ agent.endpoint }}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Score</div>
            <div class="detail-value">{{ scorePercent() }}%</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Tests Completed</div>
            <div class="detail-value">{{ agent.testCount }}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Stake</div>
            <div class="detail-value">{{ (agent.stake / 1_000_000).toFixed(4) }} ALGO</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Registered Round</div>
            <div class="detail-value mono">{{ agent.registrationRound }}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Last Heartbeat</div>
            <div class="detail-value mono">{{ agent.lastHeartbeatRound || 'Never' }}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Metadata</div>
            <div class="detail-value mono">{{ agent.metadata || 'None' }}</div>
          </div>
        </div>

        @if (agentResults.length > 0) {
          <div class="test-results-section">
            <h4>Test Results</h4>
            <table class="test-results-table">
              <thead>
                <tr>
                  <th>Challenge</th>
                  <th>Category</th>
                  <th>Score</th>
                  <th>Round</th>
                </tr>
              </thead>
              <tbody>
                @for (result of agentResults; track result.challengeId) {
                  <tr>
                    <td>{{ result.challengeId }}</td>
                    <td>{{ result.category }}</td>
                    <td>{{ result.score }} / {{ result.maxScore }}</td>
                    <td>{{ result.round }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
  `,
})
export class AgentCardComponent {
  @Input() agent: AgentRecord | null = null;
  @Input() agentResults: TestResult[] = [];

  tierLabel(tier: number): string {
    return TIER_LABELS[tier] ?? 'Unknown';
  }

  scorePercent(): number {
    if (!this.agent || this.agent.totalMaxScore === 0) return 0;
    return Math.round((this.agent.totalScore / this.agent.totalMaxScore) * 100);
  }
}
