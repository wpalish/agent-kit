import { Agent, AgentResult } from './agent.js';
import { MemoryStore, ConversationMemory } from './memory.js';

export type FlowType = 'pipeline' | 'parallel' | 'supervisor' | 'custom';

export type OrchestratorOptions = {
  agents: Agent[];
  memory?: { ttl?: number; maxSize?: number };
  defaultFlow?: FlowType;
};

export type RunOptions = {
  task: string;
  flow?: FlowType;
  agentSequence?: string[];
  router?: (task: string, agents: Agent[]) => string[];
};

export type ParallelTask = {
  agent: string;
  task: string;
};

export type OrchestratorResult = {
  output: string;
  steps: AgentResult[];
  totalUsage: { inputTokens: number; outputTokens: number };
};

export class Orchestrator {
  private agentMap = new Map<string, Agent>();
  private memory: MemoryStore;
  private conversationMemory: ConversationMemory;
  private defaultFlow: FlowType;

  constructor(options: OrchestratorOptions) {
    for (const agent of options.agents) {
      this.agentMap.set(agent.name, agent);
    }
    this.memory = new MemoryStore(options.memory);
    this.conversationMemory = new ConversationMemory(options.memory);
    this.defaultFlow = options.defaultFlow ?? 'pipeline';
  }

  async run(options: RunOptions): Promise<OrchestratorResult> {
    const flow = options.flow ?? this.defaultFlow;

    switch (flow) {
      case 'pipeline':
        return this.runPipeline(options);
      case 'parallel':
        return this.runParallelFlow(options);
      case 'supervisor':
        return this.runSupervisor(options);
      case 'custom':
        if (!options.router) throw new Error('custom flow requires a router function');
        return this.runCustom(options);
      default:
        throw new Error(`Unknown flow: ${flow}`);
    }
  }

  private async runPipeline(options: RunOptions): Promise<OrchestratorResult> {
    const agents = this.resolveAgents(options.agentSequence);
    const steps: AgentResult[] = [];
    let currentInput = options.task;

    for (const agent of agents) {
      const result = await agent.run(currentInput);
      steps.push(result);
      this.memory.set(`step:${agent.name}:output`, result.output);
      currentInput = result.output;
    }

    return this.buildResult(steps[steps.length - 1]?.output ?? '', steps);
  }

  private async runParallelFlow(options: RunOptions): Promise<OrchestratorResult> {
    const agents = this.resolveAgents(options.agentSequence);
    const steps = await Promise.all(agents.map(agent => agent.run(options.task)));
    const combined = steps.map((s, i) => `[${agents[i].name}]: ${s.output}`).join('\n\n');
    return this.buildResult(combined, steps);
  }

  async runParallel(tasks: ParallelTask[]): Promise<OrchestratorResult> {
    const results = await Promise.all(
      tasks.map(({ agent: agentName, task }) => {
        const agent = this.agentMap.get(agentName);
        if (!agent) throw new Error(`Agent not found: ${agentName}`);
        return agent.run(task);
      })
    );
    const combined = results.map(r => `[${r.agentName}]: ${r.output}`).join('\n\n');
    return this.buildResult(combined, results);
  }

  async synthesize(result: OrchestratorResult, options: { agent: string }): Promise<OrchestratorResult> {
    const agent = this.agentMap.get(options.agent);
    if (!agent) throw new Error(`Agent not found: ${options.agent}`);

    const synthesisInput = `Synthesize the following agent outputs into a coherent response:\n\n${result.output}`;
    const synthesisResult = await agent.run(synthesisInput);

    return this.buildResult(synthesisResult.output, [...result.steps, synthesisResult]);
  }

  private async runSupervisor(options: RunOptions): Promise<OrchestratorResult> {
    const [supervisor, ...workers] = this.resolveAgents(options.agentSequence);
    if (!supervisor) throw new Error('supervisor flow requires at least one agent');

    const workerNames = workers.map(w => w.name).join(', ');
    const plan = await supervisor.run(
      `You are coordinating a team. Available workers: ${workerNames}.\n\nTask: ${options.task}\n\nRespond with a JSON array of {agent, task} objects.`
    );

    let delegations: ParallelTask[] = [];
    try {
      const match = plan.output.match(/\[.*\]/s);
      delegations = match ? JSON.parse(match[0]) : [];
    } catch {
      delegations = workers.map(w => ({ agent: w.name, task: options.task }));
    }

    const workerResults = await this.runParallel(delegations);
    const finalResult = await supervisor.run(
      `Worker results:\n${workerResults.output}\n\nSummarize and finalize the response.`
    );

    return this.buildResult(finalResult.output, [...workerResults.steps, finalResult]);
  }

  private async runCustom(options: RunOptions): Promise<OrchestratorResult> {
    const agentNames = options.router!(options.task, [...this.agentMap.values()]);
    return this.runPipeline({ ...options, agentSequence: agentNames, flow: 'pipeline' });
  }

  private resolveAgents(names?: string[]): Agent[] {
    if (!names) return [...this.agentMap.values()];
    return names.map(name => {
      const agent = this.agentMap.get(name);
      if (!agent) throw new Error(`Agent not found: ${name}`);
      return agent;
    });
  }

  private buildResult(output: string, steps: AgentResult[]): OrchestratorResult {
    return {
      output,
      steps,
      totalUsage: steps.reduce(
        (acc, s) => ({
          inputTokens: acc.inputTokens + s.usage.inputTokens,
          outputTokens: acc.outputTokens + s.usage.outputTokens,
        }),
        { inputTokens: 0, outputTokens: 0 }
      ),
    };
  }
}

export function createOrchestrator(options: OrchestratorOptions): Orchestrator {
  return new Orchestrator(options);
}
