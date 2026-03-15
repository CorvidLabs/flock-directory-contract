export interface AgentRecord {
  address: string;
  name: string;
  endpoint: string;
  metadata: string;
  tier: number;
  totalScore: number;
  totalMaxScore: number;
  testCount: number;
  lastHeartbeatRound: number;
  registrationRound: number;
  stake: number;
}

export interface Challenge {
  id: string;
  category: string;
  description: string;
  maxScore: number;
  active: boolean;
}

export interface TestResult {
  agentAddress: string;
  challengeId: string;
  score: number;
  maxScore: number;
  category: string;
  round: number;
}

export interface GlobalState {
  agentCount: number;
  challengeCount: number;
  minStake: number;
  registrationOpen: boolean;
  admin: string;
}

export interface DirectoryData {
  globalState: GlobalState;
  agents: AgentRecord[];
  challenges: Challenge[];
  testResults: TestResult[];
}
