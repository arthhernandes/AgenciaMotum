import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'chatText', standalone: true, pure: true })
export class ChatTextPipe implements PipeTransform {
  transform(value: string): string {
    // Keep the response as escaped text. Normalize formatting from providers and
    // older conversation messages without introducing HTML into the chat.
    return value
      .replace(/^\s*```[^\n]*\n/gm, '')
      .replace(/^\s*```\s*$/gm, '')
      .replace(/^\s*\*{3,}\s*$/gm, '')
      .replace(/\*{2,3}([^*]+?)\*{2,3}/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/__([^_]+?)__/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^[ \t]*[*+-]\s+/gm, '• ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
