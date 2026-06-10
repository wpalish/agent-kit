import Anthropic from '@anthropic-ai/sdk';

export type ParameterSchema = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
};

export type ToolDefinition<TParams = Record<string, unknown>, TResult = unknown> = {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  execute: (params: TParams) => Promise<TResult>;
};

export function tool<TParams = Record<string, unknown>, TResult = unknown>(
  def: ToolDefinition<TParams, TResult>
): ToolDefinition<TParams, TResult> {
  return def;
}

export function toAnthropicTool(def: ToolDefinition): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(def.parameters).map(([key, schema]) => [
          key,
          {
            type: schema.type,
            description: schema.description,
          },
        ])
      ),
      required: Object.entries(def.parameters)
        .filter(([, schema]) => schema.required)
        .map(([key]) => key),
    },
  };
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  toAnthropic(): Anthropic.Tool[] {
    return this.getAll().map(toAnthropicTool);
  }

  async execute(name: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool.execute(params);
  }
}
