import { Injectable } from '@angular/core';
import algosdk from 'algosdk';
import { APP_ID, ALGOD_URL, INDEXER_URL } from './config';
import type { AgentRecord, Challenge, TestResult, GlobalState, DirectoryData } from './types';

@Injectable({ providedIn: 'root' })
export class AlgorandService {

  // ── Helpers ──────────────────────────────────────────────────────

  private readUint64(data: Uint8Array, offset: number): number {
    let val = 0;
    for (let i = 0; i < 8; i++) {
      val = val * 256 + data[offset + i];
    }
    return val;
  }

  private readUint16(data: Uint8Array, offset: number): number {
    return (data[offset] << 8) | data[offset + 1];
  }

  private readString(data: Uint8Array, offset: number): { value: string; bytesRead: number } {
    const len = this.readUint16(data, offset);
    const bytes = data.slice(offset + 2, offset + 2 + len);
    const value = new TextDecoder().decode(bytes);
    return { value, bytesRead: 2 + len };
  }

  // ── ABI Decoding ─────────────────────────────────────────────────

  private decodeAgentRecord(data: Uint8Array, address: string): AgentRecord {
    const nameOffset = this.readUint16(data, 0);
    const endpointOffset = this.readUint16(data, 2);
    const metadataOffset = this.readUint16(data, 4);

    const tier = this.readUint64(data, 6);
    const totalScore = this.readUint64(data, 14);
    const totalMaxScore = this.readUint64(data, 22);
    const testCount = this.readUint64(data, 30);
    const lastHeartbeatRound = this.readUint64(data, 38);
    const registrationRound = this.readUint64(data, 46);
    const stake = this.readUint64(data, 54);

    const name = this.readString(data, nameOffset).value;
    const endpoint = this.readString(data, endpointOffset).value;
    const metadata = this.readString(data, metadataOffset).value;

    return {
      address, name, endpoint, metadata, tier,
      totalScore, totalMaxScore, testCount,
      lastHeartbeatRound, registrationRound, stake,
    };
  }

  private decodeChallenge(data: Uint8Array, id: string): Challenge {
    const categoryOffset = this.readUint16(data, 0);
    const descriptionOffset = this.readUint16(data, 2);
    const maxScore = this.readUint64(data, 4);
    const active = this.readUint64(data, 12);

    const category = this.readString(data, categoryOffset).value;
    const description = this.readString(data, descriptionOffset).value;

    return { id, category, description, maxScore, active: active === 1 };
  }

  private decodeTestResult(
    data: Uint8Array,
    agentAddress: string,
    challengeId: string,
  ): TestResult {
    const score = this.readUint64(data, 0);
    const maxScore = this.readUint64(data, 8);
    const categoryOffset = this.readUint16(data, 16);
    const round = this.readUint64(data, 18);

    const category = this.readString(data, categoryOffset).value;

    return { agentAddress, challengeId, score, maxScore, category, round };
  }

  // ── Box key parsing ──────────────────────────────────────────────

  private decodeChallengeKey(nameBytes: Uint8Array): string | null {
    if (nameBytes.length < 3 || nameBytes[0] !== 0x63) return null;
    const strLen = this.readUint16(nameBytes, 1);
    if (nameBytes.length < 1 + 2 + strLen) return null;
    return new TextDecoder().decode(nameBytes.slice(3, 3 + strLen));
  }

  private decodeAgentKey(nameBytes: Uint8Array): string | null {
    if (nameBytes.length !== 33 || nameBytes[0] !== 0x61) return null;
    const pubkey = nameBytes.slice(1, 33);
    return algosdk.encodeAddress(pubkey);
  }

  private decodeTestResultKey(nameBytes: Uint8Array): { agentAddress: string; challengeId: string } | null {
    if (nameBytes.length < 36 || nameBytes[0] !== 0x74) return null;
    const pubkey = nameBytes.slice(1, 33);
    const agentAddress = algosdk.encodeAddress(pubkey);
    const stringOffset = this.readUint16(nameBytes, 33);
    const absOffset = 1 + stringOffset;
    if (absOffset + 2 > nameBytes.length) return null;
    const strLen = this.readUint16(nameBytes, absOffset);
    if (absOffset + 2 + strLen > nameBytes.length) return null;
    const challengeId = new TextDecoder().decode(nameBytes.slice(absOffset + 2, absOffset + 2 + strLen));
    return { agentAddress, challengeId };
  }

  // ── API calls ────────────────────────────────────────────────────

