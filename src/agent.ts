import Anthropic from '@anthropic-ai/sdk';
import { ToolDefinition, ToolRegistry, toAnthropicTool } from './tool.js';
import { ConversationMemory } from './memory.js';

export type AgentOptions = {
  name: string;
  model?: string;
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  memory?: ConversationMemory;
};

export type AgentResult = {
  agentName: string;
  output: string;
  toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
  usage: { inputTokens: number; outputTokens: number };
};

export class Agent {
  readonly name: string;
  private client: Anthropic;
  private model: string;
  private system: string;
  private registry: ToolRegistry;
  private maxTokens: number;
  private temperature: number;
  private memory?: ConversationMemory;

  constructor(options: AgentOptions) {
    this.name = options.name;
    this.client = new Anthropic();
    this.model = options.model ?? 'claude-sonnet-4-6';
    this.system = options.system ?? 'You are a helpful assistant.';
    this.maxTokens = options.maxTokens ?? 4096;
    this.temperature = options.temperature ?? 0;
    this.memory = options.memory;

    this.registry = new ToolRegistry();
    for (const t of options.tools ?? []) {
      this.registry.register(t);
    }
  }

  async run(input: string): Promise<AgentResult> {
    this.memory?.addMessage(this.name, 'user', input);

    const history = this.memory?.getHistory(this.name) ?? [];
    const messages: Anthropic.MessageParam[] = history.length > 0
      ? history.map(h => ({ role: h.role, content: h.content }))
      : [{ role: 'user', content: input }];

    const tools = this.registry.toAnthropic();
    const toolCalls: AgentResult['toolCalls'] = [];
    let totalInput = 0;
    let totalOutput = 0;

    while (true) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: this.system,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      });

      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find(b => b.type === 'text');
        const output = textBlock?.type === 'text' ? textBlock.text : '';
        this.memory?.addMessage(this.name, 'assistant', output);
        return {
          agentName: this.name,
          output,
          toolCalls,
          usage: { inputTokens: totalInput, outputTokens: totalOutput },
        };
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          const result = await this.registry.execute(block.name, block.input as Record<string, unknown>);
          toolCalls.push({ tool: block.name, input: block.input, output: result });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        }

        messages.push({ role: 'user', content: toolResults });
      }
    }
  }

  async *stream(input: string): AsyncGenerator<string> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input }];

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}

export function createAgent(options: AgentOptions): Agent {
  return new Agent(options);
}
