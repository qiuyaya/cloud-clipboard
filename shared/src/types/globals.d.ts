declare global {
  const crypto: {
    randomUUID(): string;
  };
}

export {};