// Minimal react-native stand-in for the node test environment. Only the bits
// the units under test actually touch.
export const Platform = {
  OS: 'android',
  select: <T,>(specifics: { android?: T; ios?: T; default?: T }): T | undefined =>
    specifics.android ?? specifics.default,
};

export default { Platform };
