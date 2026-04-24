export class Tokenizer {
  constructor(_name?: string) {}
  encode(text: string): number[] {
    return text.split(/\s+/).filter(Boolean).map((_, i) => i);
  }
  decode(tokens: number[]): string {
    return tokens.map(() => '').join(' ');
  }
}
