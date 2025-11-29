/**
 * Global setup file for E2E tests
 * Runs once before all E2E tests
 */

// Extend Jest's default timeout globally
jest.setTimeout(30000);

// Suppress console output during tests if needed
// Uncomment to filter out expected error logs
// const originalError = console.error;
// console.error = (...args: any[]) => {
//   if (
//     typeof args[0] === 'string' &&
//     (args[0].includes('Expected error') || args[0].includes('Test error'))
//   ) {
//     return;
//   }
//   originalError(...args);
// };

// Global test utilities can be exported here
export {};

