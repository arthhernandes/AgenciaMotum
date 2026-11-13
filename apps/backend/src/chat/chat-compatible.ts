import { CHAT_TOOLS } from './chat.tools';
import { randomUUID } from 'crypto';

/** Translate the chat's internal tool protocol to OpenAI-compatible Chat Completions. */
export function compatibleMessages(input: any[], instructions: string) {
  const messages: any[] = [{ role: 'system', content: instructions }];
  for (const item of input) {
    if (item.role && typeof item.content === 'string') {
      messages.push({ role: item.role, content: item.content });
    } else if (item.type === 'message') {
      const content = (item.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('\n');
      if (content) messages.push({ role: 'assistant', content });
    } else if (item.type === 'function_call') {
      let message = messages.at(-1);
      if (message?.role !== 'assistant') {
        message = { role: 'assistant', content: null };
        messages.push(message);
      }
      message.tool_calls ??= [];
      message.tool_calls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
    } else if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: item.output });
    }
  }
  return messages;
}

export function compatibleTools() {
  return CHAT_TOOLS.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));
}

export function compatibleOutput(data: any) {
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error('Resposta incompatível com Chat Completions.');
  const output: any[] = [];
  if (typeof message.content === 'string' && message.content.trim()) {
    output.push({ type: 'message', content: [{ type: 'output_text', text: message.content }] });
  }
  for (const call of message.tool_calls ?? []) {
    output.push({ type: 'function_call', call_id: call.id || randomUUID(), name: call.function?.name,
      arguments: typeof call.function?.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function?.arguments ?? {}) });
  }
  return { output };
}

export function compatibleEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Endereço de IA inválido.');
  let path = url.pathname.replace(/\/$/, '');
  if (!path) path = '/v1';
  url.pathname = `${path}/chat/completions`;
  return url.toString();
}
