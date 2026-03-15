import { Component, Input } from '@angular/core';
import { Challenge } from '../../types';

@Component({
  selector: 'app-challenge-list',
  standalone: true,
  template: `
    <div class="card">
      <h2>Challenges</h2>
      @if (challenges.length === 0) {
        <div class="empty-state">No challenges created yet.</div>
      } @else {
        <div class="challenge-grid">
          @for (challenge of challenges; track challenge.id) {
            <div class="challenge-card">
              <div class="challenge-card-header">
                <span class="challenge-id">{{ challenge.id }}</span>
                <span class="active-badge" [class.active]="challenge.active" [class.inactive]="!challenge.active">
                  {{ challenge.active ? 'Active' : 'Inactive' }}
                </span>
              </div>
              <div class="challenge-category">{{ challenge.category }}</div>
              <div class="challenge-description">{{ challenge.description }}</div>
              <div class="challenge-max-score">Max Score: {{ challenge.maxScore }}</div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ChallengeListComponent {
  @Input() challenges: Challenge[] = [];
}
