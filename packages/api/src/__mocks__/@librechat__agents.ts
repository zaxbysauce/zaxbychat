export enum Providers {
  OPENAI = 'openAI',
  ANTHROPIC = 'anthropic',
  AZURE = 'azureOpenAI',
  GOOGLE = 'google',
  VERTEXAI = 'vertexai',
  BEDROCK = 'bedrock',
  MISTRALAI = 'mistralai',
  MISTRAL = 'mistral',
  DEEPSEEK = 'deepseek',
  MOONSHOT = 'moonshot',
  OPENROUTER = 'openrouter',
  XAI = 'xai',
}
export const Run = { create: jest.fn(), processStream: jest.fn() };
export const Constants = {};
