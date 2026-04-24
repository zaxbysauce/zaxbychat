import {
  compatibilityTypeInitMap,
  resolveInitFromCompatibility,
} from '../providers';

jest.mock('../../anthropic/initialize', () => ({ initializeAnthropic: jest.fn() }));
jest.mock('../../bedrock/initialize', () => ({ initializeBedrock: jest.fn() }));
jest.mock('../../custom/initialize', () => ({ initializeCustom: jest.fn() }));
jest.mock('../../google/initialize', () => ({ initializeGoogle: jest.fn() }));
jest.mock('../../openai/initialize', () => ({ initializeOpenAI: jest.fn() }));
jest.mock('../../../app/config', () => ({ getCustomEndpointConfig: jest.fn() }));

const { initializeAnthropic } = jest.requireMock('../../anthropic/initialize');
const { initializeBedrock } = jest.requireMock('../../bedrock/initialize');
const { initializeCustom } = jest.requireMock('../../custom/initialize');
const { initializeGoogle } = jest.requireMock('../../google/initialize');
const { initializeOpenAI } = jest.requireMock('../../openai/initialize');

describe('compatibilityTypeInitMap — 7 dispatch paths', () => {
  it('openai → initializeOpenAI', () => {
    expect(compatibilityTypeInitMap['openai']).toBe(initializeOpenAI);
  });

  it('azure_openai → initializeOpenAI', () => {
    expect(compatibilityTypeInitMap['azure_openai']).toBe(initializeOpenAI);
  });

  it('google → initializeGoogle', () => {
    expect(compatibilityTypeInitMap['google']).toBe(initializeGoogle);
  });

  it('anthropic → initializeAnthropic', () => {
    expect(compatibilityTypeInitMap['anthropic']).toBe(initializeAnthropic);
  });

  it('bedrock → initializeBedrock', () => {
    expect(compatibilityTypeInitMap['bedrock']).toBe(initializeBedrock);
  });

  it('generic_openai_compatible → initializeCustom', () => {
    expect(compatibilityTypeInitMap['generic_openai_compatible']).toBe(initializeCustom);
  });

  it('unknown compatibilityType → undefined', () => {
    expect(resolveInitFromCompatibility('future_unknown_type')).toBeUndefined();
  });
});

describe('resolveInitFromCompatibility', () => {
  it('resolves openai', () => {
    expect(resolveInitFromCompatibility('openai')).toBe(initializeOpenAI);
  });

  it('resolves generic_openai_compatible', () => {
    expect(resolveInitFromCompatibility('generic_openai_compatible')).toBe(initializeCustom);
  });

  it('returns undefined for empty string', () => {
    expect(resolveInitFromCompatibility('')).toBeUndefined();
  });
});