  private async listAllBoxes(): Promise<Uint8Array[]> {
    const allBoxes: Uint8Array[] = [];
    let next: string | undefined;

    do {
      const url = new URL(`${INDEXER_URL}/v2/applications/${APP_ID}/boxes`);
      url.searchParams.set('limit', '100');
      if (next) url.searchParams.set('next', next);

      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error(`Indexer boxes request failed: ${resp.status}`);

      const json = await resp.json();
      const boxes: Array<{ name: string }> = json.boxes ?? [];
      for (const box of boxes) {
        const decoded = Uint8Array.from(atob(box.name), (c) => c.charCodeAt(0));
        allBoxes.push(decoded);
      }
      next = json['next-token'];
    } while (next);

    return allBoxes;
  }

  private async getBoxValue(nameBytes: Uint8Array): Promise<Uint8Array> {
    const b64Name = btoa(String.fromCharCode(...nameBytes));
    const url = `${ALGOD_URL}/v2/applications/${APP_ID}/box?name=b64:${encodeURIComponent(b64Name)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Box request failed: ${resp.status}`);
    const json = await resp.json();
    return Uint8Array.from(atob(json.value), (c) => c.charCodeAt(0));
  }

  // ── Global state ─────────────────────────────────────────────────

  async fetchGlobalState(): Promise<GlobalState> {
    const resp = await fetch(`${ALGOD_URL}/v2/applications/${APP_ID}`);
    if (!resp.ok) throw new Error(`App info request failed: ${resp.status}`);
    const appInfo = await resp.json();
    const gs: Array<{ key: string; value: { bytes: string; type: number; uint: number } }> =
      appInfo.params?.['global-state'] ?? [];

    const state: GlobalState = {
      agentCount: 0,
      challengeCount: 0,
      minStake: 0,
      registrationOpen: true,
      admin: '',
    };

    for (const entry of gs) {
      const key = atob(entry.key);
      const val = entry.value;

      if (key === 'agent_count') state.agentCount = val.uint;
      else if (key === 'chal_count') state.challengeCount = val.uint;
      else if (key === 'min_stake') state.minStake = val.uint;
      else if (key === 'reg_open') state.registrationOpen = val.uint === 1;
      else if (key === 'admin' && val.bytes) {
        try {
          const bytes = Uint8Array.from(atob(val.bytes), (c) => c.charCodeAt(0));
          if (bytes.length === 32) {
            state.admin = algosdk.encodeAddress(bytes);
          }
        } catch {
          // ignore
        }
      }
    }

    return state;
  }

  // ── Fetch all data ───────────────────────────────────────────────

  async fetchDirectoryData(): Promise<DirectoryData> {
    const [globalState, boxNames] = await Promise.all([
      this.fetchGlobalState(),
      this.listAllBoxes(),
    ]);

    const agents: AgentRecord[] = [];
    const challenges: Challenge[] = [];
    const testResults: TestResult[] = [];

    const agentBoxes: Uint8Array[] = [];
    const challengeBoxes: { name: Uint8Array; id: string }[] = [];
    const testBoxes: { name: Uint8Array; agentAddress: string; challengeId: string }[] = [];

    for (const nameBytes of boxNames) {
      if (nameBytes[0] === 0x61 && nameBytes.length === 33) {
        agentBoxes.push(nameBytes);
      } else if (nameBytes[0] === 0x63) {
        const id = this.decodeChallengeKey(nameBytes);
        if (id) challengeBoxes.push({ name: nameBytes, id });
      } else if (nameBytes[0] === 0x74) {
        const parsed = this.decodeTestResultKey(nameBytes);
        if (parsed) testBoxes.push({ name: nameBytes, ...parsed });
      }
    }

    const agentPromises = agentBoxes.map(async (nameBytes) => {
      try {
        const value = await this.getBoxValue(nameBytes);
        const address = this.decodeAgentKey(nameBytes);
        if (address) agents.push(this.decodeAgentRecord(value, address));
      } catch (e) {
        console.warn('Failed to fetch agent box:', e);
      }
    });

    const challengePromises = challengeBoxes.map(async ({ name, id }) => {
      try {
        const value = await this.getBoxValue(name);
        challenges.push(this.decodeChallenge(value, id));
      } catch (e) {
        console.warn('Failed to fetch challenge box:', e);
      }
    });

    const testPromises = testBoxes.map(async ({ name, agentAddress, challengeId }) => {
      try {
        const value = await this.getBoxValue(name);
        testResults.push(this.decodeTestResult(value, agentAddress, challengeId));
      } catch (e) {
        console.warn('Failed to fetch test result box:', e);
      }
    });

    await Promise.all([...agentPromises, ...challengePromises, ...testPromises]);

    agents.sort((a, b) => {
      if (b.tier !== a.tier) return b.tier - a.tier;
      const aScore = a.totalMaxScore > 0 ? a.totalScore / a.totalMaxScore : 0;
      const bScore = b.totalMaxScore > 0 ? b.totalScore / b.totalMaxScore : 0;
      return bScore - aScore;
    });

    return { globalState, agents, challenges, testResults };
  }
}
