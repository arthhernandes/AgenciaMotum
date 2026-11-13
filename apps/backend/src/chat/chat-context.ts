export type ChatToolContext = { name: string; arguments: string; output: string };
export type SavedChatMessage = { role: 'user' | 'assistant'; content: string; toolContext?: ChatToolContext[] };

/** Keep the original request and recent turns; past tool results remain data. */
export function conversationContext(saved: SavedChatMessage[], latest: SavedChatMessage) {
  const recent: SavedChatMessage[] = [];
  let characters = latest.content.length;
  let start = saved.length;
  while (start > 0 && recent.length < 16) {
    const message = saved[start - 1];
    if (characters + message.content.length > 12000) break;
    recent.unshift(message);characters += message.content.length;start--;
  }
  const olderUsers = saved.slice(0, start).filter(m => m.role === 'user');
  const anchors = olderUsers.length ? [olderUsers[0], ...olderUsers.slice(-5).filter(m => m !== olderUsers[0])] : [];
  const context = anchors.map(m => m.content.slice(0, 1200)).join('\n\n');
  return { messages: [...recent, latest], decisionMessages: [...saved, latest], earlierRequests: context, userRequests: [...anchors, ...recent.filter(m => m.role === 'user'), latest].map(m => m.content).join('\n\n').slice(-16000) };
}

export function modelContext(messages: SavedChatMessage[]) {
  const input: any[] = [];
  let budget = 10000;
  const selected = new Set<ChatToolContext>();
  for (const message of [...messages].reverse()) for (const call of [...(message.toolContext ?? [])].reverse()) {
    if (call.output.length + call.arguments.length <= budget) { selected.add(call);budget -= call.output.length + call.arguments.length; }
  }
  let id = 0;
  for (const message of messages) {
    for (const call of message.toolContext ?? []) if (selected.has(call)) {
      const callId = `history_${++id}`;
      input.push({ type: 'function_call', call_id: callId, name: call.name, arguments: call.arguments }, { type: 'function_call_output', call_id: callId, output: call.output });
    }
    input.push({ role: message.role, content: message.content });
  }
  return input;
}

/** Bound accumulated results without cutting a JSON document in half. */
export function boundToolInput(input: any[]) {
  let remaining = 12000;
  const selected = new Set<any>();
  for (const item of [...input].reverse()) if (item.type === 'function_call_output') {
    if (item.output.length <= remaining) { selected.add(item);remaining -= item.output.length; }
  }
  return input.map(item => item.type === 'function_call_output' && !selected.has(item)
    ? { ...item, output: JSON.stringify({ consultaAnteriorOmitida: true, orientacao: 'Resultado omitido para preservar o contexto. Mantenha o pedido original e consulte apenas os dados específicos necessários, se não estiverem nas consultas mais recentes.' }) }
    : item);
}
