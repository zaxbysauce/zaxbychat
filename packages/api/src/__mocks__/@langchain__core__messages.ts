export class HumanMessage {
  content: string;
  constructor(content: string) {
    this.content = content;
  }
}
export class SystemMessage {
  content: string;
  constructor(content: string) {
    this.content = content;
  }
}
export class AIMessage {
  content: string;
  constructor(content: string) {
    this.content = content;
  }
}
export type BaseMessage = { content: string };
