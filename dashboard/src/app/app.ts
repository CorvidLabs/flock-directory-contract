import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { HeaderComponent } from './components/header/header';
import { AgentListComponent } from './components/agent-list/agent-list';
import { AgentCardComponent } from './components/agent-card/agent-card';
import { ChallengeListComponent } from './components/challenge-list/challenge-list';
import { ReputationChartComponent } from './components/reputation-chart/reputation-chart';
import { AlgorandService } from './algorand.service';
import { APP_ID, REFRESH_INTERVAL_MS } from './config';
import type { AgentRecord, GlobalState, Challenge, TestResult } from './types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    HeaderComponent,
    AgentListComponent,
    AgentCardComponent,
    ChallengeListComponent,
    ReputationChartComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  globalState: GlobalState | null = null;
  agents: AgentRecord[] = [];
  challenges: Challenge[] = [];
  testResults: TestResult[] = [];
  selectedAgent: AgentRecord | null = null;
  loading = true;
  error: string | null = null;
  lastRefresh = '';
  appId = APP_ID;

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private algorand: AlgorandService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadData();
    this.refreshInterval = setInterval(() => this.loadData(), REFRESH_INTERVAL_MS);
  }

  ngOnDestroy() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  async loadData() {
    this.loading = true;
    this.error = null;
    try {
      const data = await this.algorand.fetchDirectoryData();
      this.globalState = data.globalState;
      this.agents = data.agents;
      this.challenges = data.challenges;
      this.testResults = data.testResults;
      this.lastRefresh = new Date().toLocaleTimeString();

      if (this.selectedAgent) {
        const updated = this.agents.find(a => a.address === this.selectedAgent!.address);
        this.selectedAgent = updated ?? null;
      }
    } catch (e: any) {
      this.error = e.message ?? 'Failed to fetch data';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  onSelectAgent(agent: AgentRecord) {
    this.selectedAgent = this.selectedAgent?.address === agent.address ? null : agent;
  }

  get selectedAgentResults(): TestResult[] {
    if (!this.selectedAgent) return [];
    return this.testResults.filter(r => r.agentAddress === this.selectedAgent!.address);
  }
}
