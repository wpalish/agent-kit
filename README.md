# agent-kit

> Multi-agent orchestration for Claude. Build parallel, tool-using, memory-aware agent systems with a clean TypeScript API.

```bash
npm install @wpalish/agent-kit
```

## Why

Most "agent frameworks" are either opinionated wrappers around a single LLM call, or sprawling systems with 40 abstraction layers. agent-kit is neither.

It's the Lego bricks: a **tool registry**, a **memory store**, a **runner**, and an **orchestrator**. You decide the topology. Swarm, pipeline, supervisor/worker — compose what you need.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Orchestrator                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Agent A  │  │  Agent B  │  │   Agent C    │  │
│  │ (planner) │  │ (search) │  │  (executor)  │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       └──────────────┴───────────────┘           │
│                      │                           │
│              ┌───────┴────────┐                  │
│              │  Shared Memory │                  │
│              │  Tool Registry │                  │
│              └────────────────┘                  │
└─────────────────────────────────────────────────┘
```

## Quickstart

```typescript
import { createOrchestrator, createAgent, tool } from '@wpalish/agent-kit';

const searchTool = tool({
  name: 'web_search',
  description: 'Search the web for information',
  parameters: { query: { type: 'string', required: true } },
  execute: async ({ query }) => {
    // your search implementation
    return { results: [] };
  },
});

const researchAgent = createAgent({
  name: 'researcher',
  model: 'claude-opus-4-8',
  tools: [searchTool],
  system: 'You are a research agent. Search for information and return structured findings.',
});

const writerAgent = createAgent({
  name: 'writer',
  model: 'claude-sonnet-4-6',
  system: 'You are a writing agent. Transform research findings into clear prose.',
});

const orchestrator = createOrchestrator({
  agents: [researchAgent, writerAgent],
  memory: { ttl: 3600 },
});

const result = await orchestrator.run({
  task: 'Research the latest TypeScript features and write a summary',
  flow: 'pipeline', // researcher → writer
});

console.log(result.output);
```

## Core Concepts

### Tool Registry

```typescript
import { ToolRegistry } from '@wpalish/agent-kit';

const registry = new ToolRegistry();
registry.register(searchTool);
registry.register(calculatorTool);

// Agents automatically get tools from the registry
const agent = createAgent({ tools: registry.getAll() });
```

### Memory Store

```typescript
import { MemoryStore } from '@wpalish/agent-kit';

const memory = new MemoryStore({ backend: 'redis', ttl: 3600 });

// Agents share memory across turns
memory.set('research_context', { topic: 'TypeScript', findings: [...] });
const context = await memory.get('research_context');

// Semantic similarity search
const related = await memory.search('TypeScript generics', { limit: 5 });
```

### Parallel Execution

```typescript
const orchestrator = createOrchestrator({ agents: [agentA, agentB, agentC] });

// Run agents in parallel, collect results
const results = await orchestrator.runParallel([
  { agent: 'agentA', task: 'Analyze topic from angle A' },
  { agent: 'agentB', task: 'Analyze topic from angle B' },
  { agent: 'agentC', task: 'Analyze topic from angle C' },
]);

// Synthesize with a final agent
const synthesis = await orchestrator.synthesize(results, { agent: 'synthesizer' });
```

### Streaming

```typescript
for await (const chunk of orchestrator.stream({ task, flow: 'pipeline' })) {
  process.stdout.write(chunk.delta);
}
```

## Flows

| Flow | Description |
|------|-------------|
| `pipeline` | Sequential: each agent's output feeds the next |
| `parallel` | All agents run simultaneously, results collected |
| `supervisor` | A planner agent delegates to specialist agents |
| `swarm` | Agents self-select tasks from a shared queue |
| `custom` | Define your own routing function |

## API Reference

See [docs/api.md](./docs/api.md) for full reference.

## License

MIT © [wpalish](https://github.com/wpalish)
