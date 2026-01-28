// Jest setup file
// Suppress console logs during tests (optional - comment out to see logs)
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
