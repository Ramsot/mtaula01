// Packages below ship no TypeScript declarations; declare them here so
// dynamic imports type-check without @ts-ignore everywhere.

declare module 'sharp' {
  const sharp: any;
  export default sharp;
}

declare module 'google-it' {
  const googleIt: (options: { query: string; limit?: number }) => Promise<any[]>;
  export default googleIt;
}

declare module 'translatte' {
  const translatte: (
    text: string,
    options: { to: string }
  ) => Promise<{ text: string; from?: string; to?: string }>;
  export default translatte;
}
