// Always-Thinking engine: shared definitions (server + client)
export const THINKING_CATEGORIES = [
  {
    id: 'robotics',
    label: 'Best Robotics Plays',
    short: 'Robotics',
    color: '#22d3ee',
    objective: 'Find the small/mid-cap stocks most likely to gain 200-500% within ~12 months from the robotics buildout: humanoids, actuators, motors, gears, sensors, lidar, machine vision, rare-earth magnets, edge compute, integrators, and second-order beneficiaries.',
  },
  {
    id: 'playbook',
    label: 'Playbook Matches',
    short: 'Playbook',
    color: '#a78bfa',
    objective: 'Find the stocks that best match the user\'s proven playbooks (net-cash recovery, insider-cluster, buyout, parabolic momentum...) using the ValueHunter data plus its own research, and rank them by expected 12-month multiple.',
  },
];

export const DEFAULT_THINKING_CONFIG = {
  engine: { enabled: true },           // master switch for the cloud runner
  mode: 'test',                        // 'test' (~5 min, quick board update + harness feedback) | 'deep' (60-75 min, subagent waves)
  budgets: { test: { minutes: 5, searches: 8, cycles: 4, pauseMinutes: 2 }, deep: { minutes: 50, searches: 150 } },
  categories: { robotics: { enabled: true }, playbook: { enabled: false } },
  cadence: 'every hour (cloud routine): deep = 50-min relay legs, test = 5-min cycles',
};

export function emptyState(category) {
  return { category, plays: [], questions: [], archive: [], evidence: [], runs: [], nextPlan: '', memo: '', rejected: [], recommendedScans: [], currentRun: null, updatedAt: null };
}
